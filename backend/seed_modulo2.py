"""
Seed Módulo 2 — Gestión Comercial (andamios)
Ejecutar: python seed_modulo2.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import engine, SessionLocal, Base
from app.models import models, comercial  # registra todos los modelos
from app.models.models import Cliente
from app.models.comercial import Cotizacion, VentaComercial, DocumentoCliente
from sqlalchemy import text
from datetime import date, timedelta
from pathlib import Path

TIPOS_SERVICIO = [
    "Alquiler de andamios", "Venta de andamios", "Reparación de andamios",
    "Venta de piezas", "Capacitación", "Transporte", "Montaje",
]

def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # ── Agregar columnas nuevas a clientes si no existen ─────────────────
        with engine.connect() as conn:
            for col, tipo in [("tipo_cliente","VARCHAR(50)"), ("distrito","VARCHAR(100)"), ("cargo_contacto","VARCHAR(100)")]:
                try:
                    conn.execute(text(f"ALTER TABLE clientes ADD COLUMN IF NOT EXISTS {col} {tipo}"))
                    conn.commit()
                except Exception:
                    conn.rollback()

        # ── Actualizar clientes existentes con tipo y distrito ───────────────
        updates = [
            (1, "constructora_grande",  "San Isidro",  "Gerente de Obra"),
            (2, "constructora_grande",  "San Isidro",  "Jefe de Licitaciones"),
            (3, "constructora_mediana", "Miraflores",  "Coordinador de Proyectos"),
            (4, "constructora_grande",  "San Borja",   "Gerente de Contratos"),
            (5, "constructora_mediana", "San Isidro",  "Jefe de Operaciones"),
            (6, "constructora_mediana", "Los Olivos",  "Gerente General"),
            (7, "constructora_pequena", "San Miguel",  "Administradora"),
            (8, "constructora_pequena", "Surco",       "Gerente de Proyectos"),
            (9, "constructora_mediana", "Miraflores",  "Director Técnico"),
            (10,"constructora_pequena", "Lince",       "Gerente Comercial"),
        ]
        for cid, tipo, dist, cargo in updates:
            c = db.query(Cliente).filter(Cliente.id == cid).first()
            if c:
                c.tipo_cliente = tipo
                c.distrito = dist
                c.cargo_contacto = cargo
        db.commit()

        if db.query(Cotizacion).count() > 0:
            print("[OK] Cotizaciones ya existen. Omitiendo seed.")
            return

        clientes = db.query(Cliente).order_by(Cliente.id).limit(10).all()
        c = clientes  # alias

        hoy = date.today()

        # ── 15 Cotizaciones en distintos estados ─────────────────────────────
        cots_data = [
            # num,       cli,   servicio,               desc,                              monto,    emision,              vto,                  estado
            ("COT-2026-001", c[0], "Alquiler de andamios", "Andamios fachada - Torre 8 pisos",  45000, date(2026,5,15), date(2026,6,30), "aprobada"),
            ("COT-2026-002", c[1], "Montaje",              "Montaje estructura proyecto centro", 18500, date(2026,5,20), date(2026,6,20), "enviada"),
            ("COT-2026-003", c[2], "Venta de andamios",    "Venta 120 marcos 48x190 galvaniz.",  85000, date(2026,4,10), date(2026,5,30), "aprobada"),
            ("COT-2026-004", c[3], "Reparación de andamios","Reparación 80 unidades dañadas",    12000, date(2026,4,20), date(2026,5,20), "rechazada"),
            ("COT-2026-005", c[4], "Transporte",           "Flete Lima - Chorrillos, 3 viajes",   8500, date(2026,5,25), date(2026,6,25), "enviada"),
            ("COT-2026-006", c[5], "Alquiler de andamios", "Alquiler 60 días - Obra La Molina",  32000, date(2026,5,10), date(2026,6,10), "rechazada"),
            ("COT-2026-007", c[6], "Capacitación",         "Curso trabajo en altura 20 pers.",    5000, date(2026,5,28), date(2026,6,28), "aprobada"),
            ("COT-2026-008", c[7], "Venta de piezas",      "Tornillos, pasadores y crucetas",    22000, date(2026,5,22), date(2026,6,22), "enviada"),
            ("COT-2026-009", c[8], "Alquiler de andamios", "Alquiler 90 días Hospital SJL",      55000, date(2026,5,5),  date(2026,7,5),  "aprobada"),
            ("COT-2026-010", c[9], "Montaje",              "Montaje y desmontaje obra Lince",    28000, date(2026,5,18), date(2026,6,18), "rechazada"),
            ("COT-2026-011", c[0], "Reparación de andamios","Revisión y pintura 50 unidades",    15000, date(2026,6,1),  hoy+timedelta(days=3), "enviada"),  # por vencer
            ("COT-2026-012", c[1], "Venta de andamios",    "200 marcos sistema europeo",        120000, date(2026,5,1),  date(2026,6,15), "aprobada"),
            ("COT-2026-013", c[2], "Transporte",           "Transporte urgente Miraflores",       9500, date(2026,6,5),  hoy+timedelta(days=5), "enviada"),  # por vencer
            ("COT-2026-014", c[3], "Alquiler de andamios", "Alquiler 45 días Viva GyM",          42000, date(2026,4,15), date(2026,5,30), "aprobada"),
            ("COT-2026-015", c[4], "Capacitación",         "Taller EPP y seguridad en obra",      6000, date(2026,6,8),  hoy+timedelta(days=6), "borrador"),  # por vencer
        ]
        cotizaciones = []
        for num, cli, serv, desc, monto, emision, vto, estado in cots_data:
            cot = Cotizacion(numero=num, cliente_id=cli.id, tipo_servicio=serv,
                             descripcion=desc, monto=monto, fecha_emision=emision,
                             fecha_vencimiento=vto, estado=estado)
            db.add(cot)
            cotizaciones.append(cot)
        db.flush()

        # ── 30 Ventas comerciales — historial 6 meses ────────────────────────
        ventas_data = [
            # Enero
            (c[0], "Alquiler de andamios", "Alquiler obra Los Olivos",        28000, date(2026,1,8)),
            (c[1], "Montaje",              "Montaje Cosapi Torre Centro",       12000, date(2026,1,15)),
            (c[2], "Venta de andamios",    "Marcos galvanizados 48x190",        45000, date(2026,1,20)),
            (c[3], "Reparación de andamios","Mantenimiento mensual Viva GyM",   8000,  date(2026,1,28)),
            (c[4], "Transporte",           "Flete San Isidro - SJL",            5500,  date(2026,1,30)),
            # Febrero
            (c[0], "Alquiler de andamios", "Alquiler fachada Miraflores",       32000, date(2026,2,5)),
            (c[6], "Capacitación",         "Curso altura 15 trabajadores",       4000,  date(2026,2,10)),
            (c[7], "Venta de piezas",      "Crucetas y pasadores",               9500,  date(2026,2,18)),
            (c[8], "Alquiler de andamios", "Alquiler Hospital SJL fase 1",       35000, date(2026,2,25)),
            (c[9], "Montaje",              "Montaje proyecto Lince",             15000, date(2026,2,28)),
            # Marzo
            (c[0], "Alquiler de andamios", "Renovación contrato Los Portales",  25000, date(2026,3,7)),
            (c[1], "Venta de andamios",    "Sistema europeo Cosapi",            55000, date(2026,3,14)),
            (c[3], "Alquiler de andamios", "Alquiler Viva GyM sede norte",      18000, date(2026,3,20)),
            (c[5], "Reparación de andamios","Reparación 40 marcos JE Const.",   11000, date(2026,3,25)),
            (c[4], "Transporte",           "Flete Miraflores-San Miguel",        6000,  date(2026,3,31)),
            # Abril
            (c[0], "Alquiler de andamios", "Alquiler mensual proyecto A",       38000, date(2026,4,4)),
            (c[2], "Montaje",              "Montaje Paz Centenario",             22000, date(2026,4,10)),
            (c[6], "Capacitación",         "Taller EPP 25 personas",             5000,  date(2026,4,18)),
            (c[8], "Alquiler de andamios", "Alquiler Hospital SJL fase 2",       42000, date(2026,4,24)),
            (c[7], "Venta de piezas",      "Tornillos y gatos niveladores",      12500, date(2026,4,30)),
            # Mayo
            (c[0], "Alquiler de andamios", "Alquiler Torre Miraflores",          45000, date(2026,5,6)),
            (c[1], "Montaje",              "Montaje y desmontaje Cosapi",        18000, date(2026,5,13)),
            (c[4], "Alquiler de andamios", "Alquiler obra Edifica",              22000, date(2026,5,20)),
            (c[3], "Reparación de andamios","Reparación urgente Viva GyM",       9500,  date(2026,5,27)),
            (c[6], "Capacitación",         "Curso seguridad actualización",       3500,  date(2026,5,30)),
            # Junio (mes actual)
            (c[0], "Alquiler de andamios", "Alquiler contrato marco Jun",        52000, date(2026,6,3)),
            (c[2], "Venta de andamios",    "Marcos nuevos Paz Centenario",       38000, date(2026,6,6)),
            (c[8], "Alquiler de andamios", "Alquiler AESA proyecto norte",       48000, date(2026,6,9)),
            (c[9], "Montaje",              "Montaje T&C Inmobiliaria",           25000, date(2026,6,11)),
            (c[6], "Venta de piezas",      "Piezas varias Urbanova",             14000, date(2026,6,12)),
        ]
        ventas_objs = []
        for cli, serv, desc, monto, fecha in ventas_data:
            v = VentaComercial(cliente_id=cli.id, tipo_servicio=serv,
                               descripcion=desc, monto=monto, fecha=fecha)
            db.add(v)
            ventas_objs.append(v)
        db.flush()

        # Marcar 2 cotizaciones aprobadas como convertidas a venta
        cotizaciones[2].venta_comercial_id = ventas_objs[2].id   # COT-003 → venta marco marzo
        cotizaciones[13].venta_comercial_id = ventas_objs[15].id  # COT-014 → venta abril

        db.flush()

        # ── Documentos de ejemplo (archivos .txt simulando docs) ─────────────
        TIPOS_DOC = ["Contrato", "RUC", "Orden de Servicio"]
        for cli in clientes:
            doc_dir = Path(f"uploads/clientes/{cli.id}")
            doc_dir.mkdir(parents=True, exist_ok=True)
            for tipo_doc in TIPOS_DOC:
                nombre = f"{tipo_doc.replace(' ','_')}_{cli.ruc}.txt"
                ruta = doc_dir / nombre
                contenido = f"Documento: {tipo_doc}\nCliente: {cli.razon_social}\nRUC: {cli.ruc}\nFecha: {date.today()}"
                ruta.write_text(contenido, encoding="utf-8")
                doc = DocumentoCliente(
                    cliente_id=cli.id, nombre=nombre, tipo=tipo_doc,
                    ruta_archivo=str(ruta), tamano=len(contenido.encode()),
                    fecha_carga=date.today(),
                )
                db.add(doc)

        db.commit()
        print("[OK] Modulo 2 seed insertado correctamente.")
        print(f"     15 cotizaciones | 30 ventas comerciales | {len(clientes)*3} documentos")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
