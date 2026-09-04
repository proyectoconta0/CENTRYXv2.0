from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from app.models.comercial import VentaComercial
from app.models.models import Cliente
from pydantic import BaseModel
from datetime import date
from app.core.security import get_empresa_id

router = APIRouter()


class FacturaCreate(BaseModel):
    numero_factura: str
    cliente_id: int
    tipo_servicio: str
    descripcion: Optional[str] = None
    monto: float
    fecha: date


class FacturaUpdate(BaseModel):
    numero_factura: Optional[str] = None
    cliente_id: Optional[int] = None
    tipo_servicio: Optional[str] = None
    descripcion: Optional[str] = None
    monto: Optional[float] = None
    fecha: Optional[date] = None


def _row_to_dict(v: VentaComercial, razon_social: str) -> dict:
    return {
        "id": v.id,
        "numero_factura": v.numero_factura,
        "cliente_id": v.cliente_id,
        "cliente_nombre": razon_social,
        "tipo_servicio": v.tipo_servicio,
        "descripcion": v.descripcion,
        "monto": v.monto,
        "fecha": v.fecha,
        "tiene_comprobante": bool(v.comprobante_path),
    }


@router.get("")
def listar_facturas(
    search: str = "",
    tipo_servicio: str = "",
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(VentaComercial, Cliente.razon_social).join(
        Cliente, VentaComercial.cliente_id == Cliente.id
    )
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            VentaComercial.numero_factura.ilike(like) |
            Cliente.razon_social.ilike(like)
        )
    if tipo_servicio:
        q = q.filter(VentaComercial.tipo_servicio == tipo_servicio)
    if fecha_desde:
        q = q.filter(VentaComercial.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(VentaComercial.fecha <= fecha_hasta)

    total = q.count()
    rows = (
        q.order_by(VentaComercial.fecha.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "data": [_row_to_dict(v, razon) for v, razon in rows],
    }


@router.post("")
def crear_factura(
    data: FacturaCreate,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    # Verificar cliente pertenece a la empresa
    q_cliente = db.query(Cliente).filter(Cliente.id == data.cliente_id)
    if empresa_id is not None:
        q_cliente = q_cliente.filter(Cliente.empresa_id == empresa_id)
    cliente = q_cliente.first()
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")

    # Número de factura único por empresa
    q_dup = db.query(VentaComercial).filter(VentaComercial.numero_factura == data.numero_factura)
    if empresa_id is not None:
        q_dup = q_dup.filter(VentaComercial.empresa_id == empresa_id)
    if q_dup.first():
        raise HTTPException(400, f"Ya existe una factura con el número {data.numero_factura}")

    venta = VentaComercial(
        cliente_id=data.cliente_id,
        tipo_servicio=data.tipo_servicio,
        descripcion=data.descripcion,
        monto=data.monto,
        fecha=data.fecha,
        numero_factura=data.numero_factura,
        estado="completada",
        empresa_id=empresa_id,
    )
    db.add(venta)
    db.commit()
    db.refresh(venta)
    return _row_to_dict(venta, cliente.razon_social)


@router.get("/{factura_id}")
def obtener_factura(
    factura_id: int,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = (
        db.query(VentaComercial, Cliente.razon_social)
        .join(Cliente, VentaComercial.cliente_id == Cliente.id)
        .filter(VentaComercial.id == factura_id)
    )
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    row = q.first()
    if not row:
        raise HTTPException(404, "Factura no encontrada")
    return _row_to_dict(row[0], row[1])


@router.put("/{factura_id}")
def actualizar_factura(
    factura_id: int,
    data: FacturaUpdate,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(VentaComercial).filter(VentaComercial.id == factura_id)
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    venta = q.first()
    if not venta:
        raise HTTPException(404, "Factura no encontrada")

    if data.numero_factura and data.numero_factura != venta.numero_factura:
        q_dup = db.query(VentaComercial).filter(
            VentaComercial.numero_factura == data.numero_factura,
            VentaComercial.id != factura_id,
        )
        if empresa_id is not None:
            q_dup = q_dup.filter(VentaComercial.empresa_id == empresa_id)
        if q_dup.first():
            raise HTTPException(400, f"Ya existe una factura con el número {data.numero_factura}")

    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(venta, field, val)

    db.commit()
    db.refresh(venta)
    cliente = db.query(Cliente).filter(Cliente.id == venta.cliente_id).first()
    return _row_to_dict(venta, cliente.razon_social if cliente else "")


@router.delete("/{factura_id}")
def eliminar_factura(
    factura_id: int,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(VentaComercial).filter(VentaComercial.id == factura_id)
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    venta = q.first()
    if not venta:
        raise HTTPException(404, "Factura no encontrada")
    db.delete(venta)
    db.commit()
    return {"mensaje": "Factura eliminada"}
