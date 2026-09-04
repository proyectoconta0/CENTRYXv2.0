from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime


class Cotizacion(Base):
    __tablename__ = "cotizaciones"

    id = Column(Integer, primary_key=True, index=True)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), nullable=True, index=True)
    numero = Column(String(20), nullable=False)
    cliente_id = Column(Integer, ForeignKey("clientes.id"))
    tipo_servicio = Column(String(100), nullable=False)
    descripcion = Column(Text)
    monto = Column(Float, nullable=False)
    fecha_emision = Column(Date, nullable=False)
    fecha_vencimiento = Column(Date, nullable=False)
    estado = Column(String(50), default="borrador")
    venta_comercial_id = Column(Integer, nullable=True)

    cliente = relationship("Cliente", back_populates="cotizaciones")


class VentaComercial(Base):
    __tablename__ = "ventas_comercial"

    id = Column(Integer, primary_key=True, index=True)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), nullable=True, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=True)
    cotizacion_id = Column(Integer, nullable=True)
    tipo_servicio = Column(String(100))
    descripcion = Column(Text)
    monto = Column(Float)
    fecha = Column(Date, index=True)
    estado = Column(String(50), default="completada")
    numero_factura = Column(String(30), nullable=True)
    comprobante_path = Column(String(500), nullable=True)
    comprobante_nombre = Column(String(200), nullable=True)
    # Campos de comprobante
    tipo_documento = Column(String(50), default="Factura")
    base_imponible = Column(Float, nullable=True)
    igv = Column(Float, nullable=True)
    precio_venta = Column(Float, nullable=True)
    documento_relacionado = Column(String(30), nullable=True)
    # Id de la factura/boleta que esta Nota de Crédito anuló (se completa al
    # confirmar la anulación en /{id}/anular). Permite reactivarla si se
    # elimina la Nota de Crédito.
    comprobante_relacionado_id = Column(Integer, ForeignKey("ventas_comercial.id"), nullable=True)
    # Solo para tipo_documento == "Nota de Crédito": "anulacion_simple" |
    # "devolucion_cobro" | "descuento_parcial" — determina el efecto sobre la
    # factura relacionada (ver _aplicar_nc en comprobantes.py).
    tipo_nota_credito = Column(String(30), nullable=True)
    # Datos del egreso de la devolución — solo aplican cuando
    # tipo_nota_credito == "devolucion_cobro" (ver _crear_egreso_nc).
    fecha_devolucion            = Column(Date, nullable=True)
    metodo_devolucion           = Column(String(30), nullable=True)   # Efectivo | Transferencia | Cheque
    banco_devolucion            = Column(String(100), nullable=True)
    numero_cuenta_devolucion    = Column(String(50), nullable=True)
    numero_operacion_devolucion = Column(String(50), nullable=True)
    # Solo para tipo_documento == "Nota de Débito": "cargo_adicional" |
    # "interes_mora" | "penalidad" — los 3 tienen el mismo efecto (aumentar
    # el monto de la factura relacionada, ver _aplicar_nd), solo clasifica.
    tipo_nota_debito = Column(String(30), nullable=True)
    ruc_cliente = Column(String(20), nullable=True, index=True)
    razon_social_cliente = Column(String(200), nullable=True)
    # Campos de cobranza (Módulo 3)
    fecha_vencimiento = Column(Date, nullable=True)
    saldo_pendiente = Column(Float, nullable=True)
    estado_cobranza = Column(String(50), nullable=True, index=True)
    # Campos de moneda (PEN / USD)
    moneda = Column(String(3), default="PEN")
    tipo_cambio = Column(Float, nullable=True)
    monto_original = Column(Float, nullable=True)
    precio_venta_soles = Column(Float, nullable=True)
    # Envío de comprobante por correo
    enviado_email = Column(Boolean, default=False)
    fecha_envio_email = Column(DateTime, nullable=True)
    email_envio_destino = Column(String(150), nullable=True)
    # Detracción (solo Facturas): cliente nos retiene y deposita en nuestra
    # cuenta de detracciones del Banco de la Nación.
    tiene_detraccion = Column(Boolean, default=False)
    tasa_detraccion = Column(Float, nullable=True)
    monto_detraccion = Column(Float, nullable=True)
    monto_neto_cobrar = Column(Float, nullable=True)
    concepto_detraccion = Column(String(100), nullable=True)
    fecha_limite_detraccion = Column(Date, nullable=True)
    detraccion_pagada = Column(Boolean, default=False)

    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)
    modificado_por = Column(String(100), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    metodo_creacion = Column(String(50), nullable=True)  # "Manual" | "Importación PDF" | "Importación ZIP"

    cliente = relationship("Cliente", back_populates="ventas_comercial")
    pagos = relationship("PagoCobranza", back_populates="comprobante", cascade="all, delete-orphan")


class PagoCobranza(Base):
    __tablename__ = "pagos_cobranza"

    id = Column(Integer, primary_key=True, index=True)
    comprobante_id = Column(Integer, ForeignKey("ventas_comercial.id"), nullable=False)
    monto_pagado = Column(Float, nullable=False, index=True)
    fecha_pago = Column(Date, nullable=False, index=True)
    metodo_pago = Column(String(50), nullable=False)
    # Campos adicionales según método de pago
    banco = Column(String(100), nullable=True)
    numero_cuenta = Column(String(50), nullable=True)
    numero_cheque = Column(String(50), nullable=True)
    created_at = Column(Date)
    creado_por = Column(String(100), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)
    modificado_por = Column(String(100), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    metodo_creacion = Column(String(50), nullable=True)
    redondeo_tipo = Column(String(20), nullable=True)
    # Valores: "ganancia", "perdida", None
    redondeo_monto = Column(Float, default=0)
    # Igual patrón que CreditoCliente.origen/origen_id — solo se usa cuando
    # este cobro vino de aplicar un crédito de garantía (origen="credito_garantia",
    # origen_id=CreditoCliente.id), para poder revertirlo si se elimina la
    # garantía que generó el crédito. None en un cobro real (efectivo/transferencia/etc).
    origen = Column(String(50), nullable=True)
    origen_id = Column(Integer, nullable=True)
    extornado = Column(Boolean, default=False)
    fecha_extorno = Column(DateTime, nullable=True)
    motivo_extorno = Column(Text, nullable=True)
    extornado_por = Column(String(100), nullable=True)

    comprobante = relationship("VentaComercial", back_populates="pagos")


class OrdenCobro(Base):
    # Cobro consolidado de UNA o VARIAS facturas/boletas de Cuentas por Cobrar
    # del mismo cliente, en un solo registro (no un PagoCobranza por
    # comprobante) — mismo patrón que OrdenPago en Gastos
    # (backend/app/routers/ordenes_pago.py).
    __tablename__ = "ordenes_cobro"

    id               = Column(Integer, primary_key=True, index=True)
    empresa_id       = Column(Integer, ForeignKey("empresas.id"), nullable=True, index=True)
    numero_orden     = Column(String(20), nullable=False, unique=True)   # OC-0001
    cliente_id       = Column(Integer, ForeignKey("clientes.id"), nullable=True)
    ruc_cliente      = Column(String(20), nullable=True)
    nombre_cliente   = Column(String(200), nullable=True)
    fecha_cobro      = Column(Date, nullable=False)
    monto_total      = Column(Float, nullable=False)
    estado           = Column(String(20), default="Cobrado")
    metodo_cobro     = Column(String(30), nullable=True)
    banco            = Column(String(100), nullable=True)
    numero_cuenta    = Column(String(50), nullable=True)
    numero_cheque    = Column(String(50), nullable=True)
    numero_operacion = Column(String(50), nullable=True)
    created_at       = Column(Date)

    detalles = relationship(
        "OrdenCobroDetalle", back_populates="orden", cascade="all, delete-orphan"
    )


class OrdenCobroDetalle(Base):
    __tablename__ = "ordenes_cobro_detalle"

    id             = Column(Integer, primary_key=True, index=True)
    orden_id       = Column(Integer, ForeignKey("ordenes_cobro.id"), nullable=False)
    venta_id       = Column(Integer, ForeignKey("ventas_comercial.id"), nullable=True)
    monto_cobrado  = Column(Float, nullable=False)
    saldo_anterior = Column(Float, nullable=False)   # saldo_pendiente del comprobante antes de este cobro
    created_at     = Column(Date)

    orden = relationship("OrdenCobro", back_populates="detalles")
    venta = relationship("VentaComercial")


class CuentaBancaria(Base):
    __tablename__ = "cuentas_bancarias"

    id = Column(Integer, primary_key=True, index=True)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), nullable=True, index=True)
    banco = Column(String(100), nullable=False)
    numero_cuenta = Column(String(50), nullable=False)
    tipo_cuenta = Column(String(50), nullable=True)  # Corriente / Ahorros
    activo = Column(Boolean, default=True)


class DocumentoCliente(Base):
    __tablename__ = "documentos_cliente"

    id = Column(Integer, primary_key=True, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"))
    nombre = Column(String(200), nullable=False)
    tipo = Column(String(100))
    ruta_archivo = Column(String(500))
    tamano = Column(Integer, default=0)
    fecha_carga = Column(Date)
    venta_id = Column(Integer, ForeignKey("ventas_comercial.id"), nullable=True)
    estado = Column(String(20), default="Activo")

    cliente = relationship("Cliente", back_populates="documentos")
    venta = relationship("VentaComercial", foreign_keys=[venta_id])
