import calendar
import io
import re
from datetime import date, datetime
from typing import Optional

import pdfplumber
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from app.models.models import Prestamo, CuotaPrestamo, Usuario, MovimientoCaja, Gasto, PagoGasto
from app.models.comercial import CuentaBancaria
from app.core.security import get_current_usuario, get_empresa_id
from app.services.auditoria_service import registrar_log, ip_de

router = APIRouter()

TIPOS_RECIBIDO = ("recibido_banco", "recibido_tercero")
TIPOS_OTORGADO = ("otorgado_tercero", "otorgado_empleado")
TIPOS_VALIDOS  = TIPOS_RECIBIDO + TIPOS_OTORGADO
TIPOS_TASA     = ("TEM", "TEA", "TNA", "TNM", "TCEA", "Personalizada")
METODOS_CON_CUENTA = ("Transferencia", "Cheque")
TAMANO_MAXIMO_PDF_PRESTAMO = 10 * 1024 * 1024


def convertir_a_tasa_mensual(tipo_tasa: str, porcentaje: float) -> float:
    """Convierte cualquier tipo de tasa a tasa mensual efectiva (fracción, no %)."""
    if not tipo_tasa or porcentaje is None:
        return 0.0
    p = porcentaje / 100
    if tipo_tasa == "TEM":
        return p
    elif tipo_tasa == "TEA":
        return (1 + p) ** (1 / 12) - 1
    elif tipo_tasa == "TNA":
        return p / 12
    elif tipo_tasa == "TNM":
        return p
    elif tipo_tasa == "TCEA":
        return (1 + p) ** (1 / 12) - 1
    elif tipo_tasa == "Personalizada":
        return p
    return 0.0


def _sumar_meses(d: date, meses: int) -> date:
    mes_total = d.month - 1 + meses
    anio = d.year + mes_total // 12
    mes = mes_total % 12 + 1
    dia = min(d.day, calendar.monthrange(anio, mes)[1])
    return date(anio, mes, dia)


# ── Importación de cronograma PDF (BCP) ─────────────────────────────────────

def convertir_fecha_bcp(fecha_str: str) -> date:
    """"030426" (ddmmyy) → date(2026, 4, 3). Los cronogramas BCP siempre caen
    en el 2000s, por eso el año de 2 dígitos se completa sumando 2000."""
    dia  = int(fecha_str[0:2])
    mes  = int(fecha_str[2:4])
    anio = 2000 + int(fecha_str[4:6])
    return date(anio, mes, dia)


def _extraer_monto_prestamo(texto: str, patron: str) -> Optional[float]:
    m = re.search(patron, texto, re.IGNORECASE)
    if not m:
        return None
    crudo = m.group(1).replace(",", "")
    try:
        return round(float(crudo), 2)
    except ValueError:
        return None


_CAMPOS_CLAVE_CRONOGRAMA_BCP = ["monto", "tea", "fecha_inicio", "num_cuotas_declaradas", "numero_credito"]

# Fila del cronograma: fecha(ddmmyy) saldo_capital amortizacion intereses
# seguro_desgravamen seguro_bien comisiones cuota_total.
_PATRON_FILA_CRONOGRAMA_BCP = re.compile(
    r'(\d{6})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+'
    r'([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)'
)


def _extraer_datos_cronograma_bcp(texto: str) -> dict:
    """Extrae los datos de un cronograma de préstamo en PDF del BCP: campos
    del encabezado (monto, tasas, fechas, N° crédito) y la tabla de cuotas.
    No crea nada — solo devuelve un preview para que el usuario confirme
    (mismo patrón que _procesar_pdf_individual en comprobantes.py/gastos.py)."""
    monto     = _extraer_monto_prestamo(texto, r'IMPORTE PRESTAMO\s*:\s*([\d,]+\.?\d*)')
    tea       = _extraer_monto_prestamo(texto, r'TASA DE INTERES COMPENSATORIA EFECTIVA ANUAL.*?:\s*([\d.]+)%')
    tcea      = _extraer_monto_prestamo(texto, r'TASA DE COSTO EFECTIVO ANUAL REMANENTE\s+([\d.]+)')

    m_fecha = re.search(r'FECHA DESEMBOLSO:\s*(\d{2}/\d{2}/\d{2})', texto, re.IGNORECASE)
    fecha_inicio = None
    if m_fecha:
        try:
            fecha_inicio = convertir_fecha_bcp(m_fecha.group(1).replace("/", ""))
        except ValueError:
            fecha_inicio = None

    m_num_cuotas = re.search(r'CUOTAS POR PAGAR:\s*(\d+)', texto, re.IGNORECASE)
    num_cuotas_declaradas = int(m_num_cuotas.group(1)) if m_num_cuotas else None

    m_credito = re.search(r'CREDITO NRO\s*:\s*([\d\-]+)', texto, re.IGNORECASE)
    numero_credito = m_credito.group(1) if m_credito else None

    # Aísla la tabla de cuotas entre "PROXIMO VENCIM." y "TOTAL POR PAGAR"
    # para no confundir números del encabezado con filas del cronograma.
    m_seccion = re.search(r'PROXIMO VENCIM\..*?TOTAL POR PAGAR', texto, re.IGNORECASE | re.DOTALL)
    seccion = m_seccion.group(0) if m_seccion else texto

    def _num(s: str) -> float:
        return round(float(s.replace(",", "")), 2)

    filas = []
    for m in _PATRON_FILA_CRONOGRAMA_BCP.finditer(seccion):
        fecha_str, saldo_capital, amortizacion, interes, seguro_desgr, seguro_bien, comisiones, cuota_total = m.groups()
        try:
            fecha_pago = convertir_fecha_bcp(fecha_str)
        except ValueError:
            continue
        filas.append({
            "fecha_pago":          fecha_pago,
            "saldo_final":         _num(saldo_capital),
            "amortizacion":        _num(amortizacion),
            "interes":             _num(interes),
            "seguro_desgravamen":  _num(seguro_desgr),
            "seguro_bien":         _num(seguro_bien),
            "comisiones":          _num(comisiones),
            "cuota_total":         _num(cuota_total),
        })

    # saldo_inicial de la fila 1 = monto del préstamo (encabezado); de ahí en
    # más, cada fila encadena con el saldo_capital (saldo_final) ya impreso
    # en la fila anterior — se confía en los valores del propio PDF en vez
    # de recalcularlos, para no arrastrar errores de redondeo propios.
    cuotas = []
    saldo_previo = monto if monto is not None else (
        round(filas[0]["saldo_final"] + filas[0]["amortizacion"], 2) if filas else 0.0
    )
    for i, f in enumerate(filas, start=1):
        # cuota_total = amortizacion + interes + seguro_desgravamen +
        # seguro_bien + comisiones — con seguro_desgravamen/seguro_bien/
        # comisiones ahora con su propia columna (antes se plegaban dentro
        # de "interes" porque el modelo no tenía dónde guardarlos).
        cuotas.append({
            "numero_cuota":        i,
            "fecha_pago":          str(f["fecha_pago"]),
            "saldo_inicial":       round(saldo_previo, 2),
            "amortizacion":        f["amortizacion"],
            "interes":             f["interes"],
            "seguro_desgravamen":  f["seguro_desgravamen"],
            "seguro_bien":         f["seguro_bien"],
            "comisiones":          f["comisiones"],
            "cuota_total":         f["cuota_total"],
            "saldo_final":         f["saldo_final"],
            "es_adelanto":         False,
            "monto_adelanto":      0,
        })
        saldo_previo = f["saldo_final"]

    detectados = {
        "monto": monto, "tea": tea, "fecha_inicio": fecha_inicio,
        "num_cuotas_declaradas": num_cuotas_declaradas, "numero_credito": numero_credito,
    }
    campos_no_detectados = [c for c in _CAMPOS_CLAVE_CRONOGRAMA_BCP if not detectados.get(c)]
    if not cuotas:
        campos_no_detectados.append("cuotas")
    confianza = round(1 - len(campos_no_detectados) / (len(_CAMPOS_CLAVE_CRONOGRAMA_BCP) + 1), 2)

    if not cuotas:
        estado = "no_valido"
    elif campos_no_detectados:
        estado = "revisar"
    else:
        estado = "listo"

    return {
        "estado":                 estado,
        "monto":                  monto,
        "tea":                    tea,
        "tcea":                   tcea,
        "fecha_inicio":           str(fecha_inicio) if fecha_inicio else None,
        "num_cuotas_declaradas":  num_cuotas_declaradas,
        "numero_credito":         numero_credito,
        "cuotas":                 cuotas,
        "cuotas_detectadas":      len(cuotas),
        "confianza":              max(0.0, min(1.0, confianza)),
        "campos_no_detectados":   campos_no_detectados,
    }


# ── Schemas ──────────────────────────────────────────────────────────────────

class PrestamoCreate(BaseModel):
    tipo: str
    nombre_tercero: str
    ruc_dni_tercero: Optional[str] = None
    monto_original: float
    fecha_inicio: date
    fecha_vencimiento: Optional[date] = None
    aplica_interes: bool = True
    tipo_tasa: Optional[str] = None
    porcentaje_tasa: Optional[float] = None
    descripcion: Optional[str] = None


class PrestamoUpdate(BaseModel):
    nombre_tercero: Optional[str] = None
    ruc_dni_tercero: Optional[str] = None
    monto_original: Optional[float] = None
    fecha_inicio: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    aplica_interes: Optional[bool] = None
    tipo_tasa: Optional[str] = None
    porcentaje_tasa: Optional[float] = None
    descripcion: Optional[str] = None


class PagarCuotaRequest(BaseModel):
    amortizacion: float
    interes: Optional[float] = None  # si no se envía, se calcula: saldo_pendiente * tasa_mensual
    fecha_pago: date
    metodo_pago: str
    cuenta_bancaria_id: Optional[int] = None
    observacion: Optional[str] = None


class EditarCuotaRequest(BaseModel):
    amortizacion: float
    interes: float
    fecha_pago: date
    metodo_pago: str
    cuenta_bancaria_id: Optional[int] = None
    observacion: Optional[str] = None


class AmortizacionRequest(BaseModel):
    monto: float
    tasa_mensual: float
    num_cuotas: int
    fecha_inicio: date
    metodo: str = "fija"  # "fija" (amortización fija) | "frances" (cuota fija/anualidad)


class CuotaCronogramaItem(BaseModel):
    numero_cuota: int
    fecha_pago: date
    saldo_inicial: float
    amortizacion: float
    interes: float = 0
    seguro_desgravamen: float = 0
    seguro_bien: float = 0
    comisiones: float = 0
    cuota_total: float
    saldo_final: float
    es_adelanto: bool = False
    monto_adelanto: float = 0


class GuardarCronogramaRequest(BaseModel):
    cuotas: list[CuotaCronogramaItem]


class PagarCuotaCronogramaRequest(BaseModel):
    fecha_pago_real: date
    metodo_pago: str
    cuenta_bancaria_id: Optional[int] = None
    observacion: Optional[str] = None


class EditarFilaCronogramaRequest(BaseModel):
    fecha_pago: Optional[date] = None
    saldo_inicial: Optional[float] = None
    amortizacion: Optional[float] = None
    interes: Optional[float] = None
    cuota_total: Optional[float] = None
    saldo_final: Optional[float] = None
    es_adelanto: Optional[bool] = None
    monto_adelanto: Optional[float] = None


# ── Helpers de serialización ─────────────────────────────────────────────────

def _serialize(p: Prestamo) -> dict:
    return {
        "id":                p.id,
        "tipo":              p.tipo,
        "nombre_tercero":    p.nombre_tercero,
        "ruc_dni_tercero":   p.ruc_dni_tercero,
        "monto_original":    round(float(p.monto_original), 2),
        "monto_pendiente":   round(float(p.monto_pendiente), 2),
        "fecha_inicio":      str(p.fecha_inicio) if p.fecha_inicio else None,
        "fecha_vencimiento": str(p.fecha_vencimiento) if p.fecha_vencimiento else None,
        "aplica_interes":    p.aplica_interes,
        "tipo_tasa":         p.tipo_tasa,
        "porcentaje_tasa":   p.porcentaje_tasa,
        "tasa_mensual":      p.tasa_mensual,
        "estado":            p.estado,
        "descripcion":       p.descripcion or "",
        "creado_por":        p.creado_por,
        "creado_en":         p.creado_en.strftime("%d/%m/%Y %H:%M") if p.creado_en else None,
    }


def _estado_cuota(c: CuotaPrestamo) -> str:
    """"vencido" es un estado calculado, no persistido: una cuota "pendiente"
    cuya fecha_pago ya pasó se muestra como vencida sin necesidad de un job
    que actualice la BD — en cuanto se paga, deja de importar la fecha."""
    if c.estado == "pagado":
        return "pagado"
    if c.fecha_pago and c.fecha_pago < date.today():
        return "vencido"
    return "pendiente"


def _serialize_cuota(c: CuotaPrestamo) -> dict:
    cuenta = c.cuenta_bancaria
    cuenta_label = f"{cuenta.banco} — {cuenta.numero_cuenta}" if cuenta else None
    return {
        "id":                c.id,
        "numero_cuota":      c.numero_cuota,
        "fecha_pago":        str(c.fecha_pago) if c.fecha_pago else None,
        "saldo_inicial":     round(float(c.saldo_inicial), 2),
        "amortizacion":      round(float(c.amortizacion), 2),
        "interes":           round(float(c.interes or 0), 2),
        "seguro_desgravamen":round(float(c.seguro_desgravamen or 0), 2),
        "seguro_bien":       round(float(c.seguro_bien or 0), 2),
        "comisiones":        round(float(c.comisiones or 0), 2),
        "cuota_total":       round(float(c.cuota_total), 2),
        "saldo_final":       round(float(c.saldo_final), 2),
        "estado":            _estado_cuota(c),
        "es_adelanto":       bool(c.es_adelanto),
        "monto_adelanto":    round(float(c.monto_adelanto or 0), 2),
        "fecha_pago_real":   str(c.fecha_pago_real) if c.fecha_pago_real else None,
        "metodo_pago":       c.metodo_pago,
        "cuenta_bancaria_id":c.cuenta_bancaria_id,
        "cuenta_bancaria":   cuenta_label,
        "observacion":       c.observacion or "",
        "creado_por":        c.creado_por,
    }


def _validar_tasa(aplica_interes: bool, tipo_tasa: Optional[str], porcentaje_tasa: Optional[float]) -> float:
    if not aplica_interes:
        return 0.0
    if not tipo_tasa or tipo_tasa not in TIPOS_TASA:
        raise HTTPException(400, f"tipo_tasa inválido. Debe ser uno de: {', '.join(TIPOS_TASA)}")
    if porcentaje_tasa is None or porcentaje_tasa < 0:
        raise HTTPException(400, "El porcentaje de tasa debe ser mayor o igual a 0")
    return convertir_a_tasa_mensual(tipo_tasa, porcentaje_tasa)


# ── Listar / Resumen / Amortización (rutas estáticas antes de /{id}) ───────

@router.get("")
def listar_prestamos(
    tipo:        str            = "",
    grupo:       str            = "",  # "recibido" | "otorgado" — agrupa los 2 tipos de cada lado (pestañas del frontend)
    estado:      str            = "",
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    search:      str            = "",
    page:        int            = 1,
    per_page:    int            = 20,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(Prestamo)
    if empresa_id is not None: q = q.filter(Prestamo.empresa_id == empresa_id)
    if tipo:        q = q.filter(Prestamo.tipo == tipo)
    if grupo == "recibido": q = q.filter(Prestamo.tipo.in_(TIPOS_RECIBIDO))
    if grupo == "otorgado": q = q.filter(Prestamo.tipo.in_(TIPOS_OTORGADO))
    if estado:      q = q.filter(Prestamo.estado == estado)
    if fecha_desde: q = q.filter(Prestamo.fecha_inicio >= fecha_desde)
    if fecha_hasta: q = q.filter(Prestamo.fecha_inicio <= fecha_hasta)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(Prestamo.nombre_tercero.ilike(like), Prestamo.ruc_dni_tercero.ilike(like)))

    total = q.count()
    rows = q.order_by(Prestamo.fecha_inicio.desc(), Prestamo.id.desc()) \
             .offset((page - 1) * per_page).limit(per_page).all()

    return {"total": total, "page": page, "per_page": per_page, "data": [_serialize(p) for p in rows]}


@router.get("/resumen")
def resumen_prestamos(db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    def _suma(campo, tipos):
        q = db.query(func.sum(campo)).filter(Prestamo.tipo.in_(tipos))
        if empresa_id is not None:
            q = q.filter(Prestamo.empresa_id == empresa_id)
        return float(q.scalar() or 0)

    return {
        "total_recibido":     round(_suma(Prestamo.monto_original, TIPOS_RECIBIDO), 2),
        "total_otorgado":     round(_suma(Prestamo.monto_original, TIPOS_OTORGADO), 2),
        "pendiente_recibido": round(_suma(Prestamo.monto_pendiente, TIPOS_RECIBIDO), 2),
        "pendiente_otorgado": round(_suma(Prestamo.monto_pendiente, TIPOS_OTORGADO), 2),
    }


@router.post("/calcular-amortizacion")
def calcular_amortizacion(data: AmortizacionRequest):
    if data.monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a 0")
    if data.num_cuotas <= 0:
        raise HTTPException(400, "El número de cuotas debe ser mayor a 0")
    if data.metodo not in ("fija", "frances"):
        raise HTTPException(400, "metodo debe ser 'fija' (amortización fija) o 'frances' (cuota fija)")

    tasa = data.tasa_mensual or 0.0
    saldo = round(float(data.monto), 2)
    tabla = []

    if data.metodo == "frances":
        # Sistema francés: cuota total constante (anualidad). Con tasa 0 se
        # reduce a amortización fija (evita división por cero en la fórmula).
        if tasa > 0:
            cuota_fija = round(data.monto * tasa / (1 - (1 + tasa) ** (-data.num_cuotas)), 2)
        else:
            cuota_fija = round(data.monto / data.num_cuotas, 2)

    amortizacion_fija = round(data.monto / data.num_cuotas, 2)

    for n in range(1, data.num_cuotas + 1):
        saldo_inicial = saldo
        interes = round(saldo_inicial * tasa, 2)
        es_ultima = n == data.num_cuotas

        if data.metodo == "frances":
            # última cuota ajusta el redondeo acumulado contra el saldo real
            amort = round(saldo_inicial, 2) if es_ultima else round(cuota_fija - interes, 2)
        else:
            amort = round(saldo_inicial, 2) if es_ultima else amortizacion_fija

        cuota_total = round(amort + interes, 2)
        saldo_final = round(saldo_inicial - amort, 2)
        if saldo_final < 0.01:
            saldo_final = 0.0

        tabla.append({
            "numero_cuota":  n,
            "fecha_pago":    str(_sumar_meses(data.fecha_inicio, n)),
            "saldo_inicial": saldo_inicial,
            "amortizacion":  amort,
            "interes":       interes,
            "cuota_total":   cuota_total,
            "saldo_final":   saldo_final,
            "es_adelanto":   False,
            "monto_adelanto":0,
        })
        saldo = saldo_final

    return {"tabla": tabla}


@router.post("/importar-cronograma-pdf")
async def importar_cronograma_pdf(file: UploadFile = File(...)):
    """Extrae los datos de un cronograma de préstamo BCP en PDF (encabezado +
    tabla de cuotas) y los devuelve como preview — no crea el préstamo ni
    guarda el cronograma; eso lo hace el usuario confirmando vía
    POST /api/prestamos y POST /api/prestamos/{id}/cronograma."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "El archivo debe ser un PDF")

    contenido = await file.read()
    if len(contenido) > TAMANO_MAXIMO_PDF_PRESTAMO:
        raise HTTPException(400, "El archivo supera el tamaño máximo de 10 MB")

    try:
        with pdfplumber.open(io.BytesIO(contenido)) as pdf:
            texto = "\n".join(pagina.extract_text() or "" for pagina in pdf.pages)
    except Exception:
        raise HTTPException(422, "No se pudo leer el archivo. Verifique que sea un PDF válido")

    if len(texto.strip()) < 20:
        raise HTTPException(422, "Este PDF es una imagen escaneada. Los datos no pudieron extraerse automáticamente.")

    return _extraer_datos_cronograma_bcp(texto)


# ── Crear ────────────────────────────────────────────────────────────────────

@router.post("")
def crear_prestamo(data: PrestamoCreate, http_request: Request, db: Session = Depends(get_db),
                    usuario: Usuario = Depends(get_current_usuario),
                    empresa_id: Optional[int] = Depends(get_empresa_id)):
    if data.tipo not in TIPOS_VALIDOS:
        raise HTTPException(400, f"tipo inválido. Debe ser uno de: {', '.join(TIPOS_VALIDOS)}")
    if not data.nombre_tercero.strip():
        raise HTTPException(400, "El nombre/razón social es obligatorio")
    if data.monto_original <= 0:
        raise HTTPException(400, "El monto debe ser mayor a 0")

    tasa_mensual = _validar_tasa(data.aplica_interes, data.tipo_tasa, data.porcentaje_tasa)

    p = Prestamo(
        tipo              = data.tipo,
        nombre_tercero    = data.nombre_tercero.strip(),
        ruc_dni_tercero   = (data.ruc_dni_tercero or "").strip() or None,
        monto_original    = round(data.monto_original, 2),
        monto_pendiente   = round(data.monto_original, 2),
        fecha_inicio      = data.fecha_inicio,
        fecha_vencimiento = data.fecha_vencimiento,
        aplica_interes    = data.aplica_interes,
        tipo_tasa         = data.tipo_tasa if data.aplica_interes else None,
        porcentaje_tasa   = data.porcentaje_tasa if data.aplica_interes else None,
        tasa_mensual      = round(tasa_mensual, 6),
        estado            = "activo",
        descripcion       = data.descripcion or None,
        creado_por        = usuario.nombre,
        creado_en         = datetime.utcnow(),
        empresa_id        = empresa_id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Registró préstamo",
        f"Registró préstamo ({data.tipo}) de S/ {p.monto_original:,.2f} — {p.nombre_tercero}", ip_de(http_request),
    )

    return _serialize(p)


# ── Detalle / Editar / Eliminar ──────────────────────────────────────────────

@router.get("/{prestamo_id}")
def obtener_prestamo(prestamo_id: int, db: Session = Depends(get_db),
                     empresa_id: Optional[int] = Depends(get_empresa_id)):
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    result = _serialize(p)
    cuotas = db.query(CuotaPrestamo).filter(CuotaPrestamo.prestamo_id == prestamo_id) \
               .order_by(CuotaPrestamo.numero_cuota.asc()).all()
    result["cuotas"] = [_serialize_cuota(c) for c in cuotas]
    return result


@router.put("/{prestamo_id}")
def actualizar_prestamo(prestamo_id: int, data: PrestamoUpdate, http_request: Request,
                         db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                         empresa_id: Optional[int] = Depends(get_empresa_id)):
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    if p.estado != "activo":
        raise HTTPException(400, "Solo se pueden editar préstamos activos")

    fields = data.model_dump(exclude_unset=True)

    if "monto_original" in fields and fields["monto_original"] is not None:
        if fields["monto_original"] <= 0:
            raise HTTPException(400, "El monto debe ser mayor a 0")
        # Preserva lo ya amortizado: el pendiente se recalcula sobre el nuevo monto.
        ya_pagado = round(float(p.monto_original) - float(p.monto_pendiente), 2)
        nuevo_monto = round(fields["monto_original"], 2)
        fields["monto_original"]  = nuevo_monto
        fields["monto_pendiente"] = round(max(nuevo_monto - ya_pagado, 0.0), 2)

    if "nombre_tercero" in fields and fields["nombre_tercero"] is not None:
        fields["nombre_tercero"] = fields["nombre_tercero"].strip()
    if "ruc_dni_tercero" in fields and fields["ruc_dni_tercero"] is not None:
        fields["ruc_dni_tercero"] = fields["ruc_dni_tercero"].strip() or None

    if any(k in fields for k in ("aplica_interes", "tipo_tasa", "porcentaje_tasa")):
        aplica_interes  = fields.get("aplica_interes", p.aplica_interes)
        tipo_tasa       = fields.get("tipo_tasa", p.tipo_tasa)
        porcentaje_tasa = fields.get("porcentaje_tasa", p.porcentaje_tasa)
        fields["tasa_mensual"] = round(_validar_tasa(aplica_interes, tipo_tasa, porcentaje_tasa), 6)
        if not aplica_interes:
            fields["tipo_tasa"] = None
            fields["porcentaje_tasa"] = None

    for k, v in fields.items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Editó préstamo",
        f"Editó préstamo #{p.id}", ip_de(http_request),
    )

    return _serialize(p)


@router.delete("/{prestamo_id}")
def eliminar_prestamo(prestamo_id: int, http_request: Request, db: Session = Depends(get_db),
                       usuario: Usuario = Depends(get_current_usuario),
                       empresa_id: Optional[int] = Depends(get_empresa_id)):
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")

    estado_previo = p.estado

    # Antes de borrar el préstamo (cascada sobre sus cuotas, ver
    # Prestamo.cuotas): limpiar lo que las cuotas pagadas generaron fuera de
    # esa cascada — mismo criterio que eliminar_cuota() para una sola cuota,
    # generalizado a todas las cuotas del préstamo.
    cuota_ids = [c.id for c in p.cuotas]
    if cuota_ids:
        # Gastos financieros (interés/seguro/comisión) — ver
        # _generar_gastos_financieros_cuota(). Gasto.cuota_prestamo_id
        # referencia cuotas_prestamo.id sin ondelete, así que deben borrarse
        # antes que las cuotas.
        db.query(Gasto).filter(
            Gasto.cuota_prestamo_id.in_(cuota_ids)
        ).delete(synchronize_session=False)

        # Movimientos de pago de cuota (ver pagar_cuota_cronograma) —
        # PagoGasto.referencia_id apunta a cuotas_prestamo.id cuando
        # tipo == "pago_cuota_prestamo".
        db.query(PagoGasto).filter(
            PagoGasto.tipo == "pago_cuota_prestamo",
            PagoGasto.referencia_id.in_(cuota_ids)
        ).delete(synchronize_session=False)

    db.delete(p)
    db.commit()

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Eliminó préstamo",
        f"Eliminó préstamo #{prestamo_id} (estado: {estado_previo})", ip_de(http_request),
    )

    return {"mensaje": "Préstamo eliminado correctamente"}


# ── Registrar cuota pagada ───────────────────────────────────────────────────

@router.post("/{prestamo_id}/pagar-cuota")
def pagar_cuota(prestamo_id: int, data: PagarCuotaRequest, http_request: Request,
                 db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                 empresa_id: Optional[int] = Depends(get_empresa_id)):
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    if p.estado != "activo":
        raise HTTPException(400, "Solo se pueden registrar cuotas de préstamos activos")
    if data.amortizacion <= 0:
        raise HTTPException(400, "La amortización debe ser mayor a 0")

    saldo_inicial = float(p.monto_pendiente)
    if data.amortizacion > saldo_inicial + 0.01:
        raise HTTPException(400, f"La amortización ({data.amortizacion:.2f}) supera el saldo pendiente ({saldo_inicial:.2f})")

    if data.metodo_pago in METODOS_CON_CUENTA and not data.cuenta_bancaria_id:
        raise HTTPException(400, f"Selecciona una cuenta bancaria para el método de pago {data.metodo_pago}")
    if data.cuenta_bancaria_id and not db.query(CuentaBancaria).filter(CuentaBancaria.id == data.cuenta_bancaria_id).first():
        raise HTTPException(404, "Cuenta bancaria no encontrada")

    amortizacion = round(data.amortizacion, 2)
    if data.interes is not None:
        if data.interes < 0:
            raise HTTPException(400, "El interés no puede ser negativo")
        interes = round(data.interes, 2)
    else:
        interes = round(saldo_inicial * float(p.tasa_mensual or 0), 2)
    cuota_total = round(amortizacion + interes, 2)
    saldo_final = round(saldo_inicial - amortizacion, 2)
    if saldo_final <= 0.01:
        saldo_final = 0.0

    numero_cuota = db.query(CuotaPrestamo).filter(CuotaPrestamo.prestamo_id == p.id).count() + 1

    # Bitácora de Flujo de Caja (MovimientoCaja, ver nota en models.py — no
    # toca conciliaciones_bancarias/movimientos_conciliacion, módulo real de
    # Flujo de Caja). Dirección del efectivo respecto a esta cuota, no al
    # préstamo en general: en un "recibido" nosotros debemos, así que pagar
    # una cuota es dinero que SALE de caja; en un "otorgado" nos deben, así
    # que cobrar una cuota es dinero que ENTRA a caja.
    tipo_movimiento = "salida" if p.tipo in TIPOS_RECIBIDO else "entrada"
    movimiento = MovimientoCaja(
        fecha              = data.fecha_pago,
        tipo               = tipo_movimiento,
        categoria          = "Pago de Préstamo" if tipo_movimiento == "salida" else "Cobro de Préstamo",
        descripcion        = f"Cuota #{numero_cuota} — préstamo {p.nombre_tercero}",
        monto              = cuota_total,
        cuenta_bancaria_id = data.cuenta_bancaria_id,
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
    )
    db.add(movimiento)
    db.flush()  # asigna movimiento.id antes de crear la cuota, que lo referencia

    cuota = CuotaPrestamo(
        prestamo_id        = p.id,
        numero_cuota       = numero_cuota,
        fecha_pago         = data.fecha_pago,
        saldo_inicial      = saldo_inicial,
        amortizacion       = amortizacion,
        interes            = interes,
        cuota_total        = cuota_total,
        saldo_final        = saldo_final,
        estado             = "pagado",
        fecha_pago_real    = data.fecha_pago,
        metodo_pago        = data.metodo_pago,
        cuenta_bancaria_id = data.cuenta_bancaria_id,
        movimiento_caja_id = movimiento.id,
        observacion        = data.observacion or None,
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
    )
    db.add(cuota)

    p.monto_pendiente = saldo_final
    if p.monto_pendiente <= 0.01:
        p.monto_pendiente = 0.0
        p.estado = "pagado"

    db.commit()
    db.refresh(p)
    db.refresh(cuota)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Registró cuota de préstamo",
        f"Registró cuota #{numero_cuota} de S/ {cuota_total:,.2f} del préstamo #{p.id} — {p.nombre_tercero}"
        + (" — préstamo pagado en su totalidad" if p.estado == "pagado" else ""),
        ip_de(http_request),
    )

    result = _serialize(p)
    result["cuota_creada"] = _serialize_cuota(cuota)
    return result


# ── Editar / Eliminar cuota ──────────────────────────────────────────────────

def _es_ultima_cuota_pagada(db: Session, prestamo_id: int, cuota: CuotaPrestamo) -> bool:
    """Última cuota PAGADA (no la última del cronograma en general — con el
    cronograma editable puede haber cuotas "pendiente" con numero_cuota mayor
    que la última realmente pagada)."""
    ultimo_numero = db.query(func.max(CuotaPrestamo.numero_cuota)).filter(
        CuotaPrestamo.prestamo_id == prestamo_id, CuotaPrestamo.estado == "pagado",
    ).scalar()
    return cuota.numero_cuota == ultimo_numero


@router.put("/{prestamo_id}/cuotas/{cuota_id}")
def editar_cuota(prestamo_id: int, cuota_id: int, data: EditarCuotaRequest, http_request: Request,
                  db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                  empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Edita una cuota ya PAGADA (ajusta lo realmente cobrado/pagado). Para
    editar una fila "pendiente"/"vencido" del cronograma usar
    PUT /{prestamo_id}/cronograma/{cuota_id} — esa no toca monto_pendiente,
    porque las pendientes nunca se restaron de él."""
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    cuota = db.query(CuotaPrestamo).filter(
        CuotaPrestamo.id == cuota_id, CuotaPrestamo.prestamo_id == prestamo_id
    ).first()
    if not cuota:
        raise HTTPException(404, "Cuota no encontrada")
    if cuota.estado != "pagado":
        raise HTTPException(400, "Esta cuota no está pagada — usa el editor del cronograma para modificarla")
    # Solo la última cuota pagada: editar una intermedia invalidaría el
    # saldo_inicial/saldo_final encadenado de las cuotas posteriores, que
    # este endpoint no recalcula en cascada.
    if not _es_ultima_cuota_pagada(db, prestamo_id, cuota):
        raise HTTPException(400, "Solo se puede editar la última cuota pagada")

    if data.amortizacion <= 0:
        raise HTTPException(400, "La amortización debe ser mayor a 0")
    if data.interes < 0:
        raise HTTPException(400, "El interés no puede ser negativo")
    if data.metodo_pago in METODOS_CON_CUENTA and not data.cuenta_bancaria_id:
        raise HTTPException(400, f"Selecciona una cuenta bancaria para el método de pago {data.metodo_pago}")
    if data.cuenta_bancaria_id and not db.query(CuentaBancaria).filter(CuentaBancaria.id == data.cuenta_bancaria_id).first():
        raise HTTPException(404, "Cuenta bancaria no encontrada")

    # Revertir el efecto de la amortización anterior sobre monto_pendiente y
    # aplicar la nueva, tal como indica el ticket (revertir, luego reaplicar).
    saldo_disponible = round(float(p.monto_pendiente) + float(cuota.amortizacion), 2)
    nueva_amortizacion = round(data.amortizacion, 2)
    if nueva_amortizacion > saldo_disponible + 0.01:
        raise HTTPException(400, f"La amortización ({nueva_amortizacion:.2f}) supera el saldo disponible ({saldo_disponible:.2f})")

    nuevo_interes = round(data.interes, 2)
    nuevo_saldo_final = round(saldo_disponible - nueva_amortizacion, 2)
    if nuevo_saldo_final <= 0.01:
        nuevo_saldo_final = 0.0

    cuota.amortizacion       = nueva_amortizacion
    cuota.interes            = nuevo_interes
    cuota.cuota_total        = round(nueva_amortizacion + nuevo_interes, 2)
    cuota.saldo_final        = nuevo_saldo_final
    cuota.fecha_pago         = data.fecha_pago
    cuota.fecha_pago_real    = data.fecha_pago
    cuota.metodo_pago        = data.metodo_pago
    cuota.cuenta_bancaria_id = data.cuenta_bancaria_id
    cuota.observacion        = data.observacion or None

    p.monto_pendiente = nuevo_saldo_final
    p.estado = "pagado" if p.monto_pendiente <= 0.01 else "activo"

    # Mantiene sincronizada la bitácora de Flujo de Caja con los nuevos montos
    # (el ticket no lo pide explícitamente para editar, pero dejar el
    # movimiento con el monto/fecha viejos sería inconsistente).
    if cuota.movimiento_caja_id:
        movimiento = db.query(MovimientoCaja).filter(MovimientoCaja.id == cuota.movimiento_caja_id).first()
        if movimiento:
            movimiento.fecha              = data.fecha_pago
            movimiento.monto              = cuota.cuota_total
            movimiento.cuenta_bancaria_id = data.cuenta_bancaria_id

    db.commit()
    db.refresh(p)
    db.refresh(cuota)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Editó cuota de préstamo",
        f"Editó cuota #{cuota.numero_cuota} del préstamo #{p.id} — {p.nombre_tercero}",
        ip_de(http_request),
    )

    result = _serialize(p)
    result["cuota_editada"] = _serialize_cuota(cuota)
    return result


@router.delete("/{prestamo_id}/cuotas/{cuota_id}")
def eliminar_cuota(prestamo_id: int, cuota_id: int, http_request: Request,
                    db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                    empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Elimina una cuota ya PAGADA (revierte lo cobrado/pagado). Para eliminar
    una fila "pendiente"/"vencido" del cronograma usar
    DELETE /{prestamo_id}/cronograma/{cuota_id}."""
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    cuota = db.query(CuotaPrestamo).filter(
        CuotaPrestamo.id == cuota_id, CuotaPrestamo.prestamo_id == prestamo_id
    ).first()
    if not cuota:
        raise HTTPException(404, "Cuota no encontrada")
    if cuota.estado != "pagado":
        raise HTTPException(400, "Esta cuota no está pagada — usa el editor del cronograma para eliminarla")
    if not _es_ultima_cuota_pagada(db, prestamo_id, cuota):
        raise HTTPException(400, "Solo se puede eliminar la última cuota pagada")

    p.monto_pendiente = round(float(p.monto_pendiente) + float(cuota.amortizacion), 2)
    p.estado = "activo"

    if cuota.movimiento_caja_id:
        movimiento = db.query(MovimientoCaja).filter(MovimientoCaja.id == cuota.movimiento_caja_id).first()
        if movimiento:
            db.delete(movimiento)

    # Revierte los Gastos financieros (interés/seguro/comisión) generados al
    # pagar esta cuota — ver _generar_gastos_financieros_cuota(). Debe borrarse
    # antes que la cuota: Gasto.cuota_prestamo_id referencia cuotas_prestamo.id.
    db.query(Gasto).filter(Gasto.cuota_prestamo_id == cuota.id).delete()

    numero_cuota = cuota.numero_cuota
    db.delete(cuota)
    db.commit()
    db.refresh(p)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Eliminó cuota de préstamo",
        f"Eliminó cuota #{numero_cuota} del préstamo #{p.id} — {p.nombre_tercero} (saldo restaurado)",
        ip_de(http_request),
    )

    return _serialize(p)


# ── Cronograma editable (filas "pendiente"/"vencido", no afectan monto_pendiente
#    hasta que se pagan — ver PUT .../cuotas/{cuota_id}/pagar) ─────────────────

@router.get("/{prestamo_id}/cronograma")
def obtener_cronograma(prestamo_id: int, db: Session = Depends(get_db),
                       empresa_id: Optional[int] = Depends(get_empresa_id)):
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    if not p.first():
        raise HTTPException(404, "Préstamo no encontrado")
    cuotas = db.query(CuotaPrestamo).filter(CuotaPrestamo.prestamo_id == prestamo_id) \
               .order_by(CuotaPrestamo.numero_cuota.asc()).all()
    return {"cuotas": [_serialize_cuota(c) for c in cuotas]}


@router.post("/{prestamo_id}/cronograma")
def guardar_cronograma(prestamo_id: int, data: GuardarCronogramaRequest, http_request: Request,
                        db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                        empresa_id: Optional[int] = Depends(get_empresa_id)):
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")

    for c in data.cuotas:
        if c.amortizacion < 0 or c.interes < 0:
            raise HTTPException(400, f"La cuota #{c.numero_cuota} tiene montos negativos")

    # Elimina solo las pendientes/vencidas (no persisten como "vencido" en BD,
    # así que basta filtrar estado != "pagado") — las pagadas quedan intactas.
    pendientes_previas = db.query(CuotaPrestamo).filter(
        CuotaPrestamo.prestamo_id == prestamo_id, CuotaPrestamo.estado != "pagado",
    ).all()
    for c in pendientes_previas:
        if c.movimiento_caja_id:
            mov = db.query(MovimientoCaja).filter(MovimientoCaja.id == c.movimiento_caja_id).first()
            if mov:
                db.delete(mov)
        db.delete(c)
    db.flush()

    for item in data.cuotas:
        db.add(CuotaPrestamo(
            prestamo_id     = p.id,
            numero_cuota    = item.numero_cuota,
            fecha_pago      = item.fecha_pago,
            saldo_inicial   = round(item.saldo_inicial, 2),
            amortizacion    = round(item.amortizacion, 2),
            interes         = round(item.interes, 2),
            seguro_desgravamen = round(item.seguro_desgravamen, 2),
            seguro_bien     = round(item.seguro_bien, 2),
            comisiones      = round(item.comisiones, 2),
            cuota_total     = round(item.cuota_total, 2),
            saldo_final     = round(item.saldo_final, 2),
            estado          = "pendiente",
            es_adelanto     = item.es_adelanto,
            monto_adelanto  = round(item.monto_adelanto, 2),
            creado_por      = usuario.nombre,
            creado_en       = datetime.utcnow(),
        ))

    # monto_pendiente solo baja con lo efectivamente PAGADO — el cronograma
    # (pendiente/vencido) es una proyección futura, no compromete saldo aún.
    pagado = float(db.query(func.sum(CuotaPrestamo.amortizacion)).filter(
        CuotaPrestamo.prestamo_id == prestamo_id, CuotaPrestamo.estado == "pagado",
    ).scalar() or 0)
    nuevo_pendiente = round(float(p.monto_original) - pagado, 2)
    p.monto_pendiente = nuevo_pendiente if nuevo_pendiente > 0.01 else 0.0
    p.estado = "pagado" if p.monto_pendiente <= 0.01 else "activo"

    db.commit()
    db.refresh(p)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Guardó cronograma de préstamo",
        f"Guardó cronograma de {len(data.cuotas)} cuota(s) del préstamo #{p.id} — {p.nombre_tercero}",
        ip_de(http_request),
    )

    cuotas = db.query(CuotaPrestamo).filter(CuotaPrestamo.prestamo_id == prestamo_id) \
               .order_by(CuotaPrestamo.numero_cuota.asc()).all()
    result = _serialize(p)
    result["cuotas"] = [_serialize_cuota(c) for c in cuotas]
    return result


def _generar_gastos_financieros_cuota(db: Session, prestamo: Prestamo, cuota: CuotaPrestamo, usuario: Usuario, empresa_id=None) -> None:
    """Registra interés/seguro desgravamen/comisiones de una cuota recién
    pagada como Gastos reales (afectan utilidad) — la amortización NO se
    incluye acá, es pago de capital, no gasto. Solo aplica a préstamos
    "recibido" (dinero que sale de la empresa): en uno "otorgado" el interés
    que cobramos es un ingreso para nosotros, no un gasto."""
    if prestamo.tipo not in TIPOS_RECIBIDO:
        return
    componentes = [
        (cuota.interes,            "Gastos Financieros", "Interés préstamo",  "INT"),
        (cuota.seguro_desgravamen, "Seguros",             "Seguro desgravamen", "SEG"),
        (cuota.comisiones,         "Gastos Bancarios",    "Comisión préstamo", "COM"),
    ]
    for monto_comp, categoria, etiqueta, prefijo in componentes:
        if not monto_comp or monto_comp <= 0:
            continue
        monto_r = round(float(monto_comp), 2)
        db.add(Gasto(
            fecha              = cuota.fecha_pago_real,
            categoria          = categoria,
            descripcion        = f"{etiqueta} — {prestamo.nombre_tercero} — Cuota N° {cuota.numero_cuota}",
            monto              = monto_r,
            area               = "Administrativa",
            tipo_comprobante   = "Recibo Interno",
            numero_comprobante = f"{prefijo}-{prestamo.id}-C{cuota.numero_cuota}",
            base_imponible     = monto_r,
            igv                = 0,
            moneda             = "PEN",
            monto_soles        = monto_r,
            afecta_utilidad    = True,
            saldo_pendiente    = 0.0,
            estado_pago        = "Pagado",
            created_at         = date.today(),
            cuota_prestamo_id  = cuota.id,
            creado_por         = usuario.nombre,
            creado_en          = datetime.utcnow(),
            metodo_creacion    = "Pago Cuota Préstamo",
            empresa_id         = empresa_id,
        ))


@router.put("/{prestamo_id}/cuotas/{cuota_id}/pagar")
def pagar_cuota_cronograma(prestamo_id: int, cuota_id: int, data: PagarCuotaCronogramaRequest, http_request: Request,
                            db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                            empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Marca como pagada una cuota del cronograma (creada por
    POST .../cronograma, estado "pendiente"/"vencido"). Los montos
    (amortización/interés/total) ya están fijados por el cronograma — este
    endpoint solo registra el pago, no los recalcula."""
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    cuota = db.query(CuotaPrestamo).filter(
        CuotaPrestamo.id == cuota_id, CuotaPrestamo.prestamo_id == prestamo_id
    ).first()
    if not cuota:
        raise HTTPException(404, "Cuota no encontrada")
    if cuota.estado == "pagado":
        raise HTTPException(400, "Esta cuota ya está pagada")

    if data.metodo_pago in METODOS_CON_CUENTA and not data.cuenta_bancaria_id:
        raise HTTPException(400, f"Selecciona una cuenta bancaria para el método de pago {data.metodo_pago}")
    if data.cuenta_bancaria_id and not db.query(CuentaBancaria).filter(CuentaBancaria.id == data.cuenta_bancaria_id).first():
        raise HTTPException(404, "Cuenta bancaria no encontrada")

    # Misma convención que pagar-cuota: "recibido" = nosotros pagamos (salida),
    # "otorgado" = nos pagan (entrada).
    tipo_movimiento = "salida" if p.tipo in TIPOS_RECIBIDO else "entrada"
    movimiento = MovimientoCaja(
        fecha              = data.fecha_pago_real,
        tipo               = tipo_movimiento,
        categoria          = "Pago de Préstamo" if tipo_movimiento == "salida" else "Cobro de Préstamo",
        descripcion        = f"Cuota #{cuota.numero_cuota} — préstamo {p.nombre_tercero}",
        monto              = round(float(cuota.cuota_total), 2),
        cuenta_bancaria_id = data.cuenta_bancaria_id,
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
    )
    db.add(movimiento)
    db.flush()

    cuota.estado             = "pagado"
    cuota.fecha_pago_real    = data.fecha_pago_real
    cuota.metodo_pago        = data.metodo_pago
    cuota.cuenta_bancaria_id = data.cuenta_bancaria_id
    cuota.movimiento_caja_id = movimiento.id
    cuota.observacion        = data.observacion or None

    p.monto_pendiente = round(max(float(p.monto_pendiente) - float(cuota.amortizacion), 0.0), 2)
    if p.monto_pendiente <= 0.01:
        p.monto_pendiente = 0.0
        p.estado = "pagado"

    # Registro en Lista de Pagos (Gastos): sin Gasto propio (gasto_id=None —
    # el monto de la cuota en sí no es un gasto, ver nota en el modelo
    # PagoGasto), identificado por tipo/referencia_id para poder localizarlo
    # y revertirlo desde DELETE /gastos/pagos/{pago_id}.
    cuenta_bancaria = (
        db.query(CuentaBancaria).filter(CuentaBancaria.id == data.cuenta_bancaria_id).first()
        if data.cuenta_bancaria_id else None
    )
    db.add(PagoGasto(
        gasto_id      = None,
        monto_pagado  = round(float(cuota.cuota_total), 2),
        fecha_pago    = data.fecha_pago_real,
        metodo_pago   = data.metodo_pago,
        banco         = cuenta_bancaria.banco if cuenta_bancaria else None,
        numero_cuenta = cuenta_bancaria.numero_cuenta if cuenta_bancaria else None,
        created_at    = date.today(),
        tipo          = "pago_cuota_prestamo",
        referencia_id = cuota.id,
    ))

    _generar_gastos_financieros_cuota(db, p, cuota, usuario, empresa_id)

    db.commit()
    db.refresh(p)
    db.refresh(cuota)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Pagó cuota de cronograma",
        f"Pagó cuota #{cuota.numero_cuota} de S/ {cuota.cuota_total:,.2f} del préstamo #{p.id} — {p.nombre_tercero}"
        + (" — préstamo pagado en su totalidad" if p.estado == "pagado" else ""),
        ip_de(http_request),
    )

    result = _serialize(p)
    result["cuota_pagada"] = _serialize_cuota(cuota)
    return result


@router.put("/{prestamo_id}/cronograma/{cuota_id}")
def editar_fila_cronograma(prestamo_id: int, cuota_id: int, data: EditarFilaCronogramaRequest, http_request: Request,
                            db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                            empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Edita una fila pendiente/vencida del cronograma directamente (ej. desde
    el detalle del préstamo). No toca monto_pendiente: las filas pendientes
    nunca se restaron de él (eso ocurre recién al pagar, ver .../pagar)."""
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    if not p.first():
        raise HTTPException(404, "Préstamo no encontrado")
    cuota = db.query(CuotaPrestamo).filter(
        CuotaPrestamo.id == cuota_id, CuotaPrestamo.prestamo_id == prestamo_id
    ).first()
    if not cuota:
        raise HTTPException(404, "Cuota no encontrada")
    if cuota.estado == "pagado":
        raise HTTPException(400, "No se puede editar una cuota ya pagada desde el cronograma — usa PUT /cuotas/{cuota_id}")

    fields = data.model_dump(exclude_unset=True)
    for campo in ("saldo_inicial", "amortizacion", "interes", "cuota_total", "saldo_final", "monto_adelanto"):
        if campo in fields and fields[campo] is not None:
            if fields[campo] < 0:
                raise HTTPException(400, f"{campo} no puede ser negativo")
            fields[campo] = round(fields[campo], 2)

    for k, v in fields.items():
        setattr(cuota, k, v)
    db.commit()
    db.refresh(cuota)

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Editó fila de cronograma",
        f"Editó cuota #{cuota.numero_cuota} (pendiente) del préstamo #{prestamo_id}",
        ip_de(http_request),
    )

    return _serialize_cuota(cuota)


@router.delete("/{prestamo_id}/cronograma/{cuota_id}")
def eliminar_fila_cronograma(prestamo_id: int, cuota_id: int, http_request: Request,
                              db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                              empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Elimina una fila pendiente/vencida del cronograma. No toca
    monto_pendiente (ver nota en editar_fila_cronograma)."""
    p = db.query(Prestamo).filter(Prestamo.id == prestamo_id)
    if empresa_id is not None: p = p.filter(Prestamo.empresa_id == empresa_id)
    p = p.first()
    if not p:
        raise HTTPException(404, "Préstamo no encontrado")
    cuota = db.query(CuotaPrestamo).filter(
        CuotaPrestamo.id == cuota_id, CuotaPrestamo.prestamo_id == prestamo_id
    ).first()
    if not cuota:
        raise HTTPException(404, "Cuota no encontrada")
    if cuota.estado == "pagado":
        raise HTTPException(400, "No se puede eliminar una cuota ya pagada desde el cronograma — usa DELETE /cuotas/{cuota_id}")

    numero_cuota = cuota.numero_cuota
    db.delete(cuota)
    db.commit()

    registrar_log(
        db, usuario.id, usuario.nombre, "prestamos", "Eliminó fila de cronograma",
        f"Eliminó cuota #{numero_cuota} (pendiente) del préstamo #{prestamo_id}",
        ip_de(http_request),
    )

    return {"mensaje": "Fila del cronograma eliminada correctamente"}
