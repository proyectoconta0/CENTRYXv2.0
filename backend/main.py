import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from database import engine
from app.models import models
from app.models import comercial                            # registra tablas módulo 2 y 3
from app.models import flujo_caja as flujo_caja_models     # registra tablas módulo 5
from app.models import reportes as reportes_models         # registra tablas módulo 9 - Reportes
from app.models import configuracion as configuracion_models  # registra tablas módulo 10 - Configuración
from app.models import auditoria as auditoria_models        # registra tabla auditoria_logs
from app.routers import (
    auth, dashboard, clientes,
    comprobantes as comprobantes_router,
    comercial as comercial_router,
    ventas as ventas_router,
    documentos as documentos_router,
    cobranza as cobranza_router,
    cuentas_bancarias as cuentas_bancarias_router,
    gastos as gastos_router,
    proveedores_gastos as proveedores_gastos_router,
    flujo_caja as flujo_caja_router,
    utils as utils_router,
    ordenes_servicio as ordenes_servicio_router,
    proveedores as proveedores_router,
    indicadores as indicadores_router,
    reportes as reportes_router,
    configuracion as configuracion_router,
    notificaciones as notificaciones_router,
    auditoria as auditoria_router,
    busqueda as busqueda_router,
    detracciones as detracciones_router,
    ordenes_pago as ordenes_pago_router,
    ordenes_cobro as ordenes_cobro_router,
    garantias as garantias_router,
    prestamos as prestamos_router,
    cotizaciones as cotizaciones_router,
)
from app.core.security import require_modulo, get_current_usuario

models.Base.metadata.create_all(bind=engine)

# ── Migración: añadir columnas de cobranza si no existen ──────────────────────
def _run_migrations():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS saldo_pendiente FLOAT",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS estado_cobranza VARCHAR(50)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) DEFAULT 'PEN'",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS tipo_cambio FLOAT",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS monto_original FLOAT",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS precio_venta_soles FLOAT",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Nuevas columnas en pagos_cobranza (campos adicionales por método de pago)
        for sql in [
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS banco VARCHAR(100)",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS numero_cuenta VARCHAR(50)",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS numero_cheque VARCHAR(50)",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Redondeo de cobranzas (tolerancia al cerrar deuda)
        for sql in [
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS redondeo_tipo VARCHAR(20)",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS redondeo_monto FLOAT DEFAULT 0",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Extorno bancario de cobranzas
        for sql in [
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS extornado BOOLEAN DEFAULT FALSE",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS fecha_extorno TIMESTAMP",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS motivo_extorno TEXT",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS extornado_por VARCHAR(100)",
        ]:
            conn.execute(text(sql))
        conn.commit()

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS movimientos_caja (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                tipo VARCHAR(20) NOT NULL,
                categoria VARCHAR(100),
                descripcion TEXT,
                monto FLOAT NOT NULL,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

        # Devolución de garantías: pago (con cuenta bancaria) + tracking parcial
        conn.execute(text(
            "ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS cuenta_bancaria_id INTEGER REFERENCES cuentas_bancarias(id)"
        ))
        for sql in [
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS monto_devuelto FLOAT DEFAULT 0",
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS monto_pendiente FLOAT",
        ]:
            conn.execute(text(sql))
        conn.commit()
        # Backfill de garantías creadas antes de este cambio (modelo anterior
        # sin tracking parcial): "devuelta"/"ejecutada" ya no tienen nada
        # pendiente por devolver; "retenida" arranca con el monto completo.
        conn.execute(text("""
            UPDATE garantias SET
                monto_pendiente = CASE WHEN estado IN ('devuelta', 'ejecutada') THEN 0 ELSE monto END,
                monto_devuelto  = CASE WHEN estado = 'devuelta' THEN monto ELSE COALESCE(monto_devuelto, 0) END
            WHERE monto_pendiente IS NULL
        """))
        conn.commit()

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pagos_garantia (
                id SERIAL PRIMARY KEY,
                garantia_id INTEGER REFERENCES garantias(id),
                monto FLOAT NOT NULL,
                fecha DATE NOT NULL,
                metodo_pago VARCHAR(50) NOT NULL,
                cuenta_bancaria_id INTEGER REFERENCES cuentas_bancarias(id),
                observacion TEXT,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

        # Compensación de créditos (garantías ejecutadas aplicadas como pago)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS creditos_cliente (
                id SERIAL PRIMARY KEY,
                cliente_id INTEGER REFERENCES clientes(id),
                origen VARCHAR(50),
                origen_id INTEGER,
                numero_documento VARCHAR(50),
                monto_original FLOAT NOT NULL,
                monto_disponible FLOAT NOT NULL,
                estado VARCHAR(20) DEFAULT 'disponible',
                fecha DATE NOT NULL,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS compensaciones_credito (
                id SERIAL PRIMARY KEY,
                venta_id INTEGER REFERENCES ventas_comercial(id),
                credito_id INTEGER REFERENCES creditos_cliente(id),
                monto FLOAT NOT NULL,
                fecha DATE NOT NULL,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

        # ── Reimplementación de Garantías: cliente por RUC/nombre (ya no por
        # cliente_id), ejecución parcial (monto_ejecutado), pagos unificados
        # (tipo devolucion/ejecucion). No se eliminan columnas ni tablas
        # anteriores — solo se agregan las nuevas y se backfillea desde las
        # viejas para no perder datos ya cargados.
        for sql in [
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS cliente_ruc VARCHAR(11)",
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(200)",
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS monto_ejecutado FLOAT DEFAULT 0",
        ]:
            conn.execute(text(sql))
        conn.commit()
        conn.execute(text("""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='garantias' AND column_name='cliente_id'
              ) THEN
                UPDATE garantias g SET
                    cliente_ruc    = c.ruc,
                    cliente_nombre = c.razon_social
                FROM clientes c
                WHERE g.cliente_id = c.id AND g.cliente_ruc IS NULL;
              END IF;
            END $$;
        """))
        conn.commit()

        for sql in [
            "ALTER TABLE pagos_garantia ADD COLUMN IF NOT EXISTS tipo VARCHAR(20)",
            "ALTER TABLE pagos_garantia ADD COLUMN IF NOT EXISTS numero_documento_generado VARCHAR(50)",
            "ALTER TABLE pagos_garantia ALTER COLUMN metodo_pago DROP NOT NULL",
        ]:
            conn.execute(text(sql))
        conn.execute(text(
            "UPDATE pagos_garantia SET tipo = 'devolucion' WHERE tipo IS NULL"
        ))
        conn.commit()

        for sql in [
            "ALTER TABLE creditos_cliente ADD COLUMN IF NOT EXISTS cliente_ruc VARCHAR(11)",
            "ALTER TABLE creditos_cliente ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(200)",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Método de cobro / cuenta bancaria al crear una garantía.
        for sql in [
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS metodo_cobro VARCHAR(50)",
            "ALTER TABLE garantias ADD COLUMN IF NOT EXISTS cuenta_bancaria_id INTEGER REFERENCES cuentas_bancarias(id)",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Trazabilidad para poder revertir cobros/ejecuciones de garantía al
        # eliminarla: qué VentaComercial saldó una ejecución directa
        # (factura/recibo interno), y qué CreditoCliente generó un cobro.
        for sql in [
            "ALTER TABLE pagos_garantia ADD COLUMN IF NOT EXISTS venta_id INTEGER REFERENCES ventas_comercial(id)",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS origen VARCHAR(50)",
            "ALTER TABLE pagos_cobranza ADD COLUMN IF NOT EXISTS origen_id INTEGER",
        ]:
            conn.execute(text(sql))
        conn.commit()
        conn.execute(text("""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='creditos_cliente' AND column_name='cliente_id'
              ) THEN
                UPDATE creditos_cliente cc SET
                    cliente_ruc    = c.ruc,
                    cliente_nombre = c.razon_social
                FROM clientes c
                WHERE cc.cliente_id = c.id AND cc.cliente_ruc IS NULL;
              END IF;
            END $$;
        """))
        conn.commit()

        # Inicializar Facturas/Boletas existentes que no tienen datos de cobranza
        conn.execute(text("""
            UPDATE ventas_comercial
            SET
                fecha_vencimiento = fecha + INTERVAL '30 days',
                saldo_pendiente   = COALESCE(precio_venta, monto, 0),
                estado_cobranza   = 'Pendiente'
            WHERE tipo_documento IN ('Factura', 'Boleta de Venta')
            AND estado_cobranza IS NULL
        """))
        conn.commit()

        # Categorías y áreas de gasto gestionables desde Configuración → Gastos
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS categorias_gasto (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) UNIQUE NOT NULL,
                activo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS areas_gasto (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) UNIQUE NOT NULL,
                activo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

        # NOTA: create_all() (línea ~37) ya crea estas tablas desde los modelos
        # de SQLAlchemy ANTES de que corra este CREATE TABLE, sin default a
        # nivel de columna (Column(Boolean, default=True) es solo un default
        # de Python al insertar vía ORM, no un DEFAULT de SQL) — por eso los
        # INSERT de abajo fijan activo/created_at explícitamente en vez de
        # confiar en el DEFAULT del CREATE TABLE, que nunca llega a aplicarse.
        conn.execute(text("""
            INSERT INTO categorias_gasto (nombre, activo, created_at) VALUES
            ('Alquiler de oficina', TRUE, NOW()),('Alquiler de almacén', TRUE, NOW()),
            ('Mano de obra', TRUE, NOW()),('Transporte', TRUE, NOW()),('Suministros', TRUE, NOW()),
            ('Materia prima', TRUE, NOW()),('Alquiler de andamios', TRUE, NOW()),
            ('Servicios básicos', TRUE, NOW()),('Seguros', TRUE, NOW()),
            ('Gastos administrativos', TRUE, NOW()),('Gastos de ventas', TRUE, NOW()),
            ('Recibo por Honorarios', TRUE, NOW())
            ON CONFLICT (nombre) DO NOTHING
        """))
        conn.execute(text("""
            INSERT INTO areas_gasto (nombre, activo, created_at) VALUES
            ('Operativa', TRUE, NOW()),('Administrativa', TRUE, NOW()),
            ('Ventas', TRUE, NOW()),('Activos', TRUE, NOW())
            ON CONFLICT (nombre) DO NOTHING
        """))
        conn.commit()

        # Backfill: filas insertadas antes de este fix (con activo/created_at
        # en NULL por el mismo motivo — CREATE TABLE tardío, ver nota arriba).
        for sql in [
            "UPDATE categorias_gasto SET activo = TRUE WHERE activo IS NULL",
            "UPDATE categorias_gasto SET created_at = NOW() WHERE created_at IS NULL",
            "UPDATE areas_gasto SET activo = TRUE WHERE activo IS NULL",
            "UPDATE areas_gasto SET created_at = NOW() WHERE created_at IS NULL",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Garantías de clientes (depósitos retenidos, no ingresos)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS garantias (
                id SERIAL PRIMARY KEY,
                cliente_id INTEGER REFERENCES clientes(id),
                venta_id INTEGER REFERENCES ventas_comercial(id),
                monto FLOAT NOT NULL,
                fecha_cobro DATE NOT NULL,
                fecha_devolucion DATE,
                tipo_documento VARCHAR(50) DEFAULT 'Recibo Interno',
                numero_documento VARCHAR(50),
                estado VARCHAR(20) DEFAULT 'retenida',
                observacion TEXT,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

        # Préstamos (recibidos de bancos/terceros u otorgados a terceros/empleados)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS prestamos (
                id SERIAL PRIMARY KEY,
                tipo VARCHAR(20) NOT NULL,
                nombre_tercero VARCHAR(200) NOT NULL,
                ruc_dni_tercero VARCHAR(11),
                monto_original FLOAT NOT NULL,
                monto_pendiente FLOAT NOT NULL,
                fecha_inicio DATE NOT NULL,
                fecha_vencimiento DATE,
                aplica_interes BOOLEAN DEFAULT TRUE,
                tipo_tasa VARCHAR(20),
                porcentaje_tasa FLOAT,
                tasa_mensual FLOAT,
                estado VARCHAR(20) DEFAULT 'activo',
                descripcion TEXT,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cuotas_prestamo (
                id SERIAL PRIMARY KEY,
                prestamo_id INTEGER REFERENCES prestamos(id) ON DELETE CASCADE,
                numero_cuota INTEGER NOT NULL,
                fecha_pago DATE NOT NULL,
                saldo_inicial FLOAT NOT NULL,
                amortizacion FLOAT NOT NULL,
                interes FLOAT DEFAULT 0,
                cuota_total FLOAT NOT NULL,
                saldo_final FLOAT NOT NULL,
                estado VARCHAR(20) DEFAULT 'pendiente',
                fecha_pago_real DATE,
                metodo_pago VARCHAR(50),
                cuenta_bancaria_id INTEGER REFERENCES cuentas_bancarias(id),
                observacion TEXT,
                creado_por VARCHAR(100),
                creado_en TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

        # Vincula cada cuota con su movimiento en la bitácora de Flujo de Caja,
        # para poder revertirlo/sincronizarlo al editar o eliminar la cuota.
        conn.execute(text(
            "ALTER TABLE cuotas_prestamo ADD COLUMN IF NOT EXISTS movimiento_caja_id INTEGER REFERENCES movimientos_caja(id)"
        ))
        conn.commit()

        # Cronograma editable: filas "adelanto" (pago extra a capital fuera de
        # la cuota regular, ver POST /api/prestamos/{id}/cronograma).
        for sql in [
            "ALTER TABLE cuotas_prestamo ADD COLUMN IF NOT EXISTS es_adelanto BOOLEAN DEFAULT FALSE",
            "ALTER TABLE cuotas_prestamo ADD COLUMN IF NOT EXISTS monto_adelanto FLOAT DEFAULT 0",
        ]:
            conn.execute(text(sql))
        conn.commit()

        # Desglose de cargos del cronograma BCP (seguro de desgravamen, seguro
        # del bien, comisiones) — antes se descartaban / se sumaban dentro de
        # "interes" al importar el PDF.
        for sql in [
            "ALTER TABLE cuotas_prestamo ADD COLUMN IF NOT EXISTS seguro_desgravamen FLOAT DEFAULT 0",
            "ALTER TABLE cuotas_prestamo ADD COLUMN IF NOT EXISTS seguro_bien FLOAT DEFAULT 0",
            "ALTER TABLE cuotas_prestamo ADD COLUMN IF NOT EXISTS comisiones FLOAT DEFAULT 0",
        ]:
            conn.execute(text(sql))
        conn.commit()


# ── Seed de datos realistas para cobranza ────────────────────────────────────
def _seed_cobranza():
    from datetime import date, timedelta

    with engine.connect() as conn:
        # Sólo sembrar si no hay pagos registrados todavía
        ya_hay = conn.execute(text("SELECT COUNT(*) FROM pagos_cobranza")).scalar()
        if ya_hay > 0:
            return

        rows = conn.execute(text("""
            SELECT id, COALESCE(precio_venta, monto, 100) AS total, fecha
            FROM ventas_comercial
            WHERE tipo_documento IN ('Factura', 'Boleta de Venta')
            ORDER BY fecha ASC
            LIMIT 15
        """)).fetchall()

        if not rows:
            return

        hoy     = date.today()
        metodos = ["Transferencia", "Efectivo", "Depósito", "Cheque", "Yape o Plin"]

        pagos_insertar = []
        actualizaciones = []

        for i, (comp_id, total, _) in enumerate(rows):
            total = float(total)

            if i == 0:
                # Factura totalmente pagada - 1 pago
                fp = hoy - timedelta(days=45)
                pagos_insertar.append((comp_id, total, fp, metodos[0], fp))
                actualizaciones.append((comp_id, 0.0, "Pagada"))

            elif i == 1:
                # Factura totalmente pagada - 1 pago
                fp = hoy - timedelta(days=30)
                pagos_insertar.append((comp_id, total, fp, metodos[2], fp))
                actualizaciones.append((comp_id, 0.0, "Pagada"))

            elif i == 2:
                # Factura totalmente pagada - 1 pago
                fp = hoy - timedelta(days=18)
                pagos_insertar.append((comp_id, total, fp, metodos[1], fp))
                actualizaciones.append((comp_id, 0.0, "Pagada"))

            elif i == 3:
                # Pago parcial 50% - 1 pago
                monto_p = round(total * 0.5, 2)
                fp = hoy - timedelta(days=10)
                pagos_insertar.append((comp_id, monto_p, fp, metodos[3], fp))
                actualizaciones.append((comp_id, round(total - monto_p, 2), "Pago Parcial"))

            elif i == 4:
                # Pago parcial 30% - 1 pago
                monto_p = round(total * 0.3, 2)
                fp = hoy - timedelta(days=5)
                pagos_insertar.append((comp_id, monto_p, fp, metodos[4], fp))
                actualizaciones.append((comp_id, round(total - monto_p, 2), "Pago Parcial"))

            elif i == 5:
                # Dos abonos: 25% + 30% — Pago Parcial con historial
                abono1 = round(total * 0.25, 2)
                abono2 = round(total * 0.30, 2)
                fp1 = hoy - timedelta(days=20)
                fp2 = hoy - timedelta(days=8)
                pagos_insertar.append((comp_id, abono1, fp1, metodos[0], fp1))
                pagos_insertar.append((comp_id, abono2, fp2, metodos[2], fp2))
                saldo_r = round(total - abono1 - abono2, 2)
                actualizaciones.append((comp_id, max(0, saldo_r), "Pago Parcial"))

            elif i == 6:
                # Tres abonos: 20% + 20% + 20% — Pago Parcial con múltiples cuotas
                abono = round(total * 0.20, 2)
                for d in [25, 15, 5]:
                    fp = hoy - timedelta(days=d)
                    pagos_insertar.append((comp_id, abono, fp, metodos[d % 5], fp))
                saldo_r = round(total - abono * 3, 2)
                actualizaciones.append((comp_id, max(0, saldo_r), "Pago Parcial"))

            # idx 7+ quedan como Pendiente (semáforos variados según su fecha_vencimiento)

        for (cid, monto, fp, metodo, created) in pagos_insertar:
            conn.execute(text("""
                INSERT INTO pagos_cobranza (comprobante_id, monto_pagado, fecha_pago, metodo_pago, created_at)
                VALUES (:cid, :monto, :fp, :metodo, :created)
            """), {"cid": cid, "monto": monto, "fp": fp, "metodo": metodo, "created": created})

        for (cid, saldo, estado) in actualizaciones:
            conn.execute(text("""
                UPDATE ventas_comercial
                SET saldo_pendiente = :saldo, estado_cobranza = :estado
                WHERE id = :cid
            """), {"saldo": saldo, "estado": estado, "cid": cid})

        conn.commit()


def _run_gastos_migrations():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS comprobante_path VARCHAR(500)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS comprobante_nombre VARCHAR(255)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS es_recurrente BOOLEAN DEFAULT FALSE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS recurrente_activo BOOLEAN DEFAULT FALSE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS recurrente_padre_id INTEGER",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS created_at DATE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS numero_recibo_interno VARCHAR(50)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS proveedor VARCHAR(200)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_comprobante VARCHAR(50)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS numero_comprobante VARCHAR(50)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(50)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(20)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS saldo_pendiente FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(50)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS base_imponible FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS igv FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) DEFAULT 'PEN'",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_cambio FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS monto_original FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS monto_soles FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS orden_id INTEGER",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS proveedor_id INTEGER",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS afecta_utilidad BOOLEAN DEFAULT TRUE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS periodo_mes INTEGER",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS periodo_anio INTEGER",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS observaciones TEXT",
            "ALTER TABLE pagos_gastos ADD COLUMN IF NOT EXISTS numero_operacion VARCHAR(50)",
            "ALTER TABLE pagos_gastos ADD COLUMN IF NOT EXISTS redondeo_tipo VARCHAR(20)",
            "ALTER TABLE pagos_gastos ADD COLUMN IF NOT EXISTS redondeo_monto FLOAT DEFAULT 0",
        ]:
            conn.execute(text(sql))
        conn.commit()


def _seed_gastos():
    from seed_gastos import run as seed_run
    try:
        seed_run()
    except Exception as e:
        print(f"[seed_gastos] {e}")


def _seed_proveedores_gastos():
    from app.models.models import ProveedorGasto, Gasto
    from database import SessionLocal
    from datetime import date as dt_date

    db = SessionLocal()
    try:
        if db.query(ProveedorGasto).count() > 0:
            return
        rows = (
            db.query(Gasto.tipo_documento, Gasto.numero_documento, Gasto.proveedor)
            .filter(Gasto.numero_documento.isnot(None), Gasto.proveedor.isnot(None))
            .distinct()
            .all()
        )
        seen, count = set(), 0
        for tipo_doc, num_doc, nombre in rows:
            if num_doc and nombre and num_doc not in seen:
                seen.add(num_doc)
                db.add(ProveedorGasto(
                    tipo_documento=tipo_doc,
                    numero_documento=num_doc,
                    nombre_proveedor=nombre,
                    created_at=dt_date.today(),
                    updated_at=dt_date.today(),
                ))
                count += 1
        db.commit()
        if count:
            print(f"✓ {count} proveedores_gastos insertados")
    except Exception as e:
        print(f"[seed_proveedores_gastos] {e}")
        db.rollback()
    finally:
        db.close()


def _generar_recurrentes():
    from datetime import date
    from app.models.models import Gasto
    from database import SessionLocal

    hoy = date.today()
    db = SessionLocal()
    try:
        templates = db.query(Gasto).filter(
            Gasto.es_recurrente == True,
            Gasto.recurrente_activo == True,
        ).all()

        for t in templates:
            start_year, start_month = t.fecha.year, t.fecha.month
            cur_month = start_month + 1
            cur_year = start_year
            if cur_month > 12:
                cur_month = 1
                cur_year += 1

            while (cur_year, cur_month) <= (hoy.year, hoy.month):
                next_month = cur_month + 1 if cur_month < 12 else 1
                next_year  = cur_year if cur_month < 12 else cur_year + 1
                exists = db.query(Gasto).filter(
                    Gasto.recurrente_padre_id == t.id,
                    Gasto.fecha >= date(cur_year, cur_month, 1),
                    Gasto.fecha <  date(next_year, next_month, 1),
                ).first()

                if not exists:
                    inst_fecha = date(cur_year, cur_month, t.fecha.day)
                    monto_r    = float(t.monto or 0)
                    db.add(Gasto(
                        fecha=inst_fecha,
                        categoria=t.categoria,
                        descripcion=t.descripcion,
                        monto=monto_r,
                        area=t.area,
                        tipo_comprobante=t.tipo_comprobante,
                        proveedor=t.proveedor,
                        es_recurrente=False,
                        recurrente_activo=False,
                        recurrente_padre_id=t.id,
                        fecha_vencimiento=date(cur_year + (1 if cur_month == 12 else 0),
                                               1 if cur_month == 12 else cur_month + 1,
                                               inst_fecha.day),
                        saldo_pendiente=monto_r,
                        estado_pago="Pendiente",
                        created_at=date.today(),
                    ))

                cur_month += 1
                if cur_month > 12:
                    cur_month = 1
                    cur_year += 1

        db.commit()
    except Exception as e:
        print(f"[_generar_recurrentes] {e}")
        db.rollback()
    finally:
        db.close()


def _seed_cuentas_por_pagar():
    from datetime import date as dt_date, timedelta
    from app.models.models import Gasto, PagoGasto
    from database import SessionLocal

    db = SessionLocal()
    try:
        # Assign fecha_vencimiento + saldo_pendiente to all gastos that don't have them yet
        gastos_sin = db.query(Gasto).filter(Gasto.saldo_pendiente.is_(None)).all()
        for g in gastos_sin:
            if g.fecha:
                g.fecha_vencimiento = g.fecha + timedelta(days=30)
            g.saldo_pendiente = float(g.monto or 0)
            g.estado_pago     = "Pendiente"
        if gastos_sin:
            db.commit()
            print(f"✓ {len(gastos_sin)} gastos inicializados con saldo_pendiente y fecha_vencimiento")

        # Only seed sample pagos once
        if db.query(PagoGasto).count() > 0:
            return

        hoy = dt_date.today()

        # Mark Jan–Feb 2026 original gastos as fully paid
        pagados = (
            db.query(Gasto)
            .filter(
                Gasto.fecha >= dt_date(2026, 1, 1),
                Gasto.fecha <= dt_date(2026, 2, 28),
                Gasto.recurrente_padre_id.is_(None),
            )
            .all()
        )
        for g in pagados:
            if not g.monto:
                continue
            venc = g.fecha_vencimiento or (g.fecha + timedelta(days=30))
            fp   = min(venc - timedelta(days=3), hoy)
            db.add(PagoGasto(
                gasto_id      = g.id,
                monto_pagado  = float(g.monto),
                fecha_pago    = fp,
                metodo_pago   = "Transferencia",
                banco         = "BCP",
                created_at    = hoy,
            ))
            g.saldo_pendiente = 0.0
            g.estado_pago     = "Pagado"

        # Partial payments for 2 Mar-2026 gastos
        parciales = (
            db.query(Gasto)
            .filter(
                Gasto.fecha >= dt_date(2026, 3, 1),
                Gasto.fecha <= dt_date(2026, 3, 31),
                Gasto.recurrente_padre_id.is_(None),
            )
            .all()[:2]
        )
        for g in parciales:
            if not g.monto:
                continue
            abono = round(float(g.monto) * 0.5, 2)
            db.add(PagoGasto(
                gasto_id     = g.id,
                monto_pagado = abono,
                fecha_pago   = g.fecha + timedelta(days=20),
                metodo_pago  = "Efectivo",
                created_at   = hoy,
            ))
            g.saldo_pendiente = round(float(g.monto) - abono, 2)
            g.estado_pago     = "Pago Parcial"

        db.commit()
        print(f"✓ Cuentas por pagar: {len(pagados)} pagados, {len(parciales)} parciales seeded")
    except Exception as e:
        print(f"[seed_cuentas_por_pagar] {e}")
        db.rollback()
    finally:
        db.close()


_run_migrations()
# _seed_cobranza()  # Deshabilitado — seeds automáticos desactivados
_run_gastos_migrations()
# _seed_gastos()  # Deshabilitado — seeds automáticos desactivados
# _seed_proveedores_gastos()  # Deshabilitado — seeds automáticos desactivados
# _generar_recurrentes()  # Deshabilitado — cliente configura sus propios recurrentes
# _seed_cuentas_por_pagar()  # Deshabilitado — seeds automáticos desactivados

def _run_flujo_caja_migrations():
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE movimientos_conciliacion "
            "ADD COLUMN IF NOT EXISTS es_gasto_bancario BOOLEAN DEFAULT FALSE"
        ))
        conn.execute(text(
            "ALTER TABLE conciliaciones_bancarias "
            "ADD COLUMN IF NOT EXISTS fecha_cierre DATE"
        ))
        conn.commit()

def _seed_flujo_caja():
    from seed_flujo_caja import run as seed_run
    try:
        seed_run()
    except Exception as e:
        print(f"[seed_flujo_caja] {e}")

_run_flujo_caja_migrations()
# _seed_flujo_caja()        # Deshabilitado para producción

# ── Limpieza de movimientos de conciliación huérfanos ──────────────────────────
# Antes de corregir eliminar-cascada, borrar un comprobante solo desconciliaba
# sus movimientos_conciliacion en vez de eliminarlos, dejando filas "sistema"
# cuya referencia_sistema_id ya no existe en pagos_cobranza (se veían como
# "❌ Solo en Sistema" en la vista de conciliación). Se limpian una sola vez
# al arrancar para no dejar huérfanos de instalaciones ya en uso.
def _limpiar_movimientos_huerfanos():
    with engine.connect() as conn:
        result = conn.execute(text("""
            DELETE FROM movimientos_conciliacion
            WHERE origen = 'sistema'
            AND referencia_sistema_tipo = 'cobranza'
            AND referencia_sistema_id NOT IN (SELECT id FROM pagos_cobranza)
        """))
        conn.commit()
        if result.rowcount:
            print(f"✓ {result.rowcount} movimientos_conciliacion huérfanos eliminados")

_limpiar_movimientos_huerfanos()

def _seed_ordenes_servicio():
    from seed_ordenes_servicio import run as seed_run
    try:
        seed_run()
    except Exception as e:
        print(f"[seed_ordenes_servicio] {e}")

# _seed_ordenes_servicio()  # Deshabilitado para producción

def _seed_proveedores():
    from seed_proveedores import run as seed_run
    try:
        seed_run()
    except Exception as e:
        print(f"[seed_proveedores] {e}")

# _seed_proveedores()       # Deshabilitado para producción

def _run_comprobantes_email_migrations():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS comprobante_relacionado_id INTEGER",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS enviado_email BOOLEAN DEFAULT FALSE",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS fecha_envio_email TIMESTAMP",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS email_envio_destino VARCHAR(150)",
            "ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(200) DEFAULT 'smtp.gmail.com'",
            "ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587",
            "ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS smtp_usuario VARCHAR(200)",
            "ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS smtp_password VARCHAR(200)",
            "ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS smtp_from_name VARCHAR(200)",
            "ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS whatsapp_soporte VARCHAR(20)",
        ]:
            conn.execute(text(sql))
        conn.commit()

_run_comprobantes_email_migrations()

def _run_detracciones_migrations():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS tiene_detraccion BOOLEAN DEFAULT FALSE",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS tasa_detraccion FLOAT",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS monto_detraccion FLOAT",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS monto_neto_cobrar FLOAT",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS concepto_detraccion VARCHAR(100)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS fecha_limite_detraccion DATE",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS detraccion_pagada BOOLEAN DEFAULT FALSE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tiene_detraccion BOOLEAN DEFAULT FALSE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tasa_detraccion FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS monto_detraccion FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS monto_neto_pagar FLOAT",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS concepto_detraccion VARCHAR(100)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_limite_detraccion DATE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS detraccion_depositada BOOLEAN DEFAULT FALSE",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS ruc_cuenta_detraccion VARCHAR(20)",
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS codigo_detraccion VARCHAR(3)",
            "ALTER TABLE detraccion_lotes ADD COLUMN IF NOT EXISTS fecha_pago DATE",
            "ALTER TABLE detraccion_lotes ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(30)",
            "ALTER TABLE detraccion_lotes ADD COLUMN IF NOT EXISTS numero_operacion VARCHAR(50)",
            "ALTER TABLE detraccion_lotes ADD COLUMN IF NOT EXISTS banco VARCHAR(100)",
            "ALTER TABLE detraccion_lotes ADD COLUMN IF NOT EXISTS numero_cuenta VARCHAR(50)",
        ]:
            conn.execute(text(sql))
        conn.commit()

_run_detracciones_migrations()

def _seed_configuracion():
    from datetime import datetime
    from database import SessionLocal
    from app.models.configuracion import ConfiguracionEmpresa, ConfiguracionAlerta, ConfiguracionDocumento

    db = SessionLocal()
    try:
        if not db.query(ConfiguracionEmpresa).first():
            db.add(ConfiguracionEmpresa(
                nombre_empresa="Centryx", color_principal="#1e40af", moneda_principal="PEN",
                onboarding_completado=False, tiempo_sesion_horas=8,
                created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
            ))

        alertas_default = {
            "cobranza_por_vencer": 7, "cobranza_vencida": 15, "cliente_deuda_alta": 5000,
            "gastos_por_vencer": 7, "gastos_recurrentes_pendientes": None,
            "saldo_bancario_bajo": 5000, "deficit_proyectado": None,
        }
        existentes_alertas = {a.tipo_alerta for a in db.query(ConfiguracionAlerta).all()}
        for tipo, umbral in alertas_default.items():
            if tipo not in existentes_alertas:
                db.add(ConfiguracionAlerta(tipo_alerta=tipo, activa=True, valor_umbral=umbral, created_at=datetime.utcnow()))

        documentos_default = [
            ("facturas", "F001-", 21), ("boletas", "B001-", 6),
            ("notas_credito", "NC-", 2), ("notas_debito", "ND-", 2),
            ("recibo_interno", "RI-", 2), ("anticipo_cliente", "AC-", 1),
            ("anticipo_proveedor", "AP-", 1), ("gastos_bancarios", "GB-", 3),
            ("orden_servicio", "OS-", 1),
        ]
        existentes_doc = {d.tipo_documento for d in db.query(ConfiguracionDocumento).all()}
        for tipo, prefijo, numero in documentos_default:
            if tipo not in existentes_doc:
                db.add(ConfiguracionDocumento(tipo_documento=tipo, prefijo=prefijo, proximo_numero=numero))

        db.commit()
    except Exception as e:
        print(f"[seed_configuracion] {e}")
        db.rollback()
    finally:
        db.close()

_seed_configuracion()


# ── Migración: columnas de auditoría (creado_por/creado_en/modificado_por/modificado_en) ──
def _run_auditoria_migrations():
    with engine.connect() as conn:
        for tabla in ["ventas_comercial", "gastos", "clientes", "proveedores", "pagos_cobranza"]:
            for sql in [
                f"ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS creado_por VARCHAR(100)",
                f"ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP",
                f"ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(100)",
                f"ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP",
                f"ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS metodo_creacion VARCHAR(50)",
            ]:
                conn.execute(text(sql))
        conn.commit()

_run_auditoria_migrations()


# ── Migración: gastos financieros auto-generados al pagar cuota de préstamo ──
def _run_prestamos_gastos_migrations():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE gastos ADD COLUMN IF NOT EXISTS cuota_prestamo_id INTEGER REFERENCES cuotas_prestamo(id)",
            "ALTER TABLE pagos_gastos ADD COLUMN IF NOT EXISTS tipo VARCHAR(50)",
            "ALTER TABLE pagos_gastos ADD COLUMN IF NOT EXISTS referencia_id INTEGER",
            "ALTER TABLE pagos_gastos ALTER COLUMN gasto_id DROP NOT NULL",
        ]:
            conn.execute(text(sql))
        conn.commit()

_run_prestamos_gastos_migrations()


# ── Migración: escenarios explícitos de Nota de Crédito ──────────────────────
def _run_notas_credito_migrations():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS tipo_nota_credito VARCHAR(30)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS fecha_devolucion DATE",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS metodo_devolucion VARCHAR(30)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS banco_devolucion VARCHAR(100)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS numero_cuenta_devolucion VARCHAR(50)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS numero_operacion_devolucion VARCHAR(50)",
            "ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS tipo_nota_debito VARCHAR(30)",
        ]:
            conn.execute(text(sql))
        conn.commit()

_run_notas_credito_migrations()


# ── Migración: logo de empresa en BD (base64) — Railway no tiene disco persistente ──
def _run_logo_base64_migration():
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE configuracion_empresa ADD COLUMN IF NOT EXISTS logo_base64 TEXT"))
        conn.commit()

_run_logo_base64_migration()

app = FastAPI(
    title="Centryx API",
    description="Sistema Gerencial para ElectroPro SAC — Lima, Perú",
    version="1.0.0",
)

origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

def _mod(nombre: str):
    return [Depends(require_modulo(nombre))]

app.include_router(auth.router,               prefix="/api/auth",              tags=["Autenticación"])
app.include_router(dashboard.router,          prefix="/api/dashboard",         tags=["Dashboard"],         dependencies=_mod("dashboard"))
app.include_router(clientes.router,           prefix="/api/clientes",          tags=["Clientes"],          dependencies=_mod("clientes"))
app.include_router(comprobantes_router.router,prefix="/api/comprobantes",      tags=["Comprobantes"],      dependencies=_mod("ventas"))
app.include_router(comercial_router.router,   prefix="/api/comercial",         tags=["Comercial"],         dependencies=_mod("ventas"))
app.include_router(ventas_router.router,      prefix="/api/ventas",            tags=["Ventas"],            dependencies=_mod("ventas"))
app.include_router(cotizaciones_router.router,prefix="/api/cotizaciones",      tags=["Cotizaciones"],      dependencies=_mod("ventas"))
app.include_router(documentos_router.router,  prefix="/api/documentos-sustento",tags=["Documentos"],       dependencies=_mod("ventas"))
app.include_router(cobranza_router.router,         prefix="/api/cobranza",          tags=["Cobranza"],          dependencies=_mod("cobranza"))
app.include_router(ordenes_cobro_router.router,    prefix="/api/ordenes-cobro",     tags=["Órdenes de Cobro"], dependencies=_mod("cobranza"))
app.include_router(garantias_router.router,        prefix="/api/garantias",         tags=["Garantías"],       dependencies=_mod("cobranza"))
app.include_router(prestamos_router.router,        prefix="/api/prestamos",         tags=["Préstamos"],       dependencies=_mod("prestamos"))
app.include_router(cuentas_bancarias_router.router,prefix="/api/cuentas-bancarias",  tags=["Cuentas Bancarias"], dependencies=_mod("flujo_caja"))
app.include_router(gastos_router.router,                  prefix="/api/gastos",              tags=["Gastos"],            dependencies=_mod("gastos"))
app.include_router(detracciones_router.router,             prefix="/api/detracciones",           tags=["Detracciones"],    dependencies=_mod("gastos"))
app.include_router(ordenes_pago_router.router,             prefix="/api/ordenes-pago",           tags=["Órdenes de Pago"], dependencies=_mod("gastos"))
app.include_router(proveedores_gastos_router.router,      prefix="/api/proveedores-gastos",   tags=["Proveedores"],       dependencies=_mod("proveedores"))
app.include_router(flujo_caja_router.flujo_router,        prefix="/api/flujo-caja",           tags=["Flujo de Caja"],     dependencies=_mod("flujo_caja"))
app.include_router(flujo_caja_router.conciliacion_router, prefix="/api/conciliacion",         tags=["Conciliación"],      dependencies=_mod("flujo_caja"))
app.include_router(utils_router.router,                   prefix="/api/utils",                  tags=["Utils"])
app.include_router(ordenes_servicio_router.router,        prefix="/api/ordenes",                tags=["Órdenes de Servicio"], dependencies=_mod("proyectos"))
app.include_router(proveedores_router.router,             prefix="/api/proveedores",            tags=["Proveedores"],       dependencies=_mod("proveedores"))
app.include_router(indicadores_router.router,              prefix="/api/indicadores",            tags=["Indicadores KPI"],  dependencies=_mod("indicadores"))
app.include_router(reportes_router.router,                 prefix="/api/reportes",               tags=["Reportes"],         dependencies=_mod("reportes"))
app.include_router(configuracion_router.router,            prefix="/api/configuracion",          tags=["Configuración"])
app.include_router(notificaciones_router.router,            prefix="/api/notificaciones",         tags=["Notificaciones"], dependencies=[Depends(get_current_usuario)])
app.include_router(auditoria_router.router,                 prefix="/api/auditoria",              tags=["Auditoría"])
app.include_router(busqueda_router.router,                  prefix="/api/busqueda",               tags=["Búsqueda Global"])


@app.get("/")
def root():
    return {
        "sistema": "Centryx",
        "empresa": "ElectroPro SAC",
        "ruc": "20123456789",
        "version": "1.0.0",
    }
