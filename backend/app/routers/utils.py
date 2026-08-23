import httpx
from fastapi import APIRouter, HTTPException

from app.services.comprobante_print import monto_a_letras

router = APIRouter()

SUNAT_API = "https://api.apis.net.pe/v1/ruc?numero={ruc}"
TIMEOUT   = 8.0


@router.get("/numero-letras")
def numero_letras(monto: float, moneda: str = "PEN"):
    if monto < 0:
        raise HTTPException(400, "El monto no puede ser negativo")
    return {"letras": monto_a_letras(monto, moneda, con_son=False)}


@router.get("/consultar-ruc/{ruc}")
def consultar_ruc(ruc: str):
    if len(ruc) != 11 or not ruc.isdigit():
        raise HTTPException(400, "El RUC debe tener exactamente 11 dígitos numéricos")

    url = SUNAT_API.format(ruc=ruc)
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url)
    except httpx.TimeoutException:
        raise HTTPException(503, "Timeout al consultar SUNAT — intente nuevamente")
    except Exception as e:
        raise HTTPException(503, f"Error de conexión: {type(e).__name__}")

    if resp.status_code != 200:
        raise HTTPException(404, f"RUC {ruc} no encontrado en SUNAT")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, "Respuesta inválida de SUNAT")

    nombre = (data.get("nombre") or "").strip()
    if not nombre:
        raise HTTPException(404, f"RUC {ruc} no encontrado en SUNAT")

    return {
        "ruc":         ruc,
        "razon_social": nombre,
        "estado":      data.get("estado", ""),
        "condicion":   data.get("condicion", ""),
        "direccion":   data.get("direccion", ""),
    }
