"""
Ejecutar desde D:\CENTRYX\backend:
    python seed_comprobantes.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from app.models.comercial import VentaComercial
from app.models.models import Cliente
from datetime import date

IGV_RATE = 0.18

def igv(base): return round(base * IGV_RATE, 2)
def total(base): return round(base + igv(base), 2)

# (pos_cliente, tipo_doc, numero, doc_relacionado, tipo_servicio, descripcion, base_imponible, fecha)
COMPROBANTES = [
    # 15 Facturas
    (1,  "Factura",        "F001-00001", None,        "Alquiler de andamios",   "Alquiler de andamios tubulares multidireccionales por 30 dias",          7500.00, date(2026, 1, 15)),
    (2,  "Factura",        "F001-00002", None,        "Montaje",                "Instalacion y supervision de andamios en fachada de edificio 12 pisos",   4500.00, date(2026, 1, 22)),
    (3,  "Factura",        "F001-00003", None,        "Venta de andamios",      "Venta de andamios tubulares tipo europeo - 200 modulos",                 35000.00, date(2026, 2,  3)),
    (4,  "Factura",        "F001-00004", None,        "Capacitacion",           "Capacitacion en armado y desarmado seguro de andamios - 12 operarios",    1500.00, date(2026, 2, 10)),
    (5,  "Factura",        "F001-00005", None,        "Alquiler de andamios",   "Alquiler de andamios de fachada para edificio residencial 45 dias",        9500.00, date(2026, 2, 18)),
    (6,  "Factura",        "F001-00006", None,        "Transporte",             "Flete y movilizacion de andamios a proyecto en Miraflores",                 800.00, date(2026, 2, 25)),
    (7,  "Factura",        "F001-00007", None,        "Reparacion de andamios", "Reparacion y pintura anticorrosiva de 150 modulos de andamio",             5500.00, date(2026, 3,  5)),
    (8,  "Factura",        "F001-00008", None,        "Alquiler de andamios",   "Alquiler mensual de andamios para obra de ampliacion industrial",           8300.00, date(2026, 3, 12)),
    (9,  "Factura",        "F001-00009", None,        "Venta de piezas",        "Venta de bases niveladoras, ruedas y conectores para andamios",             2000.00, date(2026, 3, 20)),
    (10, "Factura",        "F001-00010", None,        "Montaje",                "Servicio de montaje y desmontaje de andamios para obra en altura",          3500.00, date(2026, 3, 28)),
    (1,  "Factura",        "F001-00011", None,        "Alquiler de andamios",   "Alquiler de andamios colgantes para mantenimiento de fachada 60 dias",    11500.00, date(2026, 4,  8)),
    (2,  "Factura",        "F001-00012", None,        "Venta de piezas",        "Venta de tablones de madera certificados y perfiles metalicos",             2700.00, date(2026, 4, 15)),
    (3,  "Factura",        "F001-00013", None,        "Capacitacion",           "Curso de trabajo en altura y uso seguro de andamios norma OSHA",            2100.00, date(2026, 4, 22)),
    (4,  "Factura",        "F001-00014", None,        "Reparacion de andamios", "Mantenimiento preventivo y correctivo de andamios propios del cliente",     4000.00, date(2026, 5,  2)),
    (5,  "Factura",        "F001-00015", None,        "Venta de andamios",      "Venta de sistema de andamiaje multidireccional completo 350 modulos",      49000.00, date(2026, 5, 10)),
    # 3 Boletas
    (6,  "Boleta de Venta","B001-00001", None,        "Transporte",             "Transporte de andamios a proyecto en San Isidro",                          1200.00, date(2026, 5, 19)),
    (7,  "Boleta de Venta","B001-00002", None,        "Capacitacion",           "Taller practico de seguridad en andamios - 4 operarios",                    500.00, date(2026, 5, 26)),
    (8,  "Boleta de Venta","B001-00003", None,        "Venta de piezas",        "Venta de accesorios y repuestos varios para andamios",                     2800.00, date(2026, 6,  3)),
    # 1 Nota de Credito
    (3,  "Nota de Credito","NC-00001",   "F001-00003","Venta de andamios",      "Nota de credito por devolucion parcial de modulos con defecto",           -2000.00, date(2026, 6,  7)),
    # 1 Nota de Debito
    (5,  "Nota de Debito", "ND-00001",   "F001-00005","Alquiler de andamios",   "Nota de debito por dias adicionales de alquiler no facturados",              500.00, date(2026, 6, 10)),
]


def seed():
    db = SessionLocal()
    try:
        clientes = db.query(Cliente).order_by(Cliente.id).limit(10).all()
        if not clientes:
            print("ERROR: No hay clientes en la BD.")
            return

        # Eliminar comprobantes previos del seed
        prefijos = ("F001-", "B001-", "NC-", "ND-")
        previos = db.query(VentaComercial).filter(
            VentaComercial.numero_factura.like("F001-%") |
            VentaComercial.numero_factura.like("B001-%") |
            VentaComercial.numero_factura.like("NC-%")   |
            VentaComercial.numero_factura.like("ND-%")
        ).all()
        for p in previos:
            db.delete(p)
        db.flush()

        for pos, tipo_doc, numero, doc_rel, tipo_serv, desc, base, fecha in COMPROBANTES:
            idx = min(pos - 1, len(clientes) - 1)
            cli = clientes[idx]
            igv_v  = igv(base)
            tot    = total(base)
            venta = VentaComercial(
                cliente_id           = cli.id,
                tipo_servicio        = tipo_serv,
                descripcion          = desc,
                monto                = tot,
                fecha                = fecha,
                numero_factura       = numero,
                estado               = "completada",
                tipo_documento       = tipo_doc,
                base_imponible       = base,
                igv                  = igv_v,
                precio_venta         = tot,
                documento_relacionado= doc_rel,
                ruc_cliente          = cli.ruc,
                razon_social_cliente = cli.razon_social,
            )
            db.add(venta)

        db.commit()
        print("OK: 20 comprobantes creados")
        print(f"    15 Facturas   : F001-00001 -> F001-00015")
        print(f"     3 Boletas    : B001-00001 -> B001-00003")
        print(f"     1 N.Credito  : NC-00001 (relacionado a F001-00003)")
        print(f"     1 N.Debito   : ND-00001 (relacionado a F001-00005)")
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
