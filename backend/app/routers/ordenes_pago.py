from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.models import Gasto, OrdenPago, OrdenPagoDetalle
from app.services.empresa_header import get_empresa_header
from app.services.orden_pago_pdf import construir_pdf_orden_pago
from app.core.security import get_empresa_id
from database import get_db

router = APIRouter()

# ── Órdenes de Pago (Cuentas por Pagar) ─────────────────────────────────────
# Pago consolidado de una o varias facturas del mismo proveedor en UN solo
# registro (no un PagoGasto por factura) — mismo patrón que los Lotes de
# Detracciones (backend/app/routers/detracciones.py).


class DocumentoPagoItem(BaseModel):
    gasto_id:     int
    monto_pagado: float


class OrdenPagoCreate(BaseModel):
    # proveedor_id/ruc_proveedor/nombre_proveedor ya no los manda el cliente:
    # la tabla de documentos pendientes ahora es global (todos los
    # proveedores a la vez, con filtros), así que se derivan en el servidor
    # a partir de los documentos seleccionados — ver _proveedor_de_orden().
    documentos:       List[DocumentoPagoItem]
    fecha_pago:       date
    metodo_pago:      str
    banco:            Optional[str] = None
    numero_cuenta:    Optional[str] = None
    numero_cheque:    Optional[str] = None
    numero_operacion: Optional[str] = None


class OrdenPagoDetalleUpdate(BaseModel):
    monto_pagado: float


def _saldo_gasto(g: Gasto) -> float:
    return float(g.saldo_pendiente) if g.saldo_pendiente is not None else float(g.monto or 0)


def _recalcular_estado_gasto(g: Gasto) -> None:
    monto_total = float(g.monto or 0)
    saldo       = float(g.saldo_pendiente or 0)
    if saldo <= 0.01:
        g.saldo_pendiente = 0.0
        g.estado_pago     = "Pagado"
    elif saldo < monto_total:
        g.estado_pago = "Pago Parcial"
    else:
        g.estado_pago = "Pendiente"


def _proveedor_de_orden(gastos: List[Gasto]):
    """Deriva proveedor_id/ruc/nombre para el header de la orden a partir de
    los documentos seleccionados. Si todos son del mismo proveedor, se usa
    ese; si la orden mezcla documentos de varios proveedores (ahora posible,
    la tabla de selección ya no está acotada a uno solo), queda como
    "Varios proveedores" sin proveedor_id único."""
    nombres = {g.proveedor for g in gastos}
    if len(nombres) == 1:
        g0 = gastos[0]
        return g0.proveedor_id, g0.numero_documento, g0.proveedor
    return None, None, "Varios proveedores"


TIPOS_OTROS_EXCLUIDOS = {"Factura", "Recibo Interno", "Boleta"}


def _siguiente_numero_orden(db: Session, empresa_id: Optional[int] = None) -> str:
    q = db.query(OrdenPago.numero_orden)
    if empresa_id is not None:
        q = q.filter(OrdenPago.empresa_id == empresa_id)
    rows   = q.all()
    maximo = 0
    for (numero,) in rows:
        if numero and numero.upper().startswith("OP-"):
            try:
                maximo = max(maximo, int(numero[3:]))
            except ValueError:
                continue
    return f"OP-{maximo + 1:04d}"


def _serializar_orden(o: OrdenPago) -> dict:
    return {
        "id":               o.id,
        "numero_orden":     o.numero_orden,
        "proveedor_id":     o.proveedor_id,
        "ruc_proveedor":    o.ruc_proveedor,
        "nombre_proveedor": o.nombre_proveedor,
        "fecha_pago":       str(o.fecha_pago) if o.fecha_pago else None,
        "monto_total":      round(float(o.monto_total or 0), 2),
        "metodo_pago":      o.metodo_pago,
        "banco":            o.banco,
        "numero_cuenta":    o.numero_cuenta,
        "numero_cheque":    o.numero_cheque,
        "numero_operacion": o.numero_operacion,
        "cantidad_facturas": len(o.detalles),
    }


def _serializar_detalle(d: OrdenPagoDetalle) -> dict:
    g = d.gasto
    return {
        "id":                 d.id,
        "gasto_id":           d.gasto_id,
        "tipo_comprobante":   g.tipo_comprobante if g else None,
        "numero_comprobante": g.numero_comprobante if g else None,
        "proveedor":          g.proveedor if g else None,
        "fecha":              str(g.fecha) if g and g.fecha else None,
        "monto":              round(float(g.monto_soles or g.monto or 0), 2) if g else None,
        "monto_pagado":       round(float(d.monto_pagado), 2),
        "saldo_anterior":     round(float(d.saldo_anterior), 2),
        "saldo_restante":     round(float(d.saldo_anterior) - float(d.monto_pagado), 2),
    }


@router.get("")
def listar_ordenes(db: Session = Depends(get_db),
                   empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(OrdenPago)
    if empresa_id is not None:
        q = q.filter(OrdenPago.empresa_id == empresa_id)
    ordenes = q.order_by(OrdenPago.fecha_pago.desc(), OrdenPago.id.desc()).all()
    return [_serializar_orden(o) for o in ordenes]


# ── Documentos pendientes (para la tabla de selección de "Crear Orden de
# Pago" — ya no está acotada a un proveedor elegido antes; muestra todos
# los documentos con saldo pendiente del sistema, filtrables) ──────────────

@router.get("/documentos-pendientes")
def listar_documentos_pendientes(
    desde:            Optional[date] = None,
    hasta:            Optional[date] = None,
    search:           str            = "",   # RUC o nombre del proveedor
    tipo_comprobante: str            = "",   # "" = todos | "Otros" = ninguno de los conocidos
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(Gasto).filter(
        Gasto.estado_pago != "Pagado",
        Gasto.tipo_comprobante != "Anticipo de Proveedor",
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    if desde: q = q.filter(Gasto.fecha >= desde)
    if hasta: q = q.filter(Gasto.fecha <= hasta)
    if search:
        like = f"%{search}%"
        q = q.filter(Gasto.proveedor.ilike(like) | Gasto.numero_documento.ilike(like))
    if tipo_comprobante == "Otros":
        q = q.filter(~Gasto.tipo_comprobante.in_(TIPOS_OTROS_EXCLUIDOS))
    elif tipo_comprobante:
        q = q.filter(Gasto.tipo_comprobante == tipo_comprobante)

    rows = q.order_by(Gasto.fecha.asc(), Gasto.id.asc()).all()
    data = [
        {
            "id":                 g.id,
            "tipo_comprobante":   g.tipo_comprobante or "",
            "numero_comprobante": g.numero_comprobante or "",
            "proveedor":          g.proveedor or "",
            "numero_documento":   g.numero_documento or "",
            "proveedor_id":       g.proveedor_id,
            "fecha":              str(g.fecha),
            "monto":              round(float(g.monto_soles or g.monto or 0), 2),
            "saldo_pendiente":    round(_saldo_gasto(g), 2),
        }
        for g in rows
        if _saldo_gasto(g) > 0
    ]
    return {"data": data}


@router.post("")
def crear_orden_pago(data: OrdenPagoCreate, db: Session = Depends(get_db),
                     empresa_id: Optional[int] = Depends(get_empresa_id)):
    if not data.documentos:
        raise HTTPException(400, "Debe seleccionar al menos un documento")
    if not data.fecha_pago:
        raise HTTPException(400, "La fecha de pago es obligatoria")

    gasto_ids = [item.gasto_id for item in data.documentos]
    if len(gasto_ids) != len(set(gasto_ids)):
        raise HTTPException(400, "No se puede seleccionar el mismo documento más de una vez")

    q_gastos = db.query(Gasto).filter(Gasto.id.in_(gasto_ids))
    if empresa_id is not None:
        q_gastos = q_gastos.filter(Gasto.empresa_id == empresa_id)
    gastos_por_id = {g.id: g for g in q_gastos.all()}
    if len(gastos_por_id) != len(gasto_ids):
        raise HTTPException(404, "Uno o más documentos seleccionados no fueron encontrados")

    # Monto a pagar por documento, validado individualmente contra su propio
    # saldo_pendiente — no hay reparto automático entre documentos.
    for item in data.documentos:
        g = gastos_por_id[item.gasto_id]
        if g.estado_pago == "Pagado":
            raise HTTPException(400, f"El documento {g.numero_comprobante or g.id} ya está pagado")
        if item.monto_pagado < 0.01:
            raise HTTPException(400, f"El monto a pagar de {g.numero_comprobante or g.id} debe ser al menos S/ 0.01")
        saldo = _saldo_gasto(g)
        if item.monto_pagado > saldo + 0.01:
            raise HTTPException(
                400,
                f"El monto a pagar de {g.numero_comprobante or g.id} (S/ {item.monto_pagado:.2f}) "
                f"no puede exceder su saldo pendiente (S/ {saldo:.2f})",
            )

    proveedor_id, ruc_proveedor, nombre_proveedor = _proveedor_de_orden(list(gastos_por_id.values()))
    orden = OrdenPago(
        numero_orden     = _siguiente_numero_orden(db, empresa_id),
        proveedor_id     = proveedor_id,
        ruc_proveedor    = ruc_proveedor,
        nombre_proveedor = nombre_proveedor,
        fecha_pago       = data.fecha_pago,
        monto_total      = round(sum(item.monto_pagado for item in data.documentos), 2),
        metodo_pago      = data.metodo_pago,
        banco            = data.banco or None,
        numero_cuenta    = data.numero_cuenta or None,
        numero_cheque    = data.numero_cheque or None,
        numero_operacion = data.numero_operacion or None,
        created_at       = date.today(),
        empresa_id       = empresa_id,
    )
    db.add(orden)
    db.flush()

    for item in data.documentos:
        g            = gastos_por_id[item.gasto_id]
        saldo_actual = _saldo_gasto(g)
        monto        = round(item.monto_pagado, 2)
        db.add(OrdenPagoDetalle(
            orden_id       = orden.id,
            gasto_id       = g.id,
            monto_pagado   = monto,
            saldo_anterior = round(saldo_actual, 2),
            created_at     = date.today(),
        ))
        g.saldo_pendiente = round(saldo_actual - monto, 2)
        _recalcular_estado_gasto(g)

    db.commit()
    db.refresh(orden)
    return _serializar_orden(orden)


@router.get("/{orden_id}/detalle")
def detalle_orden(orden_id: int, db: Session = Depends(get_db),
                  empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(OrdenPago).filter(OrdenPago.id == orden_id)
    if empresa_id is not None:
        q = q.filter(OrdenPago.empresa_id == empresa_id)
    orden = q.first()
    if not orden:
        raise HTTPException(404, "Orden de pago no encontrada")
    return {
        **_serializar_orden(orden),
        "detalle": [_serializar_detalle(d) for d in orden.detalles],
    }


@router.put("/{orden_id}/detalle/{detalle_id}")
def editar_detalle_orden(orden_id: int, detalle_id: int, data: OrdenPagoDetalleUpdate,
                          db: Session = Depends(get_db),
                          empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(OrdenPago).filter(OrdenPago.id == orden_id)
    if empresa_id is not None:
        q = q.filter(OrdenPago.empresa_id == empresa_id)
    orden = q.first()
    if not orden:
        raise HTTPException(404, "Orden de pago no encontrada")
    detalle = db.query(OrdenPagoDetalle).filter(
        OrdenPagoDetalle.id == detalle_id, OrdenPagoDetalle.orden_id == orden_id,
    ).first()
    if not detalle:
        raise HTTPException(404, "Factura no encontrada en esta orden de pago")
    if data.monto_pagado < 0:
        raise HTTPException(400, "El monto pagado no puede ser negativo")
    if data.monto_pagado > detalle.saldo_anterior + 0.01:
        raise HTTPException(
            400,
            f"El monto pagado (S/ {data.monto_pagado:.2f}) no puede exceder el saldo que tenía "
            f"la factura al momento de esta orden (S/ {detalle.saldo_anterior:.2f})",
        )

    g = db.query(Gasto).filter(Gasto.id == detalle.gasto_id).first()
    if g:
        g.saldo_pendiente = round(detalle.saldo_anterior - data.monto_pagado, 2)
        _recalcular_estado_gasto(g)

    detalle.monto_pagado = round(data.monto_pagado, 2)
    db.flush()

    orden.monto_total = round(sum(float(d.monto_pagado) for d in orden.detalles), 2)
    db.commit()
    db.refresh(orden)
    db.refresh(detalle)
    return _serializar_detalle(detalle)


@router.get("/{orden_id}/pdf")
def pdf_orden_pago(orden_id: int, db: Session = Depends(get_db),
                   empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(OrdenPago).filter(OrdenPago.id == orden_id)
    if empresa_id is not None:
        q = q.filter(OrdenPago.empresa_id == empresa_id)
    orden = q.first()
    if not orden:
        raise HTTPException(404, "Orden de pago no encontrada")
    empresa = get_empresa_header(db, para_pdf=True)
    pdf_bytes = construir_pdf_orden_pago(empresa, orden)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{orden.numero_orden}.pdf"'},
    )


@router.delete("/{orden_id}")
def eliminar_orden_pago(orden_id: int, db: Session = Depends(get_db),
                         empresa_id: Optional[int] = Depends(get_empresa_id)):
    q = db.query(OrdenPago).filter(OrdenPago.id == orden_id)
    if empresa_id is not None:
        q = q.filter(OrdenPago.empresa_id == empresa_id)
    orden = q.first()
    if not orden:
        raise HTTPException(404, "Orden de pago no encontrada")

    for d in orden.detalles:
        g = db.query(Gasto).filter(Gasto.id == d.gasto_id).first()
        if g:
            g.saldo_pendiente = round(d.saldo_anterior, 2)
            _recalcular_estado_gasto(g)

    db.delete(orden)
    db.commit()
    return {"mensaje": "Orden de pago eliminada"}
