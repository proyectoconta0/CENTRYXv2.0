"""
Construcción de archivos Excel (openpyxl) y PDF (reportlab) para el
Módulo de Reportes. Estilo consistente con las exportaciones existentes
(header azul #1E40AF, filas alternas #EFF6FF).
"""
import io
from datetime import date, datetime
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

EMPRESA_NOMBRE = "ElectroPro SAC"

LOGO_ANCHO_MAX  = 3.2 * cm
LOGO_ALTO_MAX   = 1.6 * cm

# openpyxl espera hex SIN "#"; reportlab (HexColor) lo requiere CON "#".
AZUL           = "1E40AF"
AZUL_CLARO     = "EFF6FF"
AZUL_HEX       = f"#{AZUL}"
AZUL_CLARO_HEX = f"#{AZUL_CLARO}"
GRIS_HEX       = "#6B7280"

MSG_SIN_DATOS = "No hay datos para el período seleccionado"


def _hex_a_rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        h = "1E40AF"
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _tinte_claro(hex_color: str, factor: float = 0.88) -> str:
    """Aclara un color hex mezclándolo con blanco (para el fondo de filas alternas)."""
    r, g, b = _hex_a_rgb(hex_color)
    r = int(r + (255 - r) * factor)
    g = int(g + (255 - g) * factor)
    b = int(b + (255 - b) * factor)
    return f"{r:02X}{g:02X}{b:02X}"


# ══════════════════════════════════════════════════════════════════════════
# Excel
# ══════════════════════════════════════════════════════════════════════════

def _escribir_hoja(ws, headers: list, widths: list, rows: list, money_cols: Optional[set] = None,
                    color_principal: str = AZUL):
    money_cols = money_cols or set()
    color_claro = _tinte_claro(color_principal)
    hdr_font  = Font(bold=True, color="FFFFFF")
    hdr_fill  = PatternFill(start_color=color_principal, end_color=color_principal, fill_type="solid")
    hdr_align = Alignment(horizontal="center", vertical="center")
    alt_fill  = PatternFill(start_color=color_claro, end_color=color_claro, fill_type="solid")

    for ci, (h, w) in enumerate(zip(headers, widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font; cell.fill = hdr_fill; cell.alignment = hdr_align
        ws.column_dimensions[get_column_letter(ci)].width = w
    ws.row_dimensions[1].height = 20
    ws.freeze_panes = "A2"

    if not rows:
        msg_cell = ws.cell(row=2, column=1, value=MSG_SIN_DATOS)
        msg_cell.font = Font(italic=True, color="9CA3AF")
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(headers))
        return

    for ri, row in enumerate(rows, 2):
        for ci, val in enumerate(row, 1):
            cell = ws.cell(row=ri, column=ci, value=val)
            if ci in money_cols and isinstance(val, (int, float)):
                cell.number_format = "#,##0.00"
            if (ri - 1) % 2 == 0:
                cell.fill = alt_fill


def construir_excel(sheets: list, color_principal: Optional[str] = None) -> bytes:
    """sheets: [{"titulo", "headers", "widths", "rows", "money_cols"}]"""
    color = (color_principal or AZUL).lstrip("#").upper()
    wb = Workbook()
    wb.remove(wb.active)
    for sh in sheets:
        ws = wb.create_sheet(title=sh["titulo"][:31])
        _escribir_hoja(ws, sh["headers"], sh["widths"], sh["rows"], sh.get("money_cols"), color)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


# ══════════════════════════════════════════════════════════════════════════
# PDF
# ══════════════════════════════════════════════════════════════════════════

def _pdf_pie_pagina_factory(empresa_nombre: str):
    def _pie(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor(GRIS_HEX))
        fecha_txt = f"Generado el {date.today().strftime('%d/%m/%Y')} — {empresa_nombre}"
        canvas.drawString(1.5 * cm, 1 * cm, fecha_txt)
        canvas.drawRightString(doc.pagesize[0] - 1.5 * cm, 1 * cm, f"Página {doc.page}")
        canvas.restoreState()
    return _pie


def _estilos(color_hex: str):
    base = getSampleStyleSheet()
    return {
        "empresa":  ParagraphStyle("Empresa", parent=base["Normal"], fontSize=11, textColor=colors.HexColor("#111827"), fontName="Helvetica-Bold"),
        "titulo":   ParagraphStyle("Titulo", parent=base["Heading1"], fontSize=16, textColor=colors.HexColor(color_hex), spaceAfter=2),
        "sub":      ParagraphStyle("Sub", parent=base["Normal"], fontSize=10, textColor=colors.HexColor(GRIS_HEX)),
        "seccion":  ParagraphStyle("Seccion", parent=base["Heading2"], fontSize=12, textColor=colors.HexColor(color_hex), spaceBefore=10, spaceAfter=6),
        "normal":   base["Normal"],
        "resumen":  ParagraphStyle("Resumen", parent=base["Normal"], fontSize=10.5, fontName="Helvetica-Bold", spaceAfter=3),
    }


def _tabla_datos(headers: list, filas: list, color_hex: str) -> Table:
    color_claro = f"#{_tinte_claro(color_hex)}"
    data = [headers] + filas
    tabla = Table(data, repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0), colors.HexColor(color_hex)),
        ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
        ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(color_claro)]),
        ("GRID",           (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN",          (0, 0), (-1, -1), "LEFT"),
        ("TOPPADDING",     (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 4),
    ]))
    return tabla


def _logo_flowable(logo_path: Optional[str]) -> Optional[Image]:
    """Escala el logo manteniendo proporción, sin exceder LOGO_ANCHO_MAX x LOGO_ALTO_MAX."""
    if not logo_path:
        return None
    try:
        iw, ih = ImageReader(logo_path).getSize()
        escala = min(LOGO_ANCHO_MAX / iw, LOGO_ALTO_MAX / ih)
        return Image(logo_path, width=iw * escala, height=ih * escala)
    except Exception:
        return None


def _encabezado_flowables(empresa: dict, s: dict) -> list:
    """Header de los PDFs: logo + datos de la empresa si hay logo configurado;
    si no, el nombre de la empresa en texto grande (mismo criterio en toda la app)."""
    nombre = empresa.get("nombre_empresa") or EMPRESA_NOMBRE
    logo = _logo_flowable(empresa.get("logo_path"))

    datos = [d for d in (
        f"RUC: {empresa['ruc']}" if empresa.get("ruc") else None,
        empresa.get("direccion"),
        f"Tel: {empresa['telefono']}" if empresa.get("telefono") else None,
    ) if d]
    texto_datos = "  ·  ".join(datos)

    if logo:
        celda_texto = [Paragraph(nombre, s["empresa"])]
        if texto_datos:
            celda_texto.append(Paragraph(texto_datos, s["sub"]))
        tabla = Table([[logo, celda_texto]], colWidths=[LOGO_ANCHO_MAX + 0.4 * cm, None])
        tabla.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [tabla]

    nombre_grande = ParagraphStyle("EmpresaGrande", parent=s["empresa"], fontSize=16)
    elementos = [Paragraph(nombre, nombre_grande)]
    if texto_datos:
        elementos.append(Paragraph(texto_datos, s["sub"]))
    return elementos


def construir_pdf(titulo: str, periodo_label: str, headers: list, filas: list,
                   resumen_lines: Optional[list] = None,
                   empresa: Optional[dict] = None, color_principal: Optional[str] = None) -> bytes:
    empresa = empresa or {}
    empresa_nombre = empresa.get("nombre_empresa") or EMPRESA_NOMBRE
    color_hex = color_principal or empresa.get("color_principal") or AZUL_HEX
    if not color_hex.startswith("#"):
        color_hex = f"#{color_hex}"
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=1.5 * cm, bottomMargin=1.8 * cm, leftMargin=1.5 * cm, rightMargin=1.5 * cm,
    )
    s = _estilos(color_hex)
    elementos = [
        *_encabezado_flowables(empresa, s),
        Spacer(1, 0.3 * cm),
        Paragraph(titulo, s["titulo"]),
        Paragraph(f"Período: {periodo_label}", s["sub"]),
        Spacer(1, 0.5 * cm),
    ]

    if not filas:
        elementos.append(Paragraph(MSG_SIN_DATOS, s["normal"]))
    else:
        elementos.append(_tabla_datos(headers, filas, color_hex))

    if resumen_lines:
        elementos.append(Spacer(1, 0.6 * cm))
        for linea in resumen_lines:
            elementos.append(Paragraph(linea, s["resumen"]))

    pie = _pdf_pie_pagina_factory(empresa_nombre)
    doc.build(elementos, onFirstPage=pie, onLaterPages=pie)
    buf.seek(0)
    return buf.read()


def _pdf_pie_estado_cuenta_factory(generado_txt: str):
    def _pie(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor(GRIS_HEX))
        canvas.drawString(2 * cm, 1 * cm, f"Documento generado por Gerencial Pro — {generado_txt}")
        canvas.drawRightString(doc.pagesize[0] - 2 * cm, 1 * cm, f"Página {doc.page}")
        canvas.restoreState()
    return _pie


def construir_pdf_estado_cuenta(cliente: dict, movimientos: list, resumen: dict, periodo_label: str,
                                 empresa: Optional[dict] = None, color_principal: Optional[str] = None) -> bytes:
    """cliente: {"razon_social","ruc","direccion"}
    movimientos: [{"fecha","numero_documento","descripcion","cargo","abono","saldo"}] (ya formateados)
    resumen: {"total_facturado","total_cobrado","saldo_pendiente"} (montos float)"""
    empresa = empresa or {}
    empresa_nombre = empresa.get("nombre_empresa") or EMPRESA_NOMBRE
    color_hex = color_principal or empresa.get("color_principal") or AZUL_HEX
    if not color_hex.startswith("#"):
        color_hex = f"#{color_hex}"

    ahora = datetime.now()
    generado_txt = ahora.strftime("%d/%m/%Y %H:%M")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=1.8 * cm, bottomMargin=1.8 * cm, leftMargin=2 * cm, rightMargin=2 * cm,
    )
    s = _estilos(color_hex)

    elementos = [
        *_encabezado_flowables(empresa, s),
        Spacer(1, 0.4 * cm),
        Paragraph("ESTADO DE CUENTA", s["titulo"]),
        Paragraph(f"Fecha de generación: {generado_txt}", s["sub"]),
        Paragraph(f"Período: {periodo_label}", s["sub"]),
        Spacer(1, 0.5 * cm),
    ]

    datos_cliente = [
        ["Razón Social:", cliente.get("razon_social") or "—"],
        ["RUC:",          cliente.get("ruc") or "—"],
        ["Dirección:",    cliente.get("direccion") or "—"],
    ]
    tabla_cliente = Table(datos_cliente, colWidths=[3.2 * cm, 12.8 * cm])
    tabla_cliente.setStyle(TableStyle([
        ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR",     (0, 0), (0, -1), colors.HexColor(GRIS_HEX)),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elementos.append(tabla_cliente)
    elementos.append(Spacer(1, 0.6 * cm))

    headers = ["Fecha", "N° Documento", "Descripción", "Cargo (S/)", "Abono (S/)", "Saldo (S/)"]
    if not movimientos:
        elementos.append(Paragraph(MSG_SIN_DATOS, s["normal"]))
    else:
        filas = [[m["fecha"], m["numero_documento"], m["descripcion"], m["cargo"], m["abono"], m["saldo"]]
                  for m in movimientos]
        elementos.append(_tabla_datos(headers, filas, color_hex))

    elementos.append(Spacer(1, 0.6 * cm))
    elementos.append(Paragraph(f"Total Facturado: S/ {resumen['total_facturado']:,.2f}", s["resumen"]))
    elementos.append(Paragraph(f"Total Cobrado: S/ {resumen['total_cobrado']:,.2f}", s["resumen"]))
    elementos.append(Paragraph(f"Saldo Pendiente: S/ {resumen['saldo_pendiente']:,.2f}", s["resumen"]))

    pie = _pdf_pie_estado_cuenta_factory(generado_txt)
    doc.build(elementos, onFirstPage=pie, onLaterPages=pie)
    buf.seek(0)
    return buf.read()


def construir_pdf_general(periodo_label: str, resumen_lines: list, secciones: list,
                           empresa: Optional[dict] = None, color_principal: Optional[str] = None) -> bytes:
    """secciones: [{"titulo", "headers", "filas"}] — una tabla por sección,
    con salto de página entre cada una."""
    empresa = empresa or {}
    empresa_nombre = empresa.get("nombre_empresa") or EMPRESA_NOMBRE
    color_hex = color_principal or empresa.get("color_principal") or AZUL_HEX
    if not color_hex.startswith("#"):
        color_hex = f"#{color_hex}"
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=1.5 * cm, bottomMargin=1.8 * cm, leftMargin=1.5 * cm, rightMargin=1.5 * cm,
    )
    s = _estilos(color_hex)
    elementos = [
        *_encabezado_flowables(empresa, s),
        Spacer(1, 0.3 * cm),
        Paragraph("Reporte General", s["titulo"]),
        Paragraph(f"Período: {periodo_label}", s["sub"]),
        Spacer(1, 0.5 * cm),
        Paragraph("Resumen Ejecutivo", s["seccion"]),
    ]
    for linea in resumen_lines:
        elementos.append(Paragraph(linea, s["resumen"]))

    for sec in secciones:
        elementos.append(PageBreak())
        elementos.append(Paragraph(sec["titulo"], s["seccion"]))
        if not sec["filas"]:
            elementos.append(Paragraph(MSG_SIN_DATOS, s["normal"]))
        else:
            elementos.append(_tabla_datos(sec["headers"], sec["filas"], color_hex))

    pie = _pdf_pie_pagina_factory(empresa_nombre)
    doc.build(elementos, onFirstPage=pie, onLaterPages=pie)
    buf.seek(0)
    return buf.read()
