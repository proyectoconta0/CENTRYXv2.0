from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.models.comercial import DocumentoCliente, VentaComercial
from app.models.models import Cliente
from datetime import date
from typing import Optional

router = APIRouter()


@router.get("")
def listar_todos(
    cliente_id: Optional[int] = None,
    tipo: Optional[str] = None,
    estado: Optional[str] = None,
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    db: Session = Depends(get_db),
):
    q = db.query(DocumentoCliente)

    if cliente_id:
        q = q.filter(DocumentoCliente.cliente_id == cliente_id)
    if tipo:
        q = q.filter(DocumentoCliente.tipo == tipo)
    if estado:
        q = q.filter(DocumentoCliente.estado == estado)
    if fecha_desde:
        q = q.filter(DocumentoCliente.fecha_carga >= fecha_desde)
    if fecha_hasta:
        q = q.filter(DocumentoCliente.fecha_carga <= fecha_hasta)

    docs = q.order_by(DocumentoCliente.fecha_carga.desc()).all()

    result = []
    for d in docs:
        cliente = db.query(Cliente).filter(Cliente.id == d.cliente_id).first()
        venta_info = None
        if d.venta_id:
            v = db.query(VentaComercial).filter(VentaComercial.id == d.venta_id).first()
            if v:
                venta_info = {
                    "id": v.id,
                    "tipo_servicio": v.tipo_servicio,
                    "monto": v.monto,
                    "fecha": str(v.fecha),
                }
        result.append({
            "id": d.id,
            "cliente_id": d.cliente_id,
            "cliente_nombre": cliente.razon_social if cliente else "—",
            "nombre": d.nombre,
            "tipo": d.tipo,
            "tamano": d.tamano,
            "fecha_carga": d.fecha_carga,
            "estado": d.estado or "Activo",
            "venta_id": d.venta_id,
            "venta_info": venta_info,
        })
    return result
