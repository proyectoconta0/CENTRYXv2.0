from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.models.models import ProveedorGasto
from app.core.security import get_empresa_id

router = APIRouter()


@router.get("/buscar")
def buscar_proveedores(
    q: str = "",
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    if len(q) < 2:
        return []
    like = f"%{q}%"
    query = (
        db.query(ProveedorGasto)
        .filter(
            (ProveedorGasto.numero_documento.ilike(like)) |
            (ProveedorGasto.nombre_proveedor.ilike(like))
        )
    )
    if empresa_id is not None:
        query = query.filter(ProveedorGasto.empresa_id == empresa_id)
    results = query.order_by(ProveedorGasto.nombre_proveedor).limit(10).all()
    return [
        {
            "id":               r.id,
            "tipo_documento":   r.tipo_documento or "",
            "numero_documento": r.numero_documento,
            "nombre_proveedor": r.nombre_proveedor,
        }
        for r in results
    ]
