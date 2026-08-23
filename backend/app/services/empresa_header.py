"""
Encabezado de empresa (logo + datos) reutilizado por TODOS los documentos
PDF generados por el sistema (Reportes y futuros módulos). Lee siempre
de configuracion_empresa para reflejar cambios sin necesidad de reiniciar
el backend.
"""
import base64
import os
from pathlib import Path
from typing import Optional, Union

from sqlalchemy.orm import Session

from app.core.security import RUBROS
from app.models.configuracion import ConfiguracionEmpresa

NOMBRE_POR_DEFECTO = "Centryx"
COLOR_POR_DEFECTO = "#1e40af"

# El HTML imprimible se abre en una ventana nueva desde una blob: URL cuyo
# origen es el del frontend (localhost:3000), no el del backend. Con el logo
# guardado como base64 (data: URL) esto ya no importa — no depende de origen
# ni de que el backend siga sirviendo el archivo. BACKEND_URL solo se usa
# como fallback para empresas con un logo_path antiguo (subido a disco antes
# de esta migración) — igual que getLogoUrl() en configuracionApi.js.
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


def get_empresa_header(db: Session, para_pdf: bool = False) -> dict:
    """para_pdf=False (por defecto) → dict JSON-serializable, para endpoints
    que devuelven este header al frontend (p.ej. /imprimir). para_pdf=True →
    además incluye "logo_path" con los bytes del logo (o la ruta en disco
    para logos antiguos) para que ReportLab pueda dibujarlo; esos bytes NO
    son serializables a JSON, por eso solo se agregan cuando el consumidor
    es un generador de PDF."""
    empresa = db.query(ConfiguracionEmpresa).first()

    # reportlab no puede rasterizar SVG directamente para los PDFs; en ese
    # caso el PDF cae al nombre de la empresa en texto grande, pero el HTML
    # imprimible (logo_url) sí puede mostrar el SVG sin problema.
    logo_path_pdf: Optional[Union[str, bytes]] = None
    logo_url: Optional[str] = None

    if empresa and empresa.logo_base64:
        logo_url = empresa.logo_base64
        if para_pdf and not empresa.logo_base64.startswith("data:image/svg"):
            try:
                _, b64data = empresa.logo_base64.split(",", 1)
                logo_path_pdf = base64.b64decode(b64data)
            except (ValueError, base64.binascii.Error):
                logo_path_pdf = None
    elif empresa and empresa.logo_path and Path(empresa.logo_path).exists():
        logo_url = f"{BACKEND_URL}/api/configuracion/empresa/logo"
        if para_pdf and Path(empresa.logo_path).suffix.lower() != ".svg":
            logo_path_pdf = str(Path(empresa.logo_path))

    resultado = {
        "nombre_empresa":      (empresa.nombre_empresa if empresa and empresa.nombre_empresa else NOMBRE_POR_DEFECTO),
        "ruc":                 empresa.ruc if empresa else None,
        "direccion":           empresa.direccion if empresa else None,
        "telefono":            empresa.telefono if empresa else None,
        "email":               empresa.email if empresa else None,
        "logo_url":            logo_url,
        "color_principal":     (empresa.color_principal if empresa and empresa.color_principal else COLOR_POR_DEFECTO),
        "mensaje_comprobante": empresa.mensaje_comprobante if empresa and empresa.mensaje_comprobante else None,
        "giro_negocio":        (RUBROS.get(empresa.rubro, {}).get("label") if empresa and empresa.rubro else None),
    }

    if para_pdf:
        resultado["logo_path"] = logo_path_pdf

    return resultado
