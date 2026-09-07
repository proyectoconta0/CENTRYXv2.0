"""
Panel de Administración CENTRYX — Solo accesible para rol Superadmin.
Gestión completa de Empresas (tenants) y Usuarios del sistema.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from app.core.security import require_superadmin, normalizar_rol, ROLES_DISPONIBLES
from app.models.models import Usuario
from app.models.empresa import Empresa

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS — Empresa
# ══════════════════════════════════════════════════════════════════════════════

class EmpresaCreate(BaseModel):
    nombre:    str
    ruc:       str
    subdominio: str
    plan:      str = "basico"
    email:     Optional[str] = None
    telefono:  Optional[str] = None
    logo_url:  Optional[str] = None
    activo:    bool = True


class EmpresaUpdate(BaseModel):
    nombre:    Optional[str] = None
    ruc:       Optional[str] = None
    subdominio: Optional[str] = None
    plan:      Optional[str] = None
    email:     Optional[str] = None
    telefono:  Optional[str] = None
    logo_url:  Optional[str] = None
    activo:    Optional[bool] = None


class EmpresaOut(BaseModel):
    id:        int
    nombre:    str
    ruc:       str
    subdominio: str
    plan:      str
    email:     Optional[str]
    telefono:  Optional[str]
    logo_url:  Optional[str]
    activo:    bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS — Usuario
# ══════════════════════════════════════════════════════════════════════════════

class UsuarioAdminCreate(BaseModel):
    nombre:     str
    email:      str
    password:   str
    rol:        str = "Vendedor"
    empresa_id: Optional[int] = None
    activo:     bool = True


class UsuarioAdminUpdate(BaseModel):
    nombre:     Optional[str] = None
    email:      Optional[str] = None
    password:   Optional[str] = None
    rol:        Optional[str] = None
    empresa_id: Optional[int] = None
    activo:     Optional[bool] = None


class UsuarioAdminOut(BaseModel):
    id:         int
    nombre:     str
    email:      str
    rol:        str
    empresa_id: Optional[int]
    activo:     bool

    class Config:
        from_attributes = True


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — Empresas
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/empresas", response_model=List[EmpresaOut], summary="Listar todas las empresas")
def listar_empresas(
    activo: Optional[bool] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    q = db.query(Empresa)
    if activo is not None:
        q = q.filter(Empresa.activo == activo)
    return q.order_by(Empresa.nombre).all()


@router.post("/empresas", response_model=EmpresaOut, status_code=status.HTTP_201_CREATED, summary="Crear nueva empresa")
def crear_empresa(
    data: EmpresaCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    # Validar unicidad de RUC y subdominio
    if db.query(Empresa).filter(Empresa.ruc == data.ruc).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe una empresa con RUC {data.ruc}")
    if db.query(Empresa).filter(Empresa.subdominio == data.subdominio.lower()).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El subdominio '{data.subdominio}' ya está en uso")

    empresa = Empresa(
        nombre=data.nombre,
        ruc=data.ruc,
        subdominio=data.subdominio.lower().strip(),
        plan=data.plan,
        email=data.email,
        telefono=data.telefono,
        logo_url=data.logo_url,
        activo=data.activo,
    )
    db.add(empresa)
    db.commit()
    db.refresh(empresa)
    return empresa


@router.get("/empresas/{empresa_id}", response_model=EmpresaOut, summary="Obtener empresa por ID")
def obtener_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return empresa


@router.put("/empresas/{empresa_id}", response_model=EmpresaOut, summary="Actualizar empresa")
def actualizar_empresa(
    empresa_id: int,
    data: EmpresaUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")

    if data.ruc is not None and data.ruc != empresa.ruc:
        if db.query(Empresa).filter(Empresa.ruc == data.ruc, Empresa.id != empresa_id).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe una empresa con RUC {data.ruc}")

    if data.subdominio is not None and data.subdominio.lower() != empresa.subdominio:
        if db.query(Empresa).filter(Empresa.subdominio == data.subdominio.lower(), Empresa.id != empresa_id).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El subdominio '{data.subdominio}' ya está en uso")

    campos = data.model_dump(exclude_unset=True)
    if "subdominio" in campos:
        campos["subdominio"] = campos["subdominio"].lower().strip()

    for campo, valor in campos.items():
        setattr(empresa, campo, valor)

    empresa.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(empresa)
    return empresa


@router.delete("/empresas/{empresa_id}", summary="Eliminar empresa")
def eliminar_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    nombre = empresa.nombre
    db.delete(empresa)
    db.commit()
    return {"ok": True, "mensaje": f"Empresa '{nombre}' eliminada"}


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — Usuarios
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/usuarios", response_model=List[UsuarioAdminOut], summary="Listar todos los usuarios")
def listar_usuarios(
    empresa_id: Optional[int] = None,
    activo: Optional[bool] = None,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    q = db.query(Usuario)
    if empresa_id is not None:
        q = q.filter(Usuario.empresa_id == empresa_id)
    if activo is not None:
        q = q.filter(Usuario.activo == activo)
    return q.order_by(Usuario.nombre).all()


@router.post("/usuarios", response_model=UsuarioAdminOut, status_code=status.HTTP_201_CREATED, summary="Crear usuario")
def crear_usuario_admin(
    data: UsuarioAdminCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    if db.query(Usuario).filter(Usuario.email == data.email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe un usuario con email {data.email}")

    # Validar empresa si se proporciona
    if data.empresa_id is not None:
        if not db.query(Empresa).filter(Empresa.id == data.empresa_id, Empresa.activo == True).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Empresa con id {data.empresa_id} no existe o está inactiva")

    # Validar rol
    rol_normalizado = normalizar_rol(data.rol)
    roles_validos = [r.lower() for r in ROLES_DISPONIBLES]
    if data.rol.lower() not in roles_validos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Rol inválido. Opciones: {ROLES_DISPONIBLES}")

    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    usuario = Usuario(
        nombre=data.nombre,
        email=data.email,
        password=pwd_context.hash(data.password),
        rol=data.rol.capitalize(),
        empresa_id=data.empresa_id,
        activo=data.activo,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.get("/usuarios/{usuario_id}", response_model=UsuarioAdminOut, summary="Obtener usuario por ID")
def obtener_usuario_admin(
    usuario_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return usuario


@router.put("/usuarios/{usuario_id}", response_model=UsuarioAdminOut, summary="Actualizar usuario")
def actualizar_usuario_admin(
    usuario_id: int,
    data: UsuarioAdminUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    if data.email is not None and data.email != usuario.email:
        if db.query(Usuario).filter(Usuario.email == data.email, Usuario.id != usuario_id).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El email {data.email} ya está en uso")

    if data.empresa_id is not None:
        if not db.query(Empresa).filter(Empresa.id == data.empresa_id, Empresa.activo == True).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Empresa con id {data.empresa_id} no existe o está inactiva")

    campos = data.model_dump(exclude_unset=True)

    if "password" in campos:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        campos["password"] = pwd_context.hash(campos["password"])

    if "rol" in campos:
        campos["rol"] = campos["rol"].capitalize()

    for campo, valor in campos.items():
        setattr(usuario, campo, valor)

    db.commit()
    db.refresh(usuario)
    return usuario


@router.delete("/usuarios/{usuario_id}", summary="Desactivar usuario")
def desactivar_usuario_admin(
    usuario_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_superadmin),
):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    usuario.activo = False
    db.commit()
    return {"ok": True, "mensaje": f"Usuario '{usuario.nombre}' desactivado"}


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — Utilidades
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/roles", summary="Listar roles disponibles")
def listar_roles(_: Usuario = Depends(require_superadmin)):
    return {"roles": ROLES_DISPONIBLES}


@router.get("/planes", summary="Listar planes disponibles")
def listar_planes(_: Usuario = Depends(require_superadmin)):
    return {"planes": ["basico", "profesional", "enterprise"]}
