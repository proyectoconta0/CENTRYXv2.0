"""
Encabezado de empresa (logo + datos) reutilizado por TODOS los documentos
PDF generados por el sistema (Reportes y futuros módulos). Lee siempre
de configuracion_empresa para reflejar cambios sin necesidad de reiniciar
el backend.
"""
import os
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.core.security import RUBROS
from app.models.configuracion import ConfiguracionEmpresa

NOMBRE_POR_DEFECTO = "Centryx"
COLOR_POR_DEFECTO = "#1e40af"

# El HTML imprimible se abre en una ventana nueva desde una blob: URL cuyo
# origen es el del frontend (localhost:3000), no el del backend. Por eso
# logo_url debe ser absoluta (http://localhost:8000/...) — igual que
# getLogoUrl() en configuracionApi.js — y no una ruta relativa, o el
# navegador la resuelve contra localhost:3000 y el logo sale roto (404).
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


def get_empresa_header(db: Session) -> dict:
    empresa = db.query(ConfiguracionEmpresa).first()
    tiene_logo = bool(empresa and empresa.logo_path and Path(empresa.logo_path).exists())

    # reportlab no puede rasterizar SVG directamente para los PDFs; en ese
    # caso el PDF cae al nombre de la empresa en texto grande, pero el HTML
    # imprimible (logo_url) sí puede mostrar el SVG sin problema.
    logo_path_pdf: Optional[str] = None
    if tiene_logo and Path(empresa.logo_path).suffix.lower() != ".svg":
        logo_path_pdf = str(Path(empresa.logo_path))

    return {
        "nombre_empresa":      (empresa.nombre_empresa if empresa and empresa.nombre_empresa else NOMBRE_POR_DEFECTO),
        "ruc":                 empresa.ruc if empresa else None,
        "direccion":           empresa.direccion if empresa else None,
        "telefono":            empresa.telefono if empresa else None,
        "email":               empresa.email if empresa else None,
        "logo_path":           logo_path_pdf,
        "logo_url":            f"{BACKEND_URL}/api/configuracion/empresa/logo" if tiene_logo else None,
        "color_principal":     (empresa.color_principal if empresa and empresa.color_principal else COLOR_POR_DEFECTO),
        "mensaje_comprobante": empresa.mensaje_comprobante if empresa and empresa.mensaje_comprobante else None,
        "giro_negocio":        (RUBROS.get(empresa.rubro, {}).get("label") if empresa and empresa.rubro else None),
    }
