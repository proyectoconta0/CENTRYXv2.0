"""
PDF de Orden de Cobro (ReportLab, en memoria). Mismo lenguaje visual que
app/services/comprobante_pdf.py (franja de color de marca + badge + totales
destacados), con badge naranja en vez de morado.
"""
import io
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.comercial import OrdenCobro

# Paleta ámbar (Tailwind amber.600/800) — badge de Orden de Cobro
PRIMARIO_HEX = "#D97706"   # amber.600
OSCURO_HEX   = "#92400E"   # amber.800
CLARO_HEX    = "#FFFBEB"   # amber.50
BORDE_HEX    = "#FDE68A"   # amber.200
GRIS_HEX     = "#6B7280"


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


def construir_pdf_orden_cobro(empresa: dict, orden: OrdenCobro) -> bytes:
    """orden: instancia de OrdenCobro (con .detalles ya cargado vía relationship)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.8 * cm, bottomMargin=1.8 * cm,
        title=f"Orden de Cobro {orden.numero_orden or ''}",
    )
    base = getSampleStyleSheet()
    nombre_style  = ParagraphStyle("Nombre", parent=base["Heading1"], fontSize=15, textColor=colors.HexColor("#111827"), spaceAfter=2, leading=17)
    sub_style     = ParagraphStyle("Sub", parent=base["Normal"], fontSize=9, textColor=colors.HexColor(GRIS_HEX), leading=13)
    badge_style   = ParagraphStyle("Badge", parent=base["Normal"], fontSize=9, textColor=colors.white, alignment=1, fontName="Helvetica-Bold")
    numero_style  = ParagraphStyle("Numero", parent=base["Normal"], fontSize=13, textColor=colors.HexColor("#111827"), alignment=2, fontName="Helvetica-Bold", spaceBefore=4)
    fecha_style   = ParagraphStyle("Fecha", parent=base["Normal"], fontSize=8.5, textColor=colors.HexColor(GRIS_HEX), alignment=2)
    label_style   = ParagraphStyle("Label", parent=base["Normal"], fontSize=9, textColor=colors.HexColor(OSCURO_HEX), fontName="Helvetica-Bold")
    valor_style   = ParagraphStyle("Valor", parent=base["Normal"], fontSize=9, textColor=colors.HexColor("#1a1a1a"), leading=14)
    legal_style   = ParagraphStyle("Legal", parent=base["Normal"], fontSize=7.5, textColor=colors.HexColor("#777777"))
    marca_style   = ParagraphStyle("Marca", parent=base["Normal"], fontSize=8, textColor=colors.HexColor(PRIMARIO_HEX), fontName="Helvetica-Bold")

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

    badge_cell = Table([[Paragraph("ORDEN DE COBRO", badge_style)]], colWidths=[4.5 * cm])
    badge_cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(PRIMARIO_HEX)),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    doc_info_flow = [
        badge_cell,
        Paragraph(orden.numero_orden or "—", numero_style),
        Paragraph(f"Fecha: {_fmt_fecha(orden.fecha_cobro)}", fecha_style),
    ]

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
        [Paragraph("CLIENTE:", label_style), Paragraph(orden.nombre_cliente or "—", valor_style)],
        [Paragraph("RUC/DNI:", label_style), Paragraph(orden.ruc_cliente or "—", valor_style)],
    ], colWidths=[3.2 * cm, 12.8 * cm])
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

    # ── DETALLE DE COMPROBANTES ─────────────────────────────────────────
    moneda = "PEN"
    filas = [["N°", "N° COMPROBANTE", "DESCRIPCIÓN", f"MONTO ({moneda})"]]
    for i, d in enumerate(orden.detalles, start=1):
        v = d.venta
        numero_comprobante = (v.numero_factura if v else None) or "—"
        descripcion = (v.tipo_servicio if v else None) or (v.descripcion if v else None) or "Servicio"
        filas.append([str(i), numero_comprobante, Paragraph(descripcion, valor_style), _fmt_monto(d.monto_cobrado, moneda)])

    tabla_items = Table(filas, colWidths=[1 * cm, 3.5 * cm, 7 * cm, 4.5 * cm])
    tabla_items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(OSCURO_HEX)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (1, -1), "CENTER"),
        ("ALIGN", (3, 0), (3, -1), "RIGHT"),
        ("FONTNAME", (3, 1), (3, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor(OSCURO_HEX)),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, colors.HexColor(BORDE_HEX)),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(CLARO_HEX)]),
    ]))
    elementos.append(tabla_items)
    elementos.append(Spacer(1, 0.5 * cm))

    # ── TOTAL ────────────────────────────────────────────────────────────
    total_tabla = Table([["TOTAL A COBRAR", _fmt_monto(orden.monto_total, moneda)]], colWidths=[11 * cm, 5 * cm], hAlign="RIGHT")
    total_tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(OSCURO_HEX)),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elementos.append(total_tabla)
    elementos.append(Spacer(1, 0.5 * cm))

    # ── MÉTODO DE COBRO ──────────────────────────────────────────────────
    metodo_filas = [[Paragraph("MÉTODO DE COBRO:", label_style), Paragraph(orden.metodo_cobro or "—", valor_style)]]
    if orden.banco:
        metodo_filas.append([Paragraph("BANCO:", label_style), Paragraph(orden.banco, valor_style)])
    if orden.numero_cuenta:
        metodo_filas.append([Paragraph("N° CUENTA:", label_style), Paragraph(orden.numero_cuenta, valor_style)])
    metodo_tabla = Table(metodo_filas, colWidths=[4.2 * cm, 11.8 * cm])
    metodo_tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(CLARO_HEX)),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(BORDE_HEX)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elementos.append(metodo_tabla)
    elementos.append(Spacer(1, 0.8 * cm))

    # ── OBSERVACIONES (línea en blanco para completar a mano) ──────────────
    obs_tabla = Table([[""]], colWidths=[16 * cm], rowHeights=[0.9 * cm])
    obs_tabla.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, colors.HexColor("#999999")),
    ]))
    elementos.append(Paragraph("OBSERVACIONES:", label_style))
    elementos.append(obs_tabla)
    elementos.append(Spacer(1, 1 * cm))

    # ── FIRMAS: elaborado por / recibido por ────────────────────────────
    firma_izq = [Spacer(1, 1.2 * cm), Paragraph("_" * 30, sub_style), Paragraph("Nombre y Firma", legal_style)]
    firma_der = [Spacer(1, 1.2 * cm), Paragraph("_" * 30, sub_style), Paragraph("Nombre y Firma", legal_style)]
    firmas_tabla = Table([
        [Paragraph("ELABORADO POR:", label_style), Paragraph("RECIBIDO POR:", label_style)],
        [firma_izq, firma_der],
    ], colWidths=[8 * cm, 8 * cm])
    firmas_tabla.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#e5e5e5")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elementos.append(firmas_tabla)
    elementos.append(Spacer(1, 0.6 * cm))
    elementos.append(Paragraph("Generado por Centryx | centryx.pe", marca_style))

    doc.build(elementos)
    buf.seek(0)
    return buf.read()
