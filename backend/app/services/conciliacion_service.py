import re
from collections import defaultdict, deque
from datetime import date, timedelta
from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from app.models.flujo_caja import ConciliacionBancaria, MovimientoConciliacion
from app.models.comercial import PagoCobranza, OrdenCobro
from app.models.models import PagoGasto, CuotaPrestamo, Prestamo, PagoGarantia, Garantia, Gasto, OrdenPago

# Préstamos "recibido_*": el dinero es nuestro (debemos), así que pagar una
# cuota es un egreso. "otorgado_*": prestamos nosotros, así que cobrar una
# cuota es un ingreso. Mismo criterio que TIPOS_RECIBIDO/TIPOS_OTORGADO en
# app/routers/prestamos.py (no se importa desde ahí para no acoplar el
# servicio a un router).
_PRESTAMO_TIPOS_RECIBIDO = ("recibido_banco", "recibido_tercero")


def _sufijo_operacion(numero_operacion: str = None, numero_cheque: str = None) -> str:
    """Sufijo con el N° de operación/cheque para embeber en la descripción del
    espejo 'sistema' — sin esto, descripcion_similar() (ver auto_match_movimientos)
    nunca tiene nada que comparar contra el texto del banco (p.ej. "Op.698351"),
    porque las descripciones genéricas ("Pago gasto — Transferencia") no
    comparten ningún dígito con el extracto bancario."""
    partes = [p for p in (numero_operacion, numero_cheque) if p]
    return f" (Op.{'/'.join(partes)})" if partes else ""


def _resincronizar_espejo(db: Session, conc_id: int, mov_sistema: MovimientoConciliacion,
                           monto_nuevo: float, fecha_nueva: date):
    """Si el registro que respalda `mov_sistema` (pago, cuota, devolución...)
    fue editado después de sincronizado, actualiza monto y/o fecha del
    espejo. Si ya estaba conciliado con los datos viejos, desconcilia también
    su par 'banco' (mismo criterio que limpiar_movimiento_sistema_por_pago,
    emparejando por referencia_sistema_id/tipo — MovimientoConciliacion no
    guarda un id directo al par, se infiere por esa referencia compartida)
    para que el auto-match lo reevalúe con los datos correctos."""
    if round(float(mov_sistema.monto), 2) == monto_nuevo and mov_sistema.fecha == fecha_nueva:
        return
    mov_sistema.monto = monto_nuevo
    mov_sistema.fecha = fecha_nueva
    if mov_sistema.conciliado:
        mov_sistema.conciliado = False
        par_banco = db.query(MovimientoConciliacion).filter(
            MovimientoConciliacion.conciliacion_id == conc_id,
            MovimientoConciliacion.origen == "banco",
            MovimientoConciliacion.conciliado == True,
            MovimientoConciliacion.referencia_sistema_id == mov_sistema.referencia_sistema_id,
            MovimientoConciliacion.referencia_sistema_tipo == mov_sistema.referencia_sistema_tipo,
        ).first()
        if par_banco:
            par_banco.conciliado              = False
            par_banco.referencia_sistema_id   = None
            par_banco.referencia_sistema_tipo = None


def sincronizar_pagos_periodo(db: Session, conc: ConciliacionBancaria):
    """Materializa en movimientos_conciliacion (origen='sistema', conciliado=False)
    cualquier pago de pagos_cobranza / pagos_gastos / cuotas_prestamo (pagadas) /
    pagos_garantia (devoluciones) del período de `conc` que todavía no esté
    reflejado ahí. También sincroniza monto y fecha de los espejos ya
    existentes si el registro original fue editado después de creado (ver
    _resincronizar_espejo) — si no, el auto-match seguía comparando contra
    los datos viejos y el movimiento del banco quedaba "Solo en Banco" para
    siempre.

    Sin esto, "Solo en Sistema" solo mostraba la foto tomada al momento de
    importar el Excel (ver confirmar_conciliacion): un pago/cuota/devolución
    registrado o editado después de esa importación nunca aparecía (o
    aparecía con datos viejos) como pendiente de conciliar. Se llama cada vez
    que se abre la vista de movimientos, así que queda siempre al día en
    tiempo real.
    """
    try:
        # Solo origen='sistema': una fila 'banco' ya emparejada por el auto-match
        # también carga el mismo (referencia_sistema_tipo, referencia_sistema_id)
        # que su par 'sistema' (ver auto_match_movimientos), así que sin este
        # filtro la clave podía resolver a la fila del banco — y esta función
        # nunca debe reescribir un movimiento 'banco' (es el extracto real).
        existentes = {
            (m.referencia_sistema_tipo, m.referencia_sistema_id): m
            for m in db.query(MovimientoConciliacion).filter(
                MovimientoConciliacion.conciliacion_id == conc.id,
                MovimientoConciliacion.origen == "sistema",
                MovimientoConciliacion.referencia_sistema_id.isnot(None),
            ).all()
        }

        pagos_cobr = db.query(PagoCobranza).filter(
            PagoCobranza.fecha_pago >= conc.periodo_desde,
            PagoCobranza.fecha_pago <= conc.periodo_hasta,
        ).all()
        for p in pagos_cobr:
            mov_sistema = existentes.get(("cobranza", p.id))
            if mov_sistema:
                _resincronizar_espejo(db, conc.id, mov_sistema, round(float(p.monto_pagado), 2), p.fecha_pago)
                continue
            db.add(MovimientoConciliacion(
                conciliacion_id=conc.id, fecha=p.fecha_pago,
                descripcion=f"Cobro — {p.metodo_pago}" + _sufijo_operacion(numero_cheque=p.numero_cheque),
                monto=float(p.monto_pagado), tipo="ingreso", origen="sistema",
                conciliado=False, referencia_sistema_id=p.id,
                referencia_sistema_tipo="cobranza", created_at=date.today(),
            ))

        # Excluye tipo="pago_cuota_prestamo": ese PagoGasto no tiene Gasto
        # propio (gasto_id NULL, ver modelo) y es solo un reflejo del mismo
        # pago que ya se materializa más abajo desde CuotaPrestamo con
        # referencia_sistema_tipo="prestamo". Sin este filtro se creaban DOS
        # movimientos 'sistema' para el mismo pago (uno mal etiquetado
        # "Pago gasto"), y el auto-match consumía el movimiento del banco con
        # el duplicado equivocado, dejando la cuota real como huérfana
        # "Solo en Sistema". devolucion_nc/descuento_nc sí tienen Gasto propio
        # y deben seguir sincronizándose normalmente, por eso el filtro es
        # específico a "pago_cuota_prestamo" y no a "cualquier tipo no nulo".
        #
        # Excluye también los PagoGasto de un Gasto Bancario (tipo_comprobante
        # ="Gastos Bancarios", ver _registrar_pago_gb en flujo_caja.py): esos
        # movimientos 'banco' ya se vinculan directo al Gasto por su propio id
        # (ver _vincular_gasto_bancario_existente / registrar_gasto_bancario_
        # individual/bulk), nunca por PagoGasto.id — un espejo 'sistema' acá
        # queda huérfano para siempre ("Solo en Sistema" que nunca puede
        # conciliarse, porque nada del lado 'banco' referencia ese PagoGasto.id).
        pagos_gasto = db.query(PagoGasto).outerjoin(
            Gasto, PagoGasto.gasto_id == Gasto.id
        ).filter(
            PagoGasto.fecha_pago >= conc.periodo_desde,
            PagoGasto.fecha_pago <= conc.periodo_hasta,
            or_(PagoGasto.tipo.is_(None), PagoGasto.tipo != "pago_cuota_prestamo"),
            or_(Gasto.tipo_comprobante.is_(None), Gasto.tipo_comprobante != "Gastos Bancarios"),
        ).all()
        for p in pagos_gasto:
            mov_sistema = existentes.get(("gasto", p.id))
            if mov_sistema:
                _resincronizar_espejo(db, conc.id, mov_sistema, round(float(p.monto_pagado), 2), p.fecha_pago)
                continue
            db.add(MovimientoConciliacion(
                conciliacion_id=conc.id, fecha=p.fecha_pago,
                descripcion=f"Pago gasto — {p.metodo_pago}"
                    + _sufijo_operacion(p.numero_operacion, p.numero_cheque),
                monto=float(p.monto_pagado), tipo="egreso", origen="sistema",
                conciliado=False, referencia_sistema_id=p.id,
                referencia_sistema_tipo="gasto", created_at=date.today(),
            ))

        cuotas = db.query(CuotaPrestamo, Prestamo).join(
            Prestamo, CuotaPrestamo.prestamo_id == Prestamo.id
        ).filter(
            CuotaPrestamo.estado == "pagado",
            CuotaPrestamo.fecha_pago_real >= conc.periodo_desde,
            CuotaPrestamo.fecha_pago_real <= conc.periodo_hasta,
        ).all()
        for cuota, prestamo in cuotas:
            tipo_mov    = "egreso" if prestamo.tipo in _PRESTAMO_TIPOS_RECIBIDO else "ingreso"
            monto_nuevo = round(float(cuota.cuota_total), 2)
            mov_sistema = existentes.get(("prestamo", cuota.id))
            if mov_sistema:
                _resincronizar_espejo(db, conc.id, mov_sistema, monto_nuevo, cuota.fecha_pago_real)
                continue
            db.add(MovimientoConciliacion(
                conciliacion_id=conc.id, fecha=cuota.fecha_pago_real,
                descripcion=f"Cuota #{cuota.numero_cuota} — préstamo {prestamo.nombre_tercero}",
                monto=monto_nuevo, tipo=tipo_mov, origen="sistema",
                conciliado=False, referencia_sistema_id=cuota.id,
                referencia_sistema_tipo="prestamo", created_at=date.today(),
            ))

        pagos_garantia = db.query(PagoGarantia, Garantia).join(
            Garantia, PagoGarantia.garantia_id == Garantia.id
        ).filter(
            PagoGarantia.tipo == "devolucion",
            PagoGarantia.fecha >= conc.periodo_desde,
            PagoGarantia.fecha <= conc.periodo_hasta,
        ).all()
        for pago_g, garantia in pagos_garantia:
            monto_nuevo = round(float(pago_g.monto), 2)
            mov_sistema = existentes.get(("garantia", pago_g.id))
            if mov_sistema:
                _resincronizar_espejo(db, conc.id, mov_sistema, monto_nuevo, pago_g.fecha)
                continue
            db.add(MovimientoConciliacion(
                conciliacion_id=conc.id, fecha=pago_g.fecha,
                descripcion=f"Devolución garantía — {garantia.cliente_nombre}",
                monto=monto_nuevo, tipo="egreso", origen="sistema",
                conciliado=False, referencia_sistema_id=pago_g.id,
                referencia_sistema_tipo="garantia", created_at=date.today(),
            ))

        # Órdenes de Cobro (cobro consolidado de una o varias facturas del
        # mismo cliente en UN registro, ver app/routers/ordenes_cobro.py) no
        # generan PagoCobranza — son su propia tabla y nunca se sincronizaban
        # acá, así que un cobro real ya recibido en el banco quedaba
        # "Solo en Banco" para siempre.
        ordenes_cobro = db.query(OrdenCobro).filter(
            OrdenCobro.fecha_cobro >= conc.periodo_desde,
            OrdenCobro.fecha_cobro <= conc.periodo_hasta,
        ).all()
        for oc in ordenes_cobro:
            monto_nuevo = round(float(oc.monto_total), 2)
            mov_sistema = existentes.get(("orden_cobro", oc.id))
            if mov_sistema:
                _resincronizar_espejo(db, conc.id, mov_sistema, monto_nuevo, oc.fecha_cobro)
                continue
            db.add(MovimientoConciliacion(
                conciliacion_id=conc.id, fecha=oc.fecha_cobro,
                descripcion=f"Orden de cobro {oc.numero_orden} — {oc.nombre_cliente or 'Varios clientes'}"
                    + _sufijo_operacion(oc.numero_operacion, oc.numero_cheque),
                monto=monto_nuevo, tipo="ingreso", origen="sistema",
                conciliado=False, referencia_sistema_id=oc.id,
                referencia_sistema_tipo="orden_cobro", created_at=date.today(),
            ))

        # Órdenes de Pago (pago consolidado de una o varias facturas del mismo
        # proveedor en UN registro, ver app/routers/ordenes_pago.py) tampoco
        # generan PagoGasto — misma situación que OrdenCobro arriba, un pago
        # real salido del banco quedaba "Solo en Banco" para siempre.
        ordenes_pago = db.query(OrdenPago).filter(
            OrdenPago.fecha_pago >= conc.periodo_desde,
            OrdenPago.fecha_pago <= conc.periodo_hasta,
        ).all()
        for op in ordenes_pago:
            monto_nuevo = round(float(op.monto_total), 2)
            mov_sistema = existentes.get(("orden_pago", op.id))
            if mov_sistema:
                _resincronizar_espejo(db, conc.id, mov_sistema, monto_nuevo, op.fecha_pago)
                continue
            db.add(MovimientoConciliacion(
                conciliacion_id=conc.id, fecha=op.fecha_pago,
                descripcion=f"Orden de pago {op.numero_orden} — {op.nombre_proveedor or 'Varios proveedores'}"
                    + _sufijo_operacion(op.numero_operacion, op.numero_cheque),
                monto=monto_nuevo, tipo="egreso", origen="sistema",
                conciliado=False, referencia_sistema_id=op.id,
                referencia_sistema_tipo="orden_pago", created_at=date.today(),
            ))

        db.flush()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error en conciliación: {str(e)}")


def _descripcion_similar(desc_banco: str, desc_sistema: str) -> bool:
    """Compara dos descripciones por N° de operación/cheque compartido (6+
    dígitos consecutivos) — desambigua dos candidatos con igual tipo+monto+
    fecha (p.ej. 2 transferencias de S/ 5,000 el mismo día) que de otro modo
    calzarían por pura coincidencia con el primero de la cola."""
    numeros_banco   = set(re.findall(r'\d{6,}', desc_banco or ""))
    numeros_sistema = set(re.findall(r'\d{6,}', desc_sistema or ""))
    return bool(numeros_banco & numeros_sistema)


def _vincular_gasto_bancario_existente(db: Session, mb: MovimientoConciliacion, usados: set) -> bool:
    """Para un movimiento 'banco' marcado es_gasto_bancario (ITF, comisiones,
    mantenimiento...): busca un Gasto ya registrado (mismo criterio que
    _buscar_gb_existente en flujo_caja.py — tipo_comprobante="Gastos
    Bancarios", monto ±0.01, misma fecha) y lo vincula directamente, sin
    esperar a que el usuario presione "Registrar GB" a mano. Si no hay
    ninguno todavía, se deja pendiente para ese flujo manual — un gasto
    bancario nunca tiene un pago propio en pagos_gastos/pagos_cobranza para
    sincronizar de antemano.

    `usados` excluye Gasto.id ya consumidos — tanto los ya vinculados de una
    corrida anterior (precargados por el llamador) como los que esta misma
    corrida ya usó (ver el .add() al final) — para no vincular 2+ cargos
    bancarios distintos de igual monto+fecha (p.ej. 3 comisiones de S/3.50 el
    mismo día) al mismo Gasto, cosa que la primera versión de esta función
    sí permitía al no llevar ningún registro de qué Gasto ya estaba tomado."""
    monto_mb = round(float(mb.monto), 2)
    q = db.query(Gasto).filter(
        Gasto.tipo_comprobante == "Gastos Bancarios",
        func.abs(Gasto.monto - monto_mb) < 0.01,
        Gasto.fecha == mb.fecha,
    )
    if usados:
        q = q.filter(~Gasto.id.in_(usados))
    gasto = q.first()
    if not gasto:
        return False
    mb.conciliado              = True
    mb.referencia_sistema_id   = gasto.id
    mb.referencia_sistema_tipo = "gasto"
    usados.add(gasto.id)
    return True


def auto_match_movimientos(movimientos_banco: list, movimientos_sistema: list, db: Session) -> int:
    """Cruza movimientos 'banco' y 'sistema' no conciliados, en 3 niveles de
    prioridad decreciente — cada nivel solo evalúa lo que el nivel anterior
    dejó sin conciliar:

    Nivel 1 — mismo tipo + monto exacto (±0.01) + fecha exacta + N° de
              operación/cheque compartido en la descripción (ver
              _descripcion_similar). El criterio más específico: resuelve el
              caso de 2+ candidatos con igual monto y fecha (p.ej. 2
              transferencias de S/ 5,000 el mismo día) que antes se
              conciliaban con el primero de la cola sin distinguir cuál era
              cuál.
    Nivel 2 — mismo tipo + monto exacto + fecha exacta, sin distinguir por
              descripción (comportamiento previo, para cuando no hay N° de
              operación que comparar).
    Nivel 3 — mismo tipo + monto exacto + fecha ±2 días (fallback original,
              para diferencias de fecha entre el registro interno y el
              abono/cargo real en el banco).

    Los gastos bancarios (es_gasto_bancario) no participan de estos 3 niveles
    — no tienen pago propio en pagos_gastos/pagos_cobranza con el que
    calzar por monto+fecha+tipo — pero si `db` encuentra un Gasto ya
    registrado para ese cargo (ver _vincular_gasto_bancario_existente) se
    vinculan directo, sin repetir el mismo Gasto en dos movimientos banco
    distintos (ver gb_usados).

    Devuelve cuántos pares quedaron conciliados."""
    try:
        pool = defaultdict(deque)
        for ms in sorted(movimientos_sistema, key=lambda m: m.fecha):
            clave = (ms.tipo, round(float(ms.monto), 2), ms.fecha)
            pool[clave].append(ms)

        conciliados = 0

        def _confirmar(mb, ms):
            nonlocal conciliados
            mb.conciliado              = True
            ms.conciliado              = True
            mb.referencia_sistema_id   = ms.referencia_sistema_id
            mb.referencia_sistema_tipo = ms.referencia_sistema_tipo
            conciliados += 1

        # Gasto.id ya vinculados a un GB conciliado (de esta corrida o de una
        # anterior) — ver _vincular_gasto_bancario_existente.
        gb_usados = {
            row[0] for row in db.query(MovimientoConciliacion.referencia_sistema_id).filter(
                MovimientoConciliacion.origen == "banco",
                MovimientoConciliacion.es_gasto_bancario == True,
                MovimientoConciliacion.conciliado == True,
                MovimientoConciliacion.referencia_sistema_tipo == "gasto",
                MovimientoConciliacion.referencia_sistema_id.isnot(None),
            ).all()
        }

        pendientes = []
        for mb in sorted(movimientos_banco, key=lambda m: m.fecha):
            if mb.es_gasto_bancario:
                if _vincular_gasto_bancario_existente(db, mb, gb_usados):
                    conciliados += 1
                continue
            pendientes.append(mb)

        # Nivel 1: fecha exacta + descripción similar.
        restantes_n1 = []
        for mb in pendientes:
            cola = pool.get((mb.tipo, round(float(mb.monto), 2), mb.fecha))
            ms_match = next((ms for ms in cola if _descripcion_similar(mb.descripcion, ms.descripcion)), None) if cola else None
            if ms_match:
                cola.remove(ms_match)
                _confirmar(mb, ms_match)
            else:
                restantes_n1.append(mb)

        # Nivel 2: fecha exacta, primer candidato disponible (sin distinguir por descripción).
        restantes_n2 = []
        for mb in restantes_n1:
            cola = pool.get((mb.tipo, round(float(mb.monto), 2), mb.fecha))
            if cola:
                _confirmar(mb, cola.popleft())
            else:
                restantes_n2.append(mb)

        # Nivel 3: fecha ±1/±2 días (mismo orden de búsqueda que antes).
        for mb in restantes_n2:
            monto_mb = round(float(mb.monto), 2)
            for offset in (-1, 1, -2, 2):
                cola = pool.get((mb.tipo, monto_mb, mb.fecha + timedelta(days=offset)))
                if cola:
                    _confirmar(mb, cola.popleft())
                    break

        return conciliados
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error en conciliación: {str(e)}")


def sincronizar_y_conciliar(db: Session, conciliacion_id: int) -> int:
    """Sincroniza pagos nuevos del período (sincronizar_pagos_periodo) y luego
    intenta conciliarlos automáticamente contra los movimientos 'banco'
    pendientes, con el mismo algoritmo de auto-match. Devuelve cuántos pares
    nuevos quedaron conciliados; solo quedan como "Solo en Sistema" los que
    realmente no tienen par en el banco."""
    try:
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

        conciliados = auto_match_movimientos(movimientos_banco, movimientos_sistema, db)
        db.commit()
        return conciliados
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error en conciliación: {str(e)}")


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
