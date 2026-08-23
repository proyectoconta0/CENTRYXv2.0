"""
Autenticación (JWT) y autorización por rol/módulo, reutilizado por
main.py (dependencies=[...] en include_router) y por el router de
Configuración (donde el control es por endpoint, no por router entero).
"""
import os
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db
from app.models.models import Usuario

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    import sys
    if "pytest" not in sys.modules:
        raise RuntimeError(
            "SECRET_KEY no configurada. "
            "Agrega SECRET_KEY en las variables de entorno."
        )
    SECRET_KEY = "test_secret_key"
ALGORITHM  = os.getenv("ALGORITHM", "HS256")

# auto_error=False para poder lanzar nuestro propio 401 con mensaje consistente
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)


def get_current_usuario(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Usuario:
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autenticado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credenciales_invalidas
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise credenciales_invalidas
    except JWTError:
        raise credenciales_invalidas

    usuario = db.query(Usuario).filter(Usuario.email == email).first()
    if not usuario or not usuario.activo:
        raise credenciales_invalidas
    return usuario


# ── Roles y permisos por módulo ────────────────────────────────────────────────
# Roles "canónicos" de este módulo: Administrador | Vendedor.
# Se normalizan también los roles legacy sembrados antes de este módulo
# (admin, gerente, contador) para no romper usuarios ya existentes.

def normalizar_rol(rol: Optional[str]) -> str:
    r = (rol or "").strip().lower()
    if r in ("administrador", "admin", "gerente", "contador"):
        return "administrador"
    if r == "vendedor":
        return "vendedor"
    return "vendedor"  # rol desconocido → el más restrictivo


# None = acceso a todos los módulos.
MODULOS_POR_ROL = {
    "administrador": None,
    "vendedor": {"dashboard", "ventas", "clientes"},
}

ROLES_DISPONIBLES = ["Administrador", "Vendedor"]


def tiene_permiso(rol: Optional[str], modulo: str) -> bool:
    permitidos = MODULOS_POR_ROL.get(normalizar_rol(rol))
    return permitidos is None or modulo in permitidos


def require_modulo(modulo: str):
    """Dependencia para usar en `include_router(..., dependencies=[Depends(require_modulo('x'))])`."""
    def _dependencia(usuario: Usuario = Depends(get_current_usuario)) -> Usuario:
        if not tiene_permiso(usuario.rol, modulo):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tienes permiso para acceder a este módulo")
        return usuario
    return _dependencia


def require_administrador(usuario: Usuario = Depends(get_current_usuario)) -> Usuario:
    if normalizar_rol(usuario.rol) != "administrador":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo un Administrador puede realizar esta acción")
    return usuario


# ── Catálogo de rubros (Onboarding paso 2 / Configuración pestaña Rubro) ───────

RUBROS = {
    "electrico": {
        "label": "Instalaciones eléctricas", "icono": "⚡",
        "tipos_servicio": ["Instalación residencial", "Instalación comercial", "Mantenimiento", "Certificación"],
        "categorias_gastos": ["Materiales eléctricos", "Mano de obra", "Transporte", "Herramientas", "Certificaciones", "Gastos administrativos", "Otros"],
    },
    "construccion": {
        "label": "Construcción", "icono": "🏗️",
        "tipos_servicio": ["Obras civiles", "Acabados", "Estructuras", "Supervisión", "Demolición"],
        "categorias_gastos": ["Materia prima", "Mano de obra", "Alquiler de maquinaria", "Transporte", "Subcontratos", "Gastos administrativos", "Otros"],
    },
    "industrial": {
        "label": "Servicios Industriales", "icono": "🔧",
        "tipos_servicio": ["Alquiler", "Venta", "Reparación", "Piezas", "Capacitación", "Transporte", "Montaje"],
        "categorias_gastos": [
            "Alquiler de oficina", "Alquiler de almacén", "Mano de obra", "Transporte", "Suministros",
            "Materia prima", "Alquiler de andamios", "Servicios básicos", "Seguros",
            "Gastos administrativos", "Gastos de ventas", "Gastos Bancarios", "Otros",
        ],
    },
    "restaurante": {
        "label": "Restaurante", "icono": "🍽️",
        "tipos_servicio": ["Servicio en mesa", "Delivery", "Eventos", "Catering", "Bar"],
        "categorias_gastos": ["Insumos y alimentos", "Bebidas", "Mano de obra", "Servicios básicos", "Alquiler de local", "Gastos administrativos", "Otros"],
    },
    "salud": {
        "label": "Salud", "icono": "🏥",
        "tipos_servicio": ["Consulta", "Procedimiento", "Emergencia", "Hospitalización"],
        "categorias_gastos": ["Insumos médicos", "Mano de obra", "Equipos médicos", "Servicios básicos", "Seguros", "Gastos administrativos", "Otros"],
    },
    "retail": {
        "label": "Retail", "icono": "🛍️",
        "tipos_servicio": ["Venta al por mayor", "Venta al por menor", "Consignación"],
        "categorias_gastos": ["Mercadería", "Alquiler de local", "Mano de obra", "Marketing", "Transporte", "Gastos administrativos", "Otros"],
    },
    "manufactura": {
        "label": "Manufactura", "icono": "🔩",
        "tipos_servicio": ["Producción", "Maquila", "Control de Calidad", "Mantenimiento de Planta"],
        "categorias_gastos": ["Materia prima", "Mano de obra", "Mantenimiento de planta", "Servicios básicos", "Transporte", "Gastos administrativos", "Otros"],
    },
    "transporte": {
        "label": "Transporte y Logística", "icono": "🚛",
        "tipos_servicio": ["Transporte de carga", "Distribución", "Almacenaje", "Última milla"],
        "categorias_gastos": ["Combustible", "Mantenimiento de flota", "Peajes", "Mano de obra", "Seguros", "Gastos administrativos", "Otros"],
    },
    "otro": {
        "label": "Otro (personalizado)", "icono": "⚙️",
        "tipos_servicio": [],
        "categorias_gastos": [],
    },
}
