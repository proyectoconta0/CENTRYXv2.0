from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime


class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    password = Column(String(255), nullable=False)
    rol = Column(String(50), nullable=False, default="vendedor")
    activo = Column(Boolean, default=True)


class Cliente(Base):
    __tablename__ = "clientes"

    id = Column(Integer, primary_key=True, index=True)
    razon_social = Column(String(200), nullable=False)
    ruc = Column(String(11), unique=True, nullable=False)
    contacto = Column(String(100))
    telefono = Column(String(20))
    email = Column(String(100))
    direccion = Column(String(300))
    activo = Column(Boolean, default=True)
    tipo_cliente = Column(String(50))
    distrito = Column(String(100))
    cargo_contacto = Column(String(100))
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)
    modificado_por = Column(String(100), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    metodo_creacion = Column(String(50), nullable=True)

    proyectos = relationship("Proyecto", back_populates="cliente")
    ventas = relationship("Venta", back_populates="cliente")
    facturas = relationship("Factura", back_populates="cliente")
    cotizaciones = relationship("Cotizacion", back_populates="cliente")
    ventas_comercial = relationship("VentaComercial", back_populates="cliente")
    documentos = relationship("DocumentoCliente", back_populates="cliente")


class Proyecto(Base):
    __tablename__ = "proyectos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(200), nullable=False)
    cliente_id = Column(Integer, ForeignKey("clientes.id"))
    presupuesto = Column(Float, nullable=False)
    ejecutado = Column(Float, default=0)
    avance_fisico = Column(Float, default=0)
    avance_financiero = Column(Float, default=0)
    estado = Column(String(50), default="activo")
    fecha_inicio = Column(Date)
    fecha_fin = Column(Date)

    cliente = relationship("Cliente", back_populates="proyectos")
    ventas = relationship("Venta", back_populates="proyecto")
    gastos = relationship("Gasto", back_populates="proyecto")


class Venta(Base):
    __tablename__ = "ventas"

    id = Column(Integer, primary_key=True, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"))
    proyecto_id = Column(Integer, ForeignKey("proyectos.id"), nullable=True)
    monto = Column(Float, nullable=False)
    fecha = Column(Date, nullable=False)
    estado = Column(String(50), default="aprobada")
    tipo = Column(String(50))

    cliente = relationship("Cliente", back_populates="ventas")
    proyecto = relationship("Proyecto", back_populates="ventas")


class Factura(Base):
    __tablename__ = "facturas"

    id = Column(Integer, primary_key=True, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"))
    numero = Column(String(20))
    monto = Column(Float, nullable=False)
    fecha_emision = Column(Date, nullable=False)
    fecha_vencimiento = Column(Date, nullable=False)
    estado = Column(String(50), default="pendiente")
    dias_vencido = Column(Integer, default=0)

    cliente = relationship("Cliente", back_populates="facturas")


class Gasto(Base):
    __tablename__ = "gastos"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(Date, nullable=False, index=True)
    categoria = Column(String(100), nullable=False)
    descripcion = Column(String(300))
    monto = Column(Float, nullable=False)
    area = Column(String(100))
    proyecto_id = Column(Integer, ForeignKey("proyectos.id"), nullable=True)
    comprobante_path = Column(String(500))
    comprobante_nombre = Column(String(255))
    es_recurrente = Column(Boolean, default=False)
    recurrente_activo = Column(Boolean, default=False)
    recurrente_padre_id = Column(Integer, nullable=True)
    created_at = Column(Date)
    numero_recibo_interno = Column(String(50))    # legacy, mantenido para datos existentes
    proveedor = Column(String(200))
    tipo_comprobante = Column(String(50))         # Factura | Recibo de Servicios Públicos | Recibo Interno
    numero_comprobante = Column(String(50))
    tipo_documento    = Column(String(50))         # RUC | DNI | Carnet de Extranjería
    numero_documento  = Column(String(20), index=True)
    fecha_vencimiento = Column(Date)
    saldo_pendiente   = Column(Float)
    estado_pago       = Column(String(50), index=True)         # Pendiente | Pago Parcial | Pagado
    base_imponible    = Column(Float, nullable=True)
    igv               = Column(Float, nullable=True)
    moneda            = Column(String(3), default="PEN")   # PEN | USD
    tipo_cambio       = Column(Float, nullable=True)
    monto_original    = Column(Float, nullable=True)
    monto_soles       = Column(Float, nullable=True)
    afecta_utilidad   = Column(Boolean, default=True)   # False solo para categoría "Pagos Tributarios"
    periodo_mes       = Column(Integer, nullable=True)  # Pagos Tributarios: mes del período tributario (1-12)
    periodo_anio      = Column(Integer, nullable=True)  # Pagos Tributarios: año del período tributario
    observaciones     = Column(Text, nullable=True)
    # Detracción (solo Facturas de proveedor): nosotros somos el comprador y
    # debemos depositar en la cuenta de detracciones del proveedor.
    tiene_detraccion       = Column(Boolean, default=False)
    tasa_detraccion        = Column(Float, nullable=True)
    monto_detraccion       = Column(Float, nullable=True)
    monto_neto_pagar       = Column(Float, nullable=True)
    concepto_detraccion    = Column(String(100), nullable=True)
    fecha_limite_detraccion = Column(Date, nullable=True)
    detraccion_depositada  = Column(Boolean, default=False)
    ruc_cuenta_detraccion  = Column(String(20), nullable=True)
    # Código de bien/servicio (tabla SUNAT) autoseleccionado según la
    # categoría del Gasto en el frontend; editable por el usuario. Usado
    # directamente por el generador de TXT de detracciones (Banco de la
    # Nación) en vez de derivarlo de concepto_detraccion.
    codigo_detraccion     = Column(String(3), nullable=True)

    orden_id     = Column(Integer, ForeignKey("ordenes_servicio.id"), nullable=True)
    proveedor_id = Column(Integer, ForeignKey("proveedores.id"), nullable=True)
    # Marca los gastos financieros (interés/seguro/comisión) auto-generados al
    # pagar una cuota de préstamo — ver PUT /prestamos/{id}/cuotas/{id}/pagar.
    # No confundir con CuotaPrestamo.movimiento_caja_id (esa es la relación
    # inversa, cuota → bitácora de caja; esta es gasto → cuota que lo originó).
    cuota_prestamo_id = Column(Integer, ForeignKey("cuotas_prestamo.id"), nullable=True)

    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)
    modificado_por = Column(String(100), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    metodo_creacion = Column(String(50), nullable=True)

    proyecto     = relationship("Proyecto", back_populates="gastos")
    pagos_gastos = relationship("PagoGasto", back_populates="gasto", cascade="all, delete-orphan")
    orden        = relationship("OrdenServicio", back_populates="gastos")
    proveedor_ref = relationship("Proveedor", back_populates="gastos")


class PagoGasto(Base):
    __tablename__ = "pagos_gastos"

    id            = Column(Integer, primary_key=True, index=True)
    # Nullable: un pago de tipo "pago_cuota_prestamo" (ver tipo/referencia_id
    # abajo) no tiene un Gasto propio — el monto de la cuota (amortización +
    # interés + seguro + comisión) nunca se registra como Gasto en sí; solo
    # sus componentes financieros lo hacen, vía Gasto.cuota_prestamo_id.
    gasto_id      = Column(Integer, ForeignKey("gastos.id"), nullable=True)
    monto_pagado  = Column(Float, nullable=False, index=True)
    fecha_pago    = Column(Date, nullable=False, index=True)
    metodo_pago   = Column(String(50))
    banco         = Column(String(100))
    numero_cuenta = Column(String(50))
    numero_cheque = Column(String(50))
    numero_operacion = Column(String(50))   # Pagos Tributarios: N° de operación de transferencia/depósito
    created_at    = Column(Date)
    # Discriminador genérico para pagos que no vienen de un Gasto propio —
    # por ahora solo "pago_cuota_prestamo" (referencia_id = CuotaPrestamo.id).
    # None/NULL para todo pago normal de Gasto (la inmensa mayoría de filas).
    tipo          = Column(String(50), nullable=True)
    referencia_id = Column(Integer, nullable=True)
    redondeo_tipo  = Column(String(20), nullable=True)   # "ganancia" | "perdida" | None
    redondeo_monto = Column(Float, default=0)

    gasto = relationship("Gasto", back_populates="pagos_gastos")


class ProveedorGasto(Base):
    # Tabla base del futuro Módulo de Proveedores.
    # Todos los proveedores registrados desde Gastos aparecen aquí automáticamente;
    # cuando se construya el Módulo de Proveedores usará esta tabla como fuente de datos
    # sin necesidad de migración.
    __tablename__ = "proveedores_gastos"

    id               = Column(Integer, primary_key=True, index=True)
    tipo_documento   = Column(String(50))                          # RUC | DNI | Carnet de Extranjería
    numero_documento = Column(String(20), unique=True, index=True, nullable=False)
    nombre_proveedor = Column(String(200), nullable=False)
    created_at       = Column(Date)
    updated_at       = Column(Date)


class Proveedor(Base):
    __tablename__ = "proveedores"

    id = Column(Integer, primary_key=True, index=True)
    tipo_documento = Column(String(30))                    # RUC | DNI | Carnet de Extranjería
    numero_documento = Column(String(20), unique=True, index=True, nullable=False)
    razon_social = Column(String(200), nullable=False)
    direccion = Column(String(200))
    distrito = Column(String(100))
    telefono = Column(String(20))
    email = Column(String(100))
    contacto_principal = Column(String(100))
    cargo_contacto = Column(String(100))
    estado = Column(String(10), default="Activo")          # Activo | Inactivo
    observaciones = Column(Text, nullable=True)
    numero_cuenta = Column(String(11), nullable=True)      # Cuenta bancaria para depósito de detracciones
    created_at = Column(Date)
    updated_at = Column(Date)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)
    modificado_por = Column(String(100), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    metodo_creacion = Column(String(50), nullable=True)

    gastos = relationship("Gasto", back_populates="proveedor_ref")


class FlujoCaja(Base):
    __tablename__ = "flujo_caja"

    id = Column(Integer, primary_key=True, index=True)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    ingresos_proyectados = Column(Float, default=0)
    egresos_proyectados = Column(Float, default=0)
    saldo_proyectado = Column(Float, default=0)


class DetraccionLote(Base):
    # Secuencial de lotes generados para el TXT de detracciones del Banco de
    # la Nación (formato CASO 1: adquiriente con múltiples proveedores).
    __tablename__ = "detracciones_lotes"

    id                = Column(Integer, primary_key=True, index=True)
    numero_lote       = Column(Integer, nullable=False)
    fecha             = Column(Date, nullable=False)
    monto_total       = Column(Float, nullable=False)
    archivo_generado  = Column(String(100), nullable=True)
    created_at        = Column(Date)


class LoteDetraccion(Base):
    # Lote "carrito" de Detracciones Por Pagar: el usuario lo crea vacío y va
    # agregando/quitando Gastos con detracción pendiente antes de pagarlos y
    # generar el TXT para ese lote puntual. Distinto de DetraccionLote arriba
    # (ese es solo el registro histórico auto-generado al exportar un TXT
    # desde la lista plana de pendientes; este es el objeto que administra
    # el usuario desde la pantalla de lotes).
    __tablename__ = "detraccion_lotes"

    id             = Column(Integer, primary_key=True, index=True)
    numero_lote    = Column(String(4), nullable=False, unique=True)
    fecha          = Column(Date, nullable=False)
    importe_total  = Column(Float, nullable=False, default=0)
    estado         = Column(String(20), default="pendiente")
    created_at     = Column(Date)

    # Pago consolidado del lote: UN solo registro para todas las facturas del
    # lote (no un PagoGasto por factura). Se llenan al pagar y se limpian si
    # se revierte el pago (ver PUT/DELETE /detracciones/lotes/{id}/pago).
    fecha_pago       = Column(Date, nullable=True)
    metodo_pago      = Column(String(30), nullable=True)
    numero_operacion = Column(String(50), nullable=True)
    banco            = Column(String(100), nullable=True)
    numero_cuenta    = Column(String(50), nullable=True)

    detalles = relationship(
        "LoteDetraccionDetalle", back_populates="lote", cascade="all, delete-orphan"
    )


class LoteDetraccionDetalle(Base):
    __tablename__ = "detraccion_lote_detalles"

    id       = Column(Integer, primary_key=True, index=True)
    lote_id  = Column(Integer, ForeignKey("detraccion_lotes.id"), nullable=False)
    gasto_id = Column(Integer, ForeignKey("gastos.id"), nullable=True)

    lote  = relationship("LoteDetraccion", back_populates="detalles")
    gasto = relationship("Gasto")


class OrdenPago(Base):
    # Pago consolidado de UNA o VARIAS facturas de Cuentas por Pagar del mismo
    # proveedor, en un solo registro (no un PagoGasto por factura) — mismo
    # patrón que LoteDetraccion para pagos de detracciones.
    __tablename__ = "ordenes_pago"

    id               = Column(Integer, primary_key=True, index=True)
    numero_orden     = Column(String(20), nullable=False, unique=True)   # OP-0001
    proveedor_id     = Column(Integer, ForeignKey("proveedores.id"), nullable=True)
    ruc_proveedor    = Column(String(20), nullable=True)
    nombre_proveedor = Column(String(200), nullable=True)
    fecha_pago       = Column(Date, nullable=False)
    monto_total      = Column(Float, nullable=False)
    metodo_pago      = Column(String(30), nullable=True)
    banco            = Column(String(100), nullable=True)
    numero_cuenta    = Column(String(50), nullable=True)
    numero_cheque    = Column(String(50), nullable=True)
    numero_operacion = Column(String(50), nullable=True)
    created_at       = Column(Date)

    detalles = relationship(
        "OrdenPagoDetalle", back_populates="orden", cascade="all, delete-orphan"
    )


class OrdenPagoDetalle(Base):
    __tablename__ = "ordenes_pago_detalle"

    id             = Column(Integer, primary_key=True, index=True)
    orden_id       = Column(Integer, ForeignKey("ordenes_pago.id"), nullable=False)
    gasto_id       = Column(Integer, ForeignKey("gastos.id"), nullable=True)
    monto_pagado   = Column(Float, nullable=False)
    saldo_anterior = Column(Float, nullable=False)   # saldo_pendiente de la factura antes de este pago
    created_at     = Column(Date)

    orden = relationship("OrdenPago", back_populates="detalles")
    gasto = relationship("Gasto")


class OrdenServicio(Base):
    __tablename__ = "ordenes_servicio"

    id = Column(Integer, primary_key=True, index=True)
    numero_orden = Column(String(20), unique=True, index=True)         # OS-0001
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=True)
    tipo_servicio = Column(String(100))
    descripcion = Column(Text)
    direccion_obra = Column(String(200))
    distrito = Column(String(100))
    fecha_inicio = Column(Date)
    fecha_fin_estimada = Column(Date)
    fecha_fin_real = Column(Date, nullable=True)
    presupuesto = Column(Float, nullable=False)
    moneda = Column(String(3), default="PEN")               # PEN | USD
    tipo_cambio = Column(Float, nullable=True)
    presupuesto_soles = Column(Float, nullable=True)
    avance_porcentaje = Column(Integer, default=0)
    estado = Column(String(20), default="Pendiente")        # Pendiente | En Proceso | Completada | Cancelada
    comprobante_id = Column(Integer, ForeignKey("ventas_comercial.id"), nullable=True)
    observaciones = Column(Text, nullable=True)
    created_at = Column(Date)
    updated_at = Column(Date)

    cliente = relationship("Cliente")
    gastos  = relationship("Gasto", back_populates="orden")


class Empleado(Base):
    __tablename__ = "empleados"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    cargo = Column(String(100))
    sueldo = Column(Float)
    fecha_ingreso = Column(Date)
    estado = Column(String(50), default="activo")
    vacaciones_dias = Column(Integer, default=0)
    tardanzas = Column(Integer, default=0)


class CategoriaGasto(Base):
    __tablename__ = "categorias_gasto"

    id = Column(Integer, primary_key=True)
    nombre = Column(String(100), nullable=False, unique=True)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AreaGasto(Base):
    __tablename__ = "areas_gasto"

    id = Column(Integer, primary_key=True)
    nombre = Column(String(100), nullable=False, unique=True)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Garantia(Base):
    __tablename__ = "garantias"

    id = Column(Integer, primary_key=True)
    cliente_ruc = Column(String(11), nullable=False)
    cliente_nombre = Column(String(200), nullable=False)
    monto = Column(Float, nullable=False)
    monto_devuelto = Column(Float, default=0)
    monto_pendiente = Column(Float, nullable=False)
    monto_ejecutado = Column(Float, default=0)
    fecha_cobro = Column(Date, nullable=False)
    tipo_documento = Column(String(50), default="Recibo Interno")
    numero_documento = Column(String(50), nullable=True)
    estado = Column(String(30), default="retenida")
    # Estados: retenida / devolucion_parcial / devuelta / ejecutada
    metodo_cobro = Column(String(50), nullable=True)
    cuenta_bancaria_id = Column(Integer, ForeignKey("cuentas_bancarias.id"), nullable=True)
    observacion = Column(Text, nullable=True)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)

    pagos = relationship("PagoGarantia", back_populates="garantia", cascade="all, delete-orphan")
    cuenta_bancaria = relationship("CuentaBancaria")


class MovimientoCaja(Base):
    # Registro histórico de movimientos de caja generados automáticamente por
    # otras acciones del sistema (ej. extorno de un cobro) — independiente de
    # conciliaciones_bancarias/movimientos_conciliacion (módulo Flujo de Caja,
    # no modificado). Por ahora es solo bitácora: ningún reporte lo consume aún.
    __tablename__ = "movimientos_caja"

    id = Column(Integer, primary_key=True)
    fecha = Column(Date, nullable=False)
    tipo = Column(String(20), nullable=False)  # ingreso / salida
    categoria = Column(String(100), nullable=True)
    descripcion = Column(Text, nullable=True)
    monto = Column(Float, nullable=False)
    cuenta_bancaria_id = Column(Integer, ForeignKey("cuentas_bancarias.id"), nullable=True)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)


class PagoGarantia(Base):
    __tablename__ = "pagos_garantia"

    id = Column(Integer, primary_key=True)
    garantia_id = Column(Integer, ForeignKey("garantias.id"))
    tipo = Column(String(20))  # "devolucion" o "ejecucion"
    monto = Column(Float, nullable=False)
    fecha = Column(Date, nullable=False)
    metodo_pago = Column(String(50), nullable=True)
    cuenta_bancaria_id = Column(Integer, ForeignKey("cuentas_bancarias.id"), nullable=True)
    numero_documento_generado = Column(String(50), nullable=True)
    # Solo se setea cuando tipo="ejecucion" y aplicar_a fue "factura" o
    # "recibo_interno" (no "credito") — identifica qué VentaComercial se
    # saldó directamente, para poder revertirlo si se elimina la garantía.
    venta_id = Column(Integer, ForeignKey("ventas_comercial.id"), nullable=True)
    observacion = Column(Text, nullable=True)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)

    garantia = relationship("Garantia", back_populates="pagos")
    cuenta_bancaria = relationship("CuentaBancaria")


class CreditoCliente(Base):
    __tablename__ = "creditos_cliente"

    id = Column(Integer, primary_key=True)
    cliente_ruc = Column(String(11), nullable=False)
    cliente_nombre = Column(String(200), nullable=False)
    origen = Column(String(50))
    origen_id = Column(Integer, nullable=True)
    numero_documento = Column(String(50))
    monto_original = Column(Float, nullable=False)
    monto_disponible = Column(Float, nullable=False)
    estado = Column(String(20), default="disponible")
    fecha = Column(Date, nullable=False)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)


class Prestamo(Base):
    __tablename__ = "prestamos"

    id = Column(Integer, primary_key=True)
    tipo = Column(String(20), nullable=False)
    # "recibido_banco" / "recibido_tercero" / "otorgado_tercero" / "otorgado_empleado"

    # Datos del prestamista/prestatario
    nombre_tercero = Column(String(200), nullable=False)
    ruc_dni_tercero = Column(String(11), nullable=True)

    # Datos del préstamo
    monto_original = Column(Float, nullable=False)
    monto_pendiente = Column(Float, nullable=False)
    fecha_inicio = Column(Date, nullable=False)
    fecha_vencimiento = Column(Date, nullable=True)

    # Tasa de interés
    aplica_interes = Column(Boolean, default=True)
    tipo_tasa = Column(String(20), nullable=True)
    # "TEM" / "TEA" / "TNA" / "TNM" / "TCEA" / "Personalizada"
    porcentaje_tasa = Column(Float, nullable=True)
    tasa_mensual = Column(Float, nullable=True)
    # Calculada automáticamente según tipo_tasa

    # Estado
    estado = Column(String(20), default="activo")
    # "activo" / "pagado" / "cancelado"

    descripcion = Column(Text, nullable=True)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)

    cuotas = relationship("CuotaPrestamo", back_populates="prestamo", cascade="all, delete-orphan")


class CuotaPrestamo(Base):
    __tablename__ = "cuotas_prestamo"

    id = Column(Integer, primary_key=True)
    prestamo_id = Column(Integer, ForeignKey("prestamos.id"))
    numero_cuota = Column(Integer, nullable=False)
    fecha_pago = Column(Date, nullable=False)
    saldo_inicial = Column(Float, nullable=False)
    amortizacion = Column(Float, nullable=False)
    interes = Column(Float, default=0)
    # Desglose de cargos del cronograma BCP, además de amortización/interés
    # (cuota_total = amortizacion + interes + seguro_desgravamen +
    # seguro_bien + comisiones). Solo seguro_desgravamen se muestra en la UI
    # por ahora — seguro_bien/comisiones quedan disponibles para reportes.
    seguro_desgravamen = Column(Float, default=0)
    seguro_bien = Column(Float, default=0)
    comisiones = Column(Float, default=0)
    cuota_total = Column(Float, nullable=False)
    saldo_final = Column(Float, nullable=False)
    estado = Column(String(20), default="pendiente")
    # "pendiente" / "pagado" — "vencido" es un estado calculado en el
    # serializador (fecha_pago vencida + sigue "pendiente"), no se persiste.
    es_adelanto = Column(Boolean, default=False)
    monto_adelanto = Column(Float, default=0)
    fecha_pago_real = Column(Date, nullable=True)
    metodo_pago = Column(String(50), nullable=True)
    cuenta_bancaria_id = Column(Integer, ForeignKey("cuentas_bancarias.id"), nullable=True)
    # Vincula esta cuota con el movimiento que generó en la bitácora de Flujo
    # de Caja (MovimientoCaja) — permite actualizarlo/revertirlo al editar o
    # eliminar la cuota en vez de dejarlo huérfano.
    movimiento_caja_id = Column(Integer, ForeignKey("movimientos_caja.id"), nullable=True)
    observacion = Column(Text, nullable=True)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)

    prestamo = relationship("Prestamo", back_populates="cuotas")
    cuenta_bancaria = relationship("CuentaBancaria")
