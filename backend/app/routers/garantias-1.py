from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session

from database import get_db
from app.models.models import Garantia, Usuario, PagoGarantia, MovimientoCaja, CreditoCliente
from app.models.comercial import VentaComercial, CuentaBancaria, PagoCobranza
from app.core.security import get_current_usuario, get_empresa_id
from app.services.auditoria_service import registrar_log, ip_de

METODOS_CON_CUENTA = ("Transferencia", "Cheque")

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class GarantiaCreate(BaseModel):
    cliente_ruc: str
    cliente_nombre: str
    tipo_documento: str = "Recibo Interno"
    numero_documento: Optional[str] = None
    monto: float
    fecha_cobro: date
    metodo_cobro: str
    cuenta_bancaria_id: Optional[int] = None
    observacion: Optional[str] = None


class GarantiaUpdate(BaseModel):
    cliente_ruc: Optional[str] = None
    cliente_nombre: Optional[str] = None
    tipo_documento: Optional[str] = None
    numero_documento: Optional[str] = None
    monto: Optional[float] = None
    fecha_cobro: Optional[date] = None
    metodo_cobro: Optional[str] = None
    cuenta_bancaria_id: Optional[int] = None
    observacion: Optional[str] = None


class DevolverRequest(BaseModel):
    monto_devolucion: float
    fecha: date
    metodo_pago: str
    cuenta_bancaria_id: Optional[int] = None
    observacion: Optional[str] = None


class EjecutarRequest(BaseModel):
    monto_ejecutar: float
    fecha: date
    motivo: str
    aplicar_a: str  # "factura" | "recibo_interno" | "credito"
    venta_id: Optional[int] = None  # obligatorio si aplicar_a == "factura" o "recibo_interno"


class AplicarCreditoRequest(BaseModel):
    credito_id: int
    venta_id: int
    monto_aplicar: float


# ── Helpers ──────────────────────────────────────────────────────────────────

def _proximo_numero_garantia(db: Session, empresa_id=None) -> str:
    """Correlativo GAR-00001 propio de garantías — antes usaba el prefijo
    "RI-", pero ese prefijo también lo genera _proximo_ri_venta en
    comprobantes.py para el Recibo Interno de Ventas, y son dos contadores
    MAX+1 totalmente independientes (cada uno escanea su propia tabla) que
    por lo tanto podían producir el mismo número (p.ej. una garantía y un
    Recibo Interno de Ventas ambos como "RI-00002"). Se separa a un prefijo
    propio para que nunca puedan chocar entre sí, sin tocar la serie RI- de
    Ventas ni los números "RI-" que ya tengan garantías existentes (esos
    quedan como están; solo las garantías nuevas usan GAR-).

    El ticket pedía consultar un modelo SerieDocumento que no existe en el
    sistema — sí existe ConfiguracionDocumento (app/routers/configuracion.py,
    tab Documentos), pero es solo informativo: ningún generador de
    correlativos de este sistema lo lee ni lo actualiza (ver mismo criterio
    en _proximo_ri_venta), así que usarlo como fuente de verdad acá
    desincronizaría esa vista de lo que realmente se genera. Se sigue el
    mismo patrón MAX+1 sobre la tabla real que ya usa el resto de
    correlativos (AC-, CRED-, RI- de Ventas, etc.) — un COUNT() se
    desincroniza y puede repetir un correlativo si alguna garantía se llegó
    a eliminar."""
    q = db.query(Garantia.numero_documento).filter(Garantia.numero_documento.isnot(None))
    if empresa_id is not None:
        q = q.filter(Garantia.empresa_id == empresa_id)
    rows = q.all()
    max_num = 0
    for (nd,) in rows:
        if nd and nd.upper().startswith("GAR-"):
            try:
                n = int(nd[4:])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return f"GAR-{max_num + 1:05d}"


def _serialize(g: Garantia) -> dict:
    cuenta = g.cuenta_bancaria
    return {
        "id":                 g.id,
        "cliente_ruc":        g.cliente_ruc,
        "cliente_nombre":     g.cliente_nombre,
        "monto":              round(float(g.monto), 2),
        "monto_devuelto":     round(float(g.monto_devuelto or 0), 2),
        "monto_ejecutado":    round(float(g.monto_ejecutado or 0), 2),
        "monto_pendiente":    round(float(g.monto_pendiente if g.monto_pendiente is not None else g.monto), 2),
        "fecha_cobro":        str(g.fecha_cobro) if g.fecha_cobro else None,
        "tipo_documento":     g.tipo_documento,
        "numero_documento":   g.numero_documento,
        "estado":             g.estado,
        "metodo_cobro":       g.metodo_cobro,
        "cuenta_bancaria_id": g.cuenta_bancaria_id,
        "cuenta_bancaria":    f"{cuenta.banco} — {cuenta.numero_cuenta}" if cuenta else None,
        "observacion":        g.observacion or "",
        "creado_por":         g.creado_por,
        "creado_en":          g.creado_en.strftime("%d/%m/%Y %H:%M") if g.creado_en else None,
    }


def _serialize_pago(p: PagoGarantia) -> dict:
    cuenta = p.cuenta_bancaria
    cuenta_label = f"{cuenta.banco} — {cuenta.numero_cuenta}" if cuenta else None
    return {
        "id":                        p.id,
        "tipo":                      p.tipo,
        "monto":                     round(float(p.monto), 2),
        "fecha":                     str(p.fecha) if p.fecha else None,
        "metodo_pago":               p.metodo_pago,
        "cuenta_bancaria_id":        p.cuenta_bancaria_id,
        "cuenta_bancaria":           cuenta_label,
        "numero_documento_generado": p.numero_documento_generado,
        "observacion":               p.observacion or "",
        "creado_por":                p.creado_por,
        "creado_en":                 p.creado_en.strftime("%d/%m/%Y %H:%M") if p.creado_en else None,
    }


def _actualizar_estado(g: Garantia) -> None:
    """Recalcula estado a partir de monto_devuelto/monto_ejecutado/monto_pendiente.

    El ticket sólo define 4 estados/colores (retenida, devolucion_parcial,
    devuelta, ejecutada) — no existe un estado "ejecución parcial" separado.
    Mientras quede saldo pendiente, se usa "devolucion_parcial" como el único
    balde de "en progreso", sin importar si lo que se aplicó fue una
    devolución, una ejecución, o una mezcla de ambas. Al llegar a 0 pendiente,
    se resuelve a "ejecutada" si hubo algo ejecutado, o "devuelta" si no.
    """
    if g.monto_pendiente <= 0.01:
        g.monto_pendiente = 0.0
        g.estado = "ejecutada" if (g.monto_ejecutado or 0) > 0.01 else "devuelta"
    else:
        g.estado = "devolucion_parcial"


def revertir_cobro_garantia(db: Session, cobro: PagoCobranza) -> Optional[str]:
    """Revierte en la Garantía/CreditoCliente de origen el efecto de un
    PagoCobranza generado por una garantía (ejecución directa vía
    ejecutar_garantia, o aplicación de un crédito vía aplicar_credito) —
    usado por cobranza.py (eliminar_pago) y comprobantes.py (eliminar /
    eliminar_cascada / eliminar_comprobantes_masivo) ANTES de borrar el
    PagoCobranza, para que al eliminar un cobro o el documento completo la
    garantía/crédito no se quede creyendo que sigue aplicado a algo que ya
    no existe. No hace commit ni delete del propio `cobro` — eso lo maneja
    cada llamador junto con el resto de su propia transacción.

    Devuelve una frase corta para anexar al log de auditoría del llamador,
    o None si el cobro no venía de una garantía."""
    monto = round(float(cobro.monto_pagado), 2)

    if cobro.origen == "ejecucion_garantia":
        g = db.query(Garantia).filter(Garantia.id == cobro.origen_id).first()
        if not g:
            return None
        g.monto_ejecutado = round(max(float(g.monto_ejecutado or 0) - monto, 0.0), 2)
        g.monto_pendiente = round(float(g.monto_pendiente or 0) + monto, 2)
        # Mismos 3 estados que eliminar_pago_garantia (revertir una
        # devolución), pero acá se resta de monto_ejecutado en vez de
        # monto_devuelto.
        if g.monto_ejecutado <= 0.01 and (g.monto_devuelto or 0) <= 0.01:
            g.monto_ejecutado = 0.0
            g.estado = "retenida"
        elif g.monto_pendiente <= 0.01:
            g.monto_pendiente = 0.0
            g.estado = "ejecutada" if (g.monto_ejecutado or 0) > 0.01 else "devuelta"
        else:
            g.estado = "devolucion_parcial"
        return f"garantía #{g.id} revertida (S/ {monto:,.2f} vuelve a estar pendiente)"

    if cobro.origen == "credito_garantia":
        credito = db.query(CreditoCliente).filter(CreditoCliente.id == cobro.origen_id).first()
        if not credito:
            return None
        nuevo_disponible = round(float(credito.monto_disponible or 0) + monto, 2)
        # No puede quedar disponible más de lo que el crédito tuvo originalmente.
        credito.monto_disponible = min(nuevo_disponible, round(float(credito.monto_original), 2))
        credito.estado = "disponible" if credito.monto_disponible > 0.01 else "aplicado"
        return f"crédito {credito.numero_documento or credito.id} revertido (S/ {monto:,.2f} vuelven a estar disponibles)"

    return None


def _recalcular_saldo_venta(db: Session, venta: VentaComercial) -> None:
    """Recalcula saldo_pendiente/estado_cobranza de una VentaComercial desde
    la suma de sus PagoCobranza vigentes — mismo criterio que
    _recalcular_cobranza() en cobranza.py (duplicado acá en vez de importado,
    para no acoplar este router al interno de otro). Se usa tanto al aplicar
    un cobro/ejecución de garantía como al revertirlo (eliminar_garantia):
    al derivar el estado desde la suma real de pagos en vez de sumar/restar
    incrementalmente, maneja correctamente ventas con otros pagos ajenos a
    la garantía ya aplicados."""
    pagos = db.query(PagoCobranza).filter(PagoCobranza.comprobante_id == venta.id).all()
    total_pagado = sum(float(p.monto_pagado) for p in pagos)
    monto_total  = float(venta.precio_venta or venta.monto or 0)
    nuevo_saldo  = round(monto_total - total_pagado, 2)
    if nuevo_saldo <= 0.01:
        venta.saldo_pendiente = 0.0
        venta.estado_cobranza = "Pagada"
    elif total_pagado > 0.01:
        venta.saldo_pendiente = nuevo_saldo
        venta.estado_cobranza = "Pago Parcial"
    else:
        venta.saldo_pendiente = monto_total
        venta.estado_cobranza = "Pendiente"


# ── Listar / KPIs (rutas estáticas antes de /{garantia_id}) ─────────────────

@router.get("")
def listar_garantias(
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    cliente:     str            = "",
    estado:      str            = "",
    page:        int            = 1,
    per_page:    int            = 20,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(Garantia)
    if empresa_id is not None:
        q = q.filter(Garantia.empresa_id == empresa_id)
    if fecha_desde:  q = q.filter(Garantia.fecha_cobro >= fecha_desde)
    if fecha_hasta:  q = q.filter(Garantia.fecha_cobro <= fecha_hasta)
    if estado:       q = q.filter(Garantia.estado == estado)
    if cliente:
        like = f"%{cliente}%"
        q = q.filter(or_(Garantia.cliente_ruc.ilike(like), Garantia.cliente_nombre.ilike(like)))

    total = q.count()
    rows = q.order_by(Garantia.fecha_cobro.desc(), Garantia.id.desc()) \
             .offset((page - 1) * per_page).limit(per_page).all()

    return {"total": total, "page": page, "per_page": per_page, "data": [_serialize(g) for g in rows]}


@router.get("/resumen")
def resumen_garantias(db: Session = Depends(get_db), empresa_id: Optional[int] = Depends(get_empresa_id)):
    q_retenido = db.query(func.sum(
        func.coalesce(Garantia.monto_pendiente, Garantia.monto)
    )).filter(Garantia.estado.in_(["retenida", "devolucion_parcial"]))
    if empresa_id is not None:
        q_retenido = q_retenido.filter(Garantia.empresa_id == empresa_id)
    total_retenido = float(q_retenido.scalar() or 0)

    q_devuelto = db.query(func.sum(func.coalesce(Garantia.monto_devuelto, 0)))
    if empresa_id is not None:
        q_devuelto = q_devuelto.filter(Garantia.empresa_id == empresa_id)
    total_devuelto = float(q_devuelto.scalar() or 0)

    q_ejecutado = db.query(func.sum(func.coalesce(Garantia.monto_ejecutado, 0)))
    if empresa_id is not None:
        q_ejecutado = q_ejecutado.filter(Garantia.empresa_id == empresa_id)
    total_ejecutado = float(q_ejecutado.scalar() or 0)

    return {
        "total_retenido":  round(total_retenido, 2),
        "total_devuelto":  round(total_devuelto, 2),
        "total_ejecutado": round(total_ejecutado, 2),
    }


# ── Créditos disponibles / aplicar crédito (estáticas, antes de /{id}) ──────

@router.get("/creditos/{cliente_ruc}")
def creditos_disponibles(cliente_ruc: str, db: Session = Depends(get_db),
                          empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(CreditoCliente).filter(
        CreditoCliente.cliente_ruc == cliente_ruc,
        CreditoCliente.monto_disponible > 0.01,
    )
    if empresa_id is not None:
        q = q.filter(CreditoCliente.empresa_id == empresa_id)
    rows = q.order_by(CreditoCliente.fecha.desc()).all()
    return [
        {
            "id":               c.id,
            "origen":           c.origen,
            "origen_id":        c.origen_id,
            "numero_documento": c.numero_documento,
            "monto_original":   round(float(c.monto_original), 2),
            "monto_disponible": round(float(c.monto_disponible), 2),
            "estado":           c.estado,
            "fecha":            str(c.fecha) if c.fecha else None,
        }
        for c in rows
    ]


@router.get("/facturas-pendientes/{cliente_ruc}")
def facturas_pendientes(cliente_ruc: str, db: Session = Depends(get_db),
                         empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Facturas/boletas con saldo pendiente del cliente — usadas por el modal
    Ejecutar Garantía para elegir a qué comprobante aplicar el monto ejecutado.
    No reutiliza GET /api/cobranza porque ese endpoint filtra por texto libre
    (search) y semáforo, no por RUC — la garantía sólo conoce cliente_ruc."""
    q = db.query(VentaComercial).filter(
        VentaComercial.ruc_cliente == cliente_ruc,
        VentaComercial.tipo_documento.in_(["Factura", "Boleta de Venta"]),
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza.in_(["Pendiente", "Pago Parcial"]),
    )
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    rows = q.order_by(VentaComercial.fecha.desc()).all()

    return [
        {
            "id":              v.id,
            "numero_factura":  v.numero_factura,
            "monto":           round(float(v.precio_venta or v.monto or 0), 2),
            "saldo_pendiente": round(float(v.saldo_pendiente if v.saldo_pendiente is not None else (v.precio_venta or v.monto or 0)), 2),
        }
        for v in rows
    ]


@router.get("/recibos-internos-pendientes/{cliente_ruc}")
def recibos_internos_pendientes(cliente_ruc: str, db: Session = Depends(get_db),
                                 empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Recibos Internos con saldo pendiente del cliente — usados por el modal
    Ejecutar Garantía cuando aplicar_a = "recibo_interno".

    A diferencia de facturas_pendientes, NO se puede filtrar por
    estado_cobranza en SQL: "Recibo Interno" no está en TIPOS_COBRANZA
    (comprobantes.py), así que _crear_comprobante nunca le asigna
    estado_cobranza/saldo_pendiente al crearlo — quedan en NULL hasta la
    primera vez que se aplica algo contra el recibo (ver ejecutar_garantia,
    rama "recibo_interno", que sí los setea). Por eso el saldo pendiente se
    calcula acá mismo con el mismo fallback que ya usa el campo de salida:
    NULL = todavía no se tocó = pendiente el monto completo."""
    q = db.query(VentaComercial).filter(
        VentaComercial.ruc_cliente == cliente_ruc,
        VentaComercial.tipo_documento == "Recibo Interno",
        VentaComercial.estado != "Anulada",
    )
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    rows = q.order_by(VentaComercial.fecha.desc()).all()

    resultado = []
    for v in rows:
        saldo = float(v.saldo_pendiente) if v.saldo_pendiente is not None else float(v.precio_venta or v.monto or 0)
        if saldo <= 0.01:
            continue
        resultado.append({
            "id":              v.id,
            "numero_factura":  v.numero_factura,
            "monto":           round(float(v.precio_venta or v.monto or 0), 2),
            "saldo_pendiente": round(saldo, 2),
        })
    return resultado


@router.post("/aplicar-credito")
def aplicar_credito(data: AplicarCreditoRequest, http_request: Request, db: Session = Depends(get_db),
                     usuario: Usuario = Depends(get_current_usuario),
                     empresa_id: Optional[int] = Depends(get_empresa_id)):
    q_credito = db.query(CreditoCliente).filter(CreditoCliente.id == data.credito_id)
    if empresa_id is not None:
        q_credito = q_credito.filter(CreditoCliente.empresa_id == empresa_id)
    credito = q_credito.first()
    if not credito:
        raise HTTPException(404, "Crédito no encontrado")

    q_venta = db.query(VentaComercial).filter(VentaComercial.id == data.venta_id)
    if empresa_id is not None:
        q_venta = q_venta.filter(VentaComercial.empresa_id == empresa_id)
    venta = q_venta.first()
    if not venta:
        raise HTTPException(404, "Comprobante no encontrado")
    if credito.cliente_ruc != venta.ruc_cliente:
        raise HTTPException(400, "El crédito no pertenece al cliente de este comprobante")

    if data.monto_aplicar <= 0:
        raise HTTPException(400, "El monto a aplicar debe ser mayor a 0")

    saldo_pendiente   = float(venta.saldo_pendiente) if venta.saldo_pendiente is not None else float(venta.precio_venta or venta.monto or 0)
    monto_disponible  = float(credito.monto_disponible)

    if data.monto_aplicar > monto_disponible + 0.01:
        raise HTTPException(400, f"El monto ({data.monto_aplicar:.2f}) supera el crédito disponible ({monto_disponible:.2f})")
    if data.monto_aplicar > saldo_pendiente + 0.01:
        raise HTTPException(400, f"El monto ({data.monto_aplicar:.2f}) supera el saldo pendiente ({saldo_pendiente:.2f})")

    monto_aplicar = round(data.monto_aplicar, 2)

    nuevo_saldo_venta   = round(saldo_pendiente - monto_aplicar, 2)
    nuevo_saldo_credito = round(monto_disponible - monto_aplicar, 2)

    venta.saldo_pendiente = nuevo_saldo_venta if nuevo_saldo_venta > 0.01 else 0.0
    venta.estado_cobranza = "Pagada" if venta.saldo_pendiente <= 0.01 else "Pago Parcial"

    # Se registra también como un cobro en Cuentas por Cobrar / Lista de
    # Cobros (mismo patrón que un pago en efectivo, pero con su propio
    # "método de pago" para distinguirlo de un cobro real recibido) — así
    # queda trazable ahí y no solo en el historial de la garantía/crédito.
    # listar_pagos_cobranza ya incluye TODO PagoCobranza sin filtrar por
    # método, así que no hace falta tocar esa consulta.
    cobro = PagoCobranza(
        comprobante_id  = venta.id,
        monto_pagado    = monto_aplicar,
        fecha_pago      = date.today(),
        metodo_pago     = "Crédito por Garantía",
        created_at      = date.today(),
        creado_por      = usuario.nombre,
        creado_en       = datetime.utcnow(),
        metodo_creacion = "Crédito de Garantía",
        # Vincula este cobro con el crédito que lo generó (y ese crédito, a
        # su vez, con la garantía vía CreditoCliente.origen_id) — permite
        # revertirlo si se elimina la garantía. Ver eliminar_garantia.
        origen          = "credito_garantia",
        origen_id       = credito.id,
        empresa_id      = empresa_id,
    )
    db.add(cobro)

    credito.monto_disponible = nuevo_saldo_credito if nuevo_saldo_credito > 0.01 else 0.0
    credito.estado = "aplicado" if credito.monto_disponible <= 0.01 else "parcial"

    db.commit()
    db.refresh(venta)
    db.refresh(credito)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Aplicó crédito de garantía",
        f"Aplicó S/ {monto_aplicar:,.2f} del crédito {credito.numero_documento or credito.id} en {venta.numero_factura}",
        ip_de(http_request),
    )

    return {
        "mensaje":                  "Crédito aplicado correctamente",
        "venta_saldo_pendiente":    venta.saldo_pendiente,
        "venta_estado_cobranza":    venta.estado_cobranza,
        "credito_monto_disponible": credito.monto_disponible,
        "credito_estado":           credito.estado,
    }


# ── Crear ────────────────────────────────────────────────────────────────────

@router.post("")
def crear_garantia(data: GarantiaCreate, http_request: Request, db: Session = Depends(get_db),
                    usuario: Usuario = Depends(get_current_usuario),
                    empresa_id: Optional[int] = Depends(get_empresa_id)):
    if data.monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a 0")
    if not data.cliente_ruc.strip() or not data.cliente_nombre.strip():
        raise HTTPException(400, "Cliente (RUC/DNI y nombre) es obligatorio")
    if not data.metodo_cobro or not data.metodo_cobro.strip():
        raise HTTPException(400, "El método de cobro es obligatorio")
    if data.metodo_cobro in METODOS_CON_CUENTA and not data.cuenta_bancaria_id:
        raise HTTPException(400, f"Selecciona una cuenta bancaria para el método de cobro {data.metodo_cobro}")
    if data.cuenta_bancaria_id and not db.query(CuentaBancaria).filter(CuentaBancaria.id == data.cuenta_bancaria_id).first():
        raise HTTPException(404, "Cuenta bancaria no encontrada")

    # Recibo Interno: correlativo automático — el N° Documento enviado por el
    # cliente se ignora para este tipo (el frontend lo deja de solo lectura).
    if data.tipo_documento == "Recibo Interno":
        numero_documento = _proximo_numero_garantia(db, empresa_id)
    else:
        numero_documento = (data.numero_documento or "").strip() or None

    g = Garantia(
        cliente_ruc        = data.cliente_ruc.strip(),
        cliente_nombre     = data.cliente_nombre.strip(),
        monto              = round(data.monto, 2),
        monto_devuelto     = 0.0,
        monto_ejecutado    = 0.0,
        monto_pendiente    = round(data.monto, 2),
        fecha_cobro        = data.fecha_cobro,
        tipo_documento     = data.tipo_documento,
        numero_documento   = numero_documento,
        estado             = "retenida",
        metodo_cobro       = data.metodo_cobro,
        cuenta_bancaria_id = data.cuenta_bancaria_id,
        observacion        = data.observacion or None,
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
        empresa_id         = empresa_id,
    )
    db.add(g)
    db.commit()
    db.refresh(g)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Registró garantía",
        f"Registró garantía de S/ {g.monto:,.2f} — {g.cliente_nombre}", ip_de(http_request),
    )

    return _serialize(g)


# ── Eliminar un pago de devolución (revierte solo esa devolución) ───────────

@router.delete("/pagos/{pago_id}")
def eliminar_pago_garantia(pago_id: int, http_request: Request, db: Session = Depends(get_db),
                            usuario: Usuario = Depends(get_current_usuario),
                            empresa_id: Optional[int] = Depends(get_empresa_id)):
    """Elimina una devolución (PagoGarantia.tipo="devolucion") y revierte su
    efecto en la garantía — usado desde Lista de Pagos (Gastos), donde cada
    devolución aparece como fila `devolucion_garantia` (ver GET /gastos/pagos).
    Las ejecuciones (tipo="ejecucion") no se revierten acá: también generaron
    un PagoCobranza (y a veces un CreditoCliente) que hay que revertir en
    conjunto, así que esas solo se deshacen eliminando la garantía completa
    (ver DELETE /{garantia_id}, que sí lo hace)."""
    pago = db.query(PagoGarantia).filter(PagoGarantia.id == pago_id).first()
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    if pago.tipo != "devolucion":
        raise HTTPException(400, "Solo se pueden eliminar devoluciones desde aquí — para revertir una ejecución, elimina la garantía completa")

    garantia = db.query(Garantia).filter(Garantia.id == pago.garantia_id).first()
    if not garantia:
        raise HTTPException(404, "Garantía no encontrada")

    monto = round(float(pago.monto), 2)
    garantia.monto_devuelto  = round(max(float(garantia.monto_devuelto or 0) - monto, 0.0), 2)
    garantia.monto_pendiente = round(float(garantia.monto_pendiente or 0) + monto, 2)

    # Mismos 3 estados que _actualizar_estado, pero distingue "sin nada
    # aplicado todavía" (retenida) de "queda un saldo parcial pendiente"
    # (devolucion_parcial) — _actualizar_estado no hace esa distinción porque
    # nunca se llama en un escenario donde monto_devuelto pueda volver a 0.
    if garantia.monto_devuelto <= 0.01 and (garantia.monto_ejecutado or 0) <= 0.01:
        garantia.monto_devuelto = 0.0
        garantia.estado = "retenida"
    elif garantia.monto_pendiente <= 0.01:
        garantia.monto_pendiente = 0.0
        garantia.estado = "ejecutada" if (garantia.monto_ejecutado or 0) > 0.01 else "devuelta"
    else:
        garantia.estado = "devolucion_parcial"

    db.delete(pago)
    db.commit()
    db.refresh(garantia)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Eliminó devolución de garantía",
        f"Eliminó devolución de S/ {monto:,.2f} de la garantía #{garantia.id} — {garantia.cliente_nombre} (saldo restaurado)",
        ip_de(http_request),
    )

    return _serialize(garantia)


# ── Detalle / Editar / Eliminar ──────────────────────────────────────────────

@router.get("/{garantia_id}")
def obtener_garantia(garantia_id: int, db: Session = Depends(get_db),
                      empresa_id: Optional[int] = Depends(get_empresa_id)):
    g = db.query(Garantia).filter(Garantia.id == garantia_id).first()
    if not g:
        raise HTTPException(404, "Garantía no encontrada")
    result = _serialize(g)
    pagos = db.query(PagoGarantia).filter(PagoGarantia.garantia_id == garantia_id) \
              .order_by(PagoGarantia.fecha.desc(), PagoGarantia.id.desc()).all()
    result["pagos"] = [_serialize_pago(p) for p in pagos]
    return result


@router.put("/{garantia_id}")
def actualizar_garantia(garantia_id: int, data: GarantiaUpdate, http_request: Request,
                         db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                         empresa_id: Optional[int] = Depends(get_empresa_id)):
    g = db.query(Garantia).filter(Garantia.id == garantia_id).first()
    if not g:
        raise HTTPException(404, "Garantía no encontrada")
    if g.estado != "retenida":
        raise HTTPException(400, "Solo se pueden editar garantías retenidas")

    fields = data.model_dump(exclude_unset=True)
    if "monto" in fields and fields["monto"] is not None:
        if fields["monto"] <= 0:
            raise HTTPException(400, "El monto debe ser mayor a 0")
        fields["monto"] = round(fields["monto"], 2)
        fields["monto_pendiente"] = fields["monto"]
    if "cliente_ruc" in fields and fields["cliente_ruc"] is not None:
        fields["cliente_ruc"] = fields["cliente_ruc"].strip()
    if "cliente_nombre" in fields and fields["cliente_nombre"] is not None:
        fields["cliente_nombre"] = fields["cliente_nombre"].strip()
    if "numero_documento" in fields and fields["numero_documento"] is not None:
        fields["numero_documento"] = fields["numero_documento"].strip() or None
    if "metodo_cobro" in fields or "cuenta_bancaria_id" in fields:
        metodo_cobro = fields.get("metodo_cobro", g.metodo_cobro)
        cuenta_id    = fields.get("cuenta_bancaria_id", g.cuenta_bancaria_id)
        if metodo_cobro in METODOS_CON_CUENTA and not cuenta_id:
            raise HTTPException(400, f"Selecciona una cuenta bancaria para el método de cobro {metodo_cobro}")
        if cuenta_id and not db.query(CuentaBancaria).filter(CuentaBancaria.id == cuenta_id).first():
            raise HTTPException(404, "Cuenta bancaria no encontrada")

    for k, v in fields.items():
        setattr(g, k, v)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Error al guardar: {e}")
    db.refresh(g)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Editó garantía",
        f"Editó garantía #{g.id}", ip_de(http_request),
    )

    return _serialize(g)


@router.delete("/{garantia_id}")
def eliminar_garantia(garantia_id: int, http_request: Request, db: Session = Depends(get_db),
                       usuario: Usuario = Depends(get_current_usuario),
                       empresa_id: Optional[int] = Depends(get_empresa_id)):
    g = db.query(Garantia).filter(Garantia.id == garantia_id).first()
    if not g:
        raise HTTPException(404, "Garantía no encontrada")

    # Eliminable en cualquier estado (corrección de errores de digitación).
    # Revierte TODO lo que esta garantía haya generado, en orden:
    #   1. Créditos que generó al ejecutarse sin documento asociado
    #      (CreditoCliente.origen="garantia_ejecutada"/origen_id=garantia_id).
    #   2. Cobros en Lista de Cobros que ella misma originó — tanto los de
    #      ejecución directa (PagoCobranza.origen="ejecucion_garantia"/
    #      origen_id=garantia_id) como los de aplicar un crédito suyo
    #      (PagoCobranza.origen="credito_garantia"/origen_id=credito.id, para
    #      cada crédito del punto 1). Al borrar esos PagoCobranza y recalcular
    #      cada venta afectada con _recalcular_saldo_venta, el saldo/estado
    #      queda correcto aunque la venta tenga OTROS pagos ajenos a la
    #      garantía ya aplicados (no se resetea a "Pendiente" a la fuerza).
    #   3. Los créditos en sí.
    #   4. La garantía (cascada automática de PagoGarantia vía relationship
    #      "pagos", cascade="all, delete-orphan").
    estado_previo = g.estado

    q_creditos = db.query(CreditoCliente).filter(
        CreditoCliente.origen == "garantia_ejecutada",
        CreditoCliente.origen_id == garantia_id,
    )
    if empresa_id is not None:
        q_creditos = q_creditos.filter(CreditoCliente.empresa_id == empresa_id)
    creditos = q_creditos.all()
    credito_ids = [c.id for c in creditos]

    filtros_origen = [and_(PagoCobranza.origen == "ejecucion_garantia", PagoCobranza.origen_id == garantia_id)]
    if credito_ids:
        filtros_origen.append(and_(PagoCobranza.origen == "credito_garantia", PagoCobranza.origen_id.in_(credito_ids)))

    cobros = db.query(PagoCobranza).filter(or_(*filtros_origen)).all()
    venta_ids_afectadas = set()
    for cobro in cobros:
        if cobro.comprobante_id:
            venta_ids_afectadas.add(cobro.comprobante_id)
        db.delete(cobro)

    for credito in creditos:
        db.delete(credito)

    db.delete(g)

    # La sesión tiene autoflush=False — sin este flush, _recalcular_saldo_venta
    # todavía vería los `cobros` de arriba como presentes (el DELETE no se
    # ejecutó aún) y sobrestimaría lo pagado.
    db.flush()
    for venta_id in venta_ids_afectadas:
        venta = db.query(VentaComercial).filter(VentaComercial.id == venta_id).first()
        if venta:
            _recalcular_saldo_venta(db, venta)

    db.commit()

    detalle = []
    if credito_ids:
        detalle.append(f"{len(credito_ids)} crédito(s) eliminado(s)")
    if cobros:
        detalle.append(f"{len(cobros)} cobro(s) revertido(s) en {len(venta_ids_afectadas)} documento(s)")

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Eliminó garantía",
        f"Eliminó garantía #{garantia_id} (estado: {estado_previo})"
        + (f" — {', '.join(detalle)}" if detalle else ""),
        ip_de(http_request),
    )

    return {"mensaje": "Garantía eliminada correctamente"}


# ── Devolver (parcial) ───────────────────────────────────────────────────────

@router.put("/{garantia_id}/devolver")
def devolver_garantia(garantia_id: int, data: DevolverRequest, http_request: Request,
                       db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                       empresa_id: Optional[int] = Depends(get_empresa_id)):
    g = db.query(Garantia).filter(Garantia.id == garantia_id).first()
    if not g:
        raise HTTPException(404, "Garantía no encontrada")
    if g.estado not in ("retenida", "devolucion_parcial"):
        raise HTTPException(400, "Solo se pueden devolver garantías retenidas o con devolución parcial")
    if data.monto_devolucion <= 0:
        raise HTTPException(400, "El monto a devolver debe ser mayor a 0")

    monto_pendiente = float(g.monto_pendiente if g.monto_pendiente is not None else g.monto)
    if data.monto_devolucion > monto_pendiente + 0.01:
        raise HTTPException(400, f"El monto ({data.monto_devolucion:.2f}) supera el saldo pendiente ({monto_pendiente:.2f})")

    if data.metodo_pago in METODOS_CON_CUENTA and not data.cuenta_bancaria_id:
        raise HTTPException(400, f"Selecciona una cuenta bancaria para el método de pago {data.metodo_pago}")
    if data.cuenta_bancaria_id and not db.query(CuentaBancaria).filter(CuentaBancaria.id == data.cuenta_bancaria_id).first():
        raise HTTPException(404, "Cuenta bancaria no encontrada")

    monto_devolucion = round(data.monto_devolucion, 2)

    g.monto_devuelto  = round(float(g.monto_devuelto or 0) + monto_devolucion, 2)
    g.monto_pendiente = round(monto_pendiente - monto_devolucion, 2)
    _actualizar_estado(g)

    pago = PagoGarantia(
        garantia_id        = g.id,
        tipo               = "devolucion",
        monto              = monto_devolucion,
        fecha              = data.fecha,
        metodo_pago        = data.metodo_pago,
        cuenta_bancaria_id = data.cuenta_bancaria_id,
        observacion        = data.observacion or None,
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
    )
    db.add(pago)

    movimiento = MovimientoCaja(
        fecha              = data.fecha,
        tipo               = "salida",
        categoria          = "Devolución de Garantía",
        descripcion        = f"Devolución garantía #{g.id} — {g.cliente_nombre}",
        monto              = monto_devolucion,
        cuenta_bancaria_id = data.cuenta_bancaria_id,
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
    )
    db.add(movimiento)

    db.commit()
    db.refresh(g)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Devolvió garantía",
        f"Devolvió S/ {monto_devolucion:,.2f} de la garantía #{g.id}"
        + (f" (queda S/ {g.monto_pendiente:,.2f} pendiente)" if g.monto_pendiente > 0.01 else " — completada"),
        ip_de(http_request),
    )

    return _serialize(g)


# ── Ejecutar (parcial — salda una factura del cliente o queda como crédito) ─

@router.put("/{garantia_id}/ejecutar")
def ejecutar_garantia(garantia_id: int, data: EjecutarRequest, http_request: Request,
                       db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario),
                       empresa_id: Optional[int] = Depends(get_empresa_id)):
    g = db.query(Garantia).filter(Garantia.id == garantia_id).first()
    if not g:
        raise HTTPException(404, "Garantía no encontrada")
    if g.estado not in ("retenida", "devolucion_parcial"):
        raise HTTPException(400, "Solo se pueden ejecutar garantías retenidas o con devolución parcial")
    if not data.motivo or not data.motivo.strip():
        raise HTTPException(400, "El motivo es obligatorio")
    if data.monto_ejecutar <= 0:
        raise HTTPException(400, "El monto a ejecutar debe ser mayor a 0")
    if data.aplicar_a not in ("factura", "recibo_interno", "credito"):
        raise HTTPException(400, "aplicar_a debe ser 'factura', 'recibo_interno' o 'credito'")

    monto_pendiente = float(g.monto_pendiente if g.monto_pendiente is not None else g.monto)
    if data.monto_ejecutar > monto_pendiente + 0.01:
        raise HTTPException(400, f"El monto ({data.monto_ejecutar:.2f}) supera el saldo pendiente ({monto_pendiente:.2f})")

    motivo = data.motivo.strip()
    monto_ejecutar = round(data.monto_ejecutar, 2)

    venta = None
    credito = None

    if data.aplicar_a == "factura":
        if not data.venta_id:
            raise HTTPException(400, "Selecciona la factura a saldar")
        venta = db.query(VentaComercial).filter(
            VentaComercial.id == data.venta_id,
            VentaComercial.tipo_documento.in_(["Factura", "Boleta de Venta"]),
        ).first()
        if not venta:
            raise HTTPException(404, "Comprobante no encontrado")
        if venta.ruc_cliente != g.cliente_ruc:
            raise HTTPException(400, "La factura no pertenece al cliente de esta garantía")

        saldo_venta = float(venta.saldo_pendiente) if venta.saldo_pendiente is not None else float(venta.precio_venta or venta.monto or 0)
        if monto_ejecutar > saldo_venta + 0.01:
            raise HTTPException(400, f"El monto ({monto_ejecutar:.2f}) supera el saldo pendiente de la factura ({saldo_venta:.2f})")

    elif data.aplicar_a == "recibo_interno":
        if not data.venta_id:
            raise HTTPException(400, "Selecciona el recibo interno a saldar")
        venta = db.query(VentaComercial).filter(
            VentaComercial.id == data.venta_id,
            VentaComercial.tipo_documento == "Recibo Interno",
        ).first()
        if not venta:
            raise HTTPException(404, "Recibo Interno no encontrado")
        if venta.ruc_cliente != g.cliente_ruc:
            raise HTTPException(400, "El recibo interno no pertenece al cliente de esta garantía")

        saldo_venta = float(venta.saldo_pendiente) if venta.saldo_pendiente is not None else float(venta.precio_venta or venta.monto or 0)
        if monto_ejecutar > saldo_venta + 0.01:
            raise HTTPException(400, f"El monto ({monto_ejecutar:.2f}) supera el saldo pendiente del recibo interno ({saldo_venta:.2f})")

    else:
        # Sin documento asociado: el monto ejecutado queda disponible como
        # crédito a favor del cliente (ver POST /api/garantias/aplicar-credito).
        n_previos = db.query(CreditoCliente).filter(
            CreditoCliente.origen == "garantia_ejecutada", CreditoCliente.origen_id == g.id
        ).count()
        credito = CreditoCliente(
            cliente_ruc      = g.cliente_ruc,
            cliente_nombre   = g.cliente_nombre,
            origen           = "garantia_ejecutada",
            origen_id        = g.id,
            numero_documento = f"CRED-{g.id:04d}-{n_previos + 1}",
            monto_original   = monto_ejecutar,
            monto_disponible = monto_ejecutar,
            estado           = "disponible",
            fecha            = data.fecha,
            creado_por       = usuario.nombre,
            creado_en        = datetime.utcnow(),
            empresa_id       = empresa_id,
        )
        db.add(credito)

    g.monto_ejecutado = round(float(g.monto_ejecutado or 0) + monto_ejecutar, 2)
    g.monto_pendiente = round(monto_pendiente - monto_ejecutar, 2)
    _actualizar_estado(g)
    g.observacion = (f"{g.observacion} — " if g.observacion else "") + f"Ejecutada S/ {monto_ejecutar:,.2f}: {motivo}"

    pago = PagoGarantia(
        garantia_id                = g.id,
        tipo                       = "ejecucion",
        monto                      = monto_ejecutar,
        fecha                      = data.fecha,
        metodo_pago                = None,
        numero_documento_generado  = venta.numero_factura if venta else credito.numero_documento,
        venta_id                   = venta.id if venta else None,
        observacion                = motivo,
        creado_por                 = usuario.nombre,
        creado_en                  = datetime.utcnow(),
    )
    db.add(pago)

    if venta:
        # Igual patrón que aplicar_credito: se registra como cobro en Lista
        # de Cobros (con su propio origen/origen_id para poder revertirlo si
        # se elimina la garantía — ver eliminar_garantia) y el saldo/estado
        # de la venta se deriva de _recalcular_saldo_venta en vez de mutarse
        # a mano, para que conviva bien con otros pagos que tenga la venta.
        cobro = PagoCobranza(
            comprobante_id  = venta.id,
            monto_pagado    = monto_ejecutar,
            fecha_pago      = data.fecha,
            metodo_pago     = "Ejecución de Garantía",
            created_at      = data.fecha,
            creado_por      = usuario.nombre,
            creado_en       = datetime.utcnow(),
            metodo_creacion = "Ejecución de Garantía",
            origen          = "ejecucion_garantia",
            origen_id       = g.id,
            empresa_id      = empresa_id,
        )
        db.add(cobro)
        # La sesión tiene autoflush=False (database.py) — sin este flush,
        # _recalcular_saldo_venta consulta pagos_cobranza y no ve el `cobro`
        # recién agregado (todavía no existe en la fila del DB), y calcula el
        # saldo/estado de la venta como si este pago no se hubiera aplicado.
        db.flush()
        _recalcular_saldo_venta(db, venta)

    db.commit()
    db.refresh(g)
    if venta:
        db.refresh(venta)
    if credito:
        db.refresh(credito)

    detalle_log = f"aplicado a {venta.tipo_documento} {venta.numero_factura}" if venta else f"crédito {credito.numero_documento} disponible"
    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Ejecutó garantía",
        f"Ejecutó S/ {monto_ejecutar:,.2f} de la garantía #{g.id} — {detalle_log}",
        ip_de(http_request),
    )

    result = _serialize(g)
    if venta:
        result["venta_saldada_id"]     = venta.id
        result["venta_saldada_numero"] = venta.numero_factura
    if credito:
        result["credito_creado_id"] = credito.id
    return result
