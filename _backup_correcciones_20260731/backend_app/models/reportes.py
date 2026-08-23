from sqlalchemy import Column, Integer, String, Date, Text
from database import Base


class ReporteGenerado(Base):
    __tablename__ = "reportes_generados"

    id             = Column(Integer, primary_key=True, index=True)
    tipo           = Column(String(50), nullable=False)    # general | ventas | gastos | cobranza | flujo_caja | proveedores
    periodo_label  = Column(String(100))
    periodo_desde  = Column(Date, nullable=False)
    periodo_hasta  = Column(Date, nullable=False)
    formato        = Column(String(10), nullable=False)    # xlsx | pdf
    filtros_json   = Column(Text, nullable=True)
    archivo_path   = Column(String(500), nullable=False)
    archivo_nombre = Column(String(255), nullable=False)
    created_at     = Column(Date)
