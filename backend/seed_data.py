"""
Seed data para Centryx - ElectroPro SAC
Ejecutar: python seed_data.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import engine, SessionLocal, Base
from app.models.models import (
    Usuario, Cliente, Proyecto, Venta, Factura, Gasto, FlujoCaja, Empleado
)
from passlib.context import CryptContext
from datetime import date, timedelta

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        if db.query(Usuario).count() > 0:
            print("⚠  La base de datos ya tiene datos. Omitiendo seed.")
            return

        # ── USUARIOS ──────────────────────────────────────────────────────────
        usuarios = [
            Usuario(nombre="Marco Salcedo",          email="marco.salcedo@electropro.pe", password=pwd_context.hash("Marco2026*"), rol="admin"),
            Usuario(nombre="Ana Flores Huamán",       email="gerente@electropro.pe",  password=pwd_context.hash("gerente123"), rol="gerente"),
            Usuario(nombre="Luis Quispe Torres",      email="contador@electropro.pe", password=pwd_context.hash("conta123"),   rol="administrador"),
            Usuario(nombre="Rosa Mamani Condori",     email="ventas@electropro.pe",   password=pwd_context.hash("ventas123"),  rol="vendedor"),
        ]
        db.add_all(usuarios)
        db.flush()

        # ── CLIENTES (10 del rubro construcción Lima) ─────────────────────────
        clientes = [
            Cliente(razon_social="Los Portales SA",                 ruc="20100897608", contacto="Ing. Roberto Salas",    telefono="01-6134300", email="contratos@losportales.com.pe",     direccion="Av. Javier Prado Este 1230, San Isidro"),
            Cliente(razon_social="Constructora Cosapi SAC",         ruc="20100010453", contacto="Arq. Patricia Vidal",   telefono="01-7110000", email="licitaciones@cosapi.com.pe",        direccion="Av. República de Panamá 3591, San Isidro"),
            Cliente(razon_social="Inmobiliaria Paz Centenario SAC", ruc="20501503581", contacto="Sr. Jorge Paz",         telefono="01-6167000", email="proyectos@pazcentenario.com.pe",    direccion="Av. Reducto 1370, Miraflores"),
            Cliente(razon_social="Viva GyM SAC",                    ruc="20600116637", contacto="Ing. Sandra López",     telefono="01-6177000", email="obras@vivagym.com.pe",              direccion="Av. Guardia Civil 1300, San Borja"),
            Cliente(razon_social="Edifica SAC",                     ruc="20556008827", contacto="Arq. Miguel Seminario", telefono="01-7170000", email="contratos@edifica.pe",              direccion="Calle Las Flores 395, San Isidro"),
            Cliente(razon_social="JE Construcciones Generales SAC", ruc="20503564310", contacto="Ing. Juan Espinoza",    telefono="01-4220000", email="jespinoza@jeconstrucciones.pe",     direccion="Av. Universitaria 1800, Los Olivos"),
            Cliente(razon_social="Urbanova Inmobiliaria SAC",       ruc="20543699520", contacto="Sra. Carmen Ríos",      telefono="01-3210000", email="carmen.rios@urbanova.pe",           direccion="Av. La Marina 2450, San Miguel"),
            Cliente(razon_social="Menorca Inversiones SAC",         ruc="20492909489", contacto="Ing. Pedro Menorca",    telefono="01-6120000", email="pmenorca@menorca.pe",               direccion="Calle Monte Rosa 255, Surco"),
            Cliente(razon_social="AESA Contratistas SAC",           ruc="20512956935", contacto="Ing. Alberto Espejo",   telefono="01-2610000", email="aespejo@aesa.pe",                   direccion="Av. Petit Thouars 4957, Miraflores"),
            Cliente(razon_social="Grupo T&C Inmobiliaria SAC",      ruc="20601234567", contacto="Sr. Tomás Castillo",    telefono="01-7250000", email="tcastillo@grupotc.pe",              direccion="Av. Arequipa 2850, Lince"),
        ]
        db.add_all(clientes)
        db.flush()

        # ── PROYECTOS ACTIVOS ─────────────────────────────────────────────────
        proyectos = [
            Proyecto(
                nombre="Torre Residencial Miraflores – Instalaciones Eléctricas",
                cliente_id=clientes[0].id,
                presupuesto=450000, ejecutado=337500,
                avance_fisico=75, avance_financiero=75,
                estado="activo",
                fecha_inicio=date(2026, 1, 15), fecha_fin=date(2026, 8, 30),
            ),
            Proyecto(
                nombre="Proyecto Residencial La Molina – Instalaciones Sanitarias",
                cliente_id=clientes[2].id,
                presupuesto=280000, ejecutado=126000,
                avance_fisico=45, avance_financiero=45,
                estado="activo",
                fecha_inicio=date(2026, 3, 1), fecha_fin=date(2026, 10, 15),
            ),
            Proyecto(
                nombre="Hospital SJL – Sistema de Gas Centralizado",
                cliente_id=clientes[5].id,
                presupuesto=380000, ejecutado=114000,
                avance_fisico=30, avance_financiero=30,
                estado="activo",
                fecha_inicio=date(2026, 4, 1), fecha_fin=date(2026, 11, 30),
            ),
            Proyecto(
                nombre="Centro Empresarial San Isidro – Instalaciones Eléctricas",
                cliente_id=clientes[1].id,
                presupuesto=620000, ejecutado=372000,
                avance_fisico=60, avance_financiero=60,
                estado="activo",
                fecha_inicio=date(2026, 2, 1), fecha_fin=date(2026, 9, 30),
            ),
        ]
        db.add_all(proyectos)
        db.flush()

        # ── VENTAS últimos 6 meses con tendencia creciente ────────────────────
        ventas_data = [
            # Enero 2026 – S/ 95,000
            (clientes[0].id, proyectos[0].id, 28000, date(2026, 1, 8),  "electrica"),
            (clientes[3].id, None,             22000, date(2026, 1, 15), "sanitaria"),
            (clientes[1].id, proyectos[3].id, 18000, date(2026, 1, 20), "electrica"),
            (clientes[6].id, None,             15000, date(2026, 1, 28), "gas"),
            (clientes[4].id, None,             12000, date(2026, 1, 30), "electrica"),
            # Febrero 2026 – S/ 108,000
            (clientes[0].id, proyectos[0].id, 32000, date(2026, 2, 5),  "electrica"),
            (clientes[1].id, proyectos[3].id, 25000, date(2026, 2, 12), "electrica"),
            (clientes[2].id, proyectos[1].id, 20000, date(2026, 2, 18), "sanitaria"),
            (clientes[7].id, None,             18000, date(2026, 2, 25), "gas"),
            (clientes[8].id, None,             13000, date(2026, 2, 28), "electrica"),
            # Marzo 2026 – S/ 118,000
            (clientes[0].id, proyectos[0].id, 35000, date(2026, 3, 7),  "electrica"),
            (clientes[1].id, proyectos[3].id, 28000, date(2026, 3, 14), "electrica"),
            (clientes[2].id, proyectos[1].id, 22000, date(2026, 3, 20), "sanitaria"),
            (clientes[5].id, proyectos[2].id, 20000, date(2026, 3, 25), "gas"),
            (clientes[9].id, None,             13000, date(2026, 3, 31), "electrica"),
            # Abril 2026 – S/ 128,000
            (clientes[0].id, proyectos[0].id, 38000, date(2026, 4, 4),  "electrica"),
            (clientes[1].id, proyectos[3].id, 30000, date(2026, 4, 10), "electrica"),
            (clientes[5].id, proyectos[2].id, 25000, date(2026, 4, 18), "gas"),
            (clientes[2].id, proyectos[1].id, 22000, date(2026, 4, 24), "sanitaria"),
            (clientes[4].id, None,             13000, date(2026, 4, 30), "electrica"),
            # Mayo 2026 – S/ 142,000
            (clientes[0].id, proyectos[0].id, 42000, date(2026, 5, 6),  "electrica"),
            (clientes[1].id, proyectos[3].id, 35000, date(2026, 5, 13), "electrica"),
            (clientes[5].id, proyectos[2].id, 28000, date(2026, 5, 20), "gas"),
            (clientes[2].id, proyectos[1].id, 24000, date(2026, 5, 27), "sanitaria"),
            (clientes[8].id, None,             13000, date(2026, 5, 30), "electrica"),
            # Junio 2026 – S/ 150,000
            (clientes[0].id, proyectos[0].id, 45000, date(2026, 6, 3),  "electrica"),
            (clientes[1].id, proyectos[3].id, 38000, date(2026, 6, 6),  "electrica"),
            (clientes[5].id, proyectos[2].id, 30000, date(2026, 6, 9),  "gas"),
            (clientes[2].id, proyectos[1].id, 25000, date(2026, 6, 12), "sanitaria"),
            (clientes[7].id, None,             12000, date(2026, 6, 12), "gas"),
        ]
        ventas = [
            Venta(cliente_id=c, proyecto_id=p, monto=m, fecha=f, estado="aprobada", tipo=t)
            for c, p, m, f, t in ventas_data
        ]
        db.add_all(ventas)

        # ── GASTOS mes de junio 2026 ──────────────────────────────────────────
        gastos_data = [
            # Personal 44% = S/ 39,600
            ("Personal", "Planilla técnicos y operarios",    18500, date(2026, 6, 1),  "Operaciones"),
            ("Personal", "Planilla administrativos",          9800,  date(2026, 6, 1),  "Administración"),
            ("Personal", "Planilla vendedores",               7200,  date(2026, 6, 1),  "Ventas"),
            ("Personal", "Gratificaciones y beneficios",      4100,  date(2026, 6, 5),  "RRHH"),
            # Administrativos 22% = S/ 19,800
            ("Administrativos", "Alquiler oficina Miraflores", 8500, date(2026, 6, 1),  "Administración"),
            ("Administrativos", "Servicios públicos",           2800, date(2026, 6, 10), "Administración"),
            ("Administrativos", "Contabilidad y asesoría legal",3500, date(2026, 6, 5),  "Administración"),
            ("Administrativos", "Seguros y pólizas",            2200, date(2026, 6, 8),  "Administración"),
            ("Administrativos", "Útiles de oficina y TI",       2800, date(2026, 6, 12), "Administración"),
            # Operativos 20% = S/ 18,000
            ("Operativos", "Materiales eléctricos y cables",   7500, date(2026, 6, 2),  "Operaciones"),
            ("Operativos", "Herramientas y EPP",               3200, date(2026, 6, 6),  "Operaciones"),
            ("Operativos", "Transporte y logística",           4300, date(2026, 6, 8),  "Operaciones"),
            ("Operativos", "Subcontratos especializados",      3000, date(2026, 6, 11), "Operaciones"),
            # Ventas 14% = S/ 12,600
            ("Ventas", "Comisiones de ventas",                 5500, date(2026, 6, 1),  "Ventas"),
            ("Ventas", "Marketing digital y publicidad",       3500, date(2026, 6, 5),  "Ventas"),
            ("Ventas", "Viáticos y representación",            2100, date(2026, 6, 10), "Ventas"),
            ("Ventas", "Material promocional",                 1500, date(2026, 6, 12), "Ventas"),
        ]
        gastos = [
            Gasto(categoria=cat, descripcion=desc, monto=monto, fecha=f, area=area)
            for cat, desc, monto, f, area in gastos_data
        ]
        db.add_all(gastos)

        # ── FACTURAS con semáforo de morosidad ───────────────────────────────
        facturas_data = [
            # Verde – al día (vence en el futuro)
            (clientes[0].id, "F001-1025", 45000, date(2026, 5, 20), date(2026, 6, 20), "pendiente"),
            (clientes[1].id, "F001-1026", 38000, date(2026, 5, 25), date(2026, 6, 25), "pendiente"),
            (clientes[3].id, "F001-1027", 22000, date(2026, 6, 1),  date(2026, 6, 30), "pendiente"),
            (clientes[6].id, "F001-1028", 15000, date(2026, 6, 5),  date(2026, 7, 5),  "pendiente"),
            (clientes[9].id, "F001-1029", 12000, date(2026, 6, 10), date(2026, 7, 10), "pendiente"),
            # Amarillo – 1 a 15 días vencidas
            (clientes[2].id, "F001-1020", 28000, date(2026, 5, 5),  date(2026, 6, 5),  "pendiente"),
            (clientes[4].id, "F001-1021", 18000, date(2026, 5, 10), date(2026, 6, 8),  "pendiente"),
            (clientes[7].id, "F001-1022", 9500,  date(2026, 5, 12), date(2026, 6, 10), "pendiente"),
            # Rojo – más de 15 días vencidas
            (clientes[5].id, "F001-1015", 32000, date(2026, 4, 15), date(2026, 5, 15), "pendiente"),
            (clientes[8].id, "F001-1016", 21000, date(2026, 4, 20), date(2026, 5, 20), "pendiente"),
            # Pagadas
            (clientes[0].id, "F001-1010", 38000, date(2026, 4, 1),  date(2026, 5, 1),  "pagada"),
            (clientes[1].id, "F001-1011", 30000, date(2026, 4, 5),  date(2026, 5, 5),  "pagada"),
            (clientes[3].id, "F001-1012", 25000, date(2026, 4, 10), date(2026, 5, 10), "pagada"),
        ]
        hoy = date.today()
        facturas = []
        for cid, num, monto, f_emision, f_vto, estado in facturas_data:
            dias = max(0, (hoy - f_vto).days) if estado == "pendiente" else 0
            facturas.append(Factura(
                cliente_id=cid, numero=num, monto=monto,
                fecha_emision=f_emision, fecha_vencimiento=f_vto,
                estado=estado, dias_vencido=dias,
            ))
        db.add_all(facturas)

        # ── FLUJO DE CAJA 6 meses ─────────────────────────────────────────────
        flujo_data = [
            (6, 2026, 165000, 92000),
            (7, 2026, 172000, 95000),
            (8, 2026, 180000, 98000),
            (9, 2026, 185000, 100000),
            (10, 2026, 192000, 103000),
            (11, 2026, 198000, 106000),
        ]
        flujos = [
            FlujoCaja(mes=m, anio=a, ingresos_proyectados=ing, egresos_proyectados=eg,
                      saldo_proyectado=ing - eg)
            for m, a, ing, eg in flujo_data
        ]
        db.add_all(flujos)

        # ── EMPLEADOS ─────────────────────────────────────────────────────────
        empleados = [
            Empleado(nombre="Carlos Mendoza Ríos",    cargo="Gerente General",           sueldo=8500,  fecha_ingreso=date(2018, 3, 1),  estado="activo", vacaciones_dias=15, tardanzas=0),
            Empleado(nombre="Ana Flores Huamán",       cargo="Gerente Comercial",          sueldo=7200,  fecha_ingreso=date(2019, 7, 15), estado="activo", vacaciones_dias=10, tardanzas=1),
            Empleado(nombre="Luis Quispe Torres",      cargo="Contador General",           sueldo=5800,  fecha_ingreso=date(2020, 1, 10), estado="activo", vacaciones_dias=20, tardanzas=0),
            Empleado(nombre="Rosa Mamani Condori",     cargo="Ejecutiva de Ventas",        sueldo=3200,  fecha_ingreso=date(2021, 5, 1),  estado="activo", vacaciones_dias=5,  tardanzas=2),
            Empleado(nombre="Marco Ríos Huanca",       cargo="Ing. Eléctrico Senior",      sueldo=5500,  fecha_ingreso=date(2019, 9, 1),  estado="activo", vacaciones_dias=12, tardanzas=0),
            Empleado(nombre="César Tapia Lazo",        cargo="Ing. Sanitario Senior",      sueldo=5200,  fecha_ingreso=date(2020, 3, 15), estado="activo", vacaciones_dias=8,  tardanzas=1),
            Empleado(nombre="Patricia Vargas Silva",   cargo="Técnico Electricista",       sueldo=2800,  fecha_ingreso=date(2022, 2, 1),  estado="activo", vacaciones_dias=3,  tardanzas=3),
            Empleado(nombre="Juan Huamán Ccoa",        cargo="Técnico Electricista",       sueldo=2800,  fecha_ingreso=date(2022, 6, 1),  estado="activo", vacaciones_dias=3,  tardanzas=2),
            Empleado(nombre="Elena Soto Paredes",      cargo="Asistente Administrativa",   sueldo=2200,  fecha_ingreso=date(2023, 1, 15), estado="activo", vacaciones_dias=0,  tardanzas=1),
            Empleado(nombre="Roberto Chávez Pinto",    cargo="Almacenero / Logística",     sueldo=2100,  fecha_ingreso=date(2023, 4, 1),  estado="activo", vacaciones_dias=0,  tardanzas=4),
            Empleado(nombre="Diana Quispe Flores",     cargo="Técnico de Gas",             sueldo=3000,  fecha_ingreso=date(2021, 8, 1),  estado="activo", vacaciones_dias=6,  tardanzas=1),
            Empleado(nombre="Sergio Llanos Ramos",     cargo="Técnico Sanitario",          sueldo=2900,  fecha_ingreso=date(2022, 10, 1), estado="activo", vacaciones_dias=2,  tardanzas=2),
        ]
        db.add_all(empleados)
        db.commit()
        print("[OK] Seed data insertado correctamente.")
        print("   Usuario admin: admin@electropro.pe / admin123")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
