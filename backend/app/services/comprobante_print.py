"""
Payload común para la impresión de comprobantes (Factura, Boleta, Nota de
Crédito/Débito, Anticipo de Cliente en Ventas; Factura, Recibo Interno y
demás tipos de comprobante en Gastos). Reutilizado por
GET /api/comprobantes/{id}/imprimir y GET /api/gastos/{id}/imprimir para que
ambos módulos impriman con exactamente el mismo formato.
"""
import base64
import io
from datetime import datetime
from typing import Optional

import qrcode
from num2words import num2words
from sqlalchemy.orm import Session

from app.models.comercial import CuentaBancaria
from app.models.models import Usuario
from app.services.empresa_header import get_empresa_header

MONEDA_LABEL = {"PEN": "SOLES", "USD": "DÓLARES"}

TIPO_DOC_LABEL = {
    "Factura":                      "FACTURA ELECTRÓNICA",
    "Boleta de Venta":              "BOLETA DE VENTA ELECTRÓNICA",
    "Nota de Crédito":              "NOTA DE CRÉDITO ELECTRÓNICA",
    "Nota de Débito":               "NOTA DE DÉBITO ELECTRÓNICA",
    "Anticipo de Cliente":          "ANTICIPO DE CLIENTE",
    "Recibo Interno":               "RECIBO INTERNO",
    "Recibo de Servicios Públicos": "RECIBO DE SERVICIOS PÚBLICOS",
    "Gastos Bancarios":             "GASTOS BANCARIOS",
    "Anticipo de Proveedor":        "ANTICIPO DE PROVEEDOR",
}

MENSAJE_FOOTER_DEFECTO = "¡MUCHAS GRACIAS POR SU PREFERENCIA!"


def monto_a_letras(monto: float, moneda: str = "PEN", con_son: bool = True) -> str:
    """1100.00 → 'SON: MIL CIEN CON 00/100 SOLES' (o sin el prefijo 'SON:' si con_son=False)"""
    monto = round(monto or 0, 2)
    entero = int(monto)
    centavos = round((monto - entero) * 100)
    if centavos >= 100:
        entero += 1
        centavos = 0
    letras = num2words(entero, lang="es").upper()
    moneda_txt = MONEDA_LABEL.get(moneda, "SOLES")
    texto = f"{letras} CON {centavos:02d}/100 {moneda_txt}"
    return f"SON: {texto}" if con_son else texto


def generar_qr_base64(datos: str) -> str:
    img = qrcode.make(datos, border=1)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def resumen_cuentas_bancarias(db: Session) -> list:
    cuentas = (
        db.query(CuentaBancaria)
        .filter(CuentaBancaria.activo == True)  # noqa: E712
        .order_by(CuentaBancaria.banco)
        .all()
    )
    return [
        f"{(c.banco or '').upper()} - {(c.tipo_cuenta or 'CUENTA').upper()} - {c.numero_cuenta}"
        for c in cuentas
    ]


def construir_payload_impresion(
    db: Session,
    usuario: Optional[Usuario],
    *,
    tipo_documento: str,
    numero_documento: Optional[str],
    fecha_emision,
    fecha_vencimiento,
    moneda: str,
    cliente_nombre: str,
    cliente_ruc: str,
    cliente_direccion: Optional[str],
    cliente_label: str = "CLIENTE",
    items: list,
    base_imponible: Optional[float],
    igv: Optional[float],
    total: float,
    observaciones: Optional[str] = None,
    adelanto: Optional[float] = None,
    documento_relacionado: Optional[str] = None,
) -> dict:
    empresa = get_empresa_header(db)
    moneda = moneda or "PEN"
    forma_pago = (
        "CRÉDITO"
        if (fecha_vencimiento and fecha_emision and fecha_vencimiento != fecha_emision)
        else "CONTADO"
    )

    qr_datos = f"{empresa.get('ruc') or ''}|{tipo_documento}|{numero_documento or ''}|{fecha_emision or ''}|{(total or 0):.2f}"

    payload = {
        "empresa": empresa,
        "tipo_documento": tipo_documento,
        "tipo_documento_label": TIPO_DOC_LABEL.get(tipo_documento, (tipo_documento or "").upper()),
        "numero_documento": numero_documento or "—",
        "fecha_emision": str(fecha_emision) if fecha_emision else None,
        "fecha_vencimiento": str(fecha_vencimiento) if fecha_vencimiento else None,
        "moneda": moneda,
        "moneda_label": MONEDA_LABEL.get(moneda, "SOLES"),
        "forma_pago": forma_pago,
        "cliente_label": cliente_label,
        "cliente": {
            "nombre": cliente_nombre or "—",
            "ruc": cliente_ruc or "—",
            "direccion": cliente_direccion or "—",
        },
        "items": items,
        "base_imponible": round(base_imponible, 2) if base_imponible is not None else 0,
        "igv": round(igv, 2) if igv is not None else 0,
        "total": round(total, 2) if total is not None else 0,
        "adelanto": round(adelanto, 2) if adelanto else None,
        "monto_en_letras": monto_a_letras(total or 0, moneda),
        "observaciones": observaciones or None,
        "cuentas_bancarias": resumen_cuentas_bancarias(db),
        "qr_base64": generar_qr_base64(qr_datos),
        "usuario": usuario.nombre if usuario else "—",
        "generado_en": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "mensaje_footer": empresa.get("mensaje_comprobante") or MENSAJE_FOOTER_DEFECTO,
    }

    if tipo_documento in ("Nota de Crédito", "Nota de Débito"):
        payload["documento_referencia"] = documento_relacionado or ""

    return payload
