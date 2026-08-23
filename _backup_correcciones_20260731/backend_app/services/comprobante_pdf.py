"""
PDF de comprobante generado en memoria (ReportLab, sin guardar en disco) para
adjuntar al correo enviado al cliente. Estilo consistente con
app/services/reportes_export.py (header azul, tablas simples).
"""
import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

AZUL_HEX = "#1E40AF"
GRIS_HEX = "#6B7280"

TIPOS_SIN_IGV = ["Anticipo de Cliente"]


def _fmt_monto(valor, moneda="PEN"):
    if valor is None:
        return "—"
    simbolo = "US$" if moneda == "USD" else "S/"
    return f"{simbolo} {valor:,.2f}"


def _fmt_fecha(valor):
    if isinstance(valor, date):
        return valor.strftime("%d/%m/%Y")
    return str(valor) if valor else "—"


def construir_pdf_comprobante(empresa: dict, s: dict) -> bytes:
    """s: dict devuelto por _serialize() en app/routers/comprobantes.py"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.8 * cm, bottomMargin=1.8 * cm,
        title=f"{s['tipo_documento']} {s['numero_documento'] or ''}",
    )
    base = getSampleStyleSheet()
    titulo_style = ParagraphStyle("Titulo", parent=base["Heading1"], fontSize=16, textColor=colors.HexColor(AZUL_HEX), spaceAfter=2)
    sub_style    = ParagraphStyle("Sub", parent=base["Normal"], fontSize=10, textColor=colors.HexColor(GRIS_HEX))

    moneda = s.get("moneda") or "PEN"
    es_sin_igv = s["tipo_documento"] in TIPOS_SIN_IGV

    elementos = [
        Paragraph(empresa.get("nombre_empresa") or "Gerencial Pro", titulo_style),
    ]
    if empresa.get("ruc"):
        elementos.append(Paragraph(f"RUC: {empresa['ruc']}", sub_style))
    elementos.append(Spacer(1, 0.5 * cm))
    elementos.append(Paragraph(f"{s['tipo_documento']} N° {s['numero_documento'] or '—'}", titulo_style))
    elementos.append(Spacer(1, 0.3 * cm))

    datos = [
        ["Fecha de emisión:", _fmt_fecha(s.get("fecha"))],
        ["Cliente:", s.get("cliente_nombre") or "—"],
        ["RUC/DNI:", s.get("ruc_cliente") or "—"],
        ["Servicio:", s.get("tipo_servicio") or "—"],
    ]
    if s.get("descripcion"):
        datos.append(["Descripción:", s["descripcion"]])

    tabla_datos = Table(datos, colWidths=[3.5 * cm, 11.5 * cm])
    tabla_datos.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor(GRIS_HEX)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elementos.append(tabla_datos)
    elementos.append(Spacer(1, 0.6 * cm))

    montos = []
    if not es_sin_igv:
        montos.append(["Base Imponible", _fmt_monto(s.get("base_imponible"), moneda)])
        montos.append(["IGV (18%)", _fmt_monto(s.get("igv"), moneda)])
    montos.append(["TOTAL", _fmt_monto(s.get("precio_venta"), moneda)])

    tabla_montos = Table(montos, colWidths=[10 * cm, 5 * cm])
    tabla_montos.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor(AZUL_HEX)),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 12),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor(AZUL_HEX)),
        ("TOPPADDING", (0, -1), (-1, -1), 8),
    ]))
    elementos.append(tabla_montos)

    doc.build(elementos)
    buf.seek(0)
    return buf.read()
