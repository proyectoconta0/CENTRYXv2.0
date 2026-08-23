from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from app.models.models import Cliente
from app.models.comercial import VentaComercial
from app.schemas.comercial_schemas import ClienteCreate, ClienteUpdate
from datetime import date, datetime
from fastapi import HTTPException


def list_clientes(db: Session, search: str = "", estado: str = "todos",
                  page: int = 1, per_page: int = 10):
    q = db.query(Cliente)
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
        total_comprado = db.query(func.sum(VentaComercial.monto)).filter(
            VentaComercial.cliente_id == c.id
        ).scalar() or 0
        ultima = db.query(func.max(VentaComercial.fecha)).filter(
            VentaComercial.cliente_id == c.id
        ).scalar()
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


def get_cliente(db: Session, cliente_id: int):
    c = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    total_comprado = db.query(func.sum(VentaComercial.monto)).filter(
        VentaComercial.cliente_id == c.id
    ).scalar() or 0
    ultima = db.query(func.max(VentaComercial.fecha)).filter(
        VentaComercial.cliente_id == c.id
    ).scalar()
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


def create_cliente(db: Session, data: ClienteCreate, usuario_nombre: str = None):
    existing = db.query(Cliente).filter(Cliente.ruc == data.ruc).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Ya existe un cliente registrado con este RUC: {existing.razon_social}"
        )
    c = Cliente(**data.model_dump())
    c.creado_por = usuario_nombre
    c.creado_en  = datetime.utcnow()
    c.metodo_creacion = "Manual"
    db.add(c)
    db.commit()
    db.refresh(c)
    return get_cliente(db, c.id)


def update_cliente(db: Session, cliente_id: int, data: ClienteUpdate, usuario_nombre: str = None):
    c = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if data.ruc and data.ruc != c.ruc:
        existing = db.query(Cliente).filter(
            Cliente.ruc == data.ruc, Cliente.id != cliente_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Ya existe un cliente registrado con este RUC: {existing.razon_social}"
            )
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    c.modificado_por = usuario_nombre
    c.modificado_en  = datetime.utcnow()
    db.commit()
    return get_cliente(db, c.id)


def delete_cliente(db: Session, cliente_id: int):
    c = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    c.activo = False
    db.commit()
    return {"mensaje": "Cliente desactivado"}


def get_historial(db: Session, cliente_id: int):
    ventas = db.query(VentaComercial).filter(
        VentaComercial.cliente_id == cliente_id
    ).order_by(VentaComercial.fecha.desc()).all()
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
