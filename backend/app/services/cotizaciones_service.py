from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from app.models.models import Cliente
from app.models.comercial import Cotizacion, VentaComercial
from app.schemas.comercial_schemas import CotizacionCreate, CotizacionUpdate
from datetime import date
from fastapi import HTTPException


def _enrich(db: Session, c: Cotizacion) -> dict:
    cliente = db.query(Cliente).filter(Cliente.id == c.cliente_id).first()
    dias = (c.fecha_vencimiento - date.today()).days
    return {
        "id": c.id, "numero": c.numero, "cliente_id": c.cliente_id,
        "cliente_nombre": cliente.razon_social if cliente else None,
        "tipo_servicio": c.tipo_servicio, "descripcion": c.descripcion,
        "monto": c.monto, "fecha_emision": c.fecha_emision,
        "fecha_vencimiento": c.fecha_vencimiento, "estado": c.estado,
        "venta_comercial_id": c.venta_comercial_id,
        "dias_para_vencer": dias,
    }


def _generate_numero(db: Session, empresa_id: Optional[int] = None) -> str:
    anio = date.today().year
    q = db.query(func.count(Cotizacion.id)).filter(
        extract("year", Cotizacion.fecha_emision) == anio
    )
    if empresa_id is not None:
        q = q.filter(Cotizacion.empresa_id == empresa_id)
    count = q.scalar() or 0
    return f"COT-{anio}-{str(count + 1).zfill(3)}"


def list_cotizaciones(db: Session, estado: str = "todos", cliente_id: int = None,
                      empresa_id: Optional[int] = None):
    q = db.query(Cotizacion)
    if empresa_id is not None:
        q = q.filter(Cotizacion.empresa_id == empresa_id)
    if estado != "todos":
        q = q.filter(Cotizacion.estado == estado)
    if cliente_id:
        q = q.filter(Cotizacion.cliente_id == cliente_id)
    cotizaciones = q.order_by(Cotizacion.fecha_emision.desc()).all()
    return [_enrich(db, c) for c in cotizaciones]


def get_cotizacion(db: Session, cot_id: int, empresa_id: Optional[int] = None):
    q = db.query(Cotizacion).filter(Cotizacion.id == cot_id)
    if empresa_id is not None:
        q = q.filter(Cotizacion.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(404, "Cotización no encontrada")
    return _enrich(db, c)


def create_cotizacion(db: Session, data: CotizacionCreate,
                      empresa_id: Optional[int] = None):
    c = Cotizacion(
        numero=_generate_numero(db, empresa_id),
        empresa_id=empresa_id,
        **data.model_dump()
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _enrich(db, c)


def update_cotizacion(db: Session, cot_id: int, data: CotizacionUpdate,
                      empresa_id: Optional[int] = None):
    q = db.query(Cotizacion).filter(Cotizacion.id == cot_id)
    if empresa_id is not None:
        q = q.filter(Cotizacion.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(404, "Cotización no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return _enrich(db, c)


def delete_cotizacion(db: Session, cot_id: int, empresa_id: Optional[int] = None):
    q = db.query(Cotizacion).filter(Cotizacion.id == cot_id)
    if empresa_id is not None:
        q = q.filter(Cotizacion.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(404, "Cotización no encontrada")
    db.delete(c)
    db.commit()
    return {"mensaje": "Cotización eliminada"}


def convertir_venta(db: Session, cot_id: int, empresa_id: Optional[int] = None):
    q = db.query(Cotizacion).filter(Cotizacion.id == cot_id)
    if empresa_id is not None:
        q = q.filter(Cotizacion.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(404, "Cotización no encontrada")
    if c.estado != "aprobada":
        raise HTTPException(400, "Solo se pueden convertir cotizaciones aprobadas")
    if c.venta_comercial_id:
        raise HTTPException(400, "Esta cotización ya fue convertida a venta")
    venta = VentaComercial(
        cliente_id=c.cliente_id, cotizacion_id=c.id,
        tipo_servicio=c.tipo_servicio, descripcion=c.descripcion,
        monto=c.monto, fecha=date.today(), estado="completada",
        empresa_id=empresa_id,
    )
    db.add(venta)
    db.flush()
    c.venta_comercial_id = venta.id
    db.commit()
    return {"mensaje": "Convertida a venta exitosamente", "venta_id": venta.id}
