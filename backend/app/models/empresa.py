from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from database import Base
from datetime import datetime


class Empresa(Base):
    """Cada empresa (tenant) que usa el sistema CENTRYX."""
    __tablename__ = "empresas"

    id         = Column(Integer, primary_key=True, index=True)
    nombre     = Column(String(200), nullable=False)
    ruc        = Column(String(11), nullable=False, unique=True)
    subdominio = Column(String(100), nullable=False, unique=True)  # jyd, electropro, etc.
    plan       = Column(String(50), default="basico")              # basico | profesional | enterprise
    email      = Column(String(200), nullable=True)
    telefono   = Column(String(20), nullable=True)
    logo_url   = Column(String(500), nullable=True)
    logo_base64 = Column(Text, nullable=True)
    activo     = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)
