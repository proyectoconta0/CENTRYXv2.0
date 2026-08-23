from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, Text
from database import Base


class ConfiguracionEmpresa(Base):
    """Fila única (singleton) con los datos de la empresa y el estado del onboarding."""
    __tablename__ = "configuracion_empresa"

    id                      = Column(Integer, primary_key=True, index=True)
    nombre_empresa          = Column(String(200))
    ruc                     = Column(String(11))
    direccion               = Column(String(200))
    distrito                = Column(String(100))
    telefono                = Column(String(20))
    email                   = Column(String(100))
    web                     = Column(String(200))
    whatsapp_soporte        = Column(String(20))
    logo_path               = Column(String(500))
    mensaje_comprobante     = Column(String(300))
    color_principal         = Column(String(7), default="#1e40af")
    moneda_principal        = Column(String(3), default="PEN")
    rubro                   = Column(String(50))
    tipos_servicio_json     = Column(Text, nullable=True)
    categorias_gastos_json  = Column(Text, nullable=True)
    onboarding_completado   = Column(Boolean, default=False)
    tiempo_sesion_horas     = Column(Integer, default=8)
    created_at              = Column(DateTime)
    updated_at              = Column(DateTime)
    # SMTP para envío de comprobantes por correo
    smtp_host               = Column(String(200), default="smtp.gmail.com")
    smtp_port               = Column(Integer, default=587)
    smtp_usuario            = Column(String(200))
    smtp_password           = Column(String(200))
    smtp_from_name          = Column(String(200))


class ConfiguracionAlerta(Base):
    __tablename__ = "configuracion_alertas"

    id            = Column(Integer, primary_key=True, index=True)
    tipo_alerta   = Column(String(50), unique=True, nullable=False)
    activa        = Column(Boolean, default=True)
    valor_umbral  = Column(Numeric)
    created_at    = Column(DateTime)


class ConfiguracionDocumento(Base):
    """Prefijo y próximo número por tipo de comprobante/correlativo."""
    __tablename__ = "configuracion_documentos"

    id              = Column(Integer, primary_key=True, index=True)
    tipo_documento  = Column(String(50), unique=True, nullable=False)
    prefijo         = Column(String(20), default="")
    proximo_numero  = Column(Integer, default=1)
