from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.comercial import VentaComercial, PagoCobranza
from app.models.models import Gasto, PagoGasto, Empleado, Cliente
from datetime import date, timedelta
from calendar import monthrange
from typing import Optional

MESES_ES = {
    1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr",
    5: "May", 6: "Jun", 7: "Jul", 8: "Ago",
    9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
}

TIPOS_VENTA = ["Factura", "Boleta de Venta"]

MONTO_VENTA = func.coalesce(VentaComercial.precio_venta, VentaComercial.monto, 0)
# Base imponible (venta sin IGV) — usada para la Utilidad Estimada, ya que el
# IGV es un impuesto recaudado para SUNAT y no es utilidad de la empresa.
BASE_VENTA  = func.coalesce(VentaComercial.base_imponible, VentaComercial.precio_venta, VentaComercial.monto, 0)
MONTO_GASTO = func.coalesce(Gasto.monto_soles, Gasto.monto, 0)


def _rango_mes_actual(hoy: date = None):
    hoy = hoy or date.today()
    return date(hoy.year, hoy.month, 1), hoy


def rango_por_defecto(desde: str = None, hasta: str = None):
    """Parsea los query params desde/hasta (YYYY-MM-DD). Si faltan, usa el mes
    calendario actual como rango por defecto."""
    if desde and hasta:
        try:
            return date.fromisoformat(desde), date.fromisoformat(hasta)
        except ValueError:
            pass
    return _rango_mes_actual()


def _rango_anterior_equivalente(desde: date, hasta: date):
    """Rango inmediatamente anterior, de la misma duración que [desde, hasta],
    usado para calcular la variación % contra el período previo."""
    dias = (hasta - desde).days + 1
    hasta_ant = desde - timedelta(days=1)
    desde_ant = hasta_ant - timedelta(days=dias - 1)
    return desde_ant, hasta_ant


def _variacion(actual: float, anterior: float) -> float:
    if not anterior:
        return 0.0
    return round(((actual - anterior) / anterior) * 100, 1)


def _filtro_ventas(q, cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                   empresa_id: Optional[int] = None):
    """Aplica los filtros adicionales del panel de Filtros (cliente / tipo de
    servicio / empresa) a un query de VentaComercial."""
    if empresa_id is not None:
        q = q.filter(VentaComercial.empresa_id == empresa_id)
    if cliente_id:
        q = q.filter(VentaComercial.cliente_id == cliente_id)
    if tipo_servicio:
        q = q.filter(VentaComercial.tipo_servicio == tipo_servicio)
    return q


def _suma_ventas(db: Session, desde: date, hasta: date,
                  cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                  empresa_id: Optional[int] = None) -> float:
    # TIPOS_VENTA ya excluye Notas de Crédito/Débito; estado != "Anulada"
    # excluye facturas/boletas anuladas (no deben sumar a ventas).
    q = db.query(func.sum(MONTO_VENTA)).filter(
        VentaComercial.tipo_documento.in_(TIPOS_VENTA),
        VentaComercial.estado != "Anulada",
        VentaComercial.fecha >= desde,
        VentaComercial.fecha <= hasta,
    )
    q = _filtro_ventas(q, cliente_id, tipo_servicio, empresa_id)
    return float(q.scalar() or 0)


def _suma_base_ventas(db: Session, desde: date, hasta: date,
                       cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                       empresa_id: Optional[int] = None) -> float:
    """Suma la base imponible (sin IGV) de facturas/boletas activas — usada
    para calcular la Utilidad Estimada, que no debe incluir el IGV."""
    q = db.query(func.sum(BASE_VENTA)).filter(
        VentaComercial.tipo_documento.in_(TIPOS_VENTA),
        VentaComercial.estado != "Anulada",
        VentaComercial.fecha >= desde,
        VentaComercial.fecha <= hasta,
    )
    q = _filtro_ventas(q, cliente_id, tipo_servicio, empresa_id)
    return float(q.scalar() or 0)


def _suma_gastos(db: Session, desde: date, hasta: date,
                  empresa_id: Optional[int] = None) -> float:
    # "Pagos Tributarios" (afecta_utilidad=False) sale del banco pero no es
    # gasto operativo: no debe sumar a la utilidad ni al Total de Gastos.
    q = db.query(func.sum(MONTO_GASTO)).filter(
        Gasto.fecha >= desde,
        Gasto.fecha <= hasta,
        Gasto.afecta_utilidad.isnot(False),
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    return float(q.scalar() or 0)


def _suma_gastos_financieros_prestamos(db: Session, desde: date, hasta: date,
                                        empresa_id: Optional[int] = None) -> float:
    """Interés/seguro/comisión generados al pagar cuotas de préstamo (ver
    Gasto.cuota_prestamo_id) — ya están incluidos en _suma_gastos (son Gasto
    normales), esto es solo el desglose para la card informativa del KPI."""
    q = db.query(func.sum(MONTO_GASTO)).filter(
        Gasto.fecha >= desde,
        Gasto.fecha <= hasta,
        Gasto.cuota_prestamo_id.isnot(None),
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    return float(q.scalar() or 0)


def _suma_cobrado(db: Session, desde: date, hasta: date,
                   empresa_id: Optional[int] = None) -> float:
    q = db.query(func.sum(PagoCobranza.monto_pagado)).filter(
        PagoCobranza.fecha_pago >= desde,
        PagoCobranza.fecha_pago <= hasta,
    )
    if empresa_id is not None:
        # Filtra via join con VentaComercial para obtener empresa_id
        q = q.join(VentaComercial, PagoCobranza.venta_comercial_id == VentaComercial.id).filter(
            VentaComercial.empresa_id == empresa_id
        )
    return float(q.scalar() or 0)


def _suma_pagado(db: Session, desde: date, hasta: date,
                  empresa_id: Optional[int] = None) -> float:
    q = db.query(func.sum(PagoGasto.monto_pagado)).filter(
        PagoGasto.fecha_pago >= desde,
        PagoGasto.fecha_pago <= hasta,
    )
    if empresa_id is not None:
        # Filtra via join con Gasto para obtener empresa_id
        q = q.join(Gasto, PagoGasto.gasto_id == Gasto.id).filter(
            Gasto.empresa_id == empresa_id
        )
    return float(q.scalar() or 0)


def get_kpis(db: Session, desde: date, hasta: date,
              cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
              empresa_id: Optional[int] = None) -> dict:
    desde_ant, hasta_ant = _rango_anterior_equivalente(desde, hasta)

    ventas      = _suma_ventas(db, desde, hasta, cliente_id, tipo_servicio, empresa_id)
    ventas_ant  = _suma_ventas(db, desde_ant, hasta_ant, cliente_id, tipo_servicio, empresa_id)
    gastos      = _suma_gastos(db, desde, hasta, empresa_id)
    gastos_ant  = _suma_gastos(db, desde_ant, hasta_ant, empresa_id)
    gastos_financieros_prestamos = _suma_gastos_financieros_prestamos(db, desde, hasta, empresa_id)
    # Utilidad se calcula sobre la base imponible (sin IGV), no sobre el
    # precio de venta total — el IGV es un impuesto recaudado para SUNAT.
    base_ventas     = _suma_base_ventas(db, desde, hasta, cliente_id, tipo_servicio, empresa_id)
    base_ventas_ant = _suma_base_ventas(db, desde_ant, hasta_ant, cliente_id, tipo_servicio, empresa_id)
    utilidad     = base_ventas - gastos
    utilidad_ant = base_ventas_ant - gastos_ant

    # Cuentas por cobrar: saldo total pendiente (balance vivo, no depende del
    # período). La variación compara cuánto de ese saldo corresponde a
    # comprobantes emitidos en el período actual vs. el anterior.
    cuentas_cobrar_q = _filtro_ventas(db.query(func.sum(VentaComercial.saldo_pendiente)).filter(
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
    ), cliente_id, tipo_servicio, empresa_id)
    cuentas_cobrar = float(cuentas_cobrar_q.scalar() or 0)

    cobrar_periodo_q = _filtro_ventas(db.query(func.sum(VentaComercial.saldo_pendiente)).filter(
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
    ), cliente_id, tipo_servicio, empresa_id)
    cobrar_periodo = float(cobrar_periodo_q.scalar() or 0)

    cobrar_periodo_ant_q = _filtro_ventas(db.query(func.sum(VentaComercial.saldo_pendiente)).filter(
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha >= desde_ant, VentaComercial.fecha <= hasta_ant,
    ), cliente_id, tipo_servicio, empresa_id)
    cobrar_periodo_ant = float(cobrar_periodo_ant_q.scalar() or 0)

    # Flujo de caja: cuentas_bancarias no tiene columna de saldo propio, así
    # que se usa el fallback indicado — total cobrado menos total pagado.
    flujo      = _suma_cobrado(db, desde, hasta, empresa_id) - _suma_pagado(db, desde, hasta, empresa_id)
    flujo_ant  = _suma_cobrado(db, desde_ant, hasta_ant, empresa_id) - _suma_pagado(db, desde_ant, hasta_ant, empresa_id)

    return {
        "ventas_mes":         round(ventas, 2),
        "ventas_variacion":   _variacion(ventas, ventas_ant),
        "utilidad_estimada":  round(utilidad, 2),
        "utilidad_variacion": _variacion(utilidad, utilidad_ant),
        "gastos_mes":         round(gastos, 2),
        "gastos_variacion":   _variacion(gastos, gastos_ant),
        "gastos_financieros_prestamos_mes": round(gastos_financieros_prestamos, 2),
        "cuentas_cobrar":     round(cuentas_cobrar, 2),
        "cobrar_variacion":   _variacion(cobrar_periodo, cobrar_periodo_ant),
        "flujo_caja":         round(flujo, 2),
        "flujo_variacion":    _variacion(flujo, flujo_ant),
    }


def get_ventas_evolucion(db: Session, hasta: date = None,
                          cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                          empresa_id: Optional[int] = None) -> dict:
    """Mensual: 6 meses hasta el mes de `hasta`. Semanal: 4 semanas hasta esa
    fecha. Diario: 7 días hasta esa fecha. `hasta` por defecto es hoy, y se
    ajusta con la fecha seleccionada en el header (navegador de mes)."""
    hoy = hasta or date.today()

    mensual = []
    for i in range(5, -1, -1):
        mes = (hoy.month - i - 1) % 12 + 1
        anio = hoy.year if hoy.month - i > 0 else hoy.year - 1
        ultimo_dia = monthrange(anio, mes)[1]
        total = _suma_ventas(db, date(anio, mes, 1), date(anio, mes, ultimo_dia),
                             cliente_id, tipo_servicio, empresa_id)
        mensual.append({"periodo": MESES_ES[mes], "monto": round(total, 2)})

    semanal = []
    for i in range(3, -1, -1):
        inicio = hoy - timedelta(weeks=i + 1)
        fin = hoy - timedelta(weeks=i) - timedelta(days=1)
        total = _suma_ventas(db, inicio, fin, cliente_id, tipo_servicio, empresa_id)
        semanal.append({"periodo": f"Sem {4 - i}", "monto": round(total, 2)})

    diario = []
    for i in range(6, -1, -1):
        dia = hoy - timedelta(days=i)
        total = _suma_ventas(db, dia, dia, cliente_id, tipo_servicio, empresa_id)
        diario.append({"periodo": dia.strftime("%d/%m"), "monto": round(total, 2)})

    return {"mensual": mensual, "semanal": semanal, "diario": diario}


def get_flujo_caja(db: Session, empresa_id: Optional[int] = None) -> list:
    """Flujo de caja proyectado: próximos 6 meses de ingresos (comprobantes con
    saldo pendiente, por fecha de vencimiento) y egresos (gastos con saldo
    pendiente, cuentas por pagar), con saldo acumulado. Es una proyección hacia
    adelante desde hoy — no depende del período elegido en el header."""
    hoy = date.today()
    resultado = []
    saldo_acum = 0.0
    anio, mes = hoy.year, hoy.month

    for _ in range(6):
        ultimo_dia = monthrange(anio, mes)[1]
        primer, ultimo = date(anio, mes, 1), date(anio, mes, ultimo_dia)

        q_ingresos = db.query(func.sum(VentaComercial.saldo_pendiente)).filter(
            VentaComercial.estado != "Anulada",
            VentaComercial.estado_cobranza.in_(["Pendiente", "Pago Parcial"]),
            VentaComercial.fecha_vencimiento >= primer,
            VentaComercial.fecha_vencimiento <= ultimo,
            VentaComercial.saldo_pendiente > 0,
        )
        if empresa_id is not None:
            q_ingresos = q_ingresos.filter(VentaComercial.empresa_id == empresa_id)
        ingresos = float(q_ingresos.scalar() or 0)

        q_egresos = db.query(func.sum(Gasto.saldo_pendiente)).filter(
            Gasto.estado_pago.in_(["Pendiente", "Pago Parcial"]),
            Gasto.fecha_vencimiento >= primer,
            Gasto.fecha_vencimiento <= ultimo,
            Gasto.saldo_pendiente > 0,
        )
        if empresa_id is not None:
            q_egresos = q_egresos.filter(Gasto.empresa_id == empresa_id)
        egresos = float(q_egresos.scalar() or 0)

        saldo_acum += (ingresos - egresos)
        resultado.append({
            "mes":    MESES_ES[mes],
            "anio":   anio,
            "ingresos": round(ingresos, 2),
            "egresos":  round(egresos, 2),
            "saldo":    round(saldo_acum, 2),
        })

        mes += 1
        if mes > 12:
            mes = 1
            anio += 1

    return resultado


def get_top_clientes(db: Session, desde: date, hasta: date,
                      cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                      empresa_id: Optional[int] = None) -> list:
    nombre_expr = func.coalesce(Cliente.razon_social, VentaComercial.razon_social_cliente, "—")
    total_expr  = func.sum(MONTO_VENTA)

    q = (
        db.query(nombre_expr.label("nombre"), total_expr.label("total"))
        .outerjoin(Cliente, Cliente.id == VentaComercial.cliente_id)
        .filter(
            VentaComercial.tipo_documento.in_(TIPOS_VENTA),
            VentaComercial.estado != "Anulada",
            VentaComercial.fecha >= desde,
            VentaComercial.fecha <= hasta,
        )
    )
    q = _filtro_ventas(q, cliente_id, tipo_servicio, empresa_id)
    rows = (
        q.group_by(nombre_expr)
        .order_by(total_expr.desc())
        .limit(5)
        .all()
    )
    total_general = sum(float(r.total or 0) for r in rows) or 1
    return [
        {
            "nombre":     r.nombre,
            "ventas":     round(float(r.total or 0), 2),
            "porcentaje": round(float(r.total or 0) / total_general * 100, 1),
        }
        for r in rows
    ]


def get_cobranza_estado(db: Session, desde: date, hasta: date,
                         cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                         empresa_id: Optional[int] = None) -> dict:
    hoy = date.today()
    q = db.query(VentaComercial).filter(
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
        VentaComercial.fecha >= desde,
        VentaComercial.fecha <= hasta,
    )
    ventas = _filtro_ventas(q, cliente_id, tipo_servicio, empresa_id).all()

    al_dia, por_vencer, vencida = [], [], []
    for v in ventas:
        if not v.fecha_vencimiento:
            al_dia.append(v)
            continue
        dias = (hoy - v.fecha_vencimiento).days
        if dias <= 0:
            al_dia.append(v)
        elif dias <= 15:
            por_vencer.append(v)
        else:
            vencida.append(v)

    total = sum(float(v.saldo_pendiente or 0) for v in ventas) or 1

    def grupo(lista):
        monto = sum(float(v.saldo_pendiente or 0) for v in lista)
        return {
            "monto":      round(monto, 2),
            "cantidad":   len(lista),
            "porcentaje": round(monto / total * 100, 1),
        }

    return {
        "al_dia":     grupo(al_dia),
        "por_vencer": grupo(por_vencer),
        "vencida":    grupo(vencida),
    }


def get_gastos_categoria(db: Session, desde: date, hasta: date,
                          empresa_id: Optional[int] = None) -> list:
    q = db.query(Gasto.categoria, func.sum(MONTO_GASTO).label("total")).filter(
        Gasto.fecha >= desde,
        Gasto.fecha <= hasta,
        Gasto.afecta_utilidad.isnot(False),
    )
    if empresa_id is not None:
        q = q.filter(Gasto.empresa_id == empresa_id)
    rows = q.group_by(Gasto.categoria).order_by(func.sum(MONTO_GASTO).desc()).all()
    total_general = sum(float(r.total or 0) for r in rows) or 1
    return [
        {
            "categoria":  r.categoria or "Sin categoría",
            "monto":      round(float(r.total or 0), 2),
            "porcentaje": round(float(r.total or 0) / total_general * 100, 1),
        }
        for r in rows
    ]


def get_proyectos_ejecucion(db: Session, empresa_id: Optional[int] = None) -> list:
    # El módulo de Proyectos aún no está construido — no hay tabla en uso con
    # datos reales para esta sección. Se devuelve vacío; el frontend muestra
    # "Módulo de Proyectos próximamente" cuando la lista viene vacía.
    return []


def get_indicadores_kpi(db: Session, desde: date, hasta: date,
                         cliente_id: Optional[int] = None, tipo_servicio: Optional[str] = None,
                         empresa_id: Optional[int] = None) -> dict:
    ventas = _suma_ventas(db, desde, hasta, cliente_id, tipo_servicio, empresa_id)
    gastos = _suma_gastos(db, desde, hasta, empresa_id)
    rentabilidad = ((ventas - gastos) / ventas * 100) if ventas else 0.0

    total_cobrado = _suma_cobrado(db, desde, hasta, empresa_id)
    q_por_pagar = db.query(func.sum(Gasto.saldo_pendiente)).filter(
        Gasto.estado_pago != "Pagado",
        Gasto.saldo_pendiente > 0,
    )
    if empresa_id is not None:
        q_por_pagar = q_por_pagar.filter(Gasto.empresa_id == empresa_id)
    total_por_pagar = float(q_por_pagar.scalar() or 0)
    liquidez = (total_cobrado / total_por_pagar) if total_por_pagar else 0.0

    cuentas_cobrar_q = _filtro_ventas(db.query(func.sum(VentaComercial.saldo_pendiente)).filter(
        VentaComercial.estado != "Anulada",
        VentaComercial.estado_cobranza != "Pagada",
        VentaComercial.saldo_pendiente > 0,
    ), cliente_id, tipo_servicio, empresa_id)
    cuentas_cobrar = float(cuentas_cobrar_q.scalar() or 0)
    rotacion = (cuentas_cobrar / ventas * 30) if ventas else 0.0

    q_empleados = db.query(func.count(Empleado.id)).filter(Empleado.estado == "activo")
    if empresa_id is not None:
        q_empleados = q_empleados.filter(Empleado.empresa_id == empresa_id)
    empleados_activos = q_empleados.scalar() or 0
    productividad = (ventas / empleados_activos) if empleados_activos else 0.0

    return {
        "rentabilidad_neta":      round(rentabilidad, 1),
        "liquidez_corriente":     round(liquidez, 2),
        "rotacion_cartera":       round(rotacion, 0),
        "cumplimiento_ventas":    0,  # módulo de metas: próximamente
        "productividad_personal": round(productividad, 2),
    }


def get_filtros_opciones(db: Session, empresa_id: Optional[int] = None) -> dict:
    """Opciones para el panel de Filtros del dashboard: clientes con ventas
    registradas y tipos de servicio distintos."""
    q_clientes = (
        db.query(Cliente.id, Cliente.razon_social)
        .join(VentaComercial, VentaComercial.cliente_id == Cliente.id)
        .distinct()
    )
    if empresa_id is not None:
        q_clientes = q_clientes.filter(VentaComercial.empresa_id == empresa_id)
    clientes = q_clientes.order_by(Cliente.razon_social).all()

    q_tipos = db.query(VentaComercial.tipo_servicio).filter(
        VentaComercial.tipo_servicio.isnot(None),
        VentaComercial.tipo_servicio != "",
    ).distinct()
    if empresa_id is not None:
        q_tipos = q_tipos.filter(VentaComercial.empresa_id == empresa_id)
    tipos_servicio = q_tipos.order_by(VentaComercial.tipo_servicio).all()

    return {
        "clientes": [{"id": c.id, "razon_social": c.razon_social} for c in clientes],
        "tipos_servicio": [t[0] for t in tipos_servicio],
    }
