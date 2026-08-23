from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.services import comercial_service as svc

router = APIRouter()


@router.get("/resumen")
def resumen(db: Session = Depends(get_db)):
    return svc.get_resumen(db)


@router.get("/historial-por-servicio")
def historial_por_servicio(db: Session = Depends(get_db)):
    return svc.get_historial_por_servicio(db)
