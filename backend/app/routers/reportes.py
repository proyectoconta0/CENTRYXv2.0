import io
import json
import uuid
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from app.models.reportes import ReporteGenerado
from app.services import reportes_service as svc
from app.services import reportes_export as exp
from app.services.empresa_header import get_empresa_header

router = APIRouter()

REPORTES_DIR = Path("uploads/reportes")

MEDIA_TYPES = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf":  "application/pdf",
}

TIPO_LABEL = {
    "general":     "Reporte General",
    "ventas":      "Reporte de Ventas",
    "gastos":      "Reporte de Gastos",
    "cobranza":    "Reporte de Cobranza",
    "flujo_caja":  "Reporte de Flujo de Caja",
    "proveedores": "Reporte de Proveedores",
}


# ── Helpers de formato para PDF (celdas como texto) ───────────────────────────

def _s(v) -> str:
    return "—" if v is None or v == "" else str(v)

def _fd(d) -> str:
    return d.strftime("%d/%m/%Y") if d else "—"

def _fm(n) -> str:
    return f"S/ {n:,.2f}" if isinstance(n, (int, float)) else "—"


def _resolver_formato(formato: str) -> str:
    return formato if formato in ("xlsx", "pdf") else "xlsx"


def _guardar_historial(db: Session, tipo: str, periodo_label: str, desde: date, hasta: date,
                        formato: str, filtros: dict, contenido: bytes, nombre_archivo: str) -> ReporteGenerado:
    REPORTES_DIR.mkdir(parents=True, exist_ok=True)
    ext = "pdf" if formato == "pdf" else "xlsx"
    ruta = REPORTES_DIR / f"{uuid.uuid4().hex}.{ext}"
    ruta.write_bytes(contenido)

    reg = ReporteGenerado(
        tipo=tipo,
        periodo_label=periodo_label,
        periodo_desde=desde,
        periodo_hasta=hasta,
        formato=formato,
        filtros_json=json.dumps(filtros, default=str) if filtros else None,
        archivo_path=str(ruta),
        archivo_nombre=nombre_archivo,
        created_at=date.today(),
    )
    db.add(reg)
    db.commit()
    db.refresh(reg)
    return reg


def _responder(contenido: bytes, formato: str, nombre_archivo: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(contenido),
        media_type=MEDIA_TYPES[formato],
        headers={"Content-Disposition": f"attachment; filename={nombre_archivo}"},
    )


# ══════════════════════════════════════════════════════════════════════════
# Reporte General
# ══════════════════════════════════════════════════════════════════════════

@router.get("/general")
def reporte_general(
    periodo: str = "mes", desde: Optional[date] = None, hasta: Optional[date] = None,
    formato: str = "xlsx", db: Session = Depends(get_db),
):
    d, h, label = svc.resolver_periodo(periodo, desde, hasta)
    formato = _resolver_formato(formato)
    empresa_header = get_empresa_header(db)
    color_emp = empresa_header["color_principal"]

    resumen  = svc.resumen_ejecutivo(db, d, h)
    ventas   = svc.datos_ventas(db, d, h)
    gastos   = svc.datos_gastos(db, d, h)
    cobranza = svc.datos_cobranza(db, d, h)
    pagos    = svc.datos_pagos_realizados(db, d, h)

    resumen_lines = [
        f"Ventas del período: S/ {resumen['ventas_periodo']:,.2f}",
        f"Gastos del período: S/ {resumen['gastos_periodo']:,.2f}",
        f"Utilidad: S/ {resumen['utilidad']:,.2f}",
        f"Cuentas por cobrar: S/ {resumen['cuentas_por_cobrar']:,.2f}",
        f"Cuentas por pagar: S/ {resumen['cuentas_por_pagar']:,.2f}",
        f"Saldo bancario: S/ {resumen['saldo_bancario']:,.2f}",
    ]

    if formato == "pdf":
        secciones = [
            {
                "titulo": "Detalle de Ventas",
                "headers": ["Fecha", "N° Comprobante", "Cliente", "Tipo", "Monto", "Estado Cobro"],
                "filas": [[_fd(f["fecha"]), _s(f["numero_comprobante"]), _s(f["cliente"]),
                           _s(f["tipo_documento"]), _fm(f["precio_venta"]), _s(f["estado_cobro"])] for f in ventas],
            },
            {
                "titulo": "Detalle de Gastos",
                "headers": ["Fecha", "Categoría", "Descripción", "Proveedor", "Monto", "Estado Pago"],
                "filas": [[_fd(f["fecha"]), _s(f["categoria"]), _s(f["descripcion"]),
                           _s(f["proveedor"]), _fm(f["monto_soles"]), _s(f["estado_pago"])] for f in gastos],
            },
            {
                "titulo": "Cobranza",
                "headers": ["Cliente", "N° Factura", "Monto", "Vencimiento", "Saldo", "Estado"],
                "filas": [[_s(f["cliente"]), _s(f["numero_comprobante"]), _fm(f["monto_total"]),
                           _fd(f["fecha_vencimiento"]), _fm(f["saldo_pendiente"]), _s(f["estado"])] for f in cobranza],
            },
            {
                "titulo": "Pagos Realizados",
                "headers": ["Proveedor", "Descripción", "Monto", "Fecha Pago", "Método"],
                "filas": [[_s(f["proveedor"]), _s(f["descripcion"]), _fm(f["monto"]),
                           _fd(f["fecha_pago"]), _s(f["metodo_pago"])] for f in pagos],
            },
        ]
        contenido = exp.construir_pdf_general(label, resumen_lines, secciones,
                                               empresa=empresa_header, color_principal=color_emp)
    else:
        sheets = [
            {
                "titulo": "Resumen Ejecutivo",
                "headers": ["Indicador", "Valor (S/)"],
                "widths": [30, 18],
                "rows": [
                    ["Ventas del período",  resumen["ventas_periodo"]],
                    ["Gastos del período",  resumen["gastos_periodo"]],
                    ["Utilidad",            resumen["utilidad"]],
                    ["Cuentas por cobrar",  resumen["cuentas_por_cobrar"]],
                    ["Cuentas por pagar",   resumen["cuentas_por_pagar"]],
                    ["Saldo bancario",      resumen["saldo_bancario"]],
                ],
                "money_cols": {2},
            },
            {
                "titulo": "Detalle de Ventas",
                "headers": ["Fecha", "N° Comprobante", "Cliente", "Tipo", "Monto", "Estado Cobro"],
                "widths": [12, 18, 28, 14, 14, 14],
                "rows": [[str(f["fecha"]), f["numero_comprobante"], f["cliente"], f["tipo_documento"],
                          f["precio_venta"], f["estado_cobro"]] for f in ventas],
                "money_cols": {5},
            },
            {
                "titulo": "Detalle de Gastos",
                "headers": ["Fecha", "Categoría", "Descripción", "Proveedor", "Monto", "Estado Pago"],
                "widths": [12, 22, 30, 24, 14, 14],
                "rows": [[str(f["fecha"]), f["categoria"], f["descripcion"], f["proveedor"],
                          f["monto_soles"], f["estado_pago"]] for f in gastos],
                "money_cols": {5},
            },
            {
                "titulo": "Cobranza",
                "headers": ["Cliente", "N° Factura", "Monto", "Vencimiento", "Saldo", "Estado"],
                "widths": [28, 16, 14, 14, 14, 12],
                "rows": [[f["cliente"], f["numero_comprobante"], f["monto_total"],
                          str(f["fecha_vencimiento"]) if f["fecha_vencimiento"] else None,
                          f["saldo_pendiente"], f["estado"]] for f in cobranza],
                "money_cols": {3, 5},
            },
            {
                "titulo": "Pagos Realizados",
                "headers": ["Proveedor", "Descripción", "Monto", "Fecha Pago", "Método"],
                "widths": [24, 30, 14, 14, 16],
                "rows": [[f["proveedor"], f["descripcion"], f["monto"], str(f["fecha_pago"]), f["metodo_pago"]] for f in pagos],
                "money_cols": {3},
            },
        ]
        contenido = exp.construir_excel(sheets, color_principal=color_emp)

    nombre = f"Reporte_General_{d}_{h}.{formato}"
    _guardar_historial(db, "general", label, d, h, formato, {}, contenido, nombre)
    return _responder(contenido, formato, nombre)


# ══════════════════════════════════════════════════════════════════════════
# Reporte de Ventas
# ══════════════════════════════════════════════════════════════════════════

@router.get("/ventas")
def reporte_ventas(
    periodo: str = "mes", desde: Optional[date] = None, hasta: Optional[date] = None,
    formato: str = "xlsx", cliente: Optional[str] = None, tipo_servicio: Optional[str] = None,
    tipo_documento: Optional[str] = None, db: Session = Depends(get_db),
):
    d, h, label = svc.resolver_periodo(periodo, desde, hasta)
    formato = _resolver_formato(formato)
    empresa_header = get_empresa_header(db)
    color_emp = empresa_header["color_principal"]
    filas = svc.datos_ventas(db, d, h, cliente, tipo_servicio, tipo_documento)

    headers = ["Fecha", "N° Comprobante", "Tipo Doc", "Cliente", "RUC", "Tipo Servicio",
               "Base Imponible", "IGV", "Precio Venta", "Moneda", "Estado Cobro"]

    if formato == "pdf":
        pdf_filas = [[
            _fd(f["fecha"]), _s(f["numero_comprobante"]), _s(f["tipo_documento"]), _s(f["cliente"]), _s(f["ruc"]),
            _s(f["tipo_servicio"]), _fm(f["base_imponible"]), _fm(f["igv"]), _fm(f["precio_venta"]),
            _s(f["moneda"]), _s(f["estado_cobro"]),
        ] for f in filas]
        contenido = exp.construir_pdf(TIPO_LABEL["ventas"], label, headers, pdf_filas,
                                      empresa=empresa_header, color_principal=color_emp)
    else:
        rows = [[
            str(f["fecha"]), f["numero_comprobante"], f["tipo_documento"], f["cliente"], f["ruc"],
            f["tipo_servicio"], f["base_imponible"], f["igv"], f["precio_venta"], f["moneda"], f["estado_cobro"],
        ] for f in filas]
        contenido = exp.construir_excel([{
            "titulo": "Ventas", "headers": headers,
            "widths": [12, 18, 12, 28, 14, 20, 14, 12, 14, 10, 14],
            "rows": rows, "money_cols": {7, 8, 9},
        }], color_principal=color_emp)

    nombre = f"Reporte_Ventas_{d}_{h}.{formato}"
    filtros = {"cliente": cliente, "tipo_servicio": tipo_servicio, "tipo_documento": tipo_documento}
    _guardar_historial(db, "ventas", label, d, h, formato, filtros, contenido, nombre)
    return _responder(contenido, formato, nombre)


# ══════════════════════════════════════════════════════════════════════════
# Reporte de Gastos
# ══════════════════════════════════════════════════════════════════════════

@router.get("/gastos")
def reporte_gastos(
    periodo: str = "mes", desde: Optional[date] = None, hasta: Optional[date] = None,
    formato: str = "xlsx", categoria: Optional[str] = None, area: Optional[str] = None,
    tipo_comprobante: Optional[str] = None, proveedor: Optional[str] = None,
    db: Session = Depends(get_db),
):
    d, h, label = svc.resolver_periodo(periodo, desde, hasta)
    formato = _resolver_formato(formato)
    empresa_header = get_empresa_header(db)
    color_emp = empresa_header["color_principal"]
    filas = svc.datos_gastos(db, d, h, categoria, area, tipo_comprobante, proveedor)

    headers = ["Fecha", "Categoría", "Descripción", "Proveedor", "RUC", "Tipo Comprobante",
               "N° Comprobante", "Moneda", "Monto Original", "T/C", "Base Imponible",
               "IGV", "Monto S/", "Área", "Estado Pago"]

    if formato == "pdf":
        pdf_filas = [[
            _fd(f["fecha"]), _s(f["categoria"]), _s(f["descripcion"]), _s(f["proveedor"]), _s(f["ruc"]),
            _s(f["tipo_comprobante"]), _s(f["numero_comprobante"]), _s(f["moneda"]), _fm(f["monto_original"]),
            _s(f["tipo_cambio"]), _fm(f["base_imponible"]), _fm(f["igv"]), _fm(f["monto_soles"]),
            _s(f["area"]), _s(f["estado_pago"]),
        ] for f in filas]
        contenido = exp.construir_pdf(TIPO_LABEL["gastos"], label, headers, pdf_filas,
                                      empresa=empresa_header, color_principal=color_emp)
    else:
        rows = [[
            str(f["fecha"]), f["categoria"], f["descripcion"], f["proveedor"], f["ruc"],
            f["tipo_comprobante"], f["numero_comprobante"], f["moneda"], f["monto_original"],
            f["tipo_cambio"], f["base_imponible"], f["igv"], f["monto_soles"], f["area"], f["estado_pago"],
        ] for f in filas]
        contenido = exp.construir_excel([{
            "titulo": "Gastos", "headers": headers,
            "widths": [12, 20, 28, 24, 14, 20, 16, 10, 14, 8, 14, 12, 14, 16, 14],
            "rows": rows, "money_cols": {9, 11, 12, 13},
        }], color_principal=color_emp)

    nombre = f"Reporte_Gastos_{d}_{h}.{formato}"
    filtros = {"categoria": categoria, "area": area, "tipo_comprobante": tipo_comprobante, "proveedor": proveedor}
    _guardar_historial(db, "gastos", label, d, h, formato, filtros, contenido, nombre)
    return _responder(contenido, formato, nombre)


# ══════════════════════════════════════════════════════════════════════════
# Reporte de Cobranza
# ══════════════════════════════════════════════════════════════════════════

@router.get("/cobranza")
def reporte_cobranza(
    periodo: str = "mes", desde: Optional[date] = None, hasta: Optional[date] = None,
    formato: str = "xlsx", cliente: Optional[str] = None, estado: Optional[str] = None,
    db: Session = Depends(get_db),
):
    d, h, label = svc.resolver_periodo(periodo, desde, hasta)
    formato = _resolver_formato(formato)
    empresa_header = get_empresa_header(db)
    color_emp = empresa_header["color_principal"]
    filas = svc.datos_cobranza(db, d, h, cliente, estado)

    headers = ["N° Comprobante", "Cliente", "RUC", "Fecha Emisión", "Fecha Vencimiento",
               "Monto Total", "Monto Pagado", "Saldo Pendiente", "Días Mora", "Estado", "Semáforo"]

    if formato == "pdf":
        pdf_filas = [[
            _s(f["numero_comprobante"]), _s(f["cliente"]), _s(f["ruc"]), _fd(f["fecha_emision"]),
            _fd(f["fecha_vencimiento"]), _fm(f["monto_total"]), _fm(f["monto_pagado"]),
            _fm(f["saldo_pendiente"]), _s(f["dias_mora"]), _s(f["estado"]), _s(f["semaforo"]),
        ] for f in filas]
        contenido = exp.construir_pdf(TIPO_LABEL["cobranza"], label, headers, pdf_filas,
                                      empresa=empresa_header, color_principal=color_emp)
    else:
        rows = [[
            f["numero_comprobante"], f["cliente"], f["ruc"], str(f["fecha_emision"]),
            str(f["fecha_vencimiento"]) if f["fecha_vencimiento"] else None,
            f["monto_total"], f["monto_pagado"], f["saldo_pendiente"], f["dias_mora"], f["estado"], f["semaforo"],
        ] for f in filas]
        contenido = exp.construir_excel([{
            "titulo": "Cobranza", "headers": headers,
            "widths": [16, 28, 14, 14, 16, 14, 14, 14, 12, 12, 12],
            "rows": rows, "money_cols": {6, 7, 8},
        }], color_principal=color_emp)

    nombre = f"Reporte_Cobranza_{d}_{h}.{formato}"
    filtros = {"cliente": cliente, "estado": estado}
    _guardar_historial(db, "cobranza", label, d, h, formato, filtros, contenido, nombre)
    return _responder(contenido, formato, nombre)


# ══════════════════════════════════════════════════════════════════════════
# Reporte de Flujo de Caja
# ══════════════════════════════════════════════════════════════════════════

@router.get("/flujo-caja")
def reporte_flujo_caja(
    periodo: str = "mes", desde: Optional[date] = None, hasta: Optional[date] = None,
    formato: str = "xlsx", cuenta_bancaria_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    d, h, label = svc.resolver_periodo(periodo, desde, hasta)
    formato = _resolver_formato(formato)
    empresa_header = get_empresa_header(db)
    color_emp = empresa_header["color_principal"]
    filas = svc.datos_flujo_caja(db, d, h, cuenta_bancaria_id)

    headers = ["Fecha", "Descripción", "Tipo", "Cliente/Proveedor", "N° Documento",
               "Categoría", "Monto", "Saldo Acumulado"]

    if formato == "pdf":
        pdf_filas = [[
            _fd(f["fecha"]), _s(f["descripcion"]), _s(f["tipo"]), _s(f["cliente_proveedor"]),
            _s(f["numero_documento"]), _s(f["categoria"]), _fm(f["monto"]), _fm(f["saldo_acumulado"]),
        ] for f in filas]
        contenido = exp.construir_pdf(TIPO_LABEL["flujo_caja"], label, headers, pdf_filas,
                                      empresa=empresa_header, color_principal=color_emp)
    else:
        rows = [[
            str(f["fecha"]), f["descripcion"], f["tipo"], f["cliente_proveedor"],
            f["numero_documento"], f["categoria"], f["monto"], f["saldo_acumulado"],
        ] for f in filas]
        contenido = exp.construir_excel([{
            "titulo": "Flujo de Caja", "headers": headers,
            "widths": [12, 34, 10, 26, 16, 20, 14, 16],
            "rows": rows, "money_cols": {7, 8},
        }], color_principal=color_emp)

    nombre = f"Reporte_FlujoCaja_{d}_{h}.{formato}"
    filtros = {"cuenta_bancaria_id": cuenta_bancaria_id}
    _guardar_historial(db, "flujo_caja", label, d, h, formato, filtros, contenido, nombre)
    return _responder(contenido, formato, nombre)


# ══════════════════════════════════════════════════════════════════════════
# Reporte de Proveedores
# ══════════════════════════════════════════════════════════════════════════

@router.get("/proveedores")
def reporte_proveedores(
    periodo: str = "mes", desde: Optional[date] = None, hasta: Optional[date] = None,
    formato: str = "xlsx", proveedor: Optional[str] = None, estado_pago: Optional[str] = None,
    db: Session = Depends(get_db),
):
    d, h, label = svc.resolver_periodo(periodo, desde, hasta)
    formato = _resolver_formato(formato)
    empresa_header = get_empresa_header(db)
    color_emp = empresa_header["color_principal"]
    filas = svc.datos_proveedores(db, d, h, proveedor, estado_pago)

    headers = ["Proveedor", "RUC", "Categoría", "Descripción", "N° Comprobante",
               "Fecha", "Monto", "Saldo Pendiente", "Estado"]

    if formato == "pdf":
        pdf_filas = [[
            _s(f["proveedor"]), _s(f["ruc"]), _s(f["categoria"]), _s(f["descripcion"]),
            _s(f["numero_comprobante"]), _fd(f["fecha"]), _fm(f["monto"]), _fm(f["saldo_pendiente"]), _s(f["estado"]),
        ] for f in filas]
        contenido = exp.construir_pdf(TIPO_LABEL["proveedores"], label, headers, pdf_filas,
                                      empresa=empresa_header, color_principal=color_emp)
    else:
        rows = [[
            f["proveedor"], f["ruc"], f["categoria"], f["descripcion"], f["numero_comprobante"],
            str(f["fecha"]), f["monto"], f["saldo_pendiente"], f["estado"],
        ] for f in filas]
        contenido = exp.construir_excel([{
            "titulo": "Proveedores", "headers": headers,
            "widths": [26, 14, 20, 30, 16, 12, 14, 16, 14],
            "rows": rows, "money_cols": {7, 8},
        }], color_principal=color_emp)

    nombre = f"Reporte_Proveedores_{d}_{h}.{formato}"
    filtros = {"proveedor": proveedor, "estado_pago": estado_pago}
    _guardar_historial(db, "proveedores", label, d, h, formato, filtros, contenido, nombre)
    return _responder(contenido, formato, nombre)


# ══════════════════════════════════════════════════════════════════════════
# Historial
# ══════════════════════════════════════════════════════════════════════════

def _serialize_historial(r: ReporteGenerado) -> dict:
    return {
        "id":             r.id,
        "tipo":           r.tipo,
        "tipo_label":     TIPO_LABEL.get(r.tipo, r.tipo),
        "periodo_label":  r.periodo_label,
        "formato":        r.formato,
        "archivo_nombre": r.archivo_nombre,
        "created_at":     str(r.created_at) if r.created_at else None,
    }


@router.get("/historial")
def historial(db: Session = Depends(get_db)):
    rows = db.query(ReporteGenerado).order_by(ReporteGenerado.id.desc()).limit(5).all()
    return {"data": [_serialize_historial(r) for r in rows]}


@router.get("/{id}/descargar")
def descargar_historial(id: int, db: Session = Depends(get_db)):
    reg = db.query(ReporteGenerado).filter(ReporteGenerado.id == id).first()
    if not reg:
        raise HTTPException(404, "Reporte no encontrado")
    ruta = Path(reg.archivo_path)
    if not ruta.exists():
        raise HTTPException(404, "El archivo del reporte ya no está disponible")
    contenido = ruta.read_bytes()
    return _responder(contenido, reg.formato, reg.archivo_nombre)
