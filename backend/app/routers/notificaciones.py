from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.models.comercial import VentaComercial
from app.models.models import Gasto
from app.core.security import get_empresa_id
from datetime import date, timedelta

router = APIRouter()

TIPOS_COBRANZA = ["Factura", "Boleta de Venta"]


@router.get("/resumen")
def resumen_notificaciones(
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    """Alertas en tiempo real para la campana del header: facturas por vencer
    (próximos 7 días), facturas vencidas y gastos pendientes de pago próximos
    a vencer."""
    hoy       = date.today()
    en_7_dias = hoy + timedelta(days=7)
    en_3_dias = hoy + timedelta(days=3)
    alertas   = []

    q_vencidas = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha_vencimiento.isnot(None),
        VentaComercial.fecha_vencimiento < hoy,
    )
    if empresa_id is not None:
        q_vencidas = q_vencidas.filter(VentaComercial.empresa_id == empresa_id)
    vencidas = q_vencidas.order_by(VentaComercial.fecha_vencimiento.asc()).all()

    for v in vencidas:
        dias = (hoy - v.fecha_vencimiento).days
        alertas.append({
            "tipo":          "vencida",
            "titulo":        f"Factura {v.numero_factura or '—'} vencida",
            "descripcion":   f"{v.razon_social_cliente or 'Cliente'} — S/ {float(v.saldo_pendiente or 0):,.2f} · vencida hace {dias} día(s)",
            "modulo":        "cobranza",
            "referencia_id": v.id,
            "fecha":         str(v.fecha_vencimiento),
        })

    q_por_vencer = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha_vencimiento >= hoy,
        VentaComercial.fecha_vencimiento <= en_7_dias,
    )
    if empresa_id is not None:
        q_por_vencer = q_por_vencer.filter(VentaComercial.empresa_id == empresa_id)
    por_vencer = q_por_vencer.order_by(VentaComercial.fecha_vencimiento.asc()).all()

    for v in por_vencer:
        dias = (v.fecha_vencimiento - hoy).days
        alertas.append({
            "tipo":          "por_vencer",
            "titulo":        f"Factura {v.numero_factura or '—'} por vencer",
            "descripcion":   f"{v.razon_social_cliente or 'Cliente'} — S/ {float(v.saldo_pendiente or 0):,.2f} · vence en {dias} día(s)",
            "modulo":        "cobranza",
            "referencia_id": v.id,
            "fecha":         str(v.fecha_vencimiento),
        })

    q_gastos = db.query(Gasto).filter(
        Gasto.estado_pago != "Pagado",
        Gasto.saldo_pendiente > 0,
        Gasto.fecha_vencimiento.isnot(None),
        Gasto.fecha_vencimiento <= en_7_dias,
    )
    if empresa_id is not None:
        q_gastos = q_gastos.filter(Gasto.empresa_id == empresa_id)
    gastos_por_vencer = q_gastos.order_by(Gasto.fecha_vencimiento.asc()).all()

    for g in gastos_por_vencer:
        dias = (g.fecha_vencimiento - hoy).days
        estado_txt = f"vencido hace {abs(dias)} día(s)" if dias < 0 else f"vence en {dias} día(s)"
        es_tributario = g.categoria == "Pagos Tributarios"
        alertas.append({
            "tipo":          "tributo_por_vencer" if es_tributario else "gasto_por_vencer",
            "titulo":        f"Pago Tributario: {g.descripcion or '—'}" if es_tributario else f"Gasto {g.numero_comprobante or g.proveedor or '—'}",
            "descripcion":   f"S/ {float(g.saldo_pendiente or 0):,.2f} · {estado_txt}" if es_tributario else f"{g.proveedor or g.categoria or 'Proveedor'} — S/ {float(g.saldo_pendiente or 0):,.2f} · {estado_txt}",
            "modulo":        "gastos",
            "referencia_id": g.id,
            "fecha":         str(g.fecha_vencimiento),
        })

    # Detracciones por depositar
    q_ventas_det = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento == "Factura",
        VentaComercial.tiene_detraccion.is_(True),
        VentaComercial.detraccion_pagada.is_(False),
        VentaComercial.fecha_limite_detraccion.isnot(None),
        VentaComercial.fecha_limite_detraccion <= en_3_dias,
    )
    if empresa_id is not None:
        q_ventas_det = q_ventas_det.filter(VentaComercial.empresa_id == empresa_id)
    for v in q_ventas_det.order_by(VentaComercial.fecha_limite_detraccion.asc()).all():
        dias = (v.fecha_limite_detraccion - hoy).days
        estado_txt = f"vencida hace {abs(dias)} día(s)" if dias < 0 else f"vence en {dias} día(s)"
        alertas.append({
            "tipo":          "detraccion_pendiente",
            "titulo":        f"Detracción por depositar: {v.numero_factura or '—'}",
            "descripcion":   f"{v.razon_social_cliente or 'Cliente'} — S/ {float(v.monto_detraccion or 0):,.2f} · {estado_txt}",
            "modulo":        "ventas",
            "referencia_id": v.id,
            "fecha":         str(v.fecha_limite_detraccion),
        })

    q_gastos_det = db.query(Gasto).filter(
        Gasto.tipo_comprobante == "Factura",
        Gasto.tiene_detraccion.is_(True),
        Gasto.detraccion_depositada.is_(False),
        Gasto.fecha_limite_detraccion.isnot(None),
        Gasto.fecha_limite_detraccion <= en_3_dias,
    )
    if empresa_id is not None:
        q_gastos_det = q_gastos_det.filter(Gasto.empresa_id == empresa_id)
    for g in q_gastos_det.order_by(Gasto.fecha_limite_detraccion.asc()).all():
        dias = (g.fecha_limite_detraccion - hoy).days
        estado_txt = f"vencida hace {abs(dias)} día(s)" if dias < 0 else f"vence en {dias} día(s)"
        alertas.append({
            "tipo":          "detraccion_pendiente",
            "titulo":        f"Detracción por depositar: {g.numero_comprobante or '—'}",
            "descripcion":   f"{g.proveedor or 'Proveedor'} — S/ {float(g.monto_detraccion or 0):,.2f} · {estado_txt}",
            "modulo":        "gastos",
            "referencia_id": g.id,
            "fecha":         str(g.fecha_limite_detraccion),
        })

    return {"count": len(alertas), "alertas": alertas}
