from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from database import get_db
from app.models.models import Usuario
from app.schemas.schemas import Token, LoginRequest
from app.core.security import get_current_usuario
from app.services.auditoria_service import registrar_log, ip_de
import os

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("SECRET_KEY", "gerencialpro_secret_key")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))  # 24 horas


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


@router.post("/login", response_model=Token)
def login(request: LoginRequest, http_request: Request, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.email == request.email).first()
    if not usuario or not pwd_context.verify(request.password, usuario.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )
    if not usuario.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo",
        )
    token = create_access_token({"sub": usuario.email, "rol": usuario.rol})

    registrar_log(
        db, usuario.id, usuario.nombre, "auth", "Inicio de sesión",
        f"{usuario.nombre} inició sesión", ip_de(http_request),
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": {
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol,
        },
    }


@router.post("/logout")
def logout(http_request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    # El JWT es sin estado (no hay sesión que invalidar en el servidor); este
    # endpoint solo existe para dejar constancia en el log de auditoría antes
    # de que el frontend borre el token local.
    registrar_log(
        db, usuario.id, usuario.nombre, "auth", "Cierre de sesión",
        f"{usuario.nombre} cerró sesión", ip_de(http_request),
    )
    return {"mensaje": "Sesión cerrada"}
