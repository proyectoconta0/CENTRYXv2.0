"""
Módulo de Reportes.
Consultas de datos (reutilizan las mismas tablas reales que Indicadores,
Gastos/CPP, Cobranza y Flujo de Caja) + construcción de Excel (openpyxl) y
PDF (reportlab) para cada tipo de reporte.
"""
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Gasto, PagoGasto
from app.models.comercial import VentaComercial, PagoCobranza, CuentaBancaria
from app.services import indicadores_service as ind_svc

TIPOS_VENTA    = ["Factura", "Boleta de Venta"]
TIPOS_COBRANZA = ["Factura", "Boleta de Venta"]

EMPRESA_NOMBRE = "ElectroPro SAC"

MESES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


# ── Resolución de período ─────────────────────────────────────────────────────

def resolver_periodo(periodo: str, desde: Optional[date], hasta: Optional[date]) -> tuple:
    """Devuelve (desde, hasta, label) según el período elegido en el panel."""
    hoy = date.today()

    if periodo == "personalizado" and desde and hasta:
        label = f"{desde.strftime('%d/%m/%Y')} al {hasta.strftime('%d/%m/%Y')}"
        return desde, hasta, label

    if periodo == "mes_anterior":
        primer_dia_actual = hoy.replace(day=1)
        hasta_ = primer_dia_actual - timedelta(days=1)
        desde_ = hasta_.replace(day=1)
        return desde_, hasta_, f"{MESES_ES[desde_.month]} {desde_.year}"

    if periodo == "trimestre":
        mes_inicio_trim = ((hoy.month - 1) // 3) * 3 + 1
        desde_ = date(hoy.year, mes_inicio_trim, 1)
        return desde_, hoy, f"Trimestre {((hoy.month - 1) // 3) + 1} {hoy.year}"

    if periodo == "año":
        desde_ = date(hoy.year, 1, 1)
        return desde_, hoy, f"Año {hoy.year}"

    # "mes" (default)
    desde_ = hoy.replace(day=1)
    return desde_, hoy, f"{MESES_ES[hoy.month]} {hoy.year}"


# ── Datos: Ventas ──────────────────────────────────────────────────────────────

def datos_ventas(db: Session, desde: date, hasta: date, cliente: Optional[str] = None,
                  tipo_servicio: Optional[str] = None, tipo_documento: Optional[str] = None,
                  empresa_id: Optional[int] = None) -> list:
    q = db.query(VentaComercial).filter(
        VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
    )
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    if cliente:
        q = q.filter(VentaComercial.razon_social_cliente.ilike(f"%{cliente}%"))
    if tipo_servicio:
        q = q.filter(VentaComercial.tipo_servicio == tipo_servicio)
    if tipo_documento:
        q = q.filter(VentaComercial.tipo_documento == tipo_documento)
    rows = q.order_by(VentaComercial.fecha.desc()).all()

    filas = []
    for vc in rows:
        precio = float(vc.precio_venta_soles if vc.precio_venta_soles is not None
                        else (vc.precio_venta if vc.precio_venta is not None else (vc.monto or 0)))
        filas.append({
            "fecha":              vc.fecha,
            "numero_comprobante": vc.numero_factura or vc.documento_relacionado or "—",
            "tipo_documento":     vc.tipo_documento or "",
            "cliente":            vc.razon_social_cliente or (vc.cliente.razon_social if vc.cliente else "Cliente sin nombre"),
            "ruc":                vc.ruc_cliente or "",
            "tipo_servicio":      vc.tipo_servicio or "",
            "base_imponible":     round(float(vc.base_imponible), 2) if vc.base_imponible is not None else None,
            "igv":                round(float(vc.igv), 2) if vc.igv is not None else None,
            "precio_venta":       round(precio, 2),
            "moneda":             vc.moneda or "PEN",
            "estado_cobro":       vc.estado_cobranza or "Pagada",
        })
    return filas


# ── Datos: Gastos ──────────────────────────────────────────────────────────────

def datos_gastos(db: Session, desde: date, hasta: date, categoria: Optional[str] = None,
                  area: Optional[str] = None, tipo_comprobante: Optional[str] = None,
                  proveedor: Optional[str] = None, empresa_id: Optional[int] = None) -> list:
    q = db.query(Gasto).filter(Gasto.fecha >= desde, Gasto.fecha <= hasta)
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    if categoria:        q = q.filter(Gasto.categoria == categoria)
    if area:              q = q.filter(Gasto.area == area)
    if tipo_comprobante:  q = q.filter(Gasto.tipo_comprobante == tipo_comprobante)
    if proveedor:         q = q.filter(Gasto.proveedor.ilike(f"%{proveedor}%"))
    rows = q.order_by(Gasto.fecha.desc()).all()

    filas = []
    for g in rows:
        monto_soles = float(g.monto_soles if g.monto_soles is not None else (g.monto or 0))
        filas.append({
            "fecha":              g.fecha,
            "categoria":          g.categoria,
            "descripcion":        g.descripcion or "",
            "proveedor":          g.proveedor or "Proveedor sin nombre",
            "ruc":                g.numero_documento or "",
            "tipo_comprobante":   g.tipo_comprobante or "",
            "numero_comprobante": g.numero_comprobante or "",
            "moneda":             g.moneda or "PEN",
            "monto_original":     round(float(g.monto_original), 2) if g.monto_original is not None else round(float(g.monto or 0), 2),
            "tipo_cambio":        round(float(g.tipo_cambio), 4) if g.tipo_cambio is not None else None,
            "base_imponible":     round(float(g.base_imponible), 2) if g.base_imponible is not None else None,
            "igv":                round(float(g.igv), 2) if g.igv is not None else None,
            "monto_soles":        round(monto_soles, 2),
            "area":               g.area or "",
            "estado_pago":        g.estado_pago or "Pendiente",
        })
    return filas


# ── Datos: Cobranza ─────────────────────────────────────────────────────────────

def _semaforo_cobranza(vc: VentaComercial, hoy: date) -> str:
    if vc.estado_cobranza == "Pagada":
        return "Pagado"
    if not vc.fecha_vencimiento:
        return "Verde"
    dias = (hoy - vc.fecha_vencimiento).days
    if dias <= 0:
        return "Verde"
    elif dias <= 15:
        return "Amarillo"
    return "Rojo"


def datos_cobranza(db: Session, desde: date, hasta: date, cliente: Optional[str] = None,
                    estado: Optional[str] = None, empresa_id: Optional[int] = None) -> list:
    q = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
    )
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    if cliente:
        q = q.filter(VentaComercial.razon_social_cliente.ilike(f"%{cliente}%"))
    rows = q.order_by(VentaComercial.fecha.desc()).all()
    hoy = date.today()

    filas = []
    for vc in rows:
        monto_total = float(vc.precio_venta_soles if vc.precio_venta_soles is not None
                             else (vc.precio_venta if vc.precio_venta is not None else (vc.monto or 0)))
        saldo = float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else monto_total
        monto_pagado = round(monto_total - saldo, 2)
        dias_mora = max(0, (hoy - vc.fecha_vencimiento).days) if vc.fecha_vencimiento else 0

        if vc.estado == "Anulada":
            estado_txt = "Anulado"
        elif vc.estado_cobranza == "Pagada":
            estado_txt = "Pagado"
        elif dias_mora > 0:
            estado_txt = "Vencido"
        else:
            estado_txt = "Al día"

        if estado and estado != estado_txt:
            continue

        filas.append({
            "numero_comprobante": vc.numero_factura or "—",
            "cliente":            vc.razon_social_cliente or (vc.cliente.razon_social if vc.cliente else "Cliente sin nombre"),
            "ruc":                vc.ruc_cliente or "",
            "fecha_emision":      vc.fecha,
            "fecha_vencimiento":  vc.fecha_vencimiento,
            "monto_total":        round(monto_total, 2),
            "monto_pagado":       monto_pagado,
            "saldo_pendiente":    round(saldo, 2),
            "dias_mora":          dias_mora,
            "estado":             estado_txt,
            "semaforo":           _semaforo_cobranza(vc, hoy),
        })
    return filas


# ── Datos: Flujo de Caja ─────────────────────────────────────────────────────────

def datos_flujo_caja(db: Session, desde: date, hasta: date,
                     cuenta_bancaria_id: Optional[int] = None,
                     empresa_id: Optional[int] = None) -> list:
    cuenta = None
    if cuenta_bancaria_id:
        cuenta = db.query(CuentaBancaria).filter(CuentaBancaria.id == cuenta_bancaria_id).first()

    q_ing = db.query(PagoCobranza).filter(PagoCobranza.fecha_pago >= desde, PagoCobranza.fecha_pago <= hasta)
    q_egr = db.query(PagoGasto).filter(PagoGasto.fecha_pago >= desde, PagoGasto.fecha_pago <= hasta)

    if empresa_id is not None:
        q_ing = q_ing.filter(PagoCobranza.empresa_id == empresa_id)
        q_egr = q_egr.join(Gasto, PagoGasto.gasto_id == Gasto.id).filter(Gasto.empresa_id == empresa_id)

    if cuenta:
        q_ing = q_ing.filter(PagoCobranza.banco == cuenta.banco, PagoCobranza.numero_cuenta == cuenta.numero_cuenta)
        q_egr = q_egr.filter(PagoGasto.banco == cuenta.banco, PagoGasto.numero_cuenta == cuenta.numero_cuenta)

    movimientos = []
    for p in q_ing.all():
        venta = p.comprobante
        cliente = venta.razon_social_cliente if venta else None
        movimientos.append({
            "fecha":             p.fecha_pago,
            "descripcion":       f"Cobro a {cliente or 'cliente'}",
            "tipo":              "Ingreso",
            "cliente_proveedor": cliente or "",
            "numero_documento":  (venta.numero_factura if venta else "") or "",
            "categoria":         (venta.tipo_servicio if venta else "") or "Cobranza",
            "monto":             round(float(p.monto_pagado or 0), 2),
        })
    for p in q_egr.all():
        g = p.gasto
        proveedor = g.proveedor if g else None
        movimientos.append({
            "fecha":             p.fecha_pago,
            "descripcion":       (g.descripcion if g else None) or f"Pago a {proveedor or 'proveedor'}",
            "tipo":              "Egreso",
            "cliente_proveedor": proveedor or "",
            "numero_documento":  (g.numero_comprobante if g else "") or "",
            "categoria":         (g.categoria if g else "") or "",
            "monto":             round(float(p.monto_pagado or 0), 2),
        })

    movimientos.sort(key=lambda m: m["fecha"])
    saldo = 0.0
    for m in movimientos:
        signo = 1 if m["tipo"] == "Ingreso" else -1
        saldo = round(saldo + signo * m["monto"], 2)
        m["saldo_acumulado"] = saldo
    return movimientos


# ── Datos: Proveedores ────────────────────────────────────────────────────────

def datos_proveedores(db: Session, desde: date, hasta: date, proveedor: Optional[str] = None,
                       estado_pago: Optional[str] = None, empresa_id: Optional[int] = None) -> list:
    q = db.query(Gasto).filter(
        Gasto.fecha >= desde, Gasto.fecha <= hasta,
        Gasto.tipo_comprobante != "Anticipo de Proveedor",
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    if proveedor:    q = q.filter(Gasto.proveedor.ilike(f"%{proveedor}%"))
    if estado_pago:  q = q.filter(Gasto.estado_pago == estado_pago)
    rows = q.order_by(Gasto.proveedor.asc(), Gasto.fecha.desc()).all()

    filas = []
    for g in rows:
        monto_soles = float(g.monto_soles if g.monto_soles is not None else (g.monto or 0))
        saldo = float(g.saldo_pendiente) if g.saldo_pendiente is not None else monto_soles
        filas.append({
            "proveedor":          g.proveedor or "Proveedor sin nombre",
            "ruc":                g.numero_documento or "",
            "categoria":          g.categoria,
            "descripcion":        g.descripcion or "",
            "numero_comprobante": g.numero_comprobante or "",
            "fecha":              g.fecha,
            "monto":              round(monto_soles, 2),
            "saldo_pendiente":    round(saldo, 2),
            "estado":             g.estado_pago or "Pendiente",
        })
    return filas


# ── Datos: Pagos realizados (para Reporte General, hoja 5) ─────────────────────

def datos_pagos_realizados(db: Session, desde: date, hasta: date,
                            empresa_id: Optional[int] = None) -> list:
    q = db.query(PagoGasto).filter(
        PagoGasto.fecha_pago >= desde, PagoGasto.fecha_pago <= hasta,
    )
    if empresa_id is not None:
        q = q.join(Gasto, PagoGasto.gasto_id == Gasto.id).filter(Gasto.empresa_id == empresa_id)
    rows = q.order_by(PagoGasto.fecha_pago.desc()).all()

    filas = []
    for p in rows:
        g = p.gasto
        filas.append({
            "proveedor":    (g.proveedor if g else None) or "Proveedor sin nombre",
            "descripcion":  (g.descripcion if g else "") or "",
            "monto":        round(float(p.monto_pagado or 0), 2),
            "fecha_pago":   p.fecha_pago,
            "metodo_pago":  p.metodo_pago or "",
        })
    return filas


# ── Datos: Resumen ejecutivo (Reporte General, hoja 1) ─────────────────────────

def resumen_ejecutivo(db: Session, desde: date, hasta: date,
                      empresa_id: Optional[int] = None) -> dict:
    ventas   = ind_svc._ventas_periodo(db, desde, hasta)
    gastos   = ind_svc._gastos_periodo(db, desde, hasta)
    utilidad = ventas - gastos
    cartera_total, _ = ind_svc._cartera_actual(db)
    cuentas_pagar     = ind_svc._cuentas_por_pagar_actual(db)
    saldo_bancario    = ind_svc._saldo_bancario_actual(db)
    return {
        "ventas_periodo":     round(ventas, 2),
        "gastos_periodo":     round(gastos, 2),
        "utilidad":           round(utilidad, 2),
        "cuentas_por_cobrar": round(cartera_total, 2),
        "cuentas_por_pagar":  round(cuentas_pagar, 2),
        "saldo_bancario":     round(saldo_bancario, 2),
    }
