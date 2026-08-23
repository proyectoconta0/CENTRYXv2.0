from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.services import cotizaciones_service as svc
from app.schemas.comercial_schemas import CotizacionCreate, CotizacionUpdate

router = APIRouter()


@router.get("")
def listar(estado: str = "todos", cliente_id: int = None, db: Session = Depends(get_db)):
    return svc.list_cotizaciones(db, estado, cliente_id)


@router.post("")
def crear(data: CotizacionCreate, db: Session = Depends(get_db)):
    return svc.create_cotizacion(db, data)


@router.get("/{cot_id}")
def obtener(cot_id: int, db: Session = Depends(get_db)):
    return svc.get_cotizacion(db, cot_id)


@router.put("/{cot_id}")
def actualizar(cot_id: int, data: CotizacionUpdate, db: Session = Depends(get_db)):
    return svc.update_cotizacion(db, cot_id, data)


@router.delete("/{cot_id}")
def eliminar(cot_id: int, db: Session = Depends(get_db)):
    return svc.delete_cotizacion(db, cot_id)


@router.post("/{cot_id}/convertir-venta")
def convertir(cot_id: int, db: Session = Depends(get_db)):
    return svc.convertir_venta(db, cot_id)
