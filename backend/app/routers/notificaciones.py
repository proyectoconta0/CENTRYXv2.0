from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.models.comercial import VentaComercial
from app.models.models import Gasto
from datetime import date, timedelta

router = APIRouter()

TIPOS_COBRANZA = ["Factura", "Boleta de Venta"]


@router.get("/resumen")
def resumen_notificaciones(db: Session = Depends(get_db)):
    """Alertas en tiempo real para la campana del header: facturas por vencer
    (próximos 7 días), facturas vencidas y gastos pendientes de pago próximos
    a vencer."""
    hoy       = date.today()
    en_7_dias = hoy + timedelta(days=7)
    en_3_dias = hoy + timedelta(days=3)
    alertas   = []

    vencidas = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha_vencimiento.isnot(None),
        VentaComercial.fecha_vencimiento < hoy,
    ).order_by(VentaComercial.fecha_vencimiento.asc()).all()
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

    por_vencer = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha_vencimiento >= hoy,
        VentaComercial.fecha_vencimiento <= en_7_dias,
    ).order_by(VentaComercial.fecha_vencimiento.asc()).all()
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

    gastos_por_vencer = db.query(Gasto).filter(
        Gasto.estado_pago != "Pagado",
        Gasto.saldo_pendiente > 0,
        Gasto.fecha_vencimiento.isnot(None),
        Gasto.fecha_vencimiento <= en_7_dias,
    ).order_by(Gasto.fecha_vencimiento.asc()).all()
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

    # Detracciones por depositar (menos de 3 días) o vencidas sin depositar —
    # tanto de Ventas (cliente nos retuvo) como de Gastos (debemos depositar).
    ventas_det = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento == "Factura",
        VentaComercial.tiene_detraccion.is_(True),
        VentaComercial.detraccion_pagada.is_(False),
        VentaComercial.fecha_limite_detraccion.isnot(None),
        VentaComercial.fecha_limite_detraccion <= en_3_dias,
    ).order_by(VentaComercial.fecha_limite_detraccion.asc()).all()
    for v in ventas_det:
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

    gastos_det = db.query(Gasto).filter(
        Gasto.tipo_comprobante == "Factura",
        Gasto.tiene_detraccion.is_(True),
        Gasto.detraccion_depositada.is_(False),
        Gasto.fecha_limite_detraccion.isnot(None),
        Gasto.fecha_limite_detraccion <= en_3_dias,
    ).order_by(Gasto.fecha_limite_detraccion.asc()).all()
    for g in gastos_det:
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
