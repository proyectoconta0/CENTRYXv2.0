from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db
from app.models.comercial import VentaComercial, PagoCobranza, OrdenCobro, OrdenCobroDetalle, CuentaBancaria
from app.models.models import Cliente, Usuario, MovimientoCaja, Garantia
from app.core.security import get_current_usuario
from app.routers.garantias import revertir_cobro_garantia
from app.services.conciliacion_service import limpiar_movimiento_sistema_por_pago
from app.services.auditoria_service import registrar_log, ip_de
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import io

router = APIRouter()

TIPOS_COBRANZA = ["Factura", "Boleta de Venta", "Recibo Interno"]

# metodo_pago que ejecutar_garantia/aplicar_credito (garantias.py) usan para
# los PagoCobranza que generan — se usa acá solo para derivar un flag de
# presentación (pagado_con_garantia). No reemplaza estado_cobranza (que
# sigue siendo Pendiente/Pago Parcial/Pagada de siempre): ese campo se
# compara con igualdad exacta en semáforo, resumen y morosidad, así que
# introducir un valor nuevo ahí (p.ej. "aplicado_garantia") haría que una
# venta ya cobrada se siga contando como deuda pendiente en esos cálculos.
METODOS_GARANTIA = ("Ejecución de Garantía", "Crédito por Garantía")

TOLERANCIA_REDONDEO = 5.00  # S/ 5.00 máximo de diferencia entre lo cobrado y el saldo


def _semaforo(vc: VentaComercial) -> str:
    if vc.estado_cobranza == "Pagada":
        return "pagada"
    hoy = date.today()
    if not vc.fecha_vencimiento:
        return "verde"
    dias = (hoy - vc.fecha_vencimiento).days
    if dias <= 0:
        return "verde"
    elif dias <= 15:
        return "amarillo"
    else:
        return "rojo"


def _serialize(vc: VentaComercial, cli: Cliente = None, pagado_con_garantia: bool = False) -> dict:
    nombre = (cli.razon_social if cli else None) or vc.razon_social_cliente or "—"
    ruc    = (cli.ruc          if cli else None) or vc.ruc_cliente           or "—"
    hoy = date.today()
    dias_vencido = 0
    if vc.fecha_vencimiento:
        dias_vencido = max(0, (hoy - vc.fecha_vencimiento).days)

    saldo = vc.saldo_pendiente
    if saldo is None:
        saldo = vc.precio_venta or vc.monto or 0

    return {
        "id":               vc.id,
        "tipo_documento":   vc.tipo_documento or "Factura",
        "numero_documento": vc.numero_factura,
        "cliente_id":       vc.cliente_id,
        "cliente_nombre":   nombre,
        "ruc_cliente":      ruc,
        "monto_total":      vc.precio_venta or vc.monto,
        "fecha_emision":    vc.fecha,
        "fecha_vencimiento":vc.fecha_vencimiento,
        "saldo_pendiente":  round(float(saldo), 2),
        "estado_cobranza":  vc.estado_cobranza or "Pendiente",
        "semaforo":         _semaforo(vc),
        "dias_vencido":     dias_vencido,
        # True si algún cobro de esta venta vino de ejecutar una garantía o
        # aplicar un crédito de garantía — el frontend lo usa para mostrar el
        # badge "💎 Aplicado/Parcial c/Garantía" encima del estado normal.
        "pagado_con_garantia": pagado_con_garantia,
    }


@router.get("")
def listar_cobranza(
    semaforo: str = "",
    search: str = "",
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
):
    q = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado != "Anulada",
    )

    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            VentaComercial.numero_factura.ilike(like),
            VentaComercial.razon_social_cliente.ilike(like),
            Cliente.razon_social.ilike(like),
        ))

    all_rows = q.order_by(VentaComercial.fecha.desc()).all()

    venta_ids = [vc.id for vc, _ in all_rows]
    ids_con_garantia = set()
    if venta_ids:
        ids_con_garantia = {
            r[0] for r in db.query(PagoCobranza.comprobante_id).filter(
                PagoCobranza.comprobante_id.in_(venta_ids),
                PagoCobranza.metodo_pago.in_(METODOS_GARANTIA),
            ).distinct().all()
        }

    if semaforo == "garantia_completo":
        all_rows = [(vc, cli) for vc, cli in all_rows if vc.id in ids_con_garantia and vc.estado_cobranza == "Pagada"]
    elif semaforo == "garantia_parcial":
        all_rows = [(vc, cli) for vc, cli in all_rows if vc.id in ids_con_garantia and vc.estado_cobranza != "Pagada"]
    elif semaforo:
        all_rows = [(vc, cli) for vc, cli in all_rows if _semaforo(vc) == semaforo]

    total = len(all_rows)
    offset = (page - 1) * per_page
    page_rows = all_rows[offset:offset + per_page]

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "data":     [_serialize(vc, cli, vc.id in ids_con_garantia) for vc, cli in page_rows],
    }


@router.get("/resumen")
def resumen_cobranza(db: Session = Depends(get_db)):
    all_rows = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
    ).all()

    total_pendiente = 0.0
    al_dia          = 0.0
    por_vencer_15   = 0.0
    vencido_mas_15  = 0.0
    clientes_deuda: dict = {}

    for vc, cli in all_rows:
        if vc.estado_cobranza == "Pagada" or vc.estado == "Anulada":
            continue
        saldo = float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else float(vc.precio_venta or vc.monto or 0)
        total_pendiente += saldo

        s = _semaforo(vc)
        if s == "verde":
            al_dia += saldo
        elif s == "amarillo":
            por_vencer_15 += saldo
        elif s == "rojo":
            vencido_mas_15 += saldo

        nombre = (cli.razon_social if cli else None) or vc.razon_social_cliente or "—"
        key = str(vc.cliente_id) if vc.cliente_id else f"anon_{vc.ruc_cliente}"
        if key not in clientes_deuda:
            clientes_deuda[key] = {"nombre": nombre, "total": 0.0}
        clientes_deuda[key]["total"] += saldo

    mayor_deudor = None
    if clientes_deuda:
        best = max(clientes_deuda, key=lambda k: clientes_deuda[k]["total"])
        mayor_deudor = {
            "nombre": clientes_deuda[best]["nombre"],
            "total":  round(clientes_deuda[best]["total"], 2),
        }

    return {
        "total_pendiente": round(total_pendiente, 2),
        "al_dia":          round(al_dia, 2),
        "por_vencer_15":   round(por_vencer_15, 2),
        "vencido_mas_15":  round(vencido_mas_15, 2),
        "mayor_deudor":    mayor_deudor,
    }


@router.get("/morosidad-por-cliente")
def morosidad_por_cliente(db: Session = Depends(get_db)):
    hoy = date.today()
    all_rows = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.estado != "Anulada",
    ).all()

    clientes: dict = {}
    sem_order = {"verde": 0, "amarillo": 1, "rojo": 2}

    for vc, cli in all_rows:
        nombre = (cli.razon_social if cli else None) or vc.razon_social_cliente or "—"
        ruc    = (cli.ruc          if cli else None) or vc.ruc_cliente           or "—"
        key = str(vc.cliente_id) if vc.cliente_id else f"anon_{vc.ruc_cliente}"

        if key not in clientes:
            clientes[key] = {
                "cliente_nombre":       nombre,
                "ruc":                  ruc,
                "facturas_pendientes":  0,
                "monto_total":          0.0,
                "dias_mora_max":        0,
                "semaforo":             "verde",
            }

        saldo = float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else float(vc.precio_venta or vc.monto or 0)
        clientes[key]["facturas_pendientes"] += 1
        clientes[key]["monto_total"] += saldo

        if vc.fecha_vencimiento:
            dias = (hoy - vc.fecha_vencimiento).days
            if dias > clientes[key]["dias_mora_max"]:
                clientes[key]["dias_mora_max"] = dias

        s = _semaforo(vc)
        if sem_order.get(s, 0) > sem_order.get(clientes[key]["semaforo"], 0):
            clientes[key]["semaforo"] = s

    result = list(clientes.values())
    result.sort(key=lambda x: x["monto_total"], reverse=True)
    for r in result:
        r["monto_total"]    = round(r["monto_total"], 2)
        r["dias_mora_max"]  = max(0, r["dias_mora_max"])

    return result


# ─── Lista de Cobros: todos los cobros ya registrados ───────────────────────
# Fusiona PagoCobranza (cobros individuales de "Registrar Cobro" en Cuentas
# por Cobrar) y OrdenCobroDetalle (cobros consolidados en una Orden de Cobro)
# en una sola lista — mismo patrón que "Lista de Pagos" en Gastos (GET
# /gastos/pagos), que fusiona PagoGasto + LoteDetraccion + OrdenPago.

@router.get("/pagos")
def listar_pagos_cobranza(
    desde:       Optional[date] = None,
    hasta:       Optional[date] = None,
    cliente:     str            = "",
    metodo_pago: str            = "",
    db: Session = Depends(get_db),
):
    resultado = []

    q1 = db.query(PagoCobranza, VentaComercial, Cliente).join(
        VentaComercial, PagoCobranza.comprobante_id == VentaComercial.id
    ).outerjoin(Cliente, VentaComercial.cliente_id == Cliente.id)
    if desde: q1 = q1.filter(PagoCobranza.fecha_pago >= desde)
    if hasta: q1 = q1.filter(PagoCobranza.fecha_pago <= hasta)
    if metodo_pago: q1 = q1.filter(PagoCobranza.metodo_pago == metodo_pago)
    if cliente:
        like = f"%{cliente}%"
        q1 = q1.filter(or_(
            VentaComercial.razon_social_cliente.ilike(like),
            VentaComercial.ruc_cliente.ilike(like),
            Cliente.razon_social.ilike(like),
        ))
    for pago, vc, cli in q1.all():
        nombre = (cli.razon_social if cli else None) or vc.razon_social_cliente or "—"
        resultado.append({
            "tipo":             "pago",
            "id":               pago.id,
            "fecha_cobro":      str(pago.fecha_pago),
            "numero_documento": vc.numero_factura,
            "cliente_nombre":   nombre,
            "descripcion":      vc.descripcion or "",
            "monto_cobrado":    round(float(pago.monto_pagado), 2),
            "metodo_cobro":     pago.metodo_pago,
            "numero_cuenta":    pago.numero_cuenta,
            "banco":            pago.banco,
            "numero_operacion": None,  # PagoCobranza no tiene este campo (solo numero_cheque)
            "creado_por":       pago.creado_por,
            "creado_en":        pago.creado_en.strftime("%d/%m/%Y %H:%M") if pago.creado_en else None,
            "estado":           vc.estado_cobranza or "Pendiente",
            "extornado":        bool(pago.extornado),
            "fecha_extorno":    pago.fecha_extorno.strftime("%d/%m/%Y") if pago.fecha_extorno else None,
            "motivo_extorno":   pago.motivo_extorno,
        })

    q2 = db.query(OrdenCobroDetalle, OrdenCobro, VentaComercial).join(
        OrdenCobro, OrdenCobroDetalle.orden_id == OrdenCobro.id
    ).outerjoin(VentaComercial, OrdenCobroDetalle.venta_id == VentaComercial.id)
    if desde: q2 = q2.filter(OrdenCobro.fecha_cobro >= desde)
    if hasta: q2 = q2.filter(OrdenCobro.fecha_cobro <= hasta)
    if metodo_pago: q2 = q2.filter(OrdenCobro.metodo_cobro == metodo_pago)
    if cliente:
        like = f"%{cliente}%"
        q2 = q2.filter(or_(
            OrdenCobro.nombre_cliente.ilike(like),
            OrdenCobro.ruc_cliente.ilike(like),
        ))
    for det, orden, vc in q2.all():
        nombre = (vc.razon_social_cliente if vc else None) or orden.nombre_cliente or "—"
        resultado.append({
            "tipo":             "orden_cobro",
            "id":               det.id,
            "orden_id":         orden.id,
            "numero_orden":     orden.numero_orden,
            "fecha_cobro":      str(orden.fecha_cobro),
            "numero_documento": vc.numero_factura if vc else None,
            "cliente_nombre":   nombre,
            # Fijo para toda orden de cobro (igual que "ORDEN DE PAGO" en la
            # Lista de Pagos de Gastos) — no depende del comprobante incluido.
            "descripcion":      "ORDEN DE COBRANZA",
            "monto_cobrado":    round(float(det.monto_cobrado), 2),
            "metodo_cobro":     orden.metodo_cobro,
            "numero_cuenta":    orden.numero_cuenta,
            "banco":            orden.banco,
            "numero_operacion": orden.numero_operacion,
            "creado_por":       None,  # OrdenCobro no registra quién la creó
            "creado_en":        str(orden.created_at) if orden.created_at else None,
            "estado":           (vc.estado_cobranza if vc else None) or "Pagada",
        })

    # Garantías retenidas: el depósito recibido al crear la garantía también
    # es un cobro real, pero no genera un PagoCobranza (no está atado a
    # ningún comprobante — comprobante_id es NOT NULL en esa tabla). Se
    # agrega como tercera fuente, mismo patrón que las dos anteriores.
    q3 = db.query(Garantia, CuentaBancaria).outerjoin(
        CuentaBancaria, Garantia.cuenta_bancaria_id == CuentaBancaria.id
    )
    if desde: q3 = q3.filter(Garantia.fecha_cobro >= desde)
    if hasta: q3 = q3.filter(Garantia.fecha_cobro <= hasta)
    if metodo_pago: q3 = q3.filter(Garantia.metodo_cobro == metodo_pago)
    if cliente:
        like = f"%{cliente}%"
        q3 = q3.filter(or_(
            Garantia.cliente_nombre.ilike(like),
            Garantia.cliente_ruc.ilike(like),
        ))
    for g, cb in q3.all():
        resultado.append({
            "tipo":             "cobro_garantia",
            "id":               g.id,
            "fecha_cobro":      str(g.fecha_cobro),
            "numero_documento": g.numero_documento,
            "cliente_nombre":   g.cliente_nombre,
            "descripcion":      "GARANTÍA RETENIDA",
            "monto_cobrado":    round(float(g.monto), 2),
            "metodo_cobro":     g.metodo_cobro,
            "numero_cuenta":    cb.numero_cuenta if cb else None,
            "banco":            cb.banco if cb else None,
            "numero_operacion": None,  # Garantia no tiene este campo
            "creado_por":       g.creado_por,
            "creado_en":        g.creado_en.strftime("%d/%m/%Y %H:%M") if g.creado_en else None,
            "estado":           g.estado,
            "extornado":        False,
        })

    resultado.sort(key=lambda r: (r["fecha_cobro"] or "", r["id"]), reverse=True)
    return resultado


# ─── Helpers de cobranza ─────────────────────────────────────────────────────

def _recalcular_cobranza(db: Session, vc: VentaComercial):
    pagos = db.query(PagoCobranza).filter(PagoCobranza.comprobante_id == vc.id).all()
    total_pagado = sum(float(p.monto_pagado) for p in pagos)
    monto_total  = float(vc.precio_venta or vc.monto or 0)
    nuevo_saldo  = round(monto_total - total_pagado, 2)
    if nuevo_saldo <= 0.01:
        vc.saldo_pendiente = 0.0
        vc.estado_cobranza = "Pagada"
    elif total_pagado > 0:
        vc.saldo_pendiente = nuevo_saldo
        vc.estado_cobranza = "Pago Parcial"
    else:
        vc.saldo_pendiente = monto_total
        vc.estado_cobranza = "Pendiente"


# ─── Registrar pago ──────────────────────────────────────────────────────────

class PagoCreate(BaseModel):
    monto_pagado:   float
    fecha_pago:     date
    metodo_pago:    str
    banco:          Optional[str] = None
    numero_cuenta:  Optional[str] = None
    numero_cheque:  Optional[str] = None


class PagoUpdate(BaseModel):
    monto_pagado:   float
    fecha_pago:     date
    metodo_pago:    str
    banco:          Optional[str] = None
    numero_cuenta:  Optional[str] = None
    numero_cheque:  Optional[str] = None


@router.post("/{comprobante_id}/pago")
def registrar_pago(comprobante_id: int, data: PagoCreate, http_request: Request, db: Session = Depends(get_db),
                    usuario: Usuario = Depends(get_current_usuario)):
    vc = db.query(VentaComercial).filter(VentaComercial.id == comprobante_id).first()
    if not vc:
        raise HTTPException(404, "Comprobante no encontrado")
    if (vc.tipo_documento or "") not in TIPOS_COBRANZA:
        raise HTTPException(400, "Solo se pueden registrar pagos para Facturas y Boletas de Venta")
    if vc.estado_cobranza == "Pagada":
        raise HTTPException(400, "El comprobante ya está totalmente pagado")

    saldo_actual = float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else float(vc.precio_venta or vc.monto or 0)

    if data.monto_pagado <= 0:
        raise HTTPException(400, "El monto a pagar debe ser mayor a 0")

    # Diferencia entre lo cobrado y el saldo: positiva = cliente pagó de más
    # (redondeo "ganancia"), negativa = pagó de menos (redondeo "pérdida").
    # Dentro de la tolerancia, la deuda se cierra igual y la diferencia queda
    # registrada en el pago como redondeo; fuera de tolerancia, sigue el
    # comportamiento normal (pago parcial, o error si excede el saldo).
    diferencia = round(data.monto_pagado - saldo_actual, 2)
    if diferencia > TOLERANCIA_REDONDEO + 0.01:
        raise HTTPException(400, f"El monto ({data.monto_pagado:.2f}) excede el saldo pendiente ({saldo_actual:.2f})")

    redondeo_tipo  = None
    redondeo_monto = 0.0
    if abs(diferencia) <= TOLERANCIA_REDONDEO + 0.01:
        nuevo_saldo = 0.0
        nuevo_estado = "Pagada"
        if diferencia > 0.01:
            redondeo_tipo  = "ganancia"
            redondeo_monto = diferencia
        elif diferencia < -0.01:
            redondeo_tipo  = "perdida"
            redondeo_monto = abs(diferencia)
    else:
        # Pago parcial normal (diferencia negativa, fuera de tolerancia)
        nuevo_saldo  = round(saldo_actual - data.monto_pagado, 2)
        nuevo_estado = "Pago Parcial"

    pago = PagoCobranza(
        comprobante_id = comprobante_id,
        monto_pagado   = round(data.monto_pagado, 2),
        fecha_pago     = data.fecha_pago,
        metodo_pago    = data.metodo_pago,
        banco          = data.banco or None,
        numero_cuenta  = data.numero_cuenta or None,
        numero_cheque  = data.numero_cheque or None,
        created_at     = date.today(),
        creado_por     = usuario.nombre,
        creado_en      = datetime.utcnow(),
        metodo_creacion = "Manual",
        redondeo_tipo  = redondeo_tipo,
        redondeo_monto = round(redondeo_monto, 2),
    )
    db.add(pago)

    vc.saldo_pendiente = nuevo_saldo
    vc.estado_cobranza = nuevo_estado

    db.commit()
    db.refresh(vc)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Registró cobro",
        f"Registró cobro S/ {pago.monto_pagado:,.2f} en factura {vc.numero_factura}",
        ip_de(http_request),
    )

    return {
        "mensaje":         "Pago registrado correctamente",
        "saldo_pendiente": vc.saldo_pendiente,
        "estado_cobranza": vc.estado_cobranza,
        "redondeo_tipo":   pago.redondeo_tipo,
        "redondeo_monto":  pago.redondeo_monto,
    }


@router.get("/exportar")
def exportar_cobranza(
    desde:      Optional[date] = None,
    hasta:      Optional[date] = None,
    cliente_id: Optional[int]  = None,
    db: Session = Depends(get_db),
):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise HTTPException(500, "Librería openpyxl no instalada. Ejecute: pip install openpyxl")

    q = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(VentaComercial.tipo_documento.in_(TIPOS_COBRANZA))

    if desde:
        q = q.filter(VentaComercial.fecha >= desde)
    if hasta:
        q = q.filter(VentaComercial.fecha <= hasta)
    if cliente_id:
        q = q.filter(VentaComercial.cliente_id == cliente_id)

    rows = q.order_by(VentaComercial.fecha.desc()).all()
    hoy_dt = date.today()

    wb = Workbook()
    ws = wb.active
    ws.title = "Cuentas por Cobrar"

    header_font  = Font(bold=True, color="FFFFFF")
    header_fill  = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center")
    alt_fill     = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")

    HEADERS = [
        "N° Documento", "Cliente", "RUC", "Tipo de Servicio",
        "Monto (S/)", "Fecha Emisión", "Fecha Vencimiento",
        "Saldo Pendiente (S/)", "Estado", "Días de Mora", "Redondeo (S/)",
    ]
    COL_WIDTHS = [18, 30, 15, 22, 14, 16, 18, 22, 14, 14, 14]

    for col_idx, (header, width) in enumerate(zip(HEADERS, COL_WIDTHS), start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font    = header_font
        cell.fill    = header_fill
        cell.alignment = header_align
        ws.column_dimensions[cell.column_letter].width = width
    ws.row_dimensions[1].height = 20

    for row_idx, (vc, cli) in enumerate(rows, start=2):
        nombre = (cli.razon_social if cli else None) or vc.razon_social_cliente or "—"
        ruc    = (cli.ruc          if cli else None) or vc.ruc_cliente           or "—"
        monto  = float(vc.precio_venta or vc.monto or 0)
        saldo  = float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else monto
        estado = vc.estado_cobranza or "Pendiente"
        dias_mora = 0
        if vc.fecha_vencimiento and estado != "Pagada":
            dias_mora = max(0, (hoy_dt - vc.fecha_vencimiento).days)

        # Redondeo neto de todos los pagos del comprobante: positivo si el
        # cliente pagó de más en total (ganancia), negativo si pagó de menos.
        redondeo_neto = sum(
            (p.redondeo_monto or 0) if p.redondeo_tipo == "ganancia"
            else -(p.redondeo_monto or 0) if p.redondeo_tipo == "perdida"
            else 0
            for p in vc.pagos
        )

        ws.append([
            vc.numero_factura or "—",
            nombre,
            ruc,
            vc.tipo_servicio or "—",
            round(monto, 2),
            str(vc.fecha)             if vc.fecha             else "—",
            str(vc.fecha_vencimiento) if vc.fecha_vencimiento else "—",
            round(saldo, 2),
            estado,
            dias_mora,
            round(redondeo_neto, 2) if redondeo_neto else "—",
        ])

        if row_idx % 2 == 0:
            for col_idx in range(1, len(HEADERS) + 1):
                ws.cell(row=row_idx, column=col_idx).fill = alt_fill

    ws.freeze_panes = "A2"

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"Reporte_Cuentas_Por_Cobrar_{hoy_dt.strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.put("/pagos/{pago_id}")
def editar_pago(pago_id: int, data: PagoUpdate, db: Session = Depends(get_db),
                 usuario: Usuario = Depends(get_current_usuario)):
    pago = db.query(PagoCobranza).filter(PagoCobranza.id == pago_id).first()
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    vc = db.query(VentaComercial).filter(VentaComercial.id == pago.comprobante_id).first()
    if not vc:
        raise HTTPException(404, "Comprobante no encontrado")
    if data.monto_pagado <= 0:
        raise HTTPException(400, "El monto debe ser mayor a 0")

    pago.monto_pagado  = round(data.monto_pagado, 2)
    pago.fecha_pago    = data.fecha_pago
    pago.metodo_pago   = data.metodo_pago
    pago.banco         = data.banco or None
    pago.numero_cuenta = data.numero_cuenta or None
    pago.numero_cheque = data.numero_cheque or None
    pago.modificado_por = usuario.nombre
    pago.modificado_en  = datetime.utcnow()
    db.flush()

    _recalcular_cobranza(db, vc)
    db.commit()
    db.refresh(vc)
    return {
        "mensaje":         "Pago actualizado correctamente",
        "saldo_pendiente": vc.saldo_pendiente,
        "estado_cobranza": vc.estado_cobranza,
    }


@router.delete("/pagos/{pago_id}")
def eliminar_pago(pago_id: int, db: Session = Depends(get_db)):
    pago = db.query(PagoCobranza).filter(PagoCobranza.id == pago_id).first()
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    vc = db.query(VentaComercial).filter(VentaComercial.id == pago.comprobante_id).first()
    if not vc:
        raise HTTPException(404, "Comprobante no encontrado")

    # Si este cobro vino de ejecutar una garantía (o de aplicar un crédito
    # generado por una) hay que devolverle el monto a la garantía/crédito de
    # origen — si no, al eliminarlo acá se pierde para siempre (ver
    # revertir_cobro_garantia en garantias.py).
    revertir_cobro_garantia(db, pago)

    limpiar_movimiento_sistema_por_pago(db, "cobranza", pago.id)
    db.delete(pago)
    db.flush()

    _recalcular_cobranza(db, vc)
    db.commit()
    db.refresh(vc)
    return {
        "mensaje":         "Pago eliminado correctamente",
        "saldo_pendiente": vc.saldo_pendiente,
        "estado_cobranza": vc.estado_cobranza,
    }


# ─── Extorno bancario ───────────────────────────────────────────────────────

class ExtornarRequest(BaseModel):
    motivo: str


@router.put("/pagos/{pago_id}/extornar")
def extornar_pago(pago_id: int, data: ExtornarRequest, http_request: Request,
                   db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    pago = db.query(PagoCobranza).filter(PagoCobranza.id == pago_id).first()
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    if pago.extornado:
        raise HTTPException(400, "Este pago ya fue extornado")
    if not data.motivo or not data.motivo.strip():
        raise HTTPException(400, "El motivo del extorno es obligatorio")

    vc = db.query(VentaComercial).filter(VentaComercial.id == pago.comprobante_id).first()
    if not vc:
        raise HTTPException(404, "Comprobante no encontrado")

    motivo = data.motivo.strip()

    # 1. Marcar pago como extornado
    pago.extornado      = True
    pago.fecha_extorno  = datetime.utcnow()
    pago.motivo_extorno = motivo
    pago.extornado_por  = usuario.nombre

    # 2. Restaurar saldo pendiente de la factura
    precio_total = float(vc.precio_venta or vc.monto or 0)
    nuevo_saldo  = round((vc.saldo_pendiente or 0) + float(pago.monto_pagado), 2)
    vc.saldo_pendiente = nuevo_saldo

    # 3. Actualizar estado de cobranza
    if nuevo_saldo >= precio_total - 0.01:
        vc.estado_cobranza = "Pendiente"
    else:
        vc.estado_cobranza = "Pago Parcial"

    # Si el pago estaba conciliado con el banco, deja de representar algo
    # real — mismo tratamiento que al eliminar un pago (ver eliminar_pago).
    limpiar_movimiento_sistema_por_pago(db, "cobranza", pago.id)

    # 4. Registrar salida en Flujo de Caja
    movimiento = MovimientoCaja(
        fecha       = date.today(),
        tipo        = "salida",
        categoria   = "Extorno bancario",
        descripcion = f"Extorno de cobro — {vc.numero_factura} — {motivo}",
        monto       = float(pago.monto_pagado),
        creado_por  = usuario.nombre,
        creado_en   = datetime.utcnow(),
    )
    db.add(movimiento)

    db.commit()
    db.refresh(vc)
    db.refresh(pago)

    registrar_log(
        db, usuario.id, usuario.nombre, "cobranza", "Extornó cobro",
        f"Extornó cobro S/ {pago.monto_pagado:,.2f} de la factura {vc.numero_factura} — {motivo}",
        ip_de(http_request),
    )

    return {
        "mensaje":         "Pago extornado correctamente",
        "saldo_pendiente": vc.saldo_pendiente,
        "estado_cobranza": vc.estado_cobranza,
        "extornado":       pago.extornado,
        "fecha_extorno":   pago.fecha_extorno.strftime("%d/%m/%Y %H:%M"),
        "extornado_por":   pago.extornado_por,
        "motivo_extorno":  pago.motivo_extorno,
    }


@router.get("/{comprobante_id}/historial-pagos")
def historial_pagos(comprobante_id: int, db: Session = Depends(get_db)):
    vc = db.query(VentaComercial).filter(VentaComercial.id == comprobante_id).first()
    if not vc:
        raise HTTPException(404, "Comprobante no encontrado")

    pagos = db.query(PagoCobranza).filter(
        PagoCobranza.comprobante_id == comprobante_id
    ).order_by(PagoCobranza.fecha_pago.asc()).all()

    return [
        {
            "id":            p.id,
            "monto_pagado":  p.monto_pagado,
            "fecha_pago":    p.fecha_pago,
            "metodo_pago":   p.metodo_pago,
            "banco":         p.banco,
            "numero_cuenta": p.numero_cuenta,
            "numero_cheque": p.numero_cheque,
            "created_at":    p.created_at,
            "creado_por":      p.creado_por,
            "creado_en":       p.creado_en.strftime("%d/%m/%Y %H:%M") if p.creado_en else None,
            "modificado_por":  p.modificado_por,
            "modificado_en":   p.modificado_en.strftime("%d/%m/%Y %H:%M") if p.modificado_en else None,
            "metodo_creacion": p.metodo_creacion or "Manual",
            "redondeo_tipo":   p.redondeo_tipo,
            "redondeo_monto":  round(float(p.redondeo_monto), 2) if p.redondeo_monto else 0,
            "extornado":       bool(p.extornado),
            "fecha_extorno":   p.fecha_extorno.strftime("%d/%m/%Y %H:%M") if p.fecha_extorno else None,
            "motivo_extorno":  p.motivo_extorno,
            "extornado_por":   p.extornado_por,
        }
        for p in pagos
    ]
