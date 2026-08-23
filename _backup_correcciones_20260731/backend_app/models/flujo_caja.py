from sqlalchemy import Column, Integer, String, Float, Date, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class ConciliacionBancaria(Base):
    __tablename__ = "conciliaciones_bancarias"

    id                    = Column(Integer, primary_key=True, index=True)
    cuenta_bancaria_id    = Column(Integer, ForeignKey("cuentas_bancarias.id"), nullable=True)
    periodo_desde         = Column(Date, nullable=False)
    periodo_hasta         = Column(Date, nullable=False)
    banco                 = Column(String(100))
    formato_archivo       = Column(String(50))   # excel | csv | pdf
    archivo_path          = Column(String(500))
    saldo_sistema         = Column(Float, default=0)
    saldo_banco           = Column(Float, default=0)
    diferencia            = Column(Float, default=0)
    porcentaje_conciliado = Column(Float, default=0)
    estado                = Column(String(50), default="En proceso")
    fecha_cierre          = Column(Date, nullable=True)
    created_at            = Column(Date)

    movimientos = relationship(
        "MovimientoConciliacion",
        back_populates="conciliacion",
        cascade="all, delete-orphan",
    )


class MovimientoConciliacion(Base):
    __tablename__ = "movimientos_conciliacion"

    id                      = Column(Integer, primary_key=True, index=True)
    conciliacion_id         = Column(Integer, ForeignKey("conciliaciones_bancarias.id"), nullable=False)
    fecha                   = Column(Date, nullable=False)
    descripcion             = Column(String(300))
    monto                   = Column(Float, nullable=False)
    tipo                    = Column(String(20))    # ingreso | egreso
    origen                  = Column(String(20))    # sistema | banco
    conciliado              = Column(Boolean, default=False)
    es_gasto_bancario       = Column(Boolean, default=False)
    referencia_sistema_id   = Column(Integer, nullable=True)
    referencia_sistema_tipo = Column(String(50), nullable=True)  # cobranza | gasto
    created_at              = Column(Date)

    conciliacion = relationship("ConciliacionBancaria", back_populates="movimientos")
