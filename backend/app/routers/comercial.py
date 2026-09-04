from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.services import comercial_service as svc
from app.core.security import get_empresa_id

router = APIRouter()


@router.get("/resumen")
def resumen(db: Session = Depends(get_db),
            empresa_id: Optional[int] = Depends(get_empresa_id)):
    return svc.get_resumen(db, empresa_id)


@router.get("/historial-por-servicio")
def historial_por_servicio(db: Session = Depends(get_db),
                            empresa_id: Optional[int] = Depends(get_empresa_id)):
    return svc.get_historial_por_servicio(db, empresa_id)
