from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from app.services import dashboard_service as svc
from app.core.security import get_empresa_id

router = APIRouter()


@router.get("/filtros-opciones")
def filtros_opciones(db: Session = Depends(get_db),
                     empresa_id: Optional[int] = Depends(get_empresa_id)):
    return svc.get_filtros_opciones(db, empresa_id)


@router.get("/kpis")
def kpis(desde: Optional[str] = None, hasta: Optional[str] = None,
          cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
          db: Session = Depends(get_db),
          empresa_id: Optional[int] = Depends(get_empresa_id)):
    d, h = svc.rango_por_defecto(desde, hasta)
    return svc.get_kpis(db, d, h, cliente_id, tipo_servicio, empresa_id)


@router.get("/ventas-evolucion")
def ventas_evolucion(desde: Optional[str] = None, hasta: Optional[str] = None,
                      cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                      db: Session = Depends(get_db),
                      empresa_id: Optional[int] = Depends(get_empresa_id)):
    # El propio gráfico ya trae mensual/semanal/diario en una sola respuesta y
    # cambia de vista en el cliente; "hasta" ancla esas tres series a la fecha
    # seleccionada en el header (por defecto, hoy).
    _, h = svc.rango_por_defecto(desde, hasta)
    return svc.get_ventas_evolucion(db, h, cliente_id, tipo_servicio, empresa_id)


@router.get("/flujo-caja")
def flujo_caja(db: Session = Depends(get_db),
               empresa_id: Optional[int] = Depends(get_empresa_id)):
    return svc.get_flujo_caja(db, empresa_id)


@router.get("/flujo-caja-proyectado")
def flujo_caja_proyectado(db: Session = Depends(get_db),
                           empresa_id: Optional[int] = Depends(get_empresa_id)):
    return svc.get_flujo_caja(db, empresa_id)


@router.get("/top-clientes")
def top_clientes(desde: Optional[str] = None, hasta: Optional[str] = None,
                  cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                  db: Session = Depends(get_db),
                  empresa_id: Optional[int] = Depends(get_empresa_id)):
    d, h = svc.rango_por_defecto(desde, hasta)
    return svc.get_top_clientes(db, d, h, cliente_id, tipo_servicio, empresa_id)


@router.get("/cobranza-estado")
def cobranza_estado(desde: Optional[str] = None, hasta: Optional[str] = None,
                     cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                     db: Session = Depends(get_db),
                     empresa_id: Optional[int] = Depends(get_empresa_id)):
    d, h = svc.rango_por_defecto(desde, hasta)
    return svc.get_cobranza_estado(db, d, h, cliente_id, tipo_servicio, empresa_id)


@router.get("/gastos-categoria")
def gastos_categoria(desde: Optional[str] = None, hasta: Optional[str] = None,
                      db: Session = Depends(get_db),
                      empresa_id: Optional[int] = Depends(get_empresa_id)):
    d, h = svc.rango_por_defecto(desde, hasta)
    return svc.get_gastos_categoria(db, d, h, empresa_id)


@router.get("/proyectos-ejecucion")
def proyectos_ejecucion(db: Session = Depends(get_db),
                         empresa_id: Optional[int] = Depends(get_empresa_id)):
    return svc.get_proyectos_ejecucion(db, empresa_id)


@router.get("/indicadores-kpi")
def indicadores_kpi(desde: Optional[str] = None, hasta: Optional[str] = None,
                     cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                     db: Session = Depends(get_db),
                     empresa_id: Optional[int] = Depends(get_empresa_id)):
    d, h = svc.rango_por_defecto(desde, hasta)
    return svc.get_indicadores_kpi(db, d, h, cliente_id, tipo_servicio, empresa_id)
