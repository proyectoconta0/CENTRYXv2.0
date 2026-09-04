import io
import logging
import re
import traceback
from calendar import monthrange
from collections import defaultdict, deque
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form

logger = logging.getLogger(__name__)
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.flujo_caja import ConciliacionBancaria, MovimientoConciliacion
from app.models.models import Gasto, PagoGasto, Usuario, CuotaPrestamo, Prestamo, Garantia, PagoGarantia, OrdenPago
from app.models.comercial import VentaComercial, PagoCobranza, CuentaBancaria, OrdenCobro
from app.core.security import get_current_usuario, get_empresa_id
from app.services.conciliacion_service import (
    sincronizar_y_conciliar, sincronizar_pagos_periodo, auto_match_movimientos,
)
from app.routers.ordenes_cobro import _serializar_orden, _serializar_detalle
from app.services.auditoria_service import registrar_log, ip_de
from database import get_db

flujo_router        = APIRouter()
conciliacion_router = APIRouter()

MESES_ES = {1:"Ene",2:"Feb",3:"Mar",4:"Abr",5:"May",6:"Jun",
            7:"Jul",8:"Ago",9:"Sep",10:"Oct",11:"Nov",12:"Dic"}

MAPEO_COLUMNAS = {
    "BCP":        {"fecha":["Fecha Operación","Fecha"],     "descripcion":["Descripción","Descripcion"],  "cargo":["Cargo"],             "abono":["Abono"]},
    "Interbank":  {"fecha":["Fecha"],                        "descripcion":["Descripción","Descripcion"],  "cargo":["Débito","Debito"],   "abono":["Crédito","Credito"]},
    "BBVA":       {"fecha":["Fecha Valor"],                  "descripcion":["Concepto"],                   "cargo":["Importe Débito","Importe Debito"], "abono":["Importe Crédito","Importe Credito"]},
    "Scotiabank": {"fecha":["Fecha"],                        "descripcion":["Descripción","Descripcion"],  "cargo":["Débitos","Debitos"], "abono":["Créditos","Creditos"]},
}

KEYWORDS_GASTO_BANCARIO = (
    "itf", "i.t.f", "comision", "comisión", "mantenimiento", "mantenim",
    "porte", "seguro", "cargo", "costo", "detrac", "envio.est", "mant td",
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _primer_dia(anio: int, mes: int) -> date:
    return date(anio, mes, 1)

def _ultimo_dia(anio: int, mes: int) -> date:
    _, ultimo = monthrange(anio, mes)
    return date(anio, mes, ultimo)

def _siguiente_mes(anio: int, mes: int):
    return (anio + 1, 1) if mes == 12 else (anio, mes + 1)

def _find_col(df, candidates: list):
    cols_lower = {c.lower(): c for c in df.columns}
    for name in candidates:
        if name in df.columns:
            return name
        if name.lower() in cols_lower:
            return cols_lower[name.lower()]
    return None

def _detectar_gasto_bancario(descripcion: str) -> bool:
    desc = (descripcion or "").lower()
    # "PAGO DETRAC ..." es el pago de la detracción en sí (transferencia a
    # Banco de la Nación) — no es un gasto bancario. Solo la comisión que el
    # banco cobra por procesarlo ("COMIS PAGO DETRACCION") sí lo es, así que
    # la exclusión no debe aplicar si la línea también trae "COMIS".
    if "detrac" in desc and "comis" not in desc:
        return False
    return any(kw in desc for kw in KEYWORDS_GASTO_BANCARIO)


def _proximo_gb(db: Session, empresa_id: Optional[int] = None) -> str:
    q = db.query(Gasto.numero_comprobante).filter(
        Gasto.tipo_comprobante == "Gastos Bancarios",
        Gasto.numero_comprobante.isnot(None),
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    rows = q.all()
    max_num = 0
    for (nc,) in rows:
        if nc and nc.upper().startswith("GB-"):
            try:
                n = int(nc[3:])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return f"GB-{max_num + 1:04d}"


def _buscar_gb_existente(db: Session, monto: float, fecha: date, excluir_ids: set = frozenset(), empresa_id: Optional[int] = None) -> Optional[Gasto]:
    """Busca un Gasto Bancario (GB) ya registrado con el mismo monto y fecha
    (±2 días), para evitar crear un GB duplicado cuando se elimina y se vuelve
    a procesar/conciliar el mismo período."""
    monto_r = round(monto, 2)
    q = db.query(Gasto).filter(
        Gasto.tipo_comprobante == "Gastos Bancarios",
        func.abs(Gasto.monto - monto_r) < 0.01,
        Gasto.fecha >= fecha - timedelta(days=2),
        Gasto.fecha <= fecha + timedelta(days=2),
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    candidatos = [g for g in q.all() if g.id not in excluir_ids]
    if not candidatos:
        return None
    return min(candidatos, key=lambda g: abs((fecha - g.fecha).days))


def _nombre_banco_conciliacion(db: Session, conc: ConciliacionBancaria) -> str:
    if conc.cuenta_bancaria_id:
        cuenta = db.query(CuentaBancaria).filter(CuentaBancaria.id == conc.cuenta_bancaria_id).first()
        if cuenta:
            return cuenta.banco
    return conc.banco or ""


def _numero_cuenta_conciliacion(db: Session, conc: ConciliacionBancaria) -> Optional[str]:
    """Número de cuenta de la CuentaBancaria vinculada a la conciliación, para
    dejar el PagoGasto del GB correctamente vinculado (mismos campos
    banco/numero_cuenta que usa un pago manual normal, ver
    registrar_pago_gasto en gastos.py)."""
    if conc.cuenta_bancaria_id:
        cuenta = db.query(CuentaBancaria).filter(CuentaBancaria.id == conc.cuenta_bancaria_id).first()
        if cuenta:
            return cuenta.numero_cuenta
    return None


def _registrar_pago_gb(db: Session, g: Gasto, monto: float, fecha: date, banco: str, numero_cuenta: Optional[str] = None):
    """Registra el pago automático de un Gasto Bancario (GB): fue debitado
    directamente de la cuenta conciliada, por lo que se paga solo. Evita
    duplicar el pago si el GB fue reutilizado (_buscar_gb_existente) y ya
    tiene un pago registrado."""
    ya_pagado = db.query(PagoGasto).filter(PagoGasto.gasto_id == g.id).first()
    if ya_pagado:
        return
    db.add(PagoGasto(
        gasto_id=g.id,
        monto_pagado=round(monto, 2),
        fecha_pago=fecha,
        metodo_pago="Transferencia",
        banco=banco,
        numero_cuenta=numero_cuenta,
        created_at=date.today(),
    ))
    g.saldo_pendiente = 0.0
    g.estado_pago     = "Pagado"


def _serialize_movimiento(m: MovimientoConciliacion) -> dict:
    return {
        "id":                      m.id,
        "fecha":                   str(m.fecha),
        "descripcion":             m.descripcion or "",
        "monto":                   round(float(m.monto), 2),
        "tipo":                    m.tipo,
        "origen":                  m.origen,
        "conciliado":              bool(m.conciliado),
        "es_gasto_bancario":       bool(m.es_gasto_bancario or False),
        "referencia_sistema_id":   m.referencia_sistema_id,
        "referencia_sistema_tipo": m.referencia_sistema_tipo,
    }

def _serialize_conciliacion(c: ConciliacionBancaria, db: Optional[Session] = None) -> dict:
    total = len(c.movimientos) if c.movimientos else 0

    # Resolver el nombre real del banco desde cuentas_bancarias (join por
    # cuenta_bancaria_id). Tiene prioridad sobre c.banco para que también se
    # corrijan conciliaciones antiguas que hayan quedado guardadas como
    # "Plantilla" u otro valor genérico.
    cuenta = None
    if db is not None and c.cuenta_bancaria_id:
        cuenta = db.query(CuentaBancaria).filter(CuentaBancaria.id == c.cuenta_bancaria_id).first()
    banco_nombre = cuenta.banco if cuenta else (c.banco or "")

    return {
        "id":                    c.id,
        "cuenta_bancaria_id":    c.cuenta_bancaria_id,
        "periodo_desde":         str(c.periodo_desde),
        "periodo_hasta":         str(c.periodo_hasta),
        "banco":                 banco_nombre,
        "numero_cuenta":         cuenta.numero_cuenta if cuenta else None,
        "tipo_cuenta":           cuenta.tipo_cuenta if cuenta else None,
        "saldo_sistema":         round(float(c.saldo_sistema or 0), 2),
        "saldo_banco":           round(float(c.saldo_banco or 0), 2),
        "diferencia":            round(float(c.diferencia or 0), 2),
        "porcentaje_conciliado": round(float(c.porcentaje_conciliado or 0), 1),
        "estado":                c.estado or "En proceso",
        "fecha_cierre":          str(c.fecha_cierre) if c.fecha_cierre else None,
        "created_at":            str(c.created_at) if c.created_at else None,
        "total_movimientos":     total,
    }


# ─── Parsers de archivo ───────────────────────────────────────────────────────

def _procesar_dataframe(df, banco: str) -> list:
    import pandas as pd
    mapeo = MAPEO_COLUMNAS.get(banco, {
        "fecha":       ["Fecha","Date","fecha"],
        "descripcion": ["Descripción","Descripcion","Description","Concepto"],
        "cargo":       ["Cargo","Débito","Debito","Débitos"],
        "abono":       ["Abono","Crédito","Credito","Créditos"],
    })
    col_fecha = _find_col(df, mapeo.get("fecha", []))
    col_desc  = _find_col(df, mapeo.get("descripcion", []))
    col_cargo = _find_col(df, mapeo.get("cargo", []))
    col_abono = _find_col(df, mapeo.get("abono", []))
    if not col_fecha:
        raise ValueError("No se encontró columna de fecha en el archivo")

    movimientos = []
    for _, row in df.iterrows():
        try:
            fecha = pd.to_datetime(row[col_fecha], dayfirst=True).date()
        except Exception:
            continue
        descripcion = str(row[col_desc]).strip() if col_desc and pd.notna(row.get(col_desc)) else ""

        def _num(val):
            if val is None: return 0.0
            try: return float(str(val).replace(",", "").replace("S/", "").strip() or 0)
            except: return 0.0

        cargo = _num(row[col_cargo]) if col_cargo and pd.notna(row.get(col_cargo)) else 0.0
        abono = _num(row[col_abono]) if col_abono and pd.notna(row.get(col_abono)) else 0.0
        if abono > 0:
            movimientos.append({"fecha": fecha, "descripcion": descripcion, "monto": abono, "tipo": "ingreso"})
        if cargo > 0:
            movimientos.append({"fecha": fecha, "descripcion": descripcion, "monto": cargo, "tipo": "egreso"})
    return movimientos

def _parsear_excel(contenido: bytes, banco: str) -> list:
    import pandas as pd
    df = pd.read_excel(io.BytesIO(contenido), header=0)
    df.columns = df.columns.astype(str).str.strip()
    return _procesar_dataframe(df, banco)

def _parsear_csv(contenido: bytes, banco: str) -> list:
    import pandas as pd
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            df = pd.read_csv(io.BytesIO(contenido), encoding=enc)
            break
        except Exception:
            continue
    df.columns = df.columns.astype(str).str.strip()
    return _procesar_dataframe(df, banco)

def _parsear_pdf(contenido: bytes) -> list:
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(500, "pdfplumber no instalado: pip install pdfplumber")
    import re
    from datetime import datetime as dt

    movimientos = []
    with pdfplumber.open(io.BytesIO(contenido)) as pdf:
        for page in pdf.pages:
            for table in (page.extract_tables() or []):
                if not table:
                    continue
                headers = [str(h).strip().lower() if h else "" for h in table[0]]
                date_col  = next((i for i, h in enumerate(headers) if "fecha" in h or "date" in h), None)
                desc_col  = next((i for i, h in enumerate(headers) if "desc" in h or "concepto" in h), None)
                cargo_col = next((i for i, h in enumerate(headers) if "cargo" in h or "débit" in h or "debit" in h), None)
                abono_col = next((i for i, h in enumerate(headers) if "abono" in h or "crédit" in h or "credit" in h), None)
                if date_col is None:
                    continue
                for row in table[1:]:
                    if not row:
                        continue
                    try:
                        fecha_str = str(row[date_col]).strip()
                        fecha = None
                        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
                            try: fecha = dt.strptime(fecha_str, fmt).date(); break
                            except: pass
                        if not fecha:
                            continue
                        desc = str(row[desc_col]).strip() if desc_col is not None else ""
                        def _pm(v):
                            if v is None: return 0.0
                            s = re.sub(r"[^\d.]", "", str(v).replace(",", ".").strip())
                            try: return float(s)
                            except: return 0.0
                        cargo = _pm(row[cargo_col]) if cargo_col is not None else 0.0
                        abono = _pm(row[abono_col]) if abono_col is not None else 0.0
                        if abono > 0:
                            movimientos.append({"fecha": fecha, "descripcion": desc, "monto": abono, "tipo": "ingreso"})
                        if cargo > 0:
                            movimientos.append({"fecha": fecha, "descripcion": desc, "monto": cargo, "tipo": "egreso"})
                    except Exception:
                        continue
    return movimientos


def _norm_col(s: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").upper().strip()


def _parsear_plantilla(contenido: bytes, extension: str = "xlsx") -> list:
    import pandas as pd
    if extension == "csv":
        df = None
        for enc in ("utf-8", "latin-1", "cp1252"):
            try:
                df = pd.read_csv(io.BytesIO(contenido), encoding=enc)
                break
            except Exception:
                continue
        if df is None:
            raise ValueError("No se pudo leer el archivo CSV.")
    else:
        df = pd.read_excel(io.BytesIO(contenido), header=0)

    df.columns = df.columns.astype(str).str.strip()
    col_norm = {_norm_col(c): c for c in df.columns}

    col_fecha = col_norm.get("FECHA")
    col_desc  = col_norm.get("DESCRIPCION")   # DESCRIPCIÓN → DESCRIPCION tras normalizar
    col_monto = col_norm.get("MONTO")

    faltantes = [n for n, c in [("FECHA", col_fecha), ("DESCRIPCIÓN", col_desc),
                                  ("MONTO", col_monto)] if not c]
    if faltantes:
        raise ValueError(
            "El archivo no tiene el formato correcto. "
            "Por favor usa la plantilla descargable."
        )

    movs = []
    for _, row in df.iterrows():
        try:
            fecha = pd.to_datetime(row[col_fecha], dayfirst=True).date()
            desc  = str(row[col_desc]).strip() if pd.notna(row.get(col_desc)) else ""
            monto_raw = row[col_monto]
            monto = float(str(monto_raw).replace(",", "").replace("S/", "").strip() or 0) if pd.notna(monto_raw) else 0.0
            if monto == 0:
                continue
            tipo  = "ingreso" if monto > 0 else "egreso"
            movs.append({"fecha": fecha, "descripcion": desc, "monto": abs(monto), "tipo": tipo})
        except Exception:
            continue
    return movs


# ─── Estado de cuenta BCP en PDF ────────────────────────────────────────────
#
# A diferencia de _parsear_pdf (arriba, basado en extract_tables() — nunca se
# terminó de conectar a un endpoint porque los estados de cuenta de BCP no
# traen líneas de tabla detectables), esto extrae texto plano
# (extract_text()) y lo recorre con regex, que es lo que realmente funciona
# para este formato.

PATRON_PERIODO_BCP     = re.compile(r'DEL\s*(\d{2}/\d{2}/\d{4})\s*AL\s*(\d{2}/\d{2}/\d{4})')
PATRON_CUENTA_BCP       = re.compile(r'(\d{3}-\d{7}-\d-\d{2})')
PATRON_SALDO_INICIAL_BCP = re.compile(r'SALDO\s+CONTABLE\s+AL\s+\d{2}/\d{2}/\d{4}\s+([\d,]+\.\d{2})')
PATRON_MOVIMIENTO_BCP   = re.compile(
    r'(\d{2}-\d{2})\s+'
    r'(.+?)\s+'
    r'(TLC|BPI|VEN|POS|INT|CAJ)\s+'
    r'(?:[A-Z]{2,3}[\s\w]*?\s+)?'   # LUGAR opcional (SUC HUARAZ, etc)
    r'(?:\S+\s+)?'
    r'(\d{3}-\d{3})\s+'
    r'(\d+)\s+'
    r'(\d{2}:\d{2})\s+'
    r'(\w+)\s+'
    r'(\d{4})\s+'
    r'([\d,]+\.\d{2}-?)\s+'
    r'([\d,]+\.\d{2})'
)
# Cargos administrativos del banco (ITF, comisiones, envío de EECC): no traen
# canal por SUC-AGE/hora como una operación normal, solo el canal INT y a
# veces un símbolo ¥/* antes — de ahí que casi todos sus campos sean opcionales.
PATRON_CARGO_ADMIN_BCP = re.compile(
    r'^(\d{2}-\d{2})\s+'           # fecha dd-mm
    r'([A-Z][A-Z0-9\s\.\*]+?)\s+'  # descripción
    r'(?:[¥\*]\s+)?'               # símbolo ¥ o * opcional
    r'INT\s+'                      # canal INT
    r'(?:[\d\-–]+\s+)?'       # SUC-AGE opcional: acepta - y em dash –
    r'(?:\d+\s+)?'                 # NUM OP opcional
    r'(?:\d{2}:\d{2}\s+)?'         # HORA opcional
    r'(?:\w+\s+)?'                 # ORIGEN opcional
    r'(\d+)\s+'                    # TIPO (0909, 4923, etc)
    r'((?:[\d,]+)?\.\d{2}-?)\s+'   # CARGO/ABONO: parte entera opcional
    r'([\d,]+\.\d{2})',            # SALDO CONTABLE
    re.MULTILINE,
)


def _limpiar_monto_bcp(monto_str: str) -> float:
    return float(monto_str.replace(",", "").replace("-", ""))


def _extraer_estado_cuenta_bcp(texto: str, anio_referencia: int) -> dict:
    """Extrae período, N° de cuenta y movimientos de un estado de cuenta BCP
    (texto ya extraído del PDF con pdfplumber). Devuelve movs en la MISMA
    forma que _parsear_plantilla ({"fecha","descripcion","monto","tipo"}) para
    poder reutilizar _crear_conciliacion_desde_movs con cualquiera de las dos
    fuentes.

    Las líneas de movimiento en BCP solo traen día-mes ("02-05"), sin año —
    se usa el año del período detectado (fecha_inicio), y si el período cruza
    fin de año (p.ej. DEL 28/12/2025 AL 27/01/2026) los movimientos con mes
    menor al mes de inicio se asignan al año de fecha_fin."""
    match_periodo = PATRON_PERIODO_BCP.search(texto)
    fecha_inicio = match_periodo.group(1) if match_periodo else None
    fecha_fin    = match_periodo.group(2) if match_periodo else None

    anio_inicio, mes_inicio = anio_referencia, 1
    anio_fin = anio_referencia
    if fecha_inicio:
        d, m, a = fecha_inicio.split("/")
        mes_inicio, anio_inicio = int(m), int(a)
    if fecha_fin:
        anio_fin = int(fecha_fin.split("/")[-1])

    match_cuenta = PATRON_CUENTA_BCP.search(texto)
    numero_cuenta = match_cuenta.group(1) if match_cuenta else None

    match_saldo = PATRON_SALDO_INICIAL_BCP.search(texto)
    saldo_inicial = _limpiar_monto_bcp(match_saldo.group(1)) if match_saldo else 0.0

    movimientos = []
    for linea in texto.split("\n"):
        linea = linea.strip()
        if not linea:
            continue

        m = PATRON_MOVIMIENTO_BCP.search(linea)
        if m:
            fecha_str       = m.group(1)          # "02-05"
            # Medio y N° de operación se anexan a la descripción — el modelo
            # MovimientoConciliacion no tiene columnas propias para ellos.
            descripcion     = f"{m.group(2).strip()} — {m.group(3)} — Op.{m.group(5)}"
            cargo_abono_str = m.group(9)
        else:
            m = PATRON_CARGO_ADMIN_BCP.search(linea)
            if not m:
                continue
            fecha_str       = m.group(1)          # "02-05"
            descripcion     = m.group(2).strip()
            cargo_abono_str = m.group(4)

        try:
            dia, mes = map(int, fecha_str.split("-"))
            anio_mov = anio_fin if (anio_fin != anio_inicio and mes < mes_inicio) else anio_inicio
            fecha_mov = date(anio_mov, mes, dia)
        except ValueError:
            continue

        es_cargo = cargo_abono_str.endswith("-")
        monto = _limpiar_monto_bcp(cargo_abono_str)
        if monto <= 0:
            continue

        movimientos.append({
            "fecha":       fecha_mov,
            "descripcion": descripcion,
            "monto":       monto,
            "tipo":        "egreso" if es_cargo else "ingreso",
        })

    return {
        "numero_cuenta": numero_cuenta,
        "fecha_inicio":  fecha_inicio,
        "fecha_fin":     fecha_fin,
        "saldo_inicial": saldo_inicial,
        "movimientos":   movimientos,
    }


def _crear_conciliacion_desde_movs(
    db: Session, movs: list, cuenta_bancaria_id: Optional[int],
    periodo_desde: date, periodo_hasta: date, formato_archivo: str,
    empresa_id: Optional[int] = None,
) -> ConciliacionBancaria:
    """Crea la ConciliacionBancaria + sus MovimientoConciliacion (origen=banco)
    a partir de una lista de movs ya parseados — compartido entre
    importar_estado_cuenta (Excel/CSV) e importar_estado_cuenta_pdf (BCP)."""
    banco_nombre = "Sin cuenta asignada"
    if cuenta_bancaria_id:
        q = db.query(CuentaBancaria).filter(CuentaBancaria.id == cuenta_bancaria_id)
        if empresa_id is not None:
            q = q.filter(CuentaBancaria.empresa_id == empresa_id)
        cuenta_bancaria = q.first()
        if cuenta_bancaria:
            banco_nombre = cuenta_bancaria.banco

    conc = ConciliacionBancaria(
        cuenta_bancaria_id=cuenta_bancaria_id,
        periodo_desde=periodo_desde,
        periodo_hasta=periodo_hasta,
        banco=banco_nombre,
        formato_archivo=formato_archivo,
        saldo_sistema=0, saldo_banco=0, diferencia=0,
        porcentaje_conciliado=0,
        estado="En proceso",
        created_at=date.today(),
        empresa_id=empresa_id,
    )
    db.add(conc)
    db.flush()

    for m in movs:
        desc = m.get("descripcion", "")
        db.add(MovimientoConciliacion(
            conciliacion_id=conc.id,
            fecha=m["fecha"],
            descripcion=desc,
            monto=m["monto"],
            tipo=m["tipo"],
            origen="banco",
            conciliado=False,
            es_gasto_bancario=_detectar_gasto_bancario(desc),
            created_at=date.today(),
            empresa_id=empresa_id,
        ))

    db.commit()
    db.refresh(conc)
    return conc


# ═══════════════════════════════════════════════════════════════════════════════
# FLUJO DE CAJA PROYECTADO
# ═══════════════════════════════════════════════════════════════════════════════

@flujo_router.get("/resumen-kpis")
def resumen_kpis(db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q_cobrado = db.query(func.sum(PagoCobranza.monto_pagado))
    if empresa_id is not None:
        q_cobrado = q_cobrado.filter(PagoCobranza.empresa_id == empresa_id)
    total_cobrado = float(q_cobrado.scalar() or 0)

    q_pagado = db.query(func.sum(PagoGasto.monto_pagado))
    if empresa_id is not None:
        q_pagado = q_pagado.filter(PagoGasto.empresa_id == empresa_id)
    total_pagado  = float(q_pagado.scalar() or 0)
    saldo_actual  = total_cobrado - total_pagado

    hoy        = date.today()
    en_30_dias = hoy + timedelta(days=30)

    q_ing30 = db.query(func.sum(VentaComercial.saldo_pendiente)).filter(
        VentaComercial.estado_cobranza.in_(["Pendiente", "Pago Parcial"]),
        VentaComercial.fecha_vencimiento >= hoy,
        VentaComercial.fecha_vencimiento <= en_30_dias,
        VentaComercial.saldo_pendiente > 0,
    )
    if empresa_id is not None:
        q_ing30 = q_ing30.filter(VentaComercial.empresa_id == empresa_id)
    ingresos_30 = float(q_ing30.scalar() or 0)

    q_egr30 = db.query(func.sum(Gasto.saldo_pendiente)).filter(
        Gasto.estado_pago.in_(["Pendiente", "Pago Parcial"]),
        Gasto.fecha_vencimiento >= hoy,
        Gasto.fecha_vencimiento <= en_30_dias,
        Gasto.saldo_pendiente > 0,
    )
    if empresa_id is not None:
        q_egr30 = q_egr30.filter(Gasto.empresa_id == empresa_id)
    egresos_30 = float(q_egr30.scalar() or 0)

    return {
        "saldo_actual":         round(saldo_actual, 2),
        "ingresos_proyectados": round(ingresos_30, 2),
        "egresos_proyectados":  round(egresos_30, 2),
        "saldo_proyectado":     round(saldo_actual + ingresos_30 - egresos_30, 2),
    }


@flujo_router.get("/proyectado")
def flujo_proyectado(meses: int = 6, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    hoy    = date.today()
    anio   = hoy.year
    mes    = hoy.month
    saldo_acum = 0.0
    resultado  = []

    for _ in range(meses):
        primer = _primer_dia(anio, mes)
        ultimo = _ultimo_dia(anio, mes)
        label  = f"{MESES_ES[mes]} {anio}"

        q_ing = db.query(VentaComercial).filter(
            VentaComercial.estado_cobranza.in_(["Pendiente", "Pago Parcial"]),
            VentaComercial.fecha_vencimiento >= primer,
            VentaComercial.fecha_vencimiento <= ultimo,
            VentaComercial.saldo_pendiente > 0,
        )
        if empresa_id is not None:
            q_ing = q_ing.filter(VentaComercial.empresa_id == empresa_id)
        ingresos_rows = q_ing.all()

        q_egr = db.query(Gasto).filter(
            Gasto.estado_pago.in_(["Pendiente", "Pago Parcial"]),
            Gasto.fecha_vencimiento >= primer,
            Gasto.fecha_vencimiento <= ultimo,
            Gasto.saldo_pendiente > 0,
        )
        if empresa_id is not None:
            q_egr = q_egr.filter(Gasto.empresa_id == empresa_id)
        egresos_rows = q_egr.all()

        total_ing = sum(float(r.saldo_pendiente or 0) for r in ingresos_rows)
        total_egr = sum(float(r.saldo_pendiente or 0) for r in egresos_rows)
        saldo_acum += (total_ing - total_egr)

        resultado.append({
            "mes":             label,
            "mes_num":         mes,
            "anio":            anio,
            "ingresos":        round(total_ing, 2),
            "egresos":         round(total_egr, 2),
            "saldo_mes":       round(total_ing - total_egr, 2),
            "saldo_acumulado": round(saldo_acum, 2),
            "detalle_ingresos": [{
                "id":               r.id,
                "numero_factura":   r.numero_factura or "",
                "cliente":          r.razon_social_cliente or "",
                "monto":            round(float(r.saldo_pendiente or 0), 2),
                "fecha_vencimiento":str(r.fecha_vencimiento),
            } for r in ingresos_rows],
            "detalle_egresos": [{
                "id":                 r.id,
                "numero_comprobante": r.numero_comprobante or "",
                "proveedor":          r.proveedor or "",
                "descripcion":        r.descripcion or "",
                "monto":              round(float(r.saldo_pendiente or 0), 2),
                "fecha_vencimiento":  str(r.fecha_vencimiento),
            } for r in egresos_rows],
        })
        anio, mes = _siguiente_mes(anio, mes)

    return resultado


@flujo_router.get("/exportar")
def exportar_flujo(db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise HTTPException(500, "Instale openpyxl")

    data = flujo_proyectado(12, db, empresa_id)

    wb = Workbook()
    ws = wb.active
    ws.title = "Flujo de Caja"

    hdr_font  = Font(bold=True, color="FFFFFF")
    hdr_fill  = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")
    headers = ["Mes", "Ingresos Proy. (S/)", "Egresos Proy. (S/)", "Saldo Mes (S/)", "Saldo Acumulado (S/)"]
    widths  = [14, 24, 22, 20, 24]

    for ci, (h, w) in enumerate(zip(headers, widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = w

    for row in data:
        ws.append([row["mes"], row["ingresos"], row["egresos"], row["saldo_mes"], row["saldo_acumulado"]])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=flujo_caja.xlsx"},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# CONCILIACIÓN BANCARIA
# ═══════════════════════════════════════════════════════════════════════════════

@conciliacion_router.get("/cuentas")
def listar_cuentas(db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(CuentaBancaria).filter(CuentaBancaria.activo == True)
    if empresa_id is not None:
        q = q.filter(CuentaBancaria.empresa_id == empresa_id)
    cuentas = q.all()
    return [{
        "id":           c.id,
        "banco":        c.banco,
        "numero_cuenta":c.numero_cuenta,
        "tipo_cuenta":  c.tipo_cuenta or "",
    } for c in cuentas]


@conciliacion_router.get("/historial")
def historial_conciliaciones(db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).order_by(ConciliacionBancaria.id.desc())
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    concs = q.all()
    return [_serialize_conciliacion(c, db) for c in concs]


@conciliacion_router.get("/descargar-plantilla")
def descargar_plantilla():
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise HTTPException(500, "Instale openpyxl")

    wb = Workbook()

    # ── Hoja principal ──────────────────────────────────────────────────────
    ws = wb.active
    ws.title = "Estado de Cuenta"

    hdr_font  = Font(bold=True, color="FFFFFF", size=11)
    hdr_fill  = PatternFill(start_color="1E3A5F", end_color="1E3A5F", fill_type="solid")
    hdr_align = Alignment(horizontal="center", vertical="center")

    headers = ["FECHA", "DESCRIPCIÓN", "MONTO"]
    widths  = [16, 58, 16]
    for ci, (h, w) in enumerate(zip(headers, widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font      = hdr_font
        cell.fill      = hdr_fill
        cell.alignment = hdr_align
        ws.column_dimensions[cell.column_letter].width = w
    ws.row_dimensions[1].height = 22

    fill_a = PatternFill(start_color="EBF5EB", end_color="EBF5EB", fill_type="solid")
    fill_b = PatternFill(start_color="FFF0F0", end_color="FFF0F0", fill_type="solid")
    fill_c = PatternFill(start_color="FFF0F0", end_color="FFF0F0", fill_type="solid")
    # (fecha, desc, monto, fill)  positivo=ingreso  negativo=egreso
    ejemplos = [
        ("03/06/2026", "ABONO TRANSFERENCIA CLIENTE",    6200.00, fill_a),
        ("05/06/2026", "CARGO COMISION MANTENIMIENTO",    -15.00, fill_b),
        ("13/06/2026", "CARGO ITF OPERACIONES",           -35.00, fill_c),
    ]
    for ri, (fecha, desc, monto, fill) in enumerate(ejemplos, 2):
        ws.cell(row=ri, column=1, value=fecha).fill = fill
        ws.cell(row=ri, column=2, value=desc).fill  = fill
        monto_cell = ws.cell(row=ri, column=3, value=monto)
        monto_cell.fill         = fill
        monto_cell.number_format = '#,##0.00'
        monto_cell.font         = Font(
            color="166534" if monto > 0 else "991B1B", bold=True
        )

    # ── Hoja Instrucciones ──────────────────────────────────────────────────
    wi = wb.create_sheet("Instrucciones")
    wi.column_dimensions["A"].width = 20
    wi.column_dimensions["B"].width = 64

    wi["A1"] = "Centryx — Instrucciones de Importación"
    wi["A1"].font = Font(bold=True, size=13, color="1E3A5F")
    wi.merge_cells("A1:B1")

    filas = [
        ("", ""),
        ("COLUMNA",      "DESCRIPCIÓN"),
        ("FECHA",        "Fecha de la operación en formato DD/MM/AAAA. Ej: 03/06/2026"),
        ("DESCRIPCIÓN",  "Descripción del movimiento tal como aparece en el estado de cuenta"),
        ("MONTO",        "Monto en soles. Positivo = ingreso (entró dinero). Negativo = egreso (salió dinero)."),
        ("", ""),
        ("EJEMPLOS:", ""),
        ("", "6200.00   → ingreso (abono, transferencia recibida)"),
        ("", "-15.00    → egreso  (comisión, mantenimiento)"),
        ("", "-35.00    → egreso  (ITF, cargo bancario)"),
        ("", ""),
        ("NOTAS:", ""),
        ("", "• No modifiques los encabezados de la fila 1"),
        ("", "• Las filas de ejemplo (2, 3 y 4) se pueden borrar o editar"),
        ("", "• Guarda el archivo como .xlsx antes de subir"),
        ("", "• Filas con MONTO = 0 serán ignoradas automáticamente"),
    ]
    sub_font = Font(bold=True, size=11)
    for ri, (col_a, col_b) in enumerate(filas, 2):
        ca = wi.cell(row=ri, column=1, value=col_a)
        cb = wi.cell(row=ri, column=2, value=col_b)
        if col_a == "COLUMNA":
            ca.font = sub_font; cb.font = sub_font
        elif col_a in ("FECHA", "DESCRIPCIÓN", "MONTO"):
            ca.font = Font(bold=True)
        elif col_a in ("NOTAS:", "EJEMPLOS:"):
            ca.font = Font(bold=True, color="1E3A5F")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Plantilla_Estado_Cuenta.xlsx"},
    )


@conciliacion_router.post("/importar")
async def importar_estado_cuenta(
    archivo:           UploadFile     = File(...),
    cuenta_bancaria_id:Optional[int] = Form(None),
    periodo_desde:     str            = Form(...),
    periodo_hasta:     str            = Form(...),
    db:                Session        = Depends(get_db),
    empresa_id:        Optional[int]  = Depends(get_empresa_id),
):
    contenido = await archivo.read()
    if len(contenido) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo demasiado grande (máx 10 MB)")

    nombre = (archivo.filename or "").lower()
    if nombre.endswith(".csv"):
        ext = "csv"
    else:
        ext = "xlsx"

    try:
        movs = _parsear_plantilla(contenido, ext)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        tb = traceback.format_exc()
        logger.error("Error importando archivo '%s':\n%s", nombre, tb)
        raise HTTPException(400, f"Error al procesar archivo: {type(e).__name__}: {e}")

    if not movs:
        raise HTTPException(400, "No se detectaron movimientos válidos. Verifica que la columna TIPO contenga 'ingreso' o 'egreso' y que MONTO sea mayor a 0.")

    conc = _crear_conciliacion_desde_movs(
        db, movs, cuenta_bancaria_id,
        date.fromisoformat(periodo_desde), date.fromisoformat(periodo_hasta), ext,
        empresa_id=empresa_id,
    )
    return {
        "id":                    conc.id,
        "banco":                 conc.banco,
        "periodo_desde":         str(conc.periodo_desde),
        "periodo_hasta":         str(conc.periodo_hasta),
        "movimientos_detectados":len(movs),
        "movimientos":           [_serialize_movimiento(m) for m in conc.movimientos],
    }


@conciliacion_router.post("/importar-pdf")
async def importar_estado_cuenta_pdf(
    archivo:            UploadFile     = File(...),
    banco:              str            = Form("BCP"),
    cuenta_bancaria_id: Optional[int]  = Form(None),
    db:                 Session        = Depends(get_db),
    empresa_id:         Optional[int]  = Depends(get_empresa_id),
):
    """Importa un estado de cuenta en PDF (por ahora solo BCP, con texto
    seleccionable) — extrae período, N° de cuenta y movimientos por regex
    (ver _extraer_estado_cuenta_bcp) y crea la conciliación igual que
    /importar (Excel), reutilizando _crear_conciliacion_desde_movs. Desde ahí
    el flujo es idéntico al de Excel: preview → POST /confirmar/{id} corre el
    mismo motor de conciliación automática (mismo/monto ±2 días) ya usado
    para Excel — no se reimplementa un matching aparte."""
    if banco != "BCP":
        raise HTTPException(400, "Por ahora la importación de PDF solo está disponible para BCP. Usa 'Importar Excel' para otros bancos.")

    nombre = (archivo.filename or "").lower()
    if not nombre.endswith(".pdf"):
        raise HTTPException(400, "El archivo debe ser un PDF")

    contenido = await archivo.read()
    if len(contenido) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo demasiado grande (máx 10 MB)")

    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(contenido)) as pdf:
            texto = "\n".join(pagina.extract_text() or "" for pagina in pdf.pages)
    except Exception:
        raise HTTPException(400, "No se pudo leer el archivo. Verifica que sea un PDF válido con texto seleccionable (no un escaneo).")

    extraido = _extraer_estado_cuenta_bcp(texto, date.today().year)
    movs = extraido["movimientos"]
    if not movs:
        raise HTTPException(400, "No se detectaron movimientos en el PDF. Verifica que sea un estado de cuenta BCP con texto seleccionable (no un PDF escaneado o de otro banco).")

    if extraido["fecha_inicio"] and extraido["fecha_fin"]:
        d1, m1, a1 = extraido["fecha_inicio"].split("/")
        d2, m2, a2 = extraido["fecha_fin"].split("/")
        periodo_desde = date(int(a1), int(m1), int(d1))
        periodo_hasta = date(int(a2), int(m2), int(d2))
    else:
        # No se detectó el encabezado "DEL ... AL ..." — se usa el rango real
        # de fechas de los movimientos encontrados.
        fechas = [m["fecha"] for m in movs]
        periodo_desde, periodo_hasta = min(fechas), max(fechas)

    total_ingresos       = sum(m["monto"] for m in movs if m["tipo"] == "ingreso")
    total_egresos        = sum(m["monto"] for m in movs if m["tipo"] == "egreso")
    total_ingresos_count = sum(1 for m in movs if m["tipo"] == "ingreso")
    total_egresos_count  = sum(1 for m in movs if m["tipo"] == "egreso")

    conc = _crear_conciliacion_desde_movs(db, movs, cuenta_bancaria_id, periodo_desde, periodo_hasta, "pdf", empresa_id=empresa_id)
    return {
        "id":                      conc.id,
        "banco":                   conc.banco,
        "periodo_desde":           str(conc.periodo_desde),
        "periodo_hasta":           str(conc.periodo_hasta),
        "numero_cuenta_detectado": extraido["numero_cuenta"],
        "movimientos_detectados":  len(movs),
        "movimientos":             [_serialize_movimiento(m) for m in conc.movimientos],
        "resumen": {
            "total_movimientos":    len(movs),
            "total_ingresos":       round(total_ingresos, 2),
            "total_ingresos_count": total_ingresos_count,
            "total_egresos":        round(total_egresos, 2),
            "total_egresos_count":  total_egresos_count,
            "diferencia":           round(total_ingresos - total_egresos, 2),
        },
    }


@conciliacion_router.get("/preview/{id}")
def preview_conciliacion(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")
    banco_movs = [m for m in conc.movimientos if m.origen == "banco"]
    return {
        "id":            conc.id,
        "banco":         conc.banco,
        "periodo_desde": str(conc.periodo_desde),
        "periodo_hasta": str(conc.periodo_hasta),
        "movimientos":   [_serialize_movimiento(m) for m in banco_movs],
    }


@conciliacion_router.post("/confirmar/{id}")
def confirmar_conciliacion(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")

    # Remove previous sistema movimientos
    for m in list(conc.movimientos):
        if m.origen == "sistema":
            db.delete(m)
    db.flush()

    # Pull real payments from the period
    q_cobr = db.query(PagoCobranza).filter(
        PagoCobranza.fecha_pago >= conc.periodo_desde,
        PagoCobranza.fecha_pago <= conc.periodo_hasta,
    )
    if empresa_id is not None:
        q_cobr = q_cobr.filter(PagoCobranza.empresa_id == empresa_id)
    pagos_cobr = q_cobr.all()

    # Excluye tipo="pago_cuota_prestamo" y los PagoGasto de un Gasto Bancario
    # (tipo_comprobante="Gastos Bancarios"): ver misma nota en
    # sincronizar_pagos_periodo (conciliacion_service.py) — ninguno de los dos
    # tiene un movimiento 'banco' que referencie su PagoGasto.id (las cuotas
    # matchean por CuotaPrestamo.id, los GB por Gasto.id directo), así que sin
    # este filtro quedaban espejos 'sistema' huérfanos que nunca podían
    # conciliarse, o que le robaban el match al movimiento correcto.
    q_gasto = db.query(PagoGasto).outerjoin(
        Gasto, PagoGasto.gasto_id == Gasto.id
    ).filter(
        PagoGasto.fecha_pago >= conc.periodo_desde,
        PagoGasto.fecha_pago <= conc.periodo_hasta,
        or_(PagoGasto.tipo.is_(None), PagoGasto.tipo != "pago_cuota_prestamo"),
        or_(Gasto.tipo_comprobante.is_(None), Gasto.tipo_comprobante != "Gastos Bancarios"),
    )
    if empresa_id is not None:
        q_gasto = q_gasto.filter(PagoGasto.empresa_id == empresa_id)
    pagos_gasto = q_gasto.all()

    for p in pagos_cobr:
        db.add(MovimientoConciliacion(
            conciliacion_id=conc.id, fecha=p.fecha_pago,
            descripcion=f"Cobro — {p.metodo_pago}",
            monto=float(p.monto_pagado), tipo="ingreso", origen="sistema",
            conciliado=False, referencia_sistema_id=p.id,
            referencia_sistema_tipo="cobranza", created_at=date.today(),
            empresa_id=empresa_id,
        ))
    for p in pagos_gasto:
        db.add(MovimientoConciliacion(
            conciliacion_id=conc.id, fecha=p.fecha_pago,
            descripcion=f"Pago gasto — {p.metodo_pago}",
            monto=float(p.monto_pagado), tipo="egreso", origen="sistema",
            conciliado=False, referencia_sistema_id=p.id,
            referencia_sistema_tipo="gasto", created_at=date.today(),
            empresa_id=empresa_id,
        ))
    db.flush()

    # Re-consultar desde DB: el relationship ORM queda en caché y no refleja
    # los movimientos del sistema recién insertados con db.add() + db.flush()
    movs_banco   = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "banco",
    ).all()
    movs_sistema = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "sistema",
    ).all()

    # Auto-match: mismo tipo + monto exacto (±0.01, redondeado a 2 decimales) + fecha ±2 días
    #
    # Los candidatos del sistema se agrupan en colas (deque) por (tipo, monto, fecha)
    # exacta. Cada movimiento del banco saca UN registro de la cola correspondiente
    # (probando primero fecha exacta y luego ±1/±2 días) y lo consume con popleft().
    # Esto evita que, cuando hay varios movimientos con el mismo monto y la misma
    # fecha (p.ej. 2 facturas idénticas pagadas el mismo día), todos compitan por
    # el mismo primer registro encontrado: cada uno toma un registro distinto,
    # en orden.
    pool = defaultdict(deque)
    for ms in sorted(movs_sistema, key=lambda m: m.fecha):
        clave = (ms.tipo, round(float(ms.monto), 2), ms.fecha)
        pool[clave].append(ms)

    for mb in sorted(movs_banco, key=lambda m: m.fecha):
        if mb.es_gasto_bancario:
            # No debe calzar contra pagos_cobranza/pagos_gastos del sistema por
            # coincidencia de monto+fecha — se registra aparte más abajo (bloque
            # "Reutilizar Gastos Bancarios") o vía "Registrar GB" en el frontend.
            continue
        monto_mb = round(float(mb.monto), 2)
        ms = None
        for offset in (0, -1, 1, -2, 2):
            cola = pool.get((mb.tipo, monto_mb, mb.fecha + timedelta(days=offset)))
            if cola:
                ms = cola.popleft()
                break
        if ms:
            mb.conciliado = True
            ms.conciliado = True
            mb.referencia_sistema_id   = ms.referencia_sistema_id
            mb.referencia_sistema_tipo = ms.referencia_sistema_tipo

    # Fallback: egresos del banco sin pago registrado en pagos_gastos, pero que
    # corresponden a un gasto ya cargado en el sistema (p.ej. registrado con la
    # factura pero sin el pago aún). Se busca directo en "gastos" por monto y
    # fecha (±2 días), excluyendo los ya marcados como "Pagado". No aplica a
    # gastos bancarios (es_gasto_bancario), que se registran aparte vía
    # "/registrar-gastos-bancarios".
    gastos_usados = set()
    for mb in sorted(movs_banco, key=lambda m: m.fecha):
        if mb.conciliado or mb.tipo != "egreso" or mb.es_gasto_bancario:
            continue
        monto_mb = round(float(mb.monto), 2)
        q_gastos = db.query(Gasto).filter(
            func.abs(Gasto.monto - monto_mb) < 0.01,
            Gasto.fecha >= mb.fecha - timedelta(days=2),
            Gasto.fecha <= mb.fecha + timedelta(days=2),
            Gasto.estado_pago != "Pagado",
        )
        if empresa_id is not None:
            q_gastos = q_gastos.filter(Gasto.empresa_id == empresa_id)
        candidatos_gasto = [g for g in q_gastos.all() if g.id not in gastos_usados]
        if not candidatos_gasto:
            continue
        gasto = min(candidatos_gasto, key=lambda g: abs((mb.fecha - g.fecha).days))
        gastos_usados.add(gasto.id)

        nuevo_pago = PagoGasto(
            gasto_id=gasto.id, monto_pagado=monto_mb, fecha_pago=mb.fecha,
            metodo_pago="Transferencia", created_at=date.today(),
        )
        db.add(nuevo_pago)
        db.flush()

        gasto.estado_pago     = "Pagado"
        gasto.saldo_pendiente = 0.0

        nuevo_mov_sistema = MovimientoConciliacion(
            conciliacion_id=conc.id, fecha=mb.fecha,
            descripcion="Pago gasto — Transferencia (auto)",
            monto=monto_mb, tipo="egreso", origen="sistema",
            conciliado=True, referencia_sistema_id=nuevo_pago.id,
            referencia_sistema_tipo="gasto", created_at=date.today(),
            empresa_id=empresa_id,
        )
        db.add(nuevo_mov_sistema)
        movs_sistema.append(nuevo_mov_sistema)

        mb.conciliado              = True
        mb.referencia_sistema_id   = nuevo_pago.id
        mb.referencia_sistema_tipo = "gasto"

    # Reutilizar Gastos Bancarios (GB) ya registrados en "gastos" — evita duplicar
    # GB-0002, GB-0003, etc. cuando se elimina una conciliación y se vuelve a
    # procesar/conciliar el mismo período (el GB original nunca se borra, ver
    # eliminar_conciliacion). Si un movimiento marcado como es_gasto_bancario
    # coincide en monto y fecha (±2 días) con un GB existente, se reutiliza ese
    # gasto en vez de esperar a que el usuario lo registre de nuevo manualmente.
    gb_usados = set()
    for mb in sorted(movs_banco, key=lambda m: m.fecha):
        if mb.conciliado or not mb.es_gasto_bancario:
            continue
        gb = _buscar_gb_existente(db, float(mb.monto), mb.fecha, excluir_ids=gb_usados, empresa_id=empresa_id)
        if not gb:
            continue
        gb_usados.add(gb.id)
        mb.conciliado              = True
        mb.referencia_sistema_id   = gb.id
        mb.referencia_sistema_tipo = "gasto"

    # Stats calculadas desde las listas en memoria (reflejan cambios aún no commiteados)
    total       = len(movs_banco) + len(movs_sistema)
    conciliados = sum(1 for m in movs_banco + movs_sistema if m.conciliado)
    saldo_sis   = sum((float(m.monto) if m.tipo == "ingreso" else -float(m.monto)) for m in movs_sistema)
    saldo_ban   = sum((float(m.monto) if m.tipo == "ingreso" else -float(m.monto)) for m in movs_banco)
    diferencia  = round(saldo_sis - saldo_ban, 2)
    pct         = round(conciliados / total * 100 if total else 0, 1)

    conc.saldo_sistema         = round(saldo_sis, 2)
    conc.saldo_banco           = round(saldo_ban, 2)
    conc.diferencia            = diferencia
    conc.porcentaje_conciliado = pct
    conc.estado = "Conciliado" if diferencia == 0 else "Con diferencias"

    db.commit()
    db.refresh(conc)
    return _serialize_conciliacion(conc, db)


@conciliacion_router.get("/{id}/movimientos")
def get_movimientos(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")

    # Sincronizar con pagos_cobranza / pagos_gastos en cada carga de la vista
    # y conciliar automáticamente contra "Solo en Banco" pendiente. Nota:
    # `fecha_cierre` NO es un estado terminal — /guardar lo fija en cada
    # guardado sin importar el % conciliado (puede quedar "Con diferencias"),
    # así que no debe usarse para saltar la sincronización.
    sincronizar_y_conciliar(db, id)

    movs = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id
    ).order_by(MovimientoConciliacion.fecha).all()

    # Pre-cargar referencias de cobranza (PagoCobranza → VentaComercial)
    cobr_ids = {m.referencia_sistema_id for m in movs
                if m.referencia_sistema_tipo == "cobranza" and m.referencia_sistema_id}
    pagos_cobr_map, ventas_map = {}, {}
    if cobr_ids:
        pc_list = db.query(PagoCobranza).filter(PagoCobranza.id.in_(cobr_ids)).all()
        pagos_cobr_map = {p.id: p for p in pc_list}
        v_ids = {p.comprobante_id for p in pc_list if p.comprobante_id}
        if v_ids:
            ventas_map = {v.id: v for v in
                          db.query(VentaComercial).filter(VentaComercial.id.in_(v_ids)).all()}

    # Pre-cargar referencias de gasto
    # Gastos bancarios: referencia_sistema_id = Gasto.id (directo)
    # Auto-match normal:  referencia_sistema_id = PagoGasto.id
    gasto_ref_ids    = {m.referencia_sistema_id for m in movs
                        if m.referencia_sistema_tipo == "gasto" and m.referencia_sistema_id}
    gb_gasto_ids     = {m.referencia_sistema_id for m in movs
                        if m.referencia_sistema_tipo == "gasto" and m.referencia_sistema_id
                        and m.es_gasto_bancario}
    auto_pg_ids      = gasto_ref_ids - gb_gasto_ids

    pagos_gasto_map, gastos_map = {}, {}
    if auto_pg_ids:
        pg_list = db.query(PagoGasto).filter(PagoGasto.id.in_(auto_pg_ids)).all()
        pagos_gasto_map = {p.id: p for p in pg_list}
        g_ids = {p.gasto_id for p in pg_list if p.gasto_id}
        if g_ids:
            for g in db.query(Gasto).filter(Gasto.id.in_(g_ids)).all():
                gastos_map[g.id] = g
    if gb_gasto_ids:
        for g in db.query(Gasto).filter(Gasto.id.in_(gb_gasto_ids)).all():
            gastos_map[g.id] = g

    # Pre-cargar referencias de préstamo (CuotaPrestamo → Prestamo) — sin
    # esto, un movimiento conciliado contra una cuota (referencia_sistema_tipo
    # ="prestamo", ver sincronizar_pagos_periodo) no tenía rama en el armado
    # de `doc` de más abajo y quedaba con documento_sistema=None, mostrando
    # "Conciliado — sin documento del sistema vinculado" pese a estar bien
    # vinculado.
    prestamo_ref_ids = {m.referencia_sistema_id for m in movs
                         if m.referencia_sistema_tipo == "prestamo" and m.referencia_sistema_id}
    cuotas_map, prestamos_map = {}, {}
    if prestamo_ref_ids:
        cuotas_list = db.query(CuotaPrestamo).filter(CuotaPrestamo.id.in_(prestamo_ref_ids)).all()
        cuotas_map = {c.id: c for c in cuotas_list}
        p_ids = {c.prestamo_id for c in cuotas_list}
        if p_ids:
            prestamos_map = {p.id: p for p in db.query(Prestamo).filter(Prestamo.id.in_(p_ids)).all()}

    # Pre-cargar referencias de orden de cobro — mismo motivo que préstamo:
    # sin rama para "orden_cobro" quedaba documento_sistema=None. El detalle
    # completo (lista de facturas de la orden) se pide aparte, on-demand, vía
    # GET /movimientos/{mov_id}/detalle (ver más abajo) — acá solo la tarjeta
    # simple, igual que para cobranza/gasto/prestamo.
    orden_cobro_ids = {m.referencia_sistema_id for m in movs
                       if m.referencia_sistema_tipo == "orden_cobro" and m.referencia_sistema_id}
    ordenes_cobro_map = {}
    if orden_cobro_ids:
        ordenes_cobro_map = {o.id: o for o in db.query(OrdenCobro).filter(OrdenCobro.id.in_(orden_cobro_ids)).all()}

    # Pre-cargar referencias de orden de pago — mismo motivo que orden de cobro.
    orden_pago_ids = {m.referencia_sistema_id for m in movs
                      if m.referencia_sistema_tipo == "orden_pago" and m.referencia_sistema_id}
    ordenes_pago_map = {}
    if orden_pago_ids:
        ordenes_pago_map = {o.id: o for o in db.query(OrdenPago).filter(OrdenPago.id.in_(orden_pago_ids)).all()}

    result = []
    for m in movs:
        data = _serialize_movimiento(m)
        doc = None
        if m.referencia_sistema_id and m.referencia_sistema_tipo:
            if m.referencia_sistema_tipo == "cobranza":
                pago = pagos_cobr_map.get(m.referencia_sistema_id)
                if pago:
                    venta = ventas_map.get(pago.comprobante_id)
                    if venta:
                        doc = {
                            "tipo_documento":    venta.tipo_documento or "Factura",
                            "numero_documento":  venta.numero_factura or "",
                            "cliente_proveedor": venta.razon_social_cliente or "",
                            "categoria":         "Cobranza",
                            "modulo_origen":     "Ventas / Cobranza",
                        }
            elif m.referencia_sistema_tipo == "gasto":
                if m.es_gasto_bancario:
                    g = gastos_map.get(m.referencia_sistema_id)
                    if g:
                        doc = {
                            "tipo_documento":    g.tipo_comprobante or "Gasto Bancario",
                            "numero_documento":  g.numero_comprobante or "",
                            "cliente_proveedor": g.proveedor or "",
                            "categoria":         g.categoria or "Gastos Bancarios",
                            "modulo_origen":     "Gastos",
                        }
                else:
                    pago = pagos_gasto_map.get(m.referencia_sistema_id)
                    if pago:
                        g = gastos_map.get(pago.gasto_id)
                        if g:
                            doc = {
                                "tipo_documento":    g.tipo_comprobante or "Comprobante",
                                "numero_documento":  g.numero_comprobante or "",
                                "cliente_proveedor": g.proveedor or "",
                                "categoria":         g.categoria or "",
                                "modulo_origen":     "Gastos",
                            }
            elif m.referencia_sistema_tipo == "prestamo":
                cuota = cuotas_map.get(m.referencia_sistema_id)
                if cuota:
                    prestamo = prestamos_map.get(cuota.prestamo_id)
                    if prestamo:
                        doc = {
                            "tipo_documento":    "Cuota de Préstamo",
                            "numero_documento":  f"Cuota #{cuota.numero_cuota}",
                            "cliente_proveedor": prestamo.nombre_tercero or "",
                            "categoria":         "Préstamos",
                            "modulo_origen":     "Préstamos",
                        }
            elif m.referencia_sistema_tipo == "orden_cobro":
                orden = ordenes_cobro_map.get(m.referencia_sistema_id)
                if orden:
                    doc = {
                        "tipo_documento":    "Orden de Cobro",
                        "numero_documento":  orden.numero_orden,
                        "cliente_proveedor": orden.nombre_cliente or "",
                        "categoria":         "Cobranza",
                        "modulo_origen":     "Ventas / Cobranza",
                    }
            elif m.referencia_sistema_tipo == "orden_pago":
                orden = ordenes_pago_map.get(m.referencia_sistema_id)
                if orden:
                    doc = {
                        "tipo_documento":    "Orden de Pago",
                        "numero_documento":  orden.numero_orden,
                        "cliente_proveedor": orden.nombre_proveedor or "",
                        "categoria":         "Pagos",
                        "modulo_origen":     "Gastos",
                    }
        data["documento_sistema"] = doc
        result.append(data)

    return result


@conciliacion_router.get("/movimientos/{mov_id}/detalle")
def detalle_movimiento(mov_id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Detalle expandido de un movimiento vinculado a una Orden de Cobro: la
    tarjeta simple de documento_sistema (ver get_movimientos) solo alcanza
    para un documento; una orden de cobro puede agrupar varias facturas/
    boletas, así que ese detalle se pide aparte, on-demand, al expandir la
    fila en el frontend. Reutiliza los serializadores de ordenes_cobro.py
    para no duplicar el mapeo de campos de VentaComercial."""
    mov = db.query(MovimientoConciliacion).filter(MovimientoConciliacion.id == mov_id).first()
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    if mov.referencia_sistema_tipo != "orden_cobro" or not mov.referencia_sistema_id:
        raise HTTPException(400, "Este movimiento no tiene una orden de cobro vinculada")
    q = db.query(OrdenCobro).filter(OrdenCobro.id == mov.referencia_sistema_id)
    if empresa_id is not None:
        q = q.filter(OrdenCobro.empresa_id == empresa_id)
    orden = q.first()
    if not orden:
        raise HTTPException(404, "Orden de cobro no encontrada")
    return {
        "tipo": "orden_cobro",
        **_serializar_orden(orden),
        "detalle": [_serializar_detalle(d) for d in orden.detalles],
    }


@conciliacion_router.put("/{id}/actualizar")
def actualizar_conciliacion(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Reintenta conciliar los movimientos 'Solo en Banco' pendientes de esta
    conciliación a demanda — reutiliza el mismo motor de auto-match
    (sincronizar_y_conciliar: monto exacto ±0.01 + fecha ±2 días) que ya corre
    automáticamente al abrir GET /{id}/movimientos, útil por ejemplo justo
    después de registrar un pago nuevo sin tener que recargar la página."""
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")

    total = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "banco",
        MovimientoConciliacion.conciliado == False,
    ).count()

    sincronizar_y_conciliar(db, id)

    pendientes = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "banco",
        MovimientoConciliacion.conciliado == False,
    ).count()

    return {
        "conciliados": total - pendientes,
        "pendientes":  pendientes,
        "total":       total,
    }


@conciliacion_router.put("/movimientos/{movimiento_id}/reconciliar")
def reconciliar_movimiento(movimiento_id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Intenta conciliar un único movimiento 'banco' pendiente contra los
    movimientos 'sistema' del mismo período — mismo criterio que el auto-match
    general (monto exacto ±0.01, fecha ±2 días) pero acotado a este movimiento."""
    q = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.id == movimiento_id,
        MovimientoConciliacion.origen == "banco",
    )
    if empresa_id is not None:
        q = q.filter(MovimientoConciliacion.empresa_id == empresa_id)
    mov = q.first()
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    if mov.conciliado:
        return {"conciliado": True, "mensaje": "El movimiento ya estaba conciliado"}

    q_conc = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == mov.conciliacion_id)
    if empresa_id is not None:
        q_conc = q_conc.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q_conc.first()
    sincronizar_pagos_periodo(db, conc)
    db.flush()

    movimientos_sistema = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == mov.conciliacion_id,
        MovimientoConciliacion.origen == "sistema",
        MovimientoConciliacion.conciliado == False,
    ).all()

    encontrado = auto_match_movimientos([mov], movimientos_sistema, db)
    db.commit()

    if encontrado:
        return {"conciliado": True, "movimiento": _serialize_movimiento(mov)}
    return {"conciliado": False, "mensaje": "Sin coincidencia exacta"}


@conciliacion_router.put("/{id}/movimientos/{mov_id}/conciliar")
def toggle_conciliado(id: int, mov_id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.id == mov_id,
        MovimientoConciliacion.conciliacion_id == id,
    )
    if empresa_id is not None:
        q = q.filter(MovimientoConciliacion.empresa_id == empresa_id)
    mov = q.first()
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    mov.conciliado = not mov.conciliado
    db.commit()
    return _serialize_movimiento(mov)


@conciliacion_router.put("/movimientos/{mov_id}/desconciliar")
def desconciliar_movimiento(mov_id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Desconcilia un movimiento ya conciliado: vuelve a quedar como
    'Solo en Banco' / 'Solo en Sistema' y puede volver a conciliarse
    manualmente."""
    q = db.query(MovimientoConciliacion).filter(MovimientoConciliacion.id == mov_id)
    if empresa_id is not None:
        q = q.filter(MovimientoConciliacion.empresa_id == empresa_id)
    mov = q.first()
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    mov.conciliado = False

    # Su contraparte (banco↔sistema) comparte referencia_sistema_id/tipo y
    # queda oculta mientras esté conciliada — se desconcilia junto con `mov`
    # para no dejar un registro fantasma marcado como conciliado.
    if mov.referencia_sistema_id and mov.referencia_sistema_tipo:
        contraparte = db.query(MovimientoConciliacion).filter(
            MovimientoConciliacion.conciliacion_id == mov.conciliacion_id,
            MovimientoConciliacion.id != mov.id,
            MovimientoConciliacion.origen != mov.origen,
            MovimientoConciliacion.referencia_sistema_id == mov.referencia_sistema_id,
            MovimientoConciliacion.referencia_sistema_tipo == mov.referencia_sistema_tipo,
            MovimientoConciliacion.conciliado == True,
        ).first()
        if contraparte:
            contraparte.conciliado = False

    db.commit()
    return _serialize_movimiento(mov)


@conciliacion_router.post("/{id}/registrar-en-sistema/{mov_id}")
def registrar_en_sistema(id: int, mov_id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.id == mov_id,
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "banco",
    )
    if empresa_id is not None:
        q = q.filter(MovimientoConciliacion.empresa_id == empresa_id)
    mov = q.first()
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    if mov.conciliado:
        raise HTTPException(400, "El movimiento ya está conciliado")

    # Nunca se marca conciliado sin vincular un documento real: se busca un
    # movimiento 'sistema' pendiente con mismo tipo+monto (±0.01) y fecha
    # ±2 días (mismo criterio que auto_match_movimientos) para heredar su
    # referencia_sistema_id/tipo. Antes esto marcaba conciliado=True sin
    # tocar referencia_sistema_id, dejando el movimiento "Conciliado" pero
    # sin documento vinculado.
    monto_mb = round(float(mov.monto), 2)
    candidatos = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "sistema",
        MovimientoConciliacion.conciliado == False,
        MovimientoConciliacion.tipo == mov.tipo,
        MovimientoConciliacion.fecha >= mov.fecha - timedelta(days=2),
        MovimientoConciliacion.fecha <= mov.fecha + timedelta(days=2),
    ).all()
    candidato = next((c for c in candidatos if round(float(c.monto), 2) == monto_mb), None)
    if not candidato:
        raise HTTPException(
            400,
            "No se encontró un movimiento del sistema (mismo monto y fecha ±2 días) para vincular. "
            "Registra primero el pago/cuota/devolución correspondiente en el sistema.",
        )

    mov.conciliado              = True
    candidato.conciliado        = True
    mov.referencia_sistema_id   = candidato.referencia_sistema_id
    mov.referencia_sistema_tipo = candidato.referencia_sistema_tipo
    db.commit()
    return {"ok": True, "movimiento": _serialize_movimiento(mov)}


@conciliacion_router.put("/{id}/guardar")
def guardar_conciliacion(id: int, http_request: Request, db: Session = Depends(get_db),
                          usuario: Usuario = Depends(get_current_usuario),
                          empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")
    total       = len(conc.movimientos)
    conciliados = sum(1 for m in conc.movimientos if m.conciliado)
    pct         = round(conciliados / total * 100 if total else 0, 1)
    conc.porcentaje_conciliado = pct
    conc.estado = "Conciliado" if pct == 100 else "Con diferencias" if pct > 0 else "En proceso"
    conc.fecha_cierre = date.today()
    db.commit()

    MESES_ES_LOWER = {
        1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
        7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre",
    }
    mes_label = f"{MESES_ES_LOWER.get(conc.periodo_desde.month, '')} {conc.periodo_desde.year}"
    registrar_log(
        db, usuario.id, usuario.nombre, "flujo_caja", "Guardó conciliación",
        f"Guardó conciliación {mes_label}", ip_de(http_request),
    )

    return _serialize_conciliacion(conc, db)


@conciliacion_router.get("/{id}/exportar")
def exportar_conciliacion(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise HTTPException(500, "Instale openpyxl")

    wb = Workbook()
    ws = wb.active
    ws.title = "Conciliación"

    hdr_font = Font(bold=True, color="FFFFFF")
    hdr_fill = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")
    headers  = ["Fecha", "Descripción", "Monto (S/)", "Tipo", "Origen", "Conciliado"]
    widths   = [14, 42, 16, 12, 12, 14]

    for ci, (h, w) in enumerate(zip(headers, widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = w

    # Cada movimiento del banco se muestra siempre. Un movimiento "sistema" solo
    # se muestra si NO está conciliado (registrado en el sistema pero sin match
    # en el banco); si ya está conciliado, su contraparte "banco" ya representa
    # esa misma transacción, y mostrar ambas la duplicaba en el Excel.
    movimientos_export = [
        m for m in conc.movimientos
        if m.origen == "banco" or not m.conciliado
    ]
    for m in sorted(movimientos_export, key=lambda x: x.fecha):
        ws.append([str(m.fecha), m.descripcion or "", m.monto,
                   m.tipo, m.origen, "Sí" if m.conciliado else "No"])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=conciliacion_{id}.xlsx"},
    )


# ─── Exportar conciliados — 9 campos con saldo acumulativo ──────────────────

@conciliacion_router.get("/{id}/exportar-conciliados")
def exportar_conciliados(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, numbers
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(500, "Instale openpyxl")

    wb = Workbook()
    ws = wb.active
    ws.title = "Conciliados"

    hdr_font = Font(bold=True, color="FFFFFF")
    hdr_fill = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")
    headers = [
        "Fecha", "Descripción de Operación", "Razón Social",
        "RUC", "N° Documento", "Categoría",
        "Descripción de Gasto", "Monto (S/)", "Saldo Contable (S/)",
    ]
    widths = [12, 38, 30, 14, 18, 24, 34, 16, 20]

    for ci, (h, w) in enumerate(zip(headers, widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(ci)].width = w

    # Solo movimientos del banco ya conciliados — una sola fila por movimiento
    # (no se incluyen las filas "sistema" espejo, que causaban duplicados).
    movs = sorted(
        [m for m in conc.movimientos if m.origen == "banco" and m.conciliado],
        key=lambda x: x.fecha,
    )

    # Pre-cargar referencias de cobranza (PagoCobranza → VentaComercial)
    cobr_ids = {m.referencia_sistema_id for m in movs
                if m.referencia_sistema_tipo == "cobranza" and m.referencia_sistema_id}
    pagos_cobr_map, ventas_map = {}, {}
    if cobr_ids:
        pc_list = db.query(PagoCobranza).filter(PagoCobranza.id.in_(cobr_ids)).all()
        pagos_cobr_map = {p.id: p for p in pc_list}
        v_ids = {p.comprobante_id for p in pc_list if p.comprobante_id}
        if v_ids:
            ventas_map = {v.id: v for v in
                          db.query(VentaComercial).filter(VentaComercial.id.in_(v_ids)).all()}

    # Pre-cargar referencias de gasto.
    # Gastos bancarios (GB): referencia_sistema_id = Gasto.id directo.
    # Auto-match normal:     referencia_sistema_id = PagoGasto.id.
    gasto_ref_ids = {m.referencia_sistema_id for m in movs
                     if m.referencia_sistema_tipo == "gasto" and m.referencia_sistema_id}
    gb_gasto_ids  = {m.referencia_sistema_id for m in movs
                     if m.referencia_sistema_tipo == "gasto" and m.referencia_sistema_id
                     and m.es_gasto_bancario}
    auto_pg_ids   = gasto_ref_ids - gb_gasto_ids

    pagos_gasto_map, gastos_map = {}, {}
    if auto_pg_ids:
        pg_list = db.query(PagoGasto).filter(PagoGasto.id.in_(auto_pg_ids)).all()
        pagos_gasto_map = {p.id: p for p in pg_list}
        g_ids = {p.gasto_id for p in pg_list if p.gasto_id}
        if g_ids:
            for g in db.query(Gasto).filter(Gasto.id.in_(g_ids)).all():
                gastos_map[g.id] = g
    if gb_gasto_ids:
        for g in db.query(Gasto).filter(Gasto.id.in_(gb_gasto_ids)).all():
            gastos_map[g.id] = g

    # Pre-cargar referencias de préstamo (CuotaPrestamo → Prestamo)
    prestamo_ids = {m.referencia_sistema_id for m in movs
                    if m.referencia_sistema_tipo == "prestamo" and m.referencia_sistema_id}
    cuotas_map, prestamos_map = {}, {}
    if prestamo_ids:
        cu_list = db.query(CuotaPrestamo).filter(CuotaPrestamo.id.in_(prestamo_ids)).all()
        cuotas_map = {c.id: c for c in cu_list}
        p_ids = {c.prestamo_id for c in cu_list if c.prestamo_id}
        if p_ids:
            prestamos_map = {p.id: p for p in
                              db.query(Prestamo).filter(Prestamo.id.in_(p_ids)).all()}

    # Pre-cargar referencias de garantía (PagoGarantia → Garantia)
    garantia_ids = {m.referencia_sistema_id for m in movs
                     if m.referencia_sistema_tipo == "garantia" and m.referencia_sistema_id}
    pagos_garantia_map, garantias_map = {}, {}
    if garantia_ids:
        pg_list = db.query(PagoGarantia).filter(PagoGarantia.id.in_(garantia_ids)).all()
        pagos_garantia_map = {p.id: p for p in pg_list}
        g_ids = {p.garantia_id for p in pg_list if p.garantia_id}
        if g_ids:
            garantias_map = {g.id: g for g in
                              db.query(Garantia).filter(Garantia.id.in_(g_ids)).all()}

    # Pre-cargar referencias de orden de cobro (OrdenCobro → detalles → VentaComercial)
    orden_cobro_ids = {m.referencia_sistema_id for m in movs
                        if m.referencia_sistema_tipo == "orden_cobro" and m.referencia_sistema_id}
    ordenes_cobro_map = {}
    if orden_cobro_ids:
        ordenes_cobro_map = {o.id: o for o in
                              db.query(OrdenCobro).filter(OrdenCobro.id.in_(orden_cobro_ids)).all()}

    # Pre-cargar referencias de orden de pago (OrdenPago → detalles → Gasto)
    orden_pago_ids = {m.referencia_sistema_id for m in movs
                      if m.referencia_sistema_tipo == "orden_pago" and m.referencia_sistema_id}
    ordenes_pago_map = {}
    if orden_pago_ids:
        ordenes_pago_map = {o.id: o for o in
                             db.query(OrdenPago).filter(OrdenPago.id.in_(orden_pago_ids)).all()}

    saldo_acum = 0.0
    for m in movs:
        signo = 1.0 if m.tipo == "ingreso" else -1.0
        monto_con_signo = round(float(m.monto) * signo, 2)
        saldo_acum = round(saldo_acum + monto_con_signo, 2)

        # Orden de Cobro: fila principal con el total (en negrita) + una fila
        # por cada factura/boleta que la compone (indentada, gris/itálica).
        # El saldo corrido (saldo_acum) ya quedó actualizado arriba con el
        # monto total real de la orden (lo que de verdad entró al banco) —
        # solo se muestra en la fila principal, no en las de detalle.
        if m.referencia_sistema_tipo == "orden_cobro" and m.referencia_sistema_id:
            orden = ordenes_cobro_map.get(m.referencia_sistema_id)
            if orden and orden.detalles:
                ws.append([
                    m.fecha.strftime("%d/%m/%Y") if m.fecha else "",
                    m.descripcion or "",
                    orden.nombre_cliente or "",
                    orden.ruc_cliente or "",
                    orden.numero_orden,
                    "Orden de Cobro",
                    "",
                    monto_con_signo,
                    saldo_acum,
                ])
                for cell in ws[ws.max_row]:
                    cell.font = Font(bold=True)

                for det in orden.detalles:
                    venta = det.venta
                    ws.append([
                        "",
                        f"   → {venta.numero_factura if venta else ''} {venta.tipo_documento if venta else ''}".strip(),
                        venta.razon_social_cliente if venta else "",
                        venta.ruc_cliente if venta else "",
                        venta.numero_factura if venta else "",
                        venta.tipo_documento if venta else "",
                        "",
                        round(float(det.monto_cobrado) * signo, 2),
                        "",
                    ])
                    for cell in ws[ws.max_row]:
                        cell.font = Font(color="808080", italic=True)
                continue
            # Orden sin detalles o no encontrada — cae al tratamiento normal
            # de abajo (fila única con datos en blanco, mismo fallback que
            # ya existía para cualquier referencia sin resolver).

        # Orden de Pago: mismo tratamiento que Orden de Cobro arriba — fila
        # principal con el total (en negrita) + una fila por cada factura/
        # gasto que la compone (indentada, gris/itálica).
        if m.referencia_sistema_tipo == "orden_pago" and m.referencia_sistema_id:
            orden = ordenes_pago_map.get(m.referencia_sistema_id)
            if orden and orden.detalles:
                ws.append([
                    m.fecha.strftime("%d/%m/%Y") if m.fecha else "",
                    m.descripcion or "",
                    orden.nombre_proveedor or "",
                    orden.ruc_proveedor or "",
                    orden.numero_orden,
                    "Orden de Pago",
                    "",
                    monto_con_signo,
                    saldo_acum,
                ])
                for cell in ws[ws.max_row]:
                    cell.font = Font(bold=True)

                for det in orden.detalles:
                    gasto = det.gasto
                    ws.append([
                        "",
                        f"   → {gasto.numero_comprobante if gasto else ''} {gasto.tipo_comprobante if gasto else ''}".strip(),
                        gasto.proveedor if gasto else "",
                        gasto.numero_documento if gasto else "",
                        gasto.numero_comprobante if gasto else "",
                        gasto.tipo_comprobante if gasto else "",
                        "",
                        round(float(det.monto_pagado) * signo, 2),
                        "",
                    ])
                    for cell in ws[ws.max_row]:
                        cell.font = Font(color="808080", italic=True)
                continue
            # Orden sin detalles o no encontrada — cae al tratamiento normal
            # de abajo.

        doc = None
        if m.referencia_sistema_tipo == "cobranza" and m.referencia_sistema_id:
            pago = pagos_cobr_map.get(m.referencia_sistema_id)
            venta = ventas_map.get(pago.comprobante_id) if pago else None
            if venta:
                doc = {
                    "razon_social":      venta.razon_social_cliente or "",
                    "ruc":               venta.ruc_cliente or "",
                    "numero_documento":  venta.numero_factura or "",
                    "categoria":         "Ingreso por cobro",
                    "descripcion_gasto": venta.descripcion or "",
                }
        elif m.referencia_sistema_tipo == "gasto" and m.referencia_sistema_id:
            # GB (gasto bancario): referencia_sistema_id = Gasto.id directo.
            # Auto-match normal:   referencia_sistema_id = PagoGasto.id — hay
            # que resolver primero el PagoGasto para llegar al Gasto. Esto ya
            # cubre "Gastos Bancarios" como categoría (viene de Gasto.categoria).
            if m.es_gasto_bancario:
                g = gastos_map.get(m.referencia_sistema_id)
            else:
                pago = pagos_gasto_map.get(m.referencia_sistema_id)
                g = gastos_map.get(pago.gasto_id) if pago else None
            if g:
                doc = {
                    "razon_social":      g.proveedor or "",
                    "ruc":               g.numero_documento or "",
                    "numero_documento":  g.numero_comprobante or "",
                    "categoria":         g.categoria or "",
                    "descripcion_gasto": g.descripcion or "",
                }
        elif m.referencia_sistema_tipo == "prestamo" and m.referencia_sistema_id:
            cuota    = cuotas_map.get(m.referencia_sistema_id)
            prestamo = prestamos_map.get(cuota.prestamo_id) if cuota else None
            if cuota and prestamo:
                doc = {
                    "razon_social":      prestamo.nombre_tercero or "",
                    "ruc":               prestamo.ruc_dni_tercero or "",
                    "numero_documento":  f"Cuota N° {cuota.numero_cuota}",
                    "categoria":         "Préstamo",
                    "descripcion_gasto": f"Cuota préstamo — {prestamo.nombre_tercero}",
                }
        elif m.referencia_sistema_tipo == "garantia" and m.referencia_sistema_id:
            pago_g   = pagos_garantia_map.get(m.referencia_sistema_id)
            garantia = garantias_map.get(pago_g.garantia_id) if pago_g else None
            if pago_g and garantia:
                doc = {
                    "razon_social":      garantia.cliente_nombre or "",
                    "ruc":               garantia.cliente_ruc or "",
                    "numero_documento":  garantia.numero_documento or "",
                    "categoria":         "Garantía",
                    "descripcion_gasto": "Devolución garantía",
                }

        if doc is None:
            # Sin referencia de sistema (p.ej. "Solo en Banco" registrado
            # manualmente) — mostrar el movimiento del banco tal cual.
            doc = {
                "razon_social":      "",
                "ruc":               "",
                "numero_documento":  "",
                "categoria":         "Gastos Bancarios" if m.es_gasto_bancario else "",
                "descripcion_gasto": "",
            }

        ws.append([
            m.fecha.strftime("%d/%m/%Y") if m.fecha else "",
            m.descripcion or "",
            doc["razon_social"],
            doc["ruc"],
            doc["numero_documento"],
            doc["categoria"],
            doc["descripcion_gasto"],
            monto_con_signo,
            saldo_acum,
        ])

    # Formato de montos (Monto y Saldo Contable) + resaltar en rojo los saldos negativos
    for row in ws.iter_rows(min_row=2, min_col=8, max_col=9):
        for cell in row:
            cell.number_format = '#,##0.00'
            if cell.column == 9 and isinstance(cell.value, (int, float)) and cell.value < 0:
                cell.font = Font(color="DC2626", bold=True)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=conciliados_{id}.xlsx"},
    )


# ─── Registrar todos los gastos bancarios (bulk) ────────────────────────────

@conciliacion_router.post("/{id}/registrar-gastos-bancarios")
def registrar_gastos_bancarios_bulk(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")

    movs_gb = [
        m for m in conc.movimientos
        if m.es_gasto_bancario and not m.conciliado and m.origen == "banco"
    ]
    if not movs_gb:
        raise HTTPException(400, "No hay gastos bancarios pendientes de registrar")

    total        = round(sum(float(m.monto) for m in movs_gb), 2)
    ultima_fecha = max(m.fecha for m in movs_gb)

    # Reutilizar un GB ya existente (mismo monto y fecha) antes de crear uno nuevo,
    # p.ej. si la conciliación fue eliminada y se volvió a procesar el período.
    gb_existente = _buscar_gb_existente(db, total, ultima_fecha, empresa_id=empresa_id)
    if gb_existente:
        g      = gb_existente
        gb_num = g.numero_comprobante
    else:
        gb_num  = _proximo_gb(db, empresa_id=empresa_id)
        mes_str = f"{MESES_ES.get(conc.periodo_desde.month, '')} {conc.periodo_desde.year}"
        g = Gasto(
            fecha=ultima_fecha,
            categoria="Gastos Bancarios",
            descripcion=f"Comisiones y cargos bancarios - {conc.banco} - {mes_str}",
            monto=total,
            area="Administrativa",
            tipo_comprobante="Gastos Bancarios",
            numero_comprobante=gb_num,
            proveedor=conc.banco or "",
            saldo_pendiente=0.0,
            estado_pago="Pagado",
            created_at=date.today(),
            empresa_id=empresa_id,
        )
        db.add(g)
        db.flush()

    _registrar_pago_gb(
        db, g, total, ultima_fecha,
        _nombre_banco_conciliacion(db, conc),
        _numero_cuenta_conciliacion(db, conc),
    )

    for m in movs_gb:
        m.conciliado              = True
        m.referencia_sistema_id   = g.id
        m.referencia_sistema_tipo = "gasto"

    db.commit()
    mensaje = (
        f"Se reutilizó el gasto bancario existente ({gb_num}) "
        if gb_existente else
        f"Se registraron S/ {total:,.2f} en gastos bancarios ({gb_num}) "
    ) + f"y se marcaron {len(movs_gb)} movimientos como conciliados"
    return {
        "ok":                     True,
        "gasto_id":               g.id,
        "numero_comprobante":     gb_num,
        "total":                  total,
        "movimientos_conciliados":len(movs_gb),
        "mensaje":                mensaje,
    }


# ─── Eliminar conciliación ──────────────────────────────────────────────────

@conciliacion_router.delete("/{id}")
def eliminar_conciliacion(id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q = q.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")
    # Solo se borran conciliaciones_bancarias y sus movimientos_conciliacion.
    # Los Gastos Bancarios (GB) y sus pagos en "gastos"/"pagos_gastos" NO se tocan
    # aquí — quedan disponibles para ser reutilizados (ver _buscar_gb_existente)
    # si se vuelve a procesar/conciliar el mismo período.
    db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == id
    ).delete(synchronize_session=False)
    db.delete(conc)
    db.commit()
    return {"ok": True, "mensaje": f"Conciliación #{id} eliminada correctamente"}


# ─── Registrar un gasto bancario individual ─────────────────────────────────

@conciliacion_router.post("/{id}/movimientos/{mov_id}/registrar-gasto-bancario")
def registrar_gasto_bancario_individual(id: int, mov_id: int, db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q_conc = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == id)
    if empresa_id is not None:
        q_conc = q_conc.filter(ConciliacionBancaria.empresa_id == empresa_id)
    conc = q_conc.first()
    if not conc:
        raise HTTPException(404, "Conciliación no encontrada")
    q_mov = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.id == mov_id,
        MovimientoConciliacion.conciliacion_id == id,
        MovimientoConciliacion.origen == "banco",
    )
    if empresa_id is not None:
        q_mov = q_mov.filter(MovimientoConciliacion.empresa_id == empresa_id)
    mov = q_mov.first()
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    if mov.conciliado:
        raise HTTPException(400, "El movimiento ya está conciliado")

    # Reutilizar un GB ya existente (mismo monto y fecha) antes de crear uno nuevo,
    # p.ej. si la conciliación fue eliminada y se volvió a procesar el período.
    gb_existente = _buscar_gb_existente(db, float(mov.monto), mov.fecha, empresa_id=empresa_id)
    if gb_existente:
        g      = gb_existente
        gb_num = g.numero_comprobante
    else:
        gb_num = _proximo_gb(db, empresa_id=empresa_id)
        g = Gasto(
            fecha=mov.fecha,
            categoria="Gastos Bancarios",
            descripcion=mov.descripcion or f"Cargo bancario - {conc.banco}",
            monto=round(float(mov.monto), 2),
            area="Administrativa",
            tipo_comprobante="Gastos Bancarios",
            numero_comprobante=gb_num,
            proveedor=conc.banco or "",
            saldo_pendiente=0.0,
            estado_pago="Pagado",
            created_at=date.today(),
            empresa_id=empresa_id,
        )
        db.add(g)
        db.flush()

    _registrar_pago_gb(
        db, g, float(mov.monto), mov.fecha,
        _nombre_banco_conciliacion(db, conc),
        _numero_cuenta_conciliacion(db, conc),
    )

    mov.conciliado              = True
    mov.es_gasto_bancario       = True
    mov.referencia_sistema_id   = g.id
    mov.referencia_sistema_tipo = "gasto"

    db.commit()
    mensaje = (
        f"Vinculado al gasto bancario existente ({gb_num}): S/ {mov.monto:,.2f}"
        if gb_existente else
        f"Registrado como gasto bancario ({gb_num}): S/ {mov.monto:,.2f}"
    )
    return {
        "ok":                 True,
        "gasto_id":           g.id,
        "numero_comprobante": gb_num,
        "total":              round(float(mov.monto), 2),
        "movimiento":         _serialize_movimiento(mov),
        "mensaje":            mensaje,
    }
