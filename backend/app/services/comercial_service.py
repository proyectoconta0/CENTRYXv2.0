from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.models import Cliente
from app.models.comercial import Cotizacion, VentaComercial
from datetime import date


def get_resumen(db: Session, empresa_id: Optional[int] = None) -> dict:
    q_cot = db.query(Cotizacion).filter(
        Cotizacion.estado.in_(["borrador", "enviada", "aprobada"]),
        Cotizacion.venta_comercial_id == None,
    )
    if empresa_id is not None:
        q_cot = q_cot.filter(Cotizacion.empresa_id == empresa_id)
    pendientes = q_cot.all()

    monto_pendiente = sum(c.monto for c in pendientes)
    hoy = date.today()
    por_vencer = [c for c in pendientes if 0 <= (c.fecha_vencimiento - hoy).days <= 7]

    q_cli = db.query(func.count(Cliente.id)).filter(Cliente.activo == True)
    if empresa_id is not None:
        q_cli = q_cli.filter(Cliente.empresa_id == empresa_id)
    clientes_activos = q_cli.scalar() or 0

    q_top = (
        db.query(Cliente.razon_social, func.sum(VentaComercial.monto).label("total"))
        .join(VentaComercial, VentaComercial.cliente_id == Cliente.id)
    )
    if empresa_id is not None:
        q_top = q_top.filter(VentaComercial.empresa_id == empresa_id)
    top_row = q_top.group_by(Cliente.razon_social).order_by(func.sum(VentaComercial.monto).desc()).first()

    q_ticket = db.query(func.avg(VentaComercial.monto))
    if empresa_id is not None:
        q_ticket = q_ticket.filter(VentaComercial.empresa_id == empresa_id)
    ticket_row = q_ticket.scalar() or 0

    return {
        "cotizaciones_pendientes": len(pendientes),
        "monto_cotizaciones_pendientes": round(monto_pendiente, 2),
        "cotizaciones_por_vencer": len(por_vencer),
        "por_vencer_detalle": [
            {"numero": c.numero, "dias": (c.fecha_vencimiento - hoy).days,
             "monto": c.monto, "cliente_id": c.cliente_id}
            for c in por_vencer
        ],
        "cliente_top": top_row[0] if top_row else None,
        "ticket_promedio": round(ticket_row, 2),
        "total_clientes_activos": clientes_activos,
    }


def get_historial_por_servicio(db: Session, empresa_id: Optional[int] = None) -> dict:
    q = db.query(
        VentaComercial.tipo_servicio,
        func.sum(VentaComercial.monto).label("total"),
    ).group_by(VentaComercial.tipo_servicio)
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    rows = q.order_by(func.sum(VentaComercial.monto).desc()).all()

    total = sum(r.total for r in rows) or 1
    servicio_top = rows[0].tipo_servicio if rows else None
    result = [
        {"tipo_servicio": r.tipo_servicio, "monto": round(r.total, 2),
         "porcentaje": round((r.total / total) * 100, 1)}
        for r in rows
    ]
    return {"data": result, "servicio_top": servicio_top}
