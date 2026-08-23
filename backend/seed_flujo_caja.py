"""
Seed Módulo 5 — Flujo de Caja / Conciliación Bancaria.
Crea 2 conciliaciones de ejemplo:
  1. Conciliada  (diferencia = 0, todos los movimientos cuadran)
  2. Con diferencias (3 movimientos sin conciliar)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import date, timedelta
from database import SessionLocal
from app.models.comercial import CuentaBancaria
from app.models.flujo_caja import ConciliacionBancaria, MovimientoConciliacion


def run():
    db = SessionLocal()
    try:
        # ── Verificar si ya existe seed ──────────────────────────────────────
        if db.query(ConciliacionBancaria).count() > 0:
            print("Conciliaciones ya existen. Seed omitido.")
            return

        # ── Asegurar que hay al menos una cuenta bancaria ────────────────────
        cuenta = db.query(CuentaBancaria).filter(CuentaBancaria.activo == True).first()
        if not cuenta:
            cuenta = CuentaBancaria(
                banco="BCP",
                numero_cuenta="193-12345678-0-12",
                tipo_cuenta="Corriente",
                activo=True,
            )
            db.add(cuenta)
            db.flush()

        hoy = date.today()

        # ── Conciliación 1: Mayo 2026 — Completamente conciliada ─────────────
        desde1 = date(2026, 5, 1)
        hasta1 = date(2026, 5, 31)

        c1 = ConciliacionBancaria(
            cuenta_bancaria_id=cuenta.id,
            periodo_desde=desde1,
            periodo_hasta=hasta1,
            banco="BCP",
            formato_archivo="excel",
            saldo_sistema=18450.00,
            saldo_banco=18450.00,
            diferencia=0.00,
            porcentaje_conciliado=100.0,
            estado="Conciliado",
            created_at=date(2026, 6, 2),
        )
        db.add(c1)
        db.flush()

        movs1 = [
            # Ingresos sistema
            ("sistema", date(2026, 5, 5),  "Cobro Factura F-026-0041 — Transferencia", 8500.00, "ingreso", True),
            ("sistema", date(2026, 5, 12), "Cobro Factura F-026-0042 — Depósito",       5200.00, "ingreso", True),
            ("sistema", date(2026, 5, 20), "Cobro Factura F-026-0043 — Transferencia",  4750.00, "ingreso", True),
            # Egresos sistema
            ("sistema", date(2026, 5, 7),  "Pago gasto — Transferencia BCP",            2800.00, "egreso",  True),
            ("sistema", date(2026, 5, 15), "Pago gasto — Transferencia BCP",            1650.00, "egreso",  True),
            ("sistema", date(2026, 5, 23), "Pago gasto — Efectivo",                     1450.00, "egreso",  True),
            ("sistema", date(2026, 5, 28), "Pago gasto — Transferencia BCP",            2100.00, "egreso",  True),
            # Ingresos banco (mismos montos, ±0 días)
            ("banco",   date(2026, 5, 5),  "ABONO TRANSFERENCIA CLIENTE ANDAMIOS",      8500.00, "ingreso", True),
            ("banco",   date(2026, 5, 12), "DEPOSITO EN CUENTA CLIENTE",                5200.00, "ingreso", True),
            ("banco",   date(2026, 5, 20), "ABONO TRANSFERENCIA ELECTROPRO",            4750.00, "ingreso", True),
            # Egresos banco
            ("banco",   date(2026, 5, 7),  "CARGO PAGO PROVEEDOR INMOBILIARIA",        2800.00, "egreso",  True),
            ("banco",   date(2026, 5, 15), "CARGO PAGO FERRETERIA INDUSTRIAL",         1650.00, "egreso",  True),
            ("banco",   date(2026, 5, 23), "CARGO PAGO EFECTIVO CUADRILLA",            1450.00, "egreso",  True),
            ("banco",   date(2026, 5, 28), "CARGO PAGO PROVEEDOR MADERERIA",           2100.00, "egreso",  True),
        ]
        for origen, fecha, desc, monto, tipo, conc in movs1:
            db.add(MovimientoConciliacion(
                conciliacion_id=c1.id, fecha=fecha, descripcion=desc,
                monto=monto, tipo=tipo, origen=origen, conciliado=conc,
                created_at=c1.created_at,
            ))

        # ── Conciliación 2: Junio 2026 — Con diferencias ─────────────────────
        desde2 = date(2026, 6, 1)
        hasta2 = date(2026, 6, 15)

        c2 = ConciliacionBancaria(
            cuenta_bancaria_id=cuenta.id,
            periodo_desde=desde2,
            periodo_hasta=hasta2,
            banco="BCP",
            formato_archivo="excel",
            saldo_sistema=12300.00,
            saldo_banco=14800.00,
            diferencia=-2500.00,
            porcentaje_conciliado=60.0,
            estado="Con diferencias",
            created_at=hoy,
        )
        db.add(c2)
        db.flush()

        movs2 = [
            # Conciliados ✅
            ("sistema", date(2026, 6, 3),  "Cobro Factura F-026-0051 — Transferencia",  6200.00, "ingreso", True),
            ("banco",   date(2026, 6, 3),  "ABONO TRANSF CLIENTE ANDAMIOS",             6200.00, "ingreso", True),
            ("sistema", date(2026, 6, 8),  "Pago gasto — Transferencia",                1800.00, "egreso",  True),
            ("banco",   date(2026, 6, 8),  "CARGO PAGO PROVEEDOR",                      1800.00, "egreso",  True),
            ("sistema", date(2026, 6, 10), "Cobro Factura F-026-0052 — Depósito",        4850.00, "ingreso", True),
            ("banco",   date(2026, 6, 10), "DEPOSITO EN CUENTA CLIENTE LIMA",            4850.00, "ingreso", True),
            # Solo en sistema ❌ (no están en banco)
            ("sistema", date(2026, 6, 12), "Cobro Factura F-026-0053 — Efectivo",        1250.00, "ingreso", False),
            ("sistema", date(2026, 6, 14), "Pago gasto — Efectivo cuadrilla",             450.00, "egreso",  False),
            # Solo en banco ⚠️ (no están en sistema)
            ("banco",   date(2026, 6, 5),  "CARGO COMISION MANTENIMIENTO CUENTA",          15.00, "egreso",  False),
            ("banco",   date(2026, 6, 11), "ABONO TRANSFERENCIA NO IDENTIFICADA",        2500.00, "ingreso", False),
            ("banco",   date(2026, 6, 13), "CARGO ITF OPERACIONES",                        35.00, "egreso",  False),
        ]
        _kw_gb = ("itf","i.t.f","comision","comisión","mantenimiento","porte","seguro","cargo","costo")
        for origen, fecha, desc, monto, tipo, conc in movs2:
            es_gb = origen == "banco" and any(k in desc.lower() for k in _kw_gb)
            db.add(MovimientoConciliacion(
                conciliacion_id=c2.id, fecha=fecha, descripcion=desc,
                monto=monto, tipo=tipo, origen=origen, conciliado=conc,
                es_gasto_bancario=es_gb,
                created_at=c2.created_at,
            ))

        db.commit()
        print(f"✓ 2 conciliaciones seeded (c1.id={c1.id}, c2.id={c2.id})")

    except Exception as e:
        db.rollback()
        print(f"[seed_flujo_caja] Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
