from pydantic import BaseModel
from typing import Optional, List
from datetime import date


class ClienteCreate(BaseModel):
    razon_social: str
    ruc: str
    contacto: Optional[str] = None
    cargo_contacto: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    distrito: Optional[str] = None
    tipo_cliente: Optional[str] = None
    activo: bool = True


class ClienteUpdate(ClienteCreate):
    pass


class ClienteListItem(BaseModel):
    id: int
    razon_social: str
    ruc: str
    contacto: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    distrito: Optional[str] = None
    tipo_cliente: Optional[str] = None
    activo: bool = True
    total_comprado: float = 0
    ultima_compra: Optional[date] = None
    cotizaciones_pendientes: int = 0

    class Config:
        from_attributes = True


class ClienteFicha(ClienteListItem):
    cargo_contacto: Optional[str] = None
    direccion: Optional[str] = None


class CotizacionCreate(BaseModel):
    cliente_id: int
    tipo_servicio: str
    descripcion: Optional[str] = None
    monto: float
    fecha_emision: date
    fecha_vencimiento: date
    estado: str = "borrador"


class CotizacionUpdate(BaseModel):
    cliente_id: Optional[int] = None
    tipo_servicio: Optional[str] = None
    descripcion: Optional[str] = None
    monto: Optional[float] = None
    fecha_emision: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    estado: Optional[str] = None


class CotizacionOut(BaseModel):
    id: int
    numero: str
    cliente_id: int
    cliente_nombre: Optional[str] = None
    tipo_servicio: str
    descripcion: Optional[str] = None
    monto: float
    fecha_emision: date
    fecha_vencimiento: date
    estado: str
    venta_comercial_id: Optional[int] = None
    dias_para_vencer: int = 0

    class Config:
        from_attributes = True


class DocumentoOut(BaseModel):
    id: int
    cliente_id: int
    nombre: str
    tipo: Optional[str] = None
    tamano: int = 0
    fecha_carga: Optional[date] = None
    venta_id: Optional[int] = None
    estado: str = "Activo"

    class Config:
        from_attributes = True


class HistorialItem(BaseModel):
    id: int
    tipo_servicio: str
    descripcion: Optional[str] = None
    monto: float
    fecha: date
    estado: str
    tiene_comprobante: bool = False
    comprobante_nombre: Optional[str] = None

    class Config:
        from_attributes = True
