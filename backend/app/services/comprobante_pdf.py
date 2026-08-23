"""
PDF de comprobante generado en memoria (ReportLab, sin guardar en disco) para
adjuntar al correo enviado al cliente. Estilo alineado con la plantilla HTML
imprimible (frontend/src/templates/factura.html): franja morada de marca,
badge de tipo de comprobante y totales destacados.
"""
import io
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.comprobante_print import TIPO_DOC_LABEL, monto_a_letras

# Paleta morada (Chakra UI purple.*) — misma referencia usada en factura.css
PRIMARIO_HEX = "#6B46C1"   # purple.600
OSCURO_HEX   = "#44337A"   # purple.800
CLARO_HEX    = "#FAF5FF"   # purple.50
BORDE_HEX    = "#D6BCFA"   # purple.200
GRIS_HEX     = "#6B7280"

BADGE_COLOR_POR_TIPO = {
    "Nota de Crédito": "#DC2626",
    "Boleta de Venta": "#16A34A",
}

TIPOS_SIN_IGV = ["Anticipo de Cliente"]


def _fmt_monto(valor, moneda="PEN"):
    if valor is None:
        return "—"
    simbolo = "US$" if moneda == "USD" else "S/"
    return f"{simbolo} {valor:,.2f}"


def _fmt_fecha(valor):
    if isinstance(valor, date):
        return valor.strftime("%d/%m/%Y")
    if isinstance(valor, str) and valor:
        try:
            return datetime.strptime(valor[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
        except ValueError:
            return valor
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
    nombre_style   = ParagraphStyle("Nombre", parent=base["Heading1"], fontSize=15, textColor=colors.HexColor("#111827"), spaceAfter=2, leading=17)
    sub_style      = ParagraphStyle("Sub", parent=base["Normal"], fontSize=9, textColor=colors.HexColor(GRIS_HEX), leading=13)
    badge_style    = ParagraphStyle("Badge", parent=base["Normal"], fontSize=9, textColor=colors.white, alignment=1, fontName="Helvetica-Bold")
    numero_style   = ParagraphStyle("Numero", parent=base["Normal"], fontSize=13, textColor=colors.HexColor("#111827"), alignment=2, fontName="Helvetica-Bold", spaceBefore=4)
    fecha_style    = ParagraphStyle("Fecha", parent=base["Normal"], fontSize=8.5, textColor=colors.HexColor(GRIS_HEX), alignment=2)
    cliente_label_style = ParagraphStyle("ClienteLabel", parent=base["Normal"], fontSize=9, textColor=colors.HexColor(OSCURO_HEX), fontName="Helvetica-Bold")
    cliente_style  = ParagraphStyle("Cliente", parent=base["Normal"], fontSize=9, textColor=colors.HexColor("#1a1a1a"), leading=14)
    letras_style   = ParagraphStyle("Letras", parent=base["Normal"], fontSize=9.5, textColor=colors.HexColor("#333333"), fontName="Helvetica-Bold")
    legal_style    = ParagraphStyle("Legal", parent=base["Normal"], fontSize=7.5, textColor=colors.HexColor("#777777"))
    marca_style    = ParagraphStyle("Marca", parent=base["Normal"], fontSize=8, textColor=colors.HexColor(PRIMARIO_HEX), fontName="Helvetica-Bold")

    moneda = s.get("moneda") or "PEN"
    es_sin_igv = s["tipo_documento"] in TIPOS_SIN_IGV
    tipo_documento = s["tipo_documento"]
    tipo_label = TIPO_DOC_LABEL.get(tipo_documento, (tipo_documento or "").upper())
    badge_color = BADGE_COLOR_POR_TIPO.get(tipo_documento, PRIMARIO_HEX)
    forma_pago = (
        "CRÉDITO"
        if (s.get("fecha_vencimiento") and s.get("fecha") and str(s["fecha_vencimiento"]) != str(s["fecha"]))
        else "CONTADO"
    )

    elementos = []

    # ── ENCABEZADO: logo | datos empresa | badge + numeración ──────────────
    logo_flowable = ""
    if empresa.get("logo_path"):
        try:
            origen = empresa["logo_path"]
            origen = io.BytesIO(origen) if isinstance(origen, (bytes, bytearray)) else origen
            logo_flowable = Image(origen, width=2.4 * cm, height=2.4 * cm, kind="proportional")
        except Exception:
            logo_flowable = ""

    datos_empresa = [Paragraph(empresa.get("nombre_empresa") or "Centryx", nombre_style)]
    if empresa.get("ruc"):
        datos_empresa.append(Paragraph(f"RUC: {empresa['ruc']}", sub_style))
    if empresa.get("direccion"):
        datos_empresa.append(Paragraph(empresa["direccion"], sub_style))
    contacto = " · ".join(filter(None, [empresa.get("telefono"), empresa.get("email")]))
    if contacto:
        datos_empresa.append(Paragraph(contacto, sub_style))

    badge_cell = Table([[Paragraph(tipo_label, badge_style)]], colWidths=[4.5 * cm])
    badge_cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(badge_color)),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    doc_info_flow = [badge_cell, Paragraph(s["numero_documento"] or "—", numero_style),
                      Paragraph(f"Fecha: {_fmt_fecha(s.get('fecha'))}", fecha_style)]
    if s.get("fecha_vencimiento"):
        doc_info_flow.append(Paragraph(f"Venc.: {_fmt_fecha(s.get('fecha_vencimiento'))}", fecha_style))

    encabezado = Table(
        [[logo_flowable, datos_empresa, doc_info_flow]],
        colWidths=[2.8 * cm, 9.2 * cm, 4.5 * cm],
    )
    encabezado.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (2, 0), (2, 0), "RIGHT"),
    ]))
    elementos.append(encabezado)
    elementos.append(Spacer(1, 0.5 * cm))

    # ── CLIENTE ──────────────────────────────────────────────────────────
    cliente_tabla = Table([
        [Paragraph("CLIENTE:", cliente_label_style), Paragraph(s.get("cliente_nombre") or "—", cliente_style)],
        [Paragraph("RUC/DNI:", cliente_label_style), Paragraph(s.get("ruc_cliente") or "—", cliente_style)],
    ], colWidths=[2.5 * cm, 13.5 * cm])
    cliente_tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(CLARO_HEX)),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(BORDE_HEX)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elementos.append(cliente_tabla)
    elementos.append(Spacer(1, 0.5 * cm))

    # ── DETALLE DEL SERVICIO ────────────────────────────────────────────
    descripcion_item = s.get("tipo_servicio") or "Servicio"
    if s.get("descripcion"):
        descripcion_item = f"{descripcion_item} - {s['descripcion']}"

    items_header = ["N°", "DESCRIPCIÓN DEL SERVICIO", f"MONTO ({moneda})"]
    items_fila = ["1", Paragraph(descripcion_item, cliente_style), _fmt_monto(s.get("precio_venta"), moneda)]
    tabla_items = Table([items_header, items_fila], colWidths=[1.2 * cm, 11.3 * cm, 3.5 * cm])
    tabla_items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(OSCURO_HEX)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("FONTNAME", (2, 1), (2, 1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor(OSCURO_HEX)),
        ("LINEBELOW", (0, 1), (-1, 1), 0.5, colors.HexColor(BORDE_HEX)),
    ]))
    elementos.append(tabla_items)
    elementos.append(Spacer(1, 0.5 * cm))

    # ── TOTALES ──────────────────────────────────────────────────────────
    montos = []
    if not es_sin_igv:
        montos.append(["OP. GRAVADA", _fmt_monto(s.get("base_imponible"), moneda)])
        montos.append(["IGV (18%)", _fmt_monto(s.get("igv"), moneda)])
    montos.append(["TOTAL", _fmt_monto(s.get("precio_venta"), moneda)])

    tabla_montos = Table(montos, colWidths=[6 * cm, 5 * cm], hAlign="RIGHT")
    n_filas = len(montos)
    tabla_montos.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(BORDE_HEX)),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, n_filas - 1), (-1, n_filas - 1), colors.HexColor(OSCURO_HEX)),
        ("TEXTCOLOR", (0, n_filas - 1), (-1, n_filas - 1), colors.white),
        ("FONTNAME", (0, n_filas - 1), (-1, n_filas - 1), "Helvetica-Bold"),
        ("FONTSIZE", (0, n_filas - 1), (-1, n_filas - 1), 11),
    ]))
    elementos.append(tabla_montos)
    elementos.append(Spacer(1, 0.5 * cm))

    # ── MONTO EN LETRAS ─────────────────────────────────────────────────
    letras_tabla = Table([[Paragraph(monto_a_letras(s.get("precio_venta") or 0, moneda), letras_style)]], colWidths=[16 * cm])
    letras_tabla.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(BORDE_HEX)),
        ("LINEBEFORE", (0, 0), (0, -1), 2, colors.HexColor(PRIMARIO_HEX)),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elementos.append(letras_tabla)
    elementos.append(Spacer(1, 0.8 * cm))

    # ── PIE: forma de pago + legal + firma ──────────────────────────────
    pie_izq = [
        Paragraph(f"<b>Forma de pago:</b> {forma_pago}", sub_style),
        Spacer(1, 0.2 * cm),
        Paragraph("Representación impresa del comprobante electrónico — Autorizado por SUNAT.", legal_style),
        Paragraph("Generado por Centryx | centryx.pe", marca_style),
    ]
    pie_der = [
        Spacer(1, 0.9 * cm),
        Paragraph("_" * 28, sub_style),
        Paragraph("Firma y Sello Autorizado", legal_style),
    ]
    pie_tabla = Table([[pie_izq, pie_der]], colWidths=[10.5 * cm, 5.5 * cm])
    pie_tabla.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#e5e5e5")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
    ]))
    elementos.append(pie_tabla)

    doc.build(elementos)
    buf.seek(0)
    return buf.read()
