from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from app.models.comercial import CuentaBancaria
from app.core.security import get_empresa_id
from pydantic import BaseModel


router = APIRouter()


class CuentaBancariaCreate(BaseModel):
    banco: str
    numero_cuenta: str
    tipo_cuenta: Optional[str] = None


class CuentaBancariaUpdate(BaseModel):
    banco: str
    numero_cuenta: str
    tipo_cuenta: Optional[str] = None


def _serialize(c: CuentaBancaria) -> dict:
    return {
        "id":            c.id,
        "banco":         c.banco,
        "numero_cuenta": c.numero_cuenta,
        "tipo_cuenta":   c.tipo_cuenta,
        "activo":        c.activo,
    }


@router.get("")
def listar(
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(CuentaBancaria).filter(CuentaBancaria.activo == True)
    if empresa_id is not None:
        q = q.filter(CuentaBancaria.empresa_id == empresa_id)
    return [_serialize(c) for c in q.order_by(CuentaBancaria.banco).all()]


@router.post("")
def crear(
    data: CuentaBancariaCreate,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    if not data.banco.strip():
        raise HTTPException(400, "El banco es requerido")
    if not data.numero_cuenta.strip():
        raise HTTPException(400, "El número de cuenta es requerido")
    cuenta = CuentaBancaria(
        empresa_id    = empresa_id,
        banco         = data.banco.strip(),
        numero_cuenta = data.numero_cuenta.strip(),
        tipo_cuenta   = data.tipo_cuenta,
        activo        = True,
    )
    db.add(cuenta)
    db.commit()
    db.refresh(cuenta)
    return _serialize(cuenta)


@router.put("/{cuenta_id}")
def actualizar(
    cuenta_id: int,
    data: CuentaBancariaUpdate,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(CuentaBancaria).filter(CuentaBancaria.id == cuenta_id)
    if empresa_id is not None:
        q = q.filter(CuentaBancaria.empresa_id == empresa_id)
    cuenta = q.first()
    if not cuenta:
        raise HTTPException(404, "Cuenta no encontrada")
    if not data.banco.strip():
        raise HTTPException(400, "El banco es requerido")
    if not data.numero_cuenta.strip():
        raise HTTPException(400, "El número de cuenta es requerido")
    cuenta.banco         = data.banco.strip()
    cuenta.numero_cuenta = data.numero_cuenta.strip()
    cuenta.tipo_cuenta   = data.tipo_cuenta
    db.commit()
    db.refresh(cuenta)
    return _serialize(cuenta)


@router.delete("/{cuenta_id}")
def eliminar(
    cuenta_id: int,
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(CuentaBancaria).filter(CuentaBancaria.id == cuenta_id)
    if empresa_id is not None:
        q = q.filter(CuentaBancaria.empresa_id == empresa_id)
    cuenta = q.first()
    if not cuenta:
        raise HTTPException(404, "Cuenta no encontrada")
    cuenta.activo = False
    db.commit()
    return {"mensaje": "Cuenta eliminada"}
