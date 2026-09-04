from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from app.models.models import Cliente
from app.models.comercial import VentaComercial
from app.schemas.comercial_schemas import ClienteCreate, ClienteUpdate
from datetime import date, datetime
from fastapi import HTTPException


def list_clientes(db: Session, search: str = "", estado: str = "todos",
                  page: int = 1, per_page: int = 10,
                  empresa_id: Optional[int] = None):
    q = db.query(Cliente)
    if empresa_id is not None:
        q = q.filter(Cliente.empresa_id == empresa_id)
    if search:
        term = f"%{search}%"
        q = q.filter(
            (Cliente.razon_social.ilike(term)) |
            (Cliente.ruc.ilike(term)) |
            (Cliente.contacto.ilike(term))
        )
    if estado == "activo":
        q = q.filter(Cliente.activo == True)
    elif estado == "inactivo":
        q = q.filter(Cliente.activo == False)

    total = q.count()
    clientes = q.order_by(Cliente.razon_social).offset((page - 1) * per_page).limit(per_page).all()

    resultado = []
    for c in clientes:
        q_compras = db.query(func.sum(VentaComercial.monto)).filter(
            VentaComercial.cliente_id == c.id
        )
        if empresa_id is not None:
            q_compras = q_compras.filter(VentaComercial.empresa_id == empresa_id)
        total_comprado = q_compras.scalar() or 0

        q_ultima = db.query(func.max(VentaComercial.fecha)).filter(
            VentaComercial.cliente_id == c.id
        )
        if empresa_id is not None:
            q_ultima = q_ultima.filter(VentaComercial.empresa_id == empresa_id)
        ultima = q_ultima.scalar()

        pendientes = 0
        resultado.append({
            "id": c.id, "razon_social": c.razon_social, "ruc": c.ruc,
            "contacto": c.contacto, "telefono": c.telefono, "email": c.email,
            "distrito": c.distrito, "tipo_cliente": c.tipo_cliente, "activo": c.activo,
            "total_comprado": round(total_comprado, 2),
            "ultima_compra": ultima,
            "cotizaciones_pendientes": pendientes,
        })
    return {"total": total, "page": page, "per_page": per_page, "data": resultado}


def get_cliente(db: Session, cliente_id: int, empresa_id: Optional[int] = None):
    q = db.query(Cliente).filter(Cliente.id == cliente_id)
    if empresa_id is not None:
        q = q.filter(Cliente.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    q_compras = db.query(func.sum(VentaComercial.monto)).filter(
        VentaComercial.cliente_id == c.id
    )
    if empresa_id is not None:
        q_compras = q_compras.filter(VentaComercial.empresa_id == empresa_id)
    total_comprado = q_compras.scalar() or 0

    q_ultima = db.query(func.max(VentaComercial.fecha)).filter(
        VentaComercial.cliente_id == c.id
    )
    if empresa_id is not None:
        q_ultima = q_ultima.filter(VentaComercial.empresa_id == empresa_id)
    ultima = q_ultima.scalar()

    pendientes = 0
    return {
        "id": c.id, "razon_social": c.razon_social, "ruc": c.ruc,
        "contacto": c.contacto, "cargo_contacto": c.cargo_contacto,
        "telefono": c.telefono, "email": c.email,
        "direccion": c.direccion, "distrito": c.distrito,
        "tipo_cliente": c.tipo_cliente, "activo": c.activo,
        "total_comprado": round(total_comprado, 2),
        "ultima_compra": ultima,
        "cotizaciones_pendientes": pendientes,
        "creado_por":      c.creado_por,
        "creado_en":       c.creado_en.strftime("%d/%m/%Y %H:%M") if c.creado_en else None,
        "modificado_por":  c.modificado_por,
        "modificado_en":   c.modificado_en.strftime("%d/%m/%Y %H:%M") if c.modificado_en else None,
        "metodo_creacion": c.metodo_creacion or "Manual",
    }


def create_cliente(db: Session, data: ClienteCreate, usuario_nombre: str = None,
                   empresa_id: Optional[int] = None):
    # Unicidad de RUC por empresa
    q_dup = db.query(Cliente).filter(Cliente.ruc == data.ruc)
    if empresa_id is not None:
        q_dup = q_dup.filter(Cliente.empresa_id == empresa_id)
    existing = q_dup.first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Ya existe un cliente registrado con este RUC: {existing.razon_social}"
        )
    c = Cliente(**data.model_dump())
    c.creado_por = usuario_nombre
    c.creado_en  = datetime.utcnow()
    c.metodo_creacion = "Manual"
    c.empresa_id = empresa_id
    db.add(c)
    db.commit()
    db.refresh(c)
    return get_cliente(db, c.id, empresa_id)


def update_cliente(db: Session, cliente_id: int, data: ClienteUpdate,
                   usuario_nombre: str = None, empresa_id: Optional[int] = None):
    q = db.query(Cliente).filter(Cliente.id == cliente_id)
    if empresa_id is not None:
        q = q.filter(Cliente.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if data.ruc and data.ruc != c.ruc:
        q_dup = db.query(Cliente).filter(
            Cliente.ruc == data.ruc, Cliente.id != cliente_id
        )
        if empresa_id is not None:
            q_dup = q_dup.filter(Cliente.empresa_id == empresa_id)
        if q_dup.first():
            raise HTTPException(
                status_code=400,
                detail=f"Ya existe un cliente registrado con este RUC: {data.ruc}"
            )
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    c.modificado_por = usuario_nombre
    c.modificado_en  = datetime.utcnow()
    db.commit()
    return get_cliente(db, cliente_id, empresa_id)


def delete_cliente(db: Session, cliente_id: int, empresa_id: Optional[int] = None):
    q = db.query(Cliente).filter(Cliente.id == cliente_id)
    if empresa_id is not None:
        q = q.filter(Cliente.empresa_id == empresa_id)
    c = q.first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    q_ventas = db.query(VentaComercial).filter(VentaComercial.cliente_id == cliente_id)
    if empresa_id is not None:
        q_ventas = q_ventas.filter(VentaComercial.empresa_id == empresa_id)
    if q_ventas.first():
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar el cliente porque tiene comprobantes "
                   "registrados. Puede desactivarlo en su lugar.",
        )

    c.activo = False
    db.commit()
    return {"mensaje": "Cliente eliminado correctamente"}


def get_historial(db: Session, cliente_id: int, empresa_id: Optional[int] = None):
    # Verificar que el cliente pertenece a la empresa
    if empresa_id is not None:
        c = db.query(Cliente).filter(Cliente.id == cliente_id, Cliente.empresa_id == empresa_id).first()
        if not c:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

    q = db.query(VentaComercial).filter(VentaComercial.cliente_id == cliente_id)
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    ventas = q.order_by(VentaComercial.fecha.desc()).all()
    return [
        {
            "id": v.id, "tipo_servicio": v.tipo_servicio, "descripcion": v.descripcion,
            "monto": v.monto, "fecha": v.fecha, "estado": v.estado,
            "numero_factura": v.numero_factura,
            "tiene_comprobante": bool(v.comprobante_path),
            "comprobante_nombre": v.comprobante_nombre,
        }
        for v in ventas
    ]
