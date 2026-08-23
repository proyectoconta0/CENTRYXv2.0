from collections import defaultdict, deque
from datetime import date, timedelta
from sqlalchemy.orm import Session
from app.models.flujo_caja import ConciliacionBancaria, MovimientoConciliacion
from app.models.comercial import PagoCobranza
from app.models.models import PagoGasto


def sincronizar_pagos_periodo(db: Session, conc: ConciliacionBancaria):
    """Materializa en movimientos_conciliacion (origen='sistema', conciliado=False)
    cualquier pago de pagos_cobranza / pagos_gastos del período de `conc` que
    todavía no esté reflejado ahí.

    Sin esto, "Solo en Sistema" solo mostraba la foto de pagos_cobranza tomada
    al momento de importar el Excel (ver confirmar_conciliacion): un pago
    registrado después de esa importación nunca aparecía como pendiente de
    conciliar. Se llama cada vez que se abre la vista de movimientos, así que
    queda siempre al día en tiempo real.
    """
    existentes = {
        (m.referencia_sistema_tipo, m.referencia_sistema_id)
        for m in db.query(MovimientoConciliacion).filter(
            MovimientoConciliacion.conciliacion_id == conc.id,
            MovimientoConciliacion.referencia_sistema_id.isnot(None),
        ).all()
    }

    pagos_cobr = db.query(PagoCobranza).filter(
        PagoCobranza.fecha_pago >= conc.periodo_desde,
        PagoCobranza.fecha_pago <= conc.periodo_hasta,
    ).all()
    for p in pagos_cobr:
        if ("cobranza", p.id) in existentes:
            continue
        db.add(MovimientoConciliacion(
            conciliacion_id=conc.id, fecha=p.fecha_pago,
            descripcion=f"Cobro — {p.metodo_pago}",
            monto=float(p.monto_pagado), tipo="ingreso", origen="sistema",
            conciliado=False, referencia_sistema_id=p.id,
            referencia_sistema_tipo="cobranza", created_at=date.today(),
        ))

    pagos_gasto = db.query(PagoGasto).filter(
        PagoGasto.fecha_pago >= conc.periodo_desde,
        PagoGasto.fecha_pago <= conc.periodo_hasta,
    ).all()
    for p in pagos_gasto:
        if ("gasto", p.id) in existentes:
            continue
        db.add(MovimientoConciliacion(
            conciliacion_id=conc.id, fecha=p.fecha_pago,
            descripcion=f"Pago gasto — {p.metodo_pago}",
            monto=float(p.monto_pagado), tipo="egreso", origen="sistema",
            conciliado=False, referencia_sistema_id=p.id,
            referencia_sistema_tipo="gasto", created_at=date.today(),
        ))

    db.flush()


def auto_match_movimientos(movimientos_banco: list, movimientos_sistema: list) -> int:
    """Cruza movimientos 'banco' y 'sistema' no conciliados: mismo tipo +
    monto exacto (±0.01, redondeado a 2 decimales) + fecha ±2 días. Cada
    movimiento 'sistema' se consume una sola vez (cola por clave), igual que
    el auto-match de confirmar_conciliacion. Devuelve cuántos pares quedaron
    conciliados."""
    pool = defaultdict(deque)
    for ms in sorted(movimientos_sistema, key=lambda m: m.fecha):
        clave = (ms.tipo, round(float(ms.monto), 2), ms.fecha)
        pool[clave].append(ms)

    conciliados = 0
    for mb in sorted(movimientos_banco, key=lambda m: m.fecha):
        monto_mb = round(float(mb.monto), 2)
        ms = None
        for offset in (0, -1, 1, -2, 2):
            cola = pool.get((mb.tipo, monto_mb, mb.fecha + timedelta(days=offset)))
            if cola:
                ms = cola.popleft()
                break
        if ms:
            mb.conciliado              = True
            ms.conciliado              = True
            mb.referencia_sistema_id   = ms.referencia_sistema_id
            mb.referencia_sistema_tipo = ms.referencia_sistema_tipo
            conciliados += 1
    return conciliados


def sincronizar_y_conciliar(db: Session, conciliacion_id: int) -> int:
    """Sincroniza pagos nuevos del período (sincronizar_pagos_periodo) y luego
    intenta conciliarlos automáticamente contra los movimientos 'banco'
    pendientes, con el mismo algoritmo de auto-match. Devuelve cuántos pares
    nuevos quedaron conciliados; solo quedan como "Solo en Sistema" los que
    realmente no tienen par en el banco."""
    conc = db.query(ConciliacionBancaria).filter(ConciliacionBancaria.id == conciliacion_id).first()
    if not conc:
        return 0

    sincronizar_pagos_periodo(db, conc)
    db.flush()

    movimientos_banco = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == conciliacion_id,
        MovimientoConciliacion.origen == "banco",
        MovimientoConciliacion.conciliado == False,
    ).all()
    movimientos_sistema = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.conciliacion_id == conciliacion_id,
        MovimientoConciliacion.origen == "sistema",
        MovimientoConciliacion.conciliado == False,
    ).all()

    conciliados = auto_match_movimientos(movimientos_banco, movimientos_sistema)
    db.commit()
    return conciliados


def limpiar_movimiento_sistema_por_pago(db: Session, tipo: str, referencia_id: int):
    """Al eliminar un pago de cobranza o de gasto (fuera del flujo de
    eliminación en cascada de comprobantes, que ya maneja esto): limpia su
    rastro en movimientos_conciliacion.

    - origen='sistema' → se elimina (era solo el reflejo del pago; sin él no
      representa nada, y dejarlo desconciliado lo volvería a mostrar como
      huérfano "Solo en Sistema").
    - origen='banco' → NUNCA se elimina (es el extracto bancario real). Si
      estaba conciliado, solo se desconcilia y vuelve a "Solo en Banco".
    """
    movs = db.query(MovimientoConciliacion).filter(
        MovimientoConciliacion.referencia_sistema_tipo == tipo,
        MovimientoConciliacion.referencia_sistema_id == referencia_id,
    ).all()
    for m in movs:
        if m.origen == "banco":
            m.conciliado              = False
            m.referencia_sistema_id   = None
            m.referencia_sistema_tipo = None
        else:
            db.delete(m)
