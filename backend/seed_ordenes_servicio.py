"""
Seed de órdenes de servicio para Centryx — empresa de andamios.
8 órdenes de ejemplo: 2 Pendientes, 3 En Proceso (30/65/80%), 2 Completadas, 1 Cancelada.
Distribuidas entre los clientes existentes.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import date, timedelta
from database import SessionLocal
from app.models.models import OrdenServicio, Cliente

# fmt: (dias_offset_inicio, dias_duracion, tipo_servicio, descripcion, direccion, distrito,
#       presupuesto, avance, estado, dias_fin_real_tras_estimado_o_None, observaciones)
DATA = [
    (10,  20, "Alquiler de andamios",   "Alquiler de andamios tubulares para fachada de edificio",
     "Av. Javier Prado 4500", "San Isidro",    18500.00,   0, "Pendiente", None, ""),
    (18,  15, "Montaje",                "Montaje de andamios para mantenimiento de torre",
     "Calle Los Alisos 220",  "Surco",          9800.00,   0, "Pendiente", None, ""),

    (-5,  30, "Alquiler de andamios",   "Alquiler y supervisión de andamios en obra residencial",
     "Av. Benavides 3200",    "Miraflores",    24200.00,  30, "En Proceso", None,
     "Cliente solicitó ampliar el área de trabajo en la 2da semana."),
    (-15, 25, "Reparación de andamios", "Reparación estructural de andamios dañados por viento",
     "Jr. Ucayali 150",       "Cercado de Lima", 7300.00,  65, "En Proceso", None, ""),
    (-20, 35, "Montaje",                "Montaje integral de andamios para nueva torre corporativa",
     "Av. El Derby 250",      "Santiago de Surco", 38900.00, 80, "En Proceso", None,
     "Última etapa: acabados y desmontaje parcial de niveles inferiores."),

    (-60, 25, "Venta de andamios",      "Venta e instalación de andamios modulares",
     "Av. Aviación 3050",     "San Borja",     15600.00, 100, "Completada", 2,
     "Entrega conforme, cliente satisfecho."),
    (-90, 20, "Capacitación",           "Capacitación en armado seguro de andamios para cuadrilla",
     "Av. Colonial 1780",     "Cercado de Lima", 4200.00, 100, "Completada", -1,
     "Certificados entregados a 12 operarios."),

    (-30, 20, "Transporte",             "Transporte de andamios a obra en Chorrillos",
     "Av. Defensores del Morro 2100", "Chorrillos", 3100.00, 15, "Cancelada", None,
     "Cliente canceló el proyecto por falta de permisos municipales."),
]


def run():
    db = SessionLocal()
    try:
        existing = db.query(OrdenServicio).count()
        if existing > 0:
            print(f"Ya existen {existing} órdenes de servicio. Seed omitido.")
            return

        clientes = db.query(Cliente).order_by(Cliente.id.asc()).limit(20).all()
        hoy = date.today()

        for i, (off_ini, dur, tipo, desc, direccion, distrito, presupuesto,
                avance, estado, off_fin_real, obs) in enumerate(DATA):
            cliente = clientes[i % len(clientes)] if clientes else None
            fecha_inicio = hoy + timedelta(days=off_ini)
            fecha_fin_est = fecha_inicio + timedelta(days=dur)
            fecha_fin_real = None
            if off_fin_real is not None:
                fecha_fin_real = fecha_fin_est + timedelta(days=off_fin_real)

            o = OrdenServicio(
                numero_orden=f"OS-{i + 1:04d}",
                cliente_id=cliente.id if cliente else None,
                tipo_servicio=tipo,
                descripcion=desc,
                direccion_obra=direccion,
                distrito=distrito,
                fecha_inicio=fecha_inicio,
                fecha_fin_estimada=fecha_fin_est,
                fecha_fin_real=fecha_fin_real,
                presupuesto=presupuesto,
                moneda="PEN",
                tipo_cambio=None,
                presupuesto_soles=presupuesto,
                avance_porcentaje=avance,
                estado=estado,
                observaciones=obs or None,
                created_at=fecha_inicio,
                updated_at=hoy,
            )
            db.add(o)

        db.commit()
        print(f"✓ {len(DATA)} órdenes de servicio insertadas")
    finally:
        db.close()


if __name__ == "__main__":
    run()
