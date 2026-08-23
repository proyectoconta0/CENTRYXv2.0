from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.models import Cliente
from app.models.comercial import Cotizacion, VentaComercial
from datetime import date


def get_resumen(db: Session) -> dict:
    pendientes = db.query(Cotizacion).filter(
        Cotizacion.estado.in_(["borrador", "enviada", "aprobada"]),
        Cotizacion.venta_comercial_id == None
    ).all()
    monto_pendiente = sum(c.monto for c in pendientes)
    hoy = date.today()
    por_vencer = [c for c in pendientes if 0 <= (c.fecha_vencimiento - hoy).days <= 7]
    clientes_activos = db.query(func.count(Cliente.id)).filter(Cliente.activo == True).scalar() or 0
    top_row = (
        db.query(Cliente.razon_social, func.sum(VentaComercial.monto).label("total"))
        .join(VentaComercial, VentaComercial.cliente_id == Cliente.id)
        .group_by(Cliente.razon_social)
        .order_by(func.sum(VentaComercial.monto).desc())
        .first()
    )
    ticket_row = db.query(func.avg(VentaComercial.monto)).scalar() or 0
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


def get_historial_por_servicio(db: Session) -> list:
    rows = (
        db.query(VentaComercial.tipo_servicio, func.sum(VentaComercial.monto).label("total"))
        .group_by(VentaComercial.tipo_servicio)
        .order_by(func.sum(VentaComercial.monto).desc())
        .all()
    )
    total = sum(r.total for r in rows) or 1
    servicio_top = rows[0].tipo_servicio if rows else None
    result = [
        {"tipo_servicio": r.tipo_servicio, "monto": round(r.total, 2),
         "porcentaje": round((r.total / total) * 100, 1)}
        for r in rows
    ]
    return {"data": result, "servicio_top": servicio_top}
