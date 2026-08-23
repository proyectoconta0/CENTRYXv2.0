"""
Ejecutar desde D:\CENTRYX\backend:
    python seed_facturas.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from app.models.comercial import VentaComercial
from app.models.models import Cliente
from datetime import date

FACTURAS = [
    # (cliente_pos, tipo_servicio, descripcion, monto, fecha)
    (1, "Alquiler de andamios",   "Alquiler de andamios tubulares multidireccionales por 30 días",         8500.00,  date(2026, 1, 15)),
    (2, "Montaje",                "Instalación y supervisión de andamios en fachada de edificio 12 pisos", 5200.00,  date(2026, 1, 22)),
    (3, "Venta de andamios",      "Venta de andamios tubulares tipo europeo – 200 módulos",                42000.00, date(2026, 2,  3)),
    (4, "Capacitación",           "Capacitación en armado y desarmado seguro de andamios – 12 operarios",  1800.00,  date(2026, 2, 10)),
    (5, "Alquiler de andamios",   "Alquiler de andamios de fachada para edificio residencial – 45 días",   11200.00, date(2026, 2, 18)),
    (6, "Transporte",             "Flete y movilización de andamios a proyecto en Miraflores",              950.00,  date(2026, 2, 25)),
    (7, "Reparación de andamios", "Reparación y pintura anticorrosiva de 150 módulos de andamio",          6300.00,  date(2026, 3,  5)),
    (8, "Alquiler de andamios",   "Alquiler mensual de andamios para obra de ampliación industrial",       9800.00,  date(2026, 3, 12)),
    (9, "Venta de piezas",        "Venta de bases niveladoras, ruedas y conectores para andamios",         2400.00,  date(2026, 3, 20)),
    (10,"Montaje",                "Servicio de montaje y desmontaje de andamios para obra en altura",       4100.00,  date(2026, 3, 28)),
    (1, "Alquiler de andamios",   "Alquiler de andamios colgantes para mantenimiento de fachada – 60 días",13500.00, date(2026, 4,  8)),
    (2, "Venta de piezas",        "Venta de tablones de madera certificados y perfiles metálicos",          3200.00,  date(2026, 4, 15)),
    (3, "Capacitación",           "Curso de trabajo en altura y uso seguro de andamios – norma OSHA",       2500.00,  date(2026, 4, 22)),
    (4, "Reparación de andamios", "Mantenimiento preventivo y correctivo de andamios propios del cliente",  4700.00,  date(2026, 5,  2)),
    (5, "Venta de andamios",      "Venta de sistema de andamiaje multidireccional completo – 350 módulos", 58000.00, date(2026, 5, 10)),
    (6, "Transporte",             "Transporte e instalación de andamios en dos frentes de obra – San Isidro",1450.00, date(2026, 5, 19)),
    (7, "Montaje",                "Servicio completo de montaje, nivelación y supervisión de andamios",     7800.00,  date(2026, 5, 26)),
    (8, "Alquiler de andamios",   "Alquiler de andamios para renovación de hotel en Miraflores – 90 días", 16500.00, date(2026, 6,  3)),
    (9, "Venta de piezas",        "Venta de conectores, tornillos de seguridad y accesorios de andamio",    1850.00,  date(2026, 6, 10)),
    (10,"Reparación de andamios", "Reparación estructural de andamios con soldadura y galvanizado en frío",  5600.00,  date(2026, 6, 14)),
]


def seed():
    db = SessionLocal()
    try:
        clientes = db.query(Cliente).order_by(Cliente.id).limit(10).all()
        if not clientes:
            print("❌ No hay clientes en la BD. Ejecuta primero el seed de clientes.")
            return

        # Eliminar facturas de seed previas (F001-xxxxx)
        previas = db.query(VentaComercial).filter(
            VentaComercial.numero_factura.like("F001-%")
        ).all()
        for p in previas:
            db.delete(p)
        db.flush()

        for i, (pos, tipo, desc, monto, fecha) in enumerate(FACTURAS, 1):
            idx = min(pos - 1, len(clientes) - 1)
            venta = VentaComercial(
                cliente_id=clientes[idx].id,
                tipo_servicio=tipo,
                descripcion=desc,
                monto=monto,
                fecha=fecha,
                numero_factura=f"F001-{i:05d}",
                estado="completada",
            )
            db.add(venta)

        db.commit()
        print("OK: 20 facturas creadas exitosamente (F001-00001 -> F001-00020)")
        for i, (pos, tipo, _, monto, fecha) in enumerate(FACTURAS, 1):
            idx = min(pos - 1, len(clientes) - 1)
            nombre = clientes[idx].razon_social
            print(f"   F001-{i:05d}  {fecha}  S/{monto:>10,.2f}  {nombre[:30]}")
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
