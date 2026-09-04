from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from database import Base


class AuditoriaLog(Base):
    """Registro de auditoría por usuario: quién hizo qué, cuándo y desde
    dónde. Solo lectura desde la interfaz — nadie edita ni elimina filas."""
    __tablename__ = "auditoria_logs"

    id             = Column(Integer, primary_key=True, index=True)
    empresa_id     = Column(Integer, ForeignKey("empresas.id"), nullable=True, index=True)
    usuario_id     = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    usuario_nombre = Column(String(100))
    modulo         = Column(String(50), index=True)
    accion         = Column(String(100))
    descripcion    = Column(Text)
    ip_address     = Column(String(45), nullable=True)
    fecha_hora     = Column(DateTime, server_default=func.now(), index=True)
