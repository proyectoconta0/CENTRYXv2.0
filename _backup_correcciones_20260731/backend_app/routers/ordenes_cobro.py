from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.comercial import VentaComercial, OrdenCobro, OrdenCobroDetalle
from database import get_db

router = APIRouter()

# ── Órdenes de Cobro (Cuentas por Cobrar) ───────────────────────────────────
# Cobro consolidado de una o varias facturas/boletas del mismo cliente en UN
# solo registro (no un PagoCobranza por comprobante) — mismo patrón que las
# Órdenes de Pago de Gastos (backend/app/routers/ordenes_pago.py): crear la
# orden YA registra el cobro (no hay un paso separado de "agregar" o "pagar").

TIPOS_COBRANZA = ["Factura", "Boleta de Venta"]


class DocumentoCobroItem(BaseModel):
    venta_id:      int
    monto_cobrado: float


class OrdenCobroCreate(BaseModel):
    # cliente_id/ruc_cliente/nombre_cliente no los manda el cliente: la tabla
    # de documentos pendientes es global (todos los clientes a la vez, con
    # filtros), así que se derivan en el servidor — ver _cliente_de_orden().
    documentos:       List[DocumentoCobroItem]
    fecha_cobro:      date
    metodo_cobro:     str
    banco:            Optional[str] = None
    numero_cuenta:    Optional[str] = None
    numero_cheque:    Optional[str] = None
    numero_operacion: Optional[str] = None


class OrdenCobroDetalleUpdate(BaseModel):
    monto_cobrado: float


def _saldo_venta(vc: VentaComercial) -> float:
    return float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else float(vc.precio_venta or vc.monto or 0)


def _recalcular_estado_venta(vc: VentaComercial) -> None:
    monto_total = float(vc.precio_venta or vc.monto or 0)
    saldo       = float(vc.saldo_pendiente or 0)
    if saldo <= 0.01:
        vc.saldo_pendiente = 0.0
        vc.estado_cobranza = "Pagada"
    elif saldo < monto_total:
        vc.estado_cobranza = "Pago Parcial"
    else:
        vc.estado_cobranza = "Pendiente"


def _cliente_de_orden(ventas: List[VentaComercial]):
    """Deriva cliente_id/ruc/nombre para el header de la orden a partir de
    los documentos seleccionados. Si todos son del mismo cliente, se usa ese;
    si la orden mezcla documentos de varios clientes (la tabla de selección
    no está acotada a uno solo), queda como "Varios clientes" sin cliente_id único."""
    nombres = {v.razon_social_cliente or v.cliente_id for v in ventas}
    if len(nombres) == 1:
        v0 = ventas[0]
        return v0.cliente_id, v0.ruc_cliente, v0.razon_social_cliente
    return None, None, "Varios clientes"


def _siguiente_numero_orden(db: Session) -> str:
    rows   = db.query(OrdenCobro.numero_orden).all()
    maximo = 0
    for (numero,) in rows:
        if numero and numero.upper().startswith("OC-"):
            try:
                maximo = max(maximo, int(numero[3:]))
            except ValueError:
                continue
    return f"OC-{maximo + 1:04d}"


def _serializar_orden(o: OrdenCobro) -> dict:
    return {
        "id":                  o.id,
        "numero_orden":        o.numero_orden,
        "cliente_id":          o.cliente_id,
        "ruc_cliente":         o.ruc_cliente,
        "nombre_cliente":      o.nombre_cliente,
        "fecha_cobro":         str(o.fecha_cobro) if o.fecha_cobro else None,
        "monto_total":         round(float(o.monto_total or 0), 2),
        "estado":              o.estado or "Cobrado",
        "metodo_cobro":        o.metodo_cobro,
        "banco":               o.banco,
        "numero_cuenta":       o.numero_cuenta,
        "numero_cheque":       o.numero_cheque,
        "numero_operacion":    o.numero_operacion,
        "cantidad_documentos": len(o.detalles),
    }


def _serializar_detalle(d: OrdenCobroDetalle) -> dict:
    v = d.venta
    return {
        "id":               d.id,
        "venta_id":         d.venta_id,
        "tipo_documento":   v.tipo_documento if v else None,
        "numero_documento": v.numero_factura if v else None,
        "cliente_nombre":   v.razon_social_cliente if v else None,
        "fecha":            str(v.fecha) if v and v.fecha else None,
        "monto":            round(float(v.precio_venta_soles or v.precio_venta or v.monto or 0), 2) if v else None,
        "monto_cobrado":    round(float(d.monto_cobrado), 2),
        "saldo_anterior":   round(float(d.saldo_anterior), 2),
        "saldo_restante":   round(float(d.saldo_anterior) - float(d.monto_cobrado), 2),
    }


@router.get("")
def listar_ordenes(
    desde:        Optional[date] = None,
    hasta:        Optional[date] = None,
    cliente:      str            = "",
    metodo_cobro: str            = "",
    db: Session = Depends(get_db),
):
    q = db.query(OrdenCobro)
    if desde: q = q.filter(OrdenCobro.fecha_cobro >= desde)
    if hasta: q = q.filter(OrdenCobro.fecha_cobro <= hasta)
    if cliente:
        like = f"%{cliente}%"
        q = q.filter(OrdenCobro.nombre_cliente.ilike(like) | OrdenCobro.ruc_cliente.ilike(like))
    if metodo_cobro:
        q = q.filter(OrdenCobro.metodo_cobro == metodo_cobro)
    ordenes = q.order_by(OrdenCobro.fecha_cobro.desc(), OrdenCobro.id.desc()).all()
    return [_serializar_orden(o) for o in ordenes]


# ── Documentos pendientes (para la tabla de selección de "Crear Orden de
# Cobro" — muestra todos los documentos con saldo pendiente del sistema,
# filtrables) ────────────────────────────────────────────────────────────────

@router.get("/documentos-pendientes")
def listar_documentos_pendientes(
    desde:  Optional[date] = None,
    hasta:  Optional[date] = None,
    search: str            = "",   # RUC, nombre del cliente o N° de documento
    db: Session = Depends(get_db),
):
    q = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza != "Pagada",
    )
    if desde: q = q.filter(VentaComercial.fecha >= desde)
    if hasta: q = q.filter(VentaComercial.fecha <= hasta)
    if search:
        like = f"%{search}%"
        q = q.filter(
            VentaComercial.razon_social_cliente.ilike(like) |
            VentaComercial.ruc_cliente.ilike(like) |
            VentaComercial.numero_factura.ilike(like)
        )

    rows = q.order_by(VentaComercial.fecha.asc(), VentaComercial.id.asc()).all()
    data = [
        {
            "id":               v.id,
            "tipo_documento":   v.tipo_documento or "",
            "numero_documento": v.numero_factura or "",
            "cliente_nombre":   v.razon_social_cliente or "",
            "cliente_id":       v.cliente_id,
            "fecha":            str(v.fecha),
            "monto":            round(float(v.precio_venta_soles or v.precio_venta or v.monto or 0), 2),
            "saldo_pendiente":  round(_saldo_venta(v), 2),
        }
        for v in rows
        if _saldo_venta(v) > 0
    ]
    return {"data": data}


@router.post("")
def crear_orden_cobro(data: OrdenCobroCreate, db: Session = Depends(get_db)):
    if not data.documentos:
        raise HTTPException(400, "Debe seleccionar al menos un documento")
    if not data.fecha_cobro:
        raise HTTPException(400, "La fecha de cobro es obligatoria")

    venta_ids = [item.venta_id for item in data.documentos]
    if len(venta_ids) != len(set(venta_ids)):
        raise HTTPException(400, "No se puede seleccionar el mismo documento más de una vez")

    ventas_por_id = {v.id: v for v in db.query(VentaComercial).filter(VentaComercial.id.in_(venta_ids)).all()}
    if len(ventas_por_id) != len(venta_ids):
        raise HTTPException(404, "Uno o más documentos seleccionados no fueron encontrados")

    # Monto a cobrar por documento, validado individualmente contra su propio
    # saldo_pendiente — no hay reparto automático entre documentos.
    for item in data.documentos:
        v = ventas_por_id[item.venta_id]
        if v.estado_cobranza == "Pagada":
            raise HTTPException(400, f"El documento {v.numero_factura or v.id} ya está pagado")
        if item.monto_cobrado < 0.01:
            raise HTTPException(400, f"El monto a cobrar de {v.numero_factura or v.id} debe ser al menos S/ 0.01")
        saldo = _saldo_venta(v)
        if item.monto_cobrado > saldo + 0.01:
            raise HTTPException(
                400,
                f"El monto a cobrar de {v.numero_factura or v.id} (S/ {item.monto_cobrado:.2f}) "
                f"no puede exceder su saldo pendiente (S/ {saldo:.2f})",
            )

    cliente_id, ruc_cliente, nombre_cliente = _cliente_de_orden(list(ventas_por_id.values()))
    orden = OrdenCobro(
        numero_orden     = _siguiente_numero_orden(db),
        cliente_id       = cliente_id,
        ruc_cliente      = ruc_cliente,
        nombre_cliente   = nombre_cliente,
        fecha_cobro      = data.fecha_cobro,
        monto_total      = round(sum(item.monto_cobrado for item in data.documentos), 2),
        estado           = "Cobrado",
        metodo_cobro     = data.metodo_cobro,
        banco            = data.banco or None,
        numero_cuenta    = data.numero_cuenta or None,
        numero_cheque    = data.numero_cheque or None,
        numero_operacion = data.numero_operacion or None,
        created_at       = date.today(),
    )
    db.add(orden)
    db.flush()

    for item in data.documentos:
        v            = ventas_por_id[item.venta_id]
        saldo_actual = _saldo_venta(v)
        monto        = round(item.monto_cobrado, 2)
        db.add(OrdenCobroDetalle(
            orden_id       = orden.id,
            venta_id       = v.id,
            monto_cobrado  = monto,
            saldo_anterior = round(saldo_actual, 2),
            created_at     = date.today(),
        ))
        v.saldo_pendiente = round(saldo_actual - monto, 2)
        _recalcular_estado_venta(v)

    db.commit()
    db.refresh(orden)
    return _serializar_orden(orden)


@router.get("/{orden_id}/detalle")
def detalle_orden(orden_id: int, db: Session = Depends(get_db)):
    orden = db.query(OrdenCobro).filter(OrdenCobro.id == orden_id).first()
    if not orden:
        raise HTTPException(404, "Orden de cobro no encontrada")
    return {
        **_serializar_orden(orden),
        "detalle": [_serializar_detalle(d) for d in orden.detalles],
    }


@router.put("/{orden_id}/detalle/{detalle_id}")
def editar_detalle_orden(orden_id: int, detalle_id: int, data: OrdenCobroDetalleUpdate, db: Session = Depends(get_db)):
    orden = db.query(OrdenCobro).filter(OrdenCobro.id == orden_id).first()
    if not orden:
        raise HTTPException(404, "Orden de cobro no encontrada")
    detalle = db.query(OrdenCobroDetalle).filter(
        OrdenCobroDetalle.id == detalle_id, OrdenCobroDetalle.orden_id == orden_id,
    ).first()
    if not detalle:
        raise HTTPException(404, "Documento no encontrado en esta orden de cobro")
    if data.monto_cobrado < 0:
        raise HTTPException(400, "El monto cobrado no puede ser negativo")
    if data.monto_cobrado > detalle.saldo_anterior + 0.01:
        raise HTTPException(
            400,
            f"El monto cobrado (S/ {data.monto_cobrado:.2f}) no puede exceder el saldo que tenía "
            f"el documento al momento de esta orden (S/ {detalle.saldo_anterior:.2f})",
        )

    v = db.query(VentaComercial).filter(VentaComercial.id == detalle.venta_id).first()
    if v:
        v.saldo_pendiente = round(detalle.saldo_anterior - data.monto_cobrado, 2)
        _recalcular_estado_venta(v)

    detalle.monto_cobrado = round(data.monto_cobrado, 2)
    db.flush()

    orden.monto_total = round(sum(float(d.monto_cobrado) for d in orden.detalles), 2)
    db.commit()
    db.refresh(orden)
    db.refresh(detalle)
    return _serializar_detalle(detalle)


@router.delete("/{orden_id}")
def eliminar_orden_cobro(orden_id: int, db: Session = Depends(get_db)):
    orden = db.query(OrdenCobro).filter(OrdenCobro.id == orden_id).first()
    if not orden:
        raise HTTPException(404, "Orden de cobro no encontrada")

    for d in orden.detalles:
        v = db.query(VentaComercial).filter(VentaComercial.id == d.venta_id).first()
        if v:
            v.saldo_pendiente = round(d.saldo_anterior, 2)
            _recalcular_estado_venta(v)

    db.delete(orden)
    db.commit()
    return {"mensaje": "Orden de cobro eliminada"}
