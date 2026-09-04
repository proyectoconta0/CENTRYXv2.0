"""
Módulo 9 — Indicadores KPI.
Todos los cálculos se hacen en tiempo real desde las tablas reales
(ventas_comercial, gastos, pagos_cobranza, pagos_gastos), sin datos cacheados.
"""
from calendar import monthrange
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Gasto, PagoGasto
from app.models.comercial import VentaComercial, PagoCobranza

TIPOS_VENTA     = ["Factura", "Boleta de Venta"]
TIPOS_COBRANZA  = ["Factura", "Boleta de Venta"]

MONTO_VENTA = func.coalesce(VentaComercial.precio_venta_soles, VentaComercial.precio_venta, VentaComercial.monto, 0)
MONTO_GASTO = func.coalesce(Gasto.monto_soles, Gasto.monto, 0)


# ── Helpers de período ────────────────────────────────────────────────────────

def rango_default() -> tuple:
    """Mes actual por defecto si no se especifica desde/hasta."""
    try:
        hoy = date.today()
        return hoy.replace(day=1), hoy
    except Exception:
        hoy = date.today()
        return hoy, hoy


def rango_anterior(desde: date, hasta: date) -> tuple:
    """Período inmediatamente anterior, de la misma duración en días."""
    try:
        dias = (hasta - desde).days + 1
        anterior_hasta = desde - timedelta(days=1)
        anterior_desde = anterior_hasta - timedelta(days=dias - 1)
        return anterior_desde, anterior_hasta
    except Exception:
        return desde, hasta


def _variacion_pct(actual: Optional[float], anterior: Optional[float]) -> Optional[float]:
    try:
        if actual is None or anterior is None or anterior == 0:
            return None
        return round((actual - anterior) / abs(anterior) * 100, 1)
    except Exception:
        return None


def _kpi(valor: Optional[float], valor_anterior: Optional[float] = None, semaforo: Optional[str] = None) -> dict:
    try:
        return {
            "valor":          round(valor, 2) if valor is not None else None,
            "valor_anterior": round(valor_anterior, 2) if valor_anterior is not None else None,
            "variacion_pct":  _variacion_pct(valor, valor_anterior),
            "semaforo":       semaforo,
        }
    except Exception:
        return {"valor": None, "valor_anterior": None, "variacion_pct": None, "semaforo": None}


# ── Semáforos por indicador ───────────────────────────────────────────────────

def _sem_rentabilidad_neta(v):
    if v is None: return None
    return "verde" if v > 20 else "amarillo" if v >= 10 else "rojo"

def _sem_margen_bruto(v):
    if v is None: return None
    return "verde" if v > 30 else "amarillo" if v >= 15 else "rojo"

def _sem_liquidez(v):
    if v is None: return None
    return "verde" if v > 1.5 else "amarillo" if v >= 1.0 else "rojo"

def _sem_dias_caja(v):
    if v is None: return None
    return "verde" if v > 30 else "amarillo" if v >= 15 else "rojo"

def _sem_capital_trabajo(v):
    if v is None: return None
    return "verde" if v >= 0 else "rojo"

def _sem_rotacion_cartera(v):
    if v is None: return None
    return "verde" if v < 30 else "amarillo" if v <= 60 else "rojo"

def _sem_cartera_vencida(v):
    if v is None: return None
    return "verde" if v < 10 else "amarillo" if v <= 25 else "rojo"

def _sem_indice_cobranza(v):
    if v is None: return None
    return "verde" if v > 90 else "amarillo" if v >= 70 else "rojo"

def _sem_gastos_sobre_ventas(v):
    if v is None: return None
    return "verde" if v < 60 else "amarillo" if v <= 80 else "rojo"


# ── Consultas base reutilizables ──────────────────────────────────────────────

def _ventas_periodo(db: Session, desde: date, hasta: date, tipos=TIPOS_VENTA,
                    empresa_id: Optional[int] = None) -> float:
    try:
        q = db.query(func.sum(MONTO_VENTA)).filter(
            VentaComercial.tipo_documento.in_(tipos),
            VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        return float(q.scalar() or 0)
    except Exception:
        return 0


def _gastos_periodo(db: Session, desde: date, hasta: date, area: Optional[str] = None,
                    empresa_id: Optional[int] = None) -> float:
    # "Pagos Tributarios" (afecta_utilidad=False) sale del banco pero no es
    # gasto operativo: se excluye de "gastaste"/utilidad.
    try:
        q = db.query(func.sum(MONTO_GASTO)).filter(
            Gasto.fecha >= desde, Gasto.fecha <= hasta,
            Gasto.afecta_utilidad.isnot(False),
        )
        if area:
            q = q.filter(Gasto.area == area)
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        return float(q.scalar() or 0)
    except Exception:
        return 0


def _cobrado_periodo(db: Session, desde: date, hasta: date,
                     empresa_id: Optional[int] = None) -> float:
    try:
        q = db.query(func.sum(PagoCobranza.monto_pagado)).filter(
            PagoCobranza.fecha_pago >= desde, PagoCobranza.fecha_pago <= hasta,
        )
        if empresa_id is not None:
            q = q.join(VentaComercial, PagoCobranza.venta_comercial_id == VentaComercial.id).filter(
                VentaComercial.empresa_id == empresa_id
            )
        return float(q.scalar() or 0)
    except Exception:
        return 0


def _n_comprobantes_periodo(db: Session, desde: date, hasta: date,
                             empresa_id: Optional[int] = None) -> int:
    try:
        q = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_VENTA),
            VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        return q.count()
    except Exception:
        return 0


def _clientes_activos_periodo(db: Session, desde: date, hasta: date,
                               empresa_id: Optional[int] = None) -> int:
    try:
        q = db.query(VentaComercial.cliente_id).filter(
            VentaComercial.tipo_documento.in_(TIPOS_VENTA),
            VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
            VentaComercial.cliente_id.isnot(None),
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        return q.distinct().count()
    except Exception:
        return 0


def _saldo_bancario_actual(db: Session, empresa_id: Optional[int] = None) -> float:
    """Total cobrado histórico - total pagado histórico."""
    try:
        q_cobrado = db.query(func.sum(PagoCobranza.monto_pagado))
        if empresa_id is not None:
            q_cobrado = q_cobrado.join(
                VentaComercial, PagoCobranza.venta_comercial_id == VentaComercial.id
            ).filter(VentaComercial.empresa_id == empresa_id)
        total_cobrado = float(q_cobrado.scalar() or 0)

        q_pagado = db.query(func.sum(PagoGasto.monto_pagado))
        if empresa_id is not None:
            q_pagado = q_pagado.join(Gasto, PagoGasto.gasto_id == Gasto.id).filter(
                Gasto.empresa_id == empresa_id
            )
        total_pagado = float(q_pagado.scalar() or 0)

        return total_cobrado - total_pagado
    except Exception:
        return 0


def _cartera_actual(db: Session, hoy: Optional[date] = None,
                    empresa_id: Optional[int] = None):
    """Retorna (total_cartera_pendiente, cartera_vencida)."""
    try:
        hoy = hoy or date.today()
        q = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
            VentaComercial.estado_cobranza.isnot(None),
            VentaComercial.estado_cobranza != "Pagada",
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        rows = q.all()
        total = 0.0
        vencida = 0.0
        for vc in rows:
            saldo = float(vc.saldo_pendiente) if vc.saldo_pendiente is not None else 0.0
            if saldo <= 0:
                continue
            total += saldo
            if vc.fecha_vencimiento and vc.fecha_vencimiento < hoy:
                vencida += saldo
        return round(total, 2), round(vencida, 2)
    except Exception:
        return 0.0, 0.0


def _cuentas_por_pagar_actual(db: Session, empresa_id: Optional[int] = None) -> float:
    """Total pendiente en Cuentas por Pagar de Gastos."""
    try:
        q = db.query(Gasto).filter(
            Gasto.estado_pago != "Pagado",
            Gasto.tipo_comprobante != "Anticipo de Proveedor",
        )
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        rows = q.all()
        return round(sum(float(g.saldo_pendiente or 0) for g in rows), 2)
    except Exception:
        return 0


def _mayor_categoria_gasto(db: Session, desde: date, hasta: date,
                            empresa_id: Optional[int] = None) -> Optional[dict]:
    try:
        q = db.query(Gasto.categoria, func.sum(MONTO_GASTO)).filter(
            Gasto.fecha >= desde, Gasto.fecha <= hasta,
            Gasto.afecta_utilidad.isnot(False),
        )
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        rows = q.group_by(Gasto.categoria).all()
        if not rows:
            return None
        total = sum(float(m or 0) for _, m in rows)
        if total <= 0:
            return None
        categoria, monto = max(rows, key=lambda r: float(r[1] or 0))
        monto = float(monto or 0)
        return {
            "categoria":   categoria,
            "monto":       round(monto, 2),
            "porcentaje":  round(monto / total * 100, 1),
        }
    except Exception:
        return None


# ── 1. Rentabilidad ───────────────────────────────────────────────────────────

def rentabilidad(db: Session, desde: date, hasta: date,
                 empresa_id: Optional[int] = None) -> dict:
    try:
        ant_desde, ant_hasta = rango_anterior(desde, hasta)

        ventas   = _ventas_periodo(db, desde, hasta, empresa_id=empresa_id)
        gastos   = _gastos_periodo(db, desde, hasta, empresa_id=empresa_id)
        costo_op = _gastos_periodo(db, desde, hasta, area="Operativa", empresa_id=empresa_id)

        ventas_ant   = _ventas_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)
        gastos_ant   = _gastos_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)
        costo_op_ant = _gastos_periodo(db, ant_desde, ant_hasta, area="Operativa", empresa_id=empresa_id)

        rent_neta      = (ventas - gastos) / ventas * 100 if ventas > 0 else None
        rent_neta_ant  = (ventas_ant - gastos_ant) / ventas_ant * 100 if ventas_ant > 0 else None
        margen_bruto     = (ventas - costo_op) / ventas * 100 if ventas > 0 else None
        margen_bruto_ant = (ventas_ant - costo_op_ant) / ventas_ant * 100 if ventas_ant > 0 else None
        utilidad     = ventas - gastos
        utilidad_ant = ventas_ant - gastos_ant if (ventas_ant or gastos_ant) else None

        return {
            "rentabilidad_neta": _kpi(rent_neta, rent_neta_ant, _sem_rentabilidad_neta(rent_neta)),
            "margen_bruto":      _kpi(margen_bruto, margen_bruto_ant, _sem_margen_bruto(margen_bruto)),
            "utilidad_periodo":  _kpi(utilidad, utilidad_ant, "verde" if utilidad >= 0 else "rojo"),
            "ventas_periodo":    round(ventas, 2),
            "gastos_periodo":    round(gastos, 2),
        }
    except Exception:
        return {}


# ── 2. Liquidez ────────────────────────────────────────────────────────────────

def liquidez(db: Session, desde: date, hasta: date,
             empresa_id: Optional[int] = None) -> dict:
    try:
        saldo_bancario   = _saldo_bancario_actual(db, empresa_id)
        cartera_total, _ = _cartera_actual(db, empresa_id=empresa_id)
        pasivos          = _cuentas_por_pagar_actual(db, empresa_id)
        activos          = saldo_bancario + cartera_total

        liquidez_corriente = activos / pasivos if pasivos > 0 else None
        capital_trabajo    = activos - pasivos

        dias_periodo   = max((hasta - desde).days + 1, 1)
        gastos_periodo = _gastos_periodo(db, desde, hasta, empresa_id=empresa_id)
        gasto_diario   = gastos_periodo / dias_periodo if dias_periodo > 0 else None
        dias_caja      = saldo_bancario / gasto_diario if gasto_diario and gasto_diario > 0 else None

        return {
            "liquidez_corriente": _kpi(liquidez_corriente, None, _sem_liquidez(liquidez_corriente)),
            "dias_caja":          _kpi(dias_caja, None, _sem_dias_caja(dias_caja)),
            "capital_trabajo":    _kpi(capital_trabajo, None, _sem_capital_trabajo(capital_trabajo)),
            "activos_corrientes": round(activos, 2),
            "pasivos_corrientes": round(pasivos, 2),
            "saldo_bancario":     round(saldo_bancario, 2),
        }
    except Exception:
        return {}


# ── 3. Cobranza ────────────────────────────────────────────────────────────────

def cobranza(db: Session, desde: date, hasta: date,
             empresa_id: Optional[int] = None) -> dict:
    try:
        ant_desde, ant_hasta = rango_anterior(desde, hasta)

        cartera_total, cartera_vencida = _cartera_actual(db, empresa_id=empresa_id)
        ventas     = _ventas_periodo(db, desde, hasta, tipos=TIPOS_COBRANZA, empresa_id=empresa_id)
        ventas_ant = _ventas_periodo(db, ant_desde, ant_hasta, tipos=TIPOS_COBRANZA, empresa_id=empresa_id)

        rotacion = (cartera_total / ventas) * 30 if ventas > 0 else None
        cartera_vencida_pct = (cartera_vencida / cartera_total * 100) if cartera_total > 0 else None

        cobrado     = _cobrado_periodo(db, desde, hasta, empresa_id)
        cobrado_ant = _cobrado_periodo(db, ant_desde, ant_hasta, empresa_id)
        indice_cobranza     = (cobrado / ventas * 100) if ventas > 0 else None
        indice_cobranza_ant = (cobrado_ant / ventas_ant * 100) if ventas_ant > 0 else None

        return {
            "rotacion_cartera_dias": _kpi(rotacion, None, _sem_rotacion_cartera(rotacion)),
            "cartera_vencida_pct":   _kpi(cartera_vencida_pct, None, _sem_cartera_vencida(cartera_vencida_pct)),
            "indice_cobranza_pct":   _kpi(indice_cobranza, indice_cobranza_ant, _sem_indice_cobranza(indice_cobranza)),
            "cartera_total":         round(cartera_total, 2),
            "cartera_vencida":       round(cartera_vencida, 2),
            "total_cobrado":         round(cobrado, 2),
            "total_facturado":       round(ventas, 2),
        }
    except Exception:
        return {}


# ── 4. Gastos ──────────────────────────────────────────────────────────────────

def gastos_kpi(db: Session, desde: date, hasta: date,
               empresa_id: Optional[int] = None) -> dict:
    try:
        ant_desde, ant_hasta = rango_anterior(desde, hasta)
        dias_periodo = max((hasta - desde).days + 1, 1)
        dias_ant     = max((ant_hasta - ant_desde).days + 1, 1)

        ventas     = _ventas_periodo(db, desde, hasta, empresa_id=empresa_id)
        gastos     = _gastos_periodo(db, desde, hasta, empresa_id=empresa_id)
        ventas_ant = _ventas_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)
        gastos_ant = _gastos_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)

        gxv     = (gastos / ventas * 100) if ventas > 0 else None
        gxv_ant = (gastos_ant / ventas_ant * 100) if ventas_ant > 0 else None

        gasto_diario     = gastos / dias_periodo if dias_periodo > 0 else None
        gasto_diario_ant = gastos_ant / dias_ant if dias_ant > 0 else None

        return {
            "gastos_sobre_ventas_pct": _kpi(gxv, gxv_ant, _sem_gastos_sobre_ventas(gxv)),
            "gasto_promedio_diario":   _kpi(gasto_diario, gasto_diario_ant, None),
            "mayor_categoria":         _mayor_categoria_gasto(db, desde, hasta, empresa_id),
        }
    except Exception:
        return {}


# ── 5. Ventas ──────────────────────────────────────────────────────────────────

def ventas_kpi(db: Session, desde: date, hasta: date,
               empresa_id: Optional[int] = None) -> dict:
    try:
        ant_desde, ant_hasta = rango_anterior(desde, hasta)

        ventas       = _ventas_periodo(db, desde, hasta, empresa_id=empresa_id)
        ventas_ant   = _ventas_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)
        n_comp       = _n_comprobantes_periodo(db, desde, hasta, empresa_id)
        n_comp_ant   = _n_comprobantes_periodo(db, ant_desde, ant_hasta, empresa_id)
        clientes     = _clientes_activos_periodo(db, desde, hasta, empresa_id)
        clientes_ant = _clientes_activos_periodo(db, ant_desde, ant_hasta, empresa_id)

        ticket           = ventas / n_comp if n_comp > 0 else None
        ticket_ant       = ventas_ant / n_comp_ant if n_comp_ant > 0 else None
        venta_x_cliente     = ventas / clientes if clientes > 0 else None
        venta_x_cliente_ant = ventas_ant / clientes_ant if clientes_ant > 0 else None

        return {
            "ticket_promedio":   _kpi(ticket, ticket_ant, None),
            "clientes_activos":  _kpi(clientes, clientes_ant, None),
            "venta_por_cliente": _kpi(venta_x_cliente, venta_x_cliente_ant, None),
        }
    except Exception:
        return {}


# ── 6. Evolución mensual ───────────────────────────────────────────────────────

def evolucion(db: Session, meses: int = 6, empresa_id: Optional[int] = None) -> list:
    try:
        hoy = date.today()
        resultado = []
        for i in range(meses - 1, -1, -1):
            mes  = (hoy.month - i - 1) % 12 + 1
            anio = hoy.year + ((hoy.month - i - 1) // 12)
            desde = date(anio, mes, 1)
            ultimo_dia = monthrange(anio, mes)[1]
            hasta = date(anio, mes, min(ultimo_dia, hoy.day) if (anio, mes) == (hoy.year, hoy.month) else ultimo_dia)

            ventas   = _ventas_periodo(db, desde, hasta, empresa_id=empresa_id)
            gastos   = _gastos_periodo(db, desde, hasta, empresa_id=empresa_id)
            utilidad = ventas - gastos
            rent_neta = (utilidad / ventas * 100) if ventas > 0 else None
            gxv       = (gastos / ventas * 100) if ventas > 0 else None
            cartera_total, cartera_vencida = _cartera_actual(db, hoy=hasta, empresa_id=empresa_id)
            cartera_vencida_pct = (cartera_vencida / cartera_total * 100) if cartera_total > 0 else None

            resultado.append({
                "mes":                   f"{['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][mes-1]} {anio}",
                "ventas":                round(ventas, 2),
                "gastos":                round(gastos, 2),
                "utilidad":              round(utilidad, 2),
                "rentabilidad_neta":     round(rent_neta, 2) if rent_neta is not None else None,
                "gastos_sobre_ventas":   round(gxv, 2) if gxv is not None else None,
                "cartera_vencida_pct":   round(cartera_vencida_pct, 2) if cartera_vencida_pct is not None else None,
            })
        return resultado
    except Exception:
        return []


# ── 7. Salud general ───────────────────────────────────────────────────────────

_ALERTAS_LABEL = {
    "rentabilidad_neta":     ("Rentabilidad neta", "%"),
    "margen_bruto":          ("Margen bruto", "%"),
    "liquidez_corriente":    ("Liquidez corriente", "x"),
    "dias_caja":             ("Días de caja", "días"),
    "capital_trabajo":       ("Capital de trabajo", "S/"),
    "rotacion_cartera_dias": ("Rotación de cartera", "días"),
    "cartera_vencida_pct":   ("Cartera vencida", "%"),
    "indice_cobranza_pct":   ("Índice de cobranza", "%"),
    "gastos_sobre_ventas_pct": ("Gastos sobre ventas", "%"),
}


def salud_general(db: Session, desde: date, hasta: date,
                  empresa_id: Optional[int] = None) -> dict:
    try:
        rent = rentabilidad(db, desde, hasta, empresa_id)
        liq  = liquidez(db, desde, hasta, empresa_id)
        cob  = cobranza(db, desde, hasta, empresa_id)
        gas  = gastos_kpi(db, desde, hasta, empresa_id)

        kpis = {
            "rentabilidad_neta":       rent.get("rentabilidad_neta", {}),
            "margen_bruto":            rent.get("margen_bruto", {}),
            "liquidez_corriente":      liq.get("liquidez_corriente", {}),
            "dias_caja":               liq.get("dias_caja", {}),
            "capital_trabajo":         liq.get("capital_trabajo", {}),
            "rotacion_cartera_dias":   cob.get("rotacion_cartera_dias", {}),
            "cartera_vencida_pct":     cob.get("cartera_vencida_pct", {}),
            "indice_cobranza_pct":     cob.get("indice_cobranza_pct", {}),
            "gastos_sobre_ventas_pct": gas.get("gastos_sobre_ventas_pct", {}),
        }

        evaluados  = {k: v for k, v in kpis.items() if v.get("semaforo") is not None}
        n_rojo     = sum(1 for v in evaluados.values() if v["semaforo"] == "rojo")
        n_amarillo = sum(1 for v in evaluados.values() if v["semaforo"] == "amarillo")
        n_verde    = sum(1 for v in evaluados.values() if v["semaforo"] == "verde")
        n_total    = len(evaluados)

        if n_total == 0:
            estado, titulo = "sin_datos", "SIN DATOS SUFICIENTES"
        elif n_rojo >= 2 or (n_total > 0 and n_rojo / n_total >= 0.34):
            estado, titulo = "rojo", "ATENCIÓN URGENTE"
        elif n_rojo >= 1 or n_amarillo >= 2:
            estado, titulo = "amarillo", "REQUIERE ATENCIÓN"
        else:
            estado, titulo = "verde", "NEGOCIO SALUDABLE"

        alertas = []
        for color in ["rojo", "amarillo", "verde"]:
            for key, v in evaluados.items():
                if len(alertas) >= 3:
                    break
                if v["semaforo"] != color:
                    continue
                label, unidad = _ALERTAS_LABEL.get(key, (key, ""))
                valor_fmt = f"S/ {v['valor']:,.2f}" if unidad == "S/" else f"{v['valor']:,.1f}{unidad}"
                icono = "🔴" if color == "rojo" else "🟡" if color == "amarillo" else "✅"
                alertas.append(f"{icono} {label}: {valor_fmt}")

        return {
            "estado": estado, "titulo": titulo, "alertas": alertas[:3],
            "resumen": {"verde": n_verde, "amarillo": n_amarillo, "rojo": n_rojo, "total": n_total},
        }
    except Exception:
        return {
            "estado": "sin_datos", "titulo": "SIN DATOS SUFICIENTES",
            "alertas": [], "resumen": {"verde": 0, "amarillo": 0, "rojo": 0, "total": 0},
        }


# ── 8. Exportar ────────────────────────────────────────────────────────────────

def filas_exportar(db: Session, desde: date, hasta: date,
                   empresa_id: Optional[int] = None) -> list:
    try:
        rent = rentabilidad(db, desde, hasta, empresa_id)
        liq  = liquidez(db, desde, hasta, empresa_id)
        cob  = cobranza(db, desde, hasta, empresa_id)
        gas  = gastos_kpi(db, desde, hasta, empresa_id)
        ven  = ventas_kpi(db, desde, hasta, empresa_id)

        definiciones = [
            ("Rentabilidad Neta (%)",        rent.get("rentabilidad_neta", {})),
            ("Margen Bruto (%)",             rent.get("margen_bruto", {})),
            ("Utilidad del Período (S/)",    rent.get("utilidad_periodo", {})),
            ("Liquidez Corriente (x)",       liq.get("liquidez_corriente", {})),
            ("Días de Caja",                 liq.get("dias_caja", {})),
            ("Capital de Trabajo (S/)",      liq.get("capital_trabajo", {})),
            ("Rotación de Cartera (días)",   cob.get("rotacion_cartera_dias", {})),
            ("% Cartera Vencida",            cob.get("cartera_vencida_pct", {})),
            ("Índice de Cobranza (%)",       cob.get("indice_cobranza_pct", {})),
            ("% Gastos sobre Ventas",        gas.get("gastos_sobre_ventas_pct", {})),
            ("Gasto Promedio Diario (S/)",   gas.get("gasto_promedio_diario", {})),
            ("Ticket Promedio (S/)",         ven.get("ticket_promedio", {})),
            ("Clientes Activos",             ven.get("clientes_activos", {})),
            ("Venta por Cliente (S/)",       ven.get("venta_por_cliente", {})),
        ]
        filas = []
        for nombre, k in definiciones:
            filas.append({
                "indicador":       nombre,
                "valor":           k.get("valor"),
                "semaforo":        k.get("semaforo") or "—",
                "valor_anterior":  k.get("valor_anterior"),
                "variacion_pct":   k.get("variacion_pct"),
            })
        return filas
    except Exception:
        return []


# ── 9. Vista Simple ────────────────────────────────────────────────────────────

MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def rango_simple(periodo: str) -> tuple:
    try:
        hoy = date.today()
        if periodo == "año":
            return date(hoy.year, 1, 1), hoy
        return hoy.replace(day=1), hoy
    except Exception:
        hoy = date.today()
        return hoy, hoy


def _tendencia(actual: float, anterior: Optional[float], mayor_es_bueno: bool = True) -> dict:
    try:
        if anterior is None or anterior == 0:
            return {"direccion": None, "es_bueno": None, "diferencia": None}
        diferencia = round(actual - anterior, 2)
        if diferencia == 0:
            return {"direccion": "igual", "es_bueno": None, "diferencia": 0.0}
        subio = diferencia > 0
        return {"direccion": "sube" if subio else "baja", "es_bueno": (subio if mayor_es_bueno else not subio), "diferencia": diferencia}
    except Exception:
        return {"direccion": None, "es_bueno": None, "diferencia": None}


def _facturas_vencidas_detalle(db: Session, hoy: date,
                                empresa_id: Optional[int] = None) -> list:
    try:
        q = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
            VentaComercial.estado_cobranza.isnot(None),
            VentaComercial.estado_cobranza != "Pagada",
            VentaComercial.fecha_vencimiento.isnot(None),
            VentaComercial.fecha_vencimiento < hoy,
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        rows = q.all()
        detalle = []
        for vc in rows:
            saldo = float(vc.saldo_pendiente or 0)
            if saldo <= 0:
                continue
            detalle.append({
                "cliente":      vc.razon_social_cliente or "Cliente sin nombre",
                "monto":        round(saldo, 2),
                "dias_vencido": (hoy - vc.fecha_vencimiento).days,
            })
        return detalle
    except Exception:
        return []


def _pagos_proximos_detalle(db: Session, hoy: date, dias_limite: int = 7,
                             empresa_id: Optional[int] = None) -> list:
    try:
        limite = hoy + timedelta(days=dias_limite)
        q = db.query(Gasto).filter(
            Gasto.estado_pago != "Pagado",
            Gasto.tipo_comprobante != "Anticipo de Proveedor",
            Gasto.fecha_vencimiento.isnot(None),
            Gasto.fecha_vencimiento >= hoy,
            Gasto.fecha_vencimiento <= limite,
        )
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        rows = q.all()
        detalle = []
        for g in rows:
            saldo = float(g.saldo_pendiente or 0)
            if saldo <= 0:
                continue
            detalle.append({
                "proveedor": g.proveedor or "tu proveedor",
                "monto": round(saldo, 2),
                "fecha_vencimiento": g.fecha_vencimiento,
            })
        return detalle
    except Exception:
        return []


def _pagos_vencidos_count(db: Session, hoy: date,
                           empresa_id: Optional[int] = None) -> int:
    try:
        q = db.query(Gasto).filter(
            Gasto.estado_pago != "Pagado",
            Gasto.tipo_comprobante != "Anticipo de Proveedor",
            Gasto.fecha_vencimiento.isnot(None),
            Gasto.fecha_vencimiento < hoy,
        )
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        return q.count()
    except Exception:
        return 0


def resumen_simple(db: Session, periodo: str = "mes",
                   empresa_id: Optional[int] = None) -> dict:
    try:
        hoy = date.today()
        desde, hasta = rango_simple(periodo)
        ant_desde, ant_hasta = rango_anterior(desde, hasta)

        vendiste     = _ventas_periodo(db, desde, hasta, empresa_id=empresa_id)
        vendiste_ant = _ventas_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)
        gastaste     = _gastos_periodo(db, desde, hasta, empresa_id=empresa_id)
        gastaste_ant = _gastos_periodo(db, ant_desde, ant_hasta, empresa_id=empresa_id)
        ganaste      = vendiste - gastaste

        cartera_total, _ = _cartera_actual(db, hoy=hoy, empresa_id=empresa_id)
        facturas_vencidas = _facturas_vencidas_detalle(db, hoy, empresa_id)
        monto_vencido_hoy = sum(f["monto"] for f in facturas_vencidas)

        q_pendientes = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
            VentaComercial.estado_cobranza.isnot(None),
            VentaComercial.estado_cobranza != "Pagada",
            VentaComercial.saldo_pendiente > 0,
        )
        if empresa_id is not None:
            q_pendientes = q_pendientes.filter(VentaComercial.empresa_id == empresa_id)
        total_facturas_pendientes = q_pendientes.count()

        en_7_dias = hoy + timedelta(days=7)
        q_por_vencer = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
            VentaComercial.estado_cobranza.isnot(None),
            VentaComercial.estado_cobranza != "Pagada",
            VentaComercial.saldo_pendiente > 0,
            VentaComercial.fecha_vencimiento >= hoy,
            VentaComercial.fecha_vencimiento <= en_7_dias,
        )
        if empresa_id is not None:
            q_por_vencer = q_por_vencer.filter(VentaComercial.empresa_id == empresa_id)
        facturas_por_vencer_semana = q_por_vencer.all()
        monto_por_vencer_semana = sum(float(v.saldo_pendiente or 0) for v in facturas_por_vencer_semana)

        saldo_bancario    = _saldo_bancario_actual(db, empresa_id)
        gastos_mes_actual = _gastos_periodo(db, hoy.replace(day=1), hoy, empresa_id=empresa_id)

        debes_pagar      = _cuentas_por_pagar_actual(db, empresa_id)
        n_pagos_vencidos = _pagos_vencidos_count(db, hoy, empresa_id)
        pagos_proximos   = _pagos_proximos_detalle(db, hoy, empresa_id=empresa_id)

        # Alertas en lenguaje simple
        alertas = []
        morosos_por_cliente = {}
        for f in facturas_vencidas:
            if f["dias_vencido"] > 30:
                morosos_por_cliente[f["cliente"]] = morosos_por_cliente.get(f["cliente"], 0) + f["monto"]
        for cliente, monto in sorted(morosos_por_cliente.items(), key=lambda x: x[1], reverse=True)[:2]:
            alertas.append({
                "nivel": "rojo",
                "mensaje": f"El cliente {cliente} te debe S/ {monto:,.2f} hace más de 30 días. Es hora de cobrarle.",
            })

        for p in sorted(pagos_proximos, key=lambda x: x["fecha_vencimiento"])[:2]:
            fv = p["fecha_vencimiento"]
            fecha_txt = f"{fv.day} de {MESES_ES[fv.month - 1]}"
            alertas.append({
                "nivel": "amarillo",
                "mensaje": f"Tienes que pagar S/ {p['monto']:,.2f} a {p['proveedor']} antes del {fecha_txt}.",
            })

        if vendiste_ant and vendiste > vendiste_ant:
            alertas.append({
                "nivel": "verde",
                "mensaje": f"Vendiste S/ {vendiste - vendiste_ant:,.2f} más que el período anterior. ¡Vas muy bien!",
            })

        if gastaste_ant and gastaste > gastaste_ant and (gastaste - gastaste_ant) / gastaste_ant * 100 > 20:
            alertas.append({
                "nivel": "amarillo",
                "mensaje": f"Tus gastos subieron S/ {gastaste - gastaste_ant:,.2f} este período comparado con el anterior.",
            })

        orden = {"rojo": 0, "amarillo": 1, "verde": 2}
        alertas.sort(key=lambda a: orden[a["nivel"]])
        alertas = alertas[:5]

        n_rojo     = sum(1 for a in alertas if a["nivel"] == "rojo")
        n_amarillo = sum(1 for a in alertas if a["nivel"] == "amarillo")
        if n_rojo > 0:
            estado_banner, mensaje_banner = "rojo", "¡Atención! Hay cosas urgentes que atender 🚨"
        elif n_amarillo > 0:
            estado_banner, mensaje_banner = "amarillo", "Hay algunas cosas que debes revisar 👀"
        else:
            periodo_txt = "año" if periodo == "año" else "mes"
            estado_banner, mensaje_banner = "verde", f"¡Tu negocio va bien este {periodo_txt}! 💪"

        if cartera_total > 0 and len(facturas_vencidas) >= 2:
            consejo = "💡 Consejo: Tienes mucho dinero que cobrar. Llama a tus clientes esta semana."
        elif vendiste > 0 and (gastaste / vendiste) > 0.8:
            consejo = "💡 Consejo: Tus gastos están altos este período. Revisa si hay algo que puedas reducir."
        else:
            consejo = "💡 Consejo: ¡Todo va bien! Es buen momento para pensar en crecer."

        return {
            "periodo": periodo,
            "vendiste":    {"valor": round(vendiste, 2), **_tendencia(vendiste, vendiste_ant, mayor_es_bueno=True)},
            "gastaste":    {"valor": round(gastaste, 2), **_tendencia(gastaste, gastaste_ant, mayor_es_bueno=False)},
            "ganaste":     {"valor": round(ganaste, 2), "es_positivo": ganaste >= 0},
            "te_deben":    {
                "valor": round(cartera_total, 2), "facturas_vencidas": len(facturas_vencidas),
                "facturas_pendientes": total_facturas_pendientes,
            },
            "en_banco":    {"valor": round(saldo_bancario, 2), "suficiente": saldo_bancario >= gastos_mes_actual},
            "debes_pagar": {"valor": round(debes_pagar, 2), "pagos_vencidos": n_pagos_vencidos},
            "vencidas_hoy":       {"valor": round(monto_vencido_hoy, 2), "facturas": len(facturas_vencidas)},
            "por_vencer_semana":  {"valor": round(monto_por_vencer_semana, 2), "facturas": len(facturas_por_vencer_semana)},
            "alertas":         alertas,
            "consejo":         consejo,
            "estado_banner":   estado_banner,
            "mensaje_banner":  mensaje_banner,
        }
    except Exception:
        return {}


# ── 10. Detalle de tarjetas ────────────────────────────────────────────────────

def detalle_ventas(db: Session, desde: date, hasta: date,
                   empresa_id: Optional[int] = None) -> list:
    try:
        q = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_VENTA),
            VentaComercial.fecha >= desde, VentaComercial.fecha <= hasta,
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        rows = q.order_by(VentaComercial.fecha.desc()).all()
        detalle = []
        for vc in rows:
            monto = float(vc.precio_venta_soles if vc.precio_venta_soles is not None else (vc.precio_venta if vc.precio_venta is not None else (vc.monto or 0)))
            detalle.append({
                "fecha":               vc.fecha,
                "numero_comprobante":  vc.numero_factura or vc.documento_relacionado or "—",
                "tipo_documento":      vc.tipo_documento,
                "cliente":             vc.razon_social_cliente or (vc.cliente.razon_social if vc.cliente else "Cliente sin nombre"),
                "monto":               round(monto, 2),
                "estado_cobranza":     vc.estado_cobranza or "Pagada",
            })
        return detalle
    except Exception:
        return []


def detalle_gastos(db: Session, desde: date, hasta: date,
                   empresa_id: Optional[int] = None) -> list:
    try:
        q = db.query(Gasto).filter(
            Gasto.fecha >= desde, Gasto.fecha <= hasta,
            Gasto.afecta_utilidad.isnot(False),
        )
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        rows = q.order_by(Gasto.fecha.desc()).all()
        detalle = []
        for g in rows:
            monto = float(g.monto_soles if g.monto_soles is not None else (g.monto or 0))
            detalle.append({
                "fecha":               g.fecha,
                "numero_comprobante":  g.numero_comprobante or g.numero_recibo_interno or "—",
                "tipo_comprobante":    g.tipo_comprobante,
                "proveedor":           g.proveedor or "Proveedor sin nombre",
                "monto":               round(monto, 2),
            })
        return detalle
    except Exception:
        return []


def detalle_ganaste(db: Session, desde: date, hasta: date,
                    empresa_id: Optional[int] = None) -> dict:
    try:
        ventas   = _ventas_periodo(db, desde, hasta, empresa_id=empresa_id)
        gastos   = _gastos_periodo(db, desde, hasta, empresa_id=empresa_id)
        utilidad = ventas - gastos
        margen   = (utilidad / ventas * 100) if ventas > 0 else None
        return {
            "ventas_total": round(ventas, 2),
            "gastos_total": round(gastos, 2),
            "utilidad":     round(utilidad, 2),
            "margen_pct":   round(margen, 1) if margen is not None else None,
        }
    except Exception:
        return {}


def detalle_te_deben(db: Session, hoy: Optional[date] = None,
                     empresa_id: Optional[int] = None) -> list:
    try:
        hoy = hoy or date.today()
        q = db.query(VentaComercial).filter(
            VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
            VentaComercial.estado_cobranza.isnot(None),
            VentaComercial.estado_cobranza != "Pagada",
        )
        if empresa_id is not None:
            q = q.filter(VentaComercial.empresa_id == empresa_id)
        rows = q.order_by(VentaComercial.fecha_vencimiento.asc()).all()
        detalle = []
        for vc in rows:
            saldo = float(vc.saldo_pendiente or 0)
            if saldo <= 0:
                continue
            vencida = bool(vc.fecha_vencimiento and vc.fecha_vencimiento < hoy)
            detalle.append({
                "fecha":              vc.fecha,
                "fecha_vencimiento":  vc.fecha_vencimiento,
                "cliente":            vc.razon_social_cliente or (vc.cliente.razon_social if vc.cliente else "Cliente sin nombre"),
                "monto":              round(saldo, 2),
                "dias_vencido":       (hoy - vc.fecha_vencimiento).days if vencida else None,
                "vencida":            vencida,
            })
        return detalle
    except Exception:
        return []


def detalle_en_banco(db: Session, limit: int = 30,
                     empresa_id: Optional[int] = None) -> list:
    try:
        q_ingresos = db.query(PagoCobranza).order_by(PagoCobranza.fecha_pago.desc())
        if empresa_id is not None:
            q_ingresos = q_ingresos.join(
                VentaComercial, PagoCobranza.venta_comercial_id == VentaComercial.id
            ).filter(VentaComercial.empresa_id == empresa_id)
        ingresos = q_ingresos.limit(limit).all()

        q_egresos = db.query(PagoGasto).order_by(PagoGasto.fecha_pago.desc())
        if empresa_id is not None:
            q_egresos = q_egresos.join(Gasto, PagoGasto.gasto_id == Gasto.id).filter(
                Gasto.empresa_id == empresa_id
            )
        egresos = q_egresos.limit(limit).all()

        movimientos = []
        for p in ingresos:
            cliente = p.comprobante.razon_social_cliente if p.comprobante else None
            movimientos.append({
                "fecha":    p.fecha_pago,
                "tipo":     "ingreso",
                "concepto": f"Cobro a {cliente or 'cliente'}",
                "monto":    round(float(p.monto_pagado or 0), 2),
            })
        for p in egresos:
            proveedor = p.gasto.proveedor if p.gasto else None
            movimientos.append({
                "fecha":    p.fecha_pago,
                "tipo":     "egreso",
                "concepto": f"Pago a {proveedor or 'proveedor'}",
                "monto":    round(float(p.monto_pagado or 0), 2),
            })
        movimientos.sort(key=lambda m: m["fecha"], reverse=True)
        return movimientos[:limit]
    except Exception:
        return []


def detalle_debes_pagar(db: Session, hoy: Optional[date] = None,
                         empresa_id: Optional[int] = None) -> list:
    try:
        hoy = hoy or date.today()
        q = db.query(Gasto).filter(
            Gasto.estado_pago != "Pagado",
            Gasto.tipo_comprobante != "Anticipo de Proveedor",
        )
        if empresa_id is not None:
            q = q.filter(Gasto.empresa_id == empresa_id)
        rows = q.order_by(Gasto.fecha_vencimiento.asc()).all()
        detalle = []
        for g in rows:
            saldo = float(g.saldo_pendiente or 0)
            if saldo <= 0:
                continue
            vencido = bool(g.fecha_vencimiento and g.fecha_vencimiento < hoy)
            detalle.append({
                "fecha":              g.fecha,
                "fecha_vencimiento":  g.fecha_vencimiento,
                "proveedor":          g.proveedor or "Proveedor sin nombre",
                "monto":              round(saldo, 2),
                "dias_vencido":       (hoy - g.fecha_vencimiento).days if vencido else None,
                "vencido":            vencido,
            })
        return detalle
    except Exception:
        return []
