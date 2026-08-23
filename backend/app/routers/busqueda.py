from sqlalchemy import or_
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends

from database import get_db
from app.core.security import get_current_usuario
from app.models.models import Cliente, Gasto, Proveedor
from app.models.comercial import VentaComercial

router = APIRouter()

LIMITE_POR_CATEGORIA = 5
LARGO_MINIMO = 3


@router.get("")
def buscar(q: str = "", db: Session = Depends(get_db), usuario=Depends(get_current_usuario)):
    termino = (q or "").strip()
    if len(termino) < LARGO_MINIMO:
        return {"clientes": [], "comprobantes": [], "gastos": [], "proveedores": []}

    like = f"%{termino}%"

    clientes = (
        db.query(Cliente)
        .filter(or_(Cliente.razon_social.ilike(like), Cliente.ruc.ilike(like)))
        .order_by(Cliente.razon_social.asc())
        .limit(LIMITE_POR_CATEGORIA)
        .all()
    )

    comprobantes = (
        db.query(VentaComercial)
        .filter(VentaComercial.numero_factura.ilike(like))
        .order_by(VentaComercial.fecha.desc())
        .limit(LIMITE_POR_CATEGORIA)
        .all()
    )

    gastos = (
        db.query(Gasto)
        .filter(or_(Gasto.descripcion.ilike(like), Gasto.proveedor.ilike(like)))
        .order_by(Gasto.fecha.desc())
        .limit(LIMITE_POR_CATEGORIA)
        .all()
    )

    proveedores = (
        db.query(Proveedor)
        .filter(or_(Proveedor.razon_social.ilike(like), Proveedor.numero_documento.ilike(like)))
        .order_by(Proveedor.razon_social.asc())
        .limit(LIMITE_POR_CATEGORIA)
        .all()
    )

    return {
        "clientes": [
            {"id": c.id, "titulo": c.razon_social, "subtitulo": c.ruc or ""}
            for c in clientes
        ],
        "comprobantes": [
            {
                "id": v.id,
                "titulo": v.numero_factura or f"Comprobante #{v.id}",
                "subtitulo": f"{v.razon_social_cliente or '—'} — S/ {float(v.precio_venta_soles if v.precio_venta_soles is not None else (v.precio_venta or v.monto or 0)):,.2f}",
            }
            for v in comprobantes
        ],
        "gastos": [
            {
                "id": g.id,
                "titulo": g.descripcion or g.categoria,
                "subtitulo": f"S/ {float(g.monto_soles if g.monto_soles is not None else (g.monto or 0)):,.2f}",
            }
            for g in gastos
        ],
        "proveedores": [
            {"id": p.id, "titulo": p.razon_social, "subtitulo": p.numero_documento or ""}
            for p in proveedores
        ],
    }
