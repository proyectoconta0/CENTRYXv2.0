"""
Middleware de tenant: detecta la empresa por subdominio en cada request
y la inyecta en request.state.empresa_id para que los routers la usen.

Flujo:
  jyd.centryx.pe   →  busca Empresa(subdominio='jyd')  →  request.state.empresa_id = 3
  admin.centryx.pe →  request.state.empresa_id = None  (panel admin, sin filtro)
  localhost         →  request.state.empresa_id = None  (dev local, sin filtro)
"""
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from database import SessionLocal
from app.models.empresa import Empresa

# Subdominio reservado para el panel de administración
ADMIN_SUBDOMAIN = "admin"

# Rutas que siempre se dejan pasar sin consultar la BD
_BYPASS_EXACT = {"/", "/docs", "/openapi.json", "/redoc"}
_BYPASS_PREFIX = ("/api/admin/", "/api/auth/login", "/api/auth/")


class TenantMiddleware(BaseHTTPMiddleware):
    """Detecta el tenant (empresa) por subdominio y lo almacena en request.state."""

    async def dispatch(self, request: Request, call_next):
        # Preflight CORS → pasar sin DB lookup
        if request.method == "OPTIONS":
            return await call_next(request)

        # Rutas globales (docs, login, admin) → sin filtro de empresa
        path = request.url.path
        if path in _BYPASS_EXACT or any(path.startswith(p) for p in _BYPASS_PREFIX):
            request.state.empresa_id = None
            return await call_next(request)

        host = request.headers.get("host", "")
        subdominio = _extract_subdomain(host)

        # Sin subdominio (localhost, dominio raíz) o subdominio admin → sin filtro
        if subdominio is None or subdominio == ADMIN_SUBDOMAIN:
            request.state.empresa_id = None
            return await call_next(request)

        # Buscar empresa activa por subdominio
        db = SessionLocal()
        try:
            empresa = (
                db.query(Empresa)
                .filter(Empresa.subdominio == subdominio, Empresa.activo == True)
                .first()
            )
        finally:
            db.close()

        if not empresa:
            return JSONResponse(
                status_code=404,
                content={"detail": f"Empresa '{subdominio}' no encontrada o inactiva."},
            )

        request.state.empresa_id = empresa.id
        return await call_next(request)


def _extract_subdomain(host: str) -> Optional[str]:
    """
    Extrae el primer subdominio del host.

    Ejemplos:
        jyd.centryx.pe   →  "jyd"
        admin.centryx.pe →  "admin"
        centryx.pe       →  None   (sin subdominio → dominio raíz)
        localhost        →  None   (desarrollo local)
        www.centryx.pe   →  None   (www no es tenant)
    """
    if not host:
        return None

    # Quitar el puerto si viene (ej. localhost:8000)
    host = host.split(":")[0].lower()

    if host in ("localhost", "127.0.0.1", "0.0.0.0"):
        return None

    parts = host.split(".")
    # jyd.centryx.pe → 3 partes → subdominio = parts[0]
    # centryx.pe     → 2 partes → sin subdominio
    if len(parts) >= 3:
        sub = parts[0]
        return None if sub == "www" else sub

    return None
