from pydantic import BaseModel
from typing import Optional, List
from datetime import date


class Token(BaseModel):
    access_token: str
    token_type: str
    usuario: dict


class LoginRequest(BaseModel):
    email: str
    password: str


class UsuarioBase(BaseModel):
    nombre: str
    email: str
    rol: str = "vendedor"
    activo: bool = True


class UsuarioCreate(UsuarioBase):
    password: str


class UsuarioOut(UsuarioBase):
    id: int

    class Config:
        from_attributes = True


class ClienteBase(BaseModel):
    razon_social: str
    ruc: str
    contacto: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    activo: bool = True


class ClienteOut(ClienteBase):
    id: int

    class Config:
        from_attributes = True


class ProyectoBase(BaseModel):
    nombre: str
    cliente_id: int
    presupuesto: float
    ejecutado: float = 0
    avance_fisico: float = 0
    avance_financiero: float = 0
    estado: str = "activo"
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None


class ProyectoOut(ProyectoBase):
    id: int

    class Config:
        from_attributes = True


class KPIDashboard(BaseModel):
    ventas_mes: float
    ventas_variacion: float
    utilidad_estimada: float
    utilidad_variacion: float
    gastos_mes: float
    gastos_variacion: float
    cuentas_cobrar: float
    cobrar_variacion: float
    flujo_caja: float


class VentaEvolucion(BaseModel):
    periodo: str
    monto: float


class FlujoCajaItem(BaseModel):
    mes: str
    anio: int
    ingresos: float
    egresos: float
    saldo: float


class TopCliente(BaseModel):
    nombre: str
    ventas: float
    porcentaje: float


class CobranzaEstado(BaseModel):
    al_dia: dict
    por_vencer: dict
    vencida: dict


class GastoCategoria(BaseModel):
    categoria: str
    monto: float
    porcentaje: float


class ProyectoEjecucion(BaseModel):
    nombre: str
    cliente: str
    presupuesto: float
    ejecutado: float
    avance_fisico: float
    avance_financiero: float
    estado: str


class IndicadoresKPI(BaseModel):
    rentabilidad_neta: float
    liquidez_corriente: float
    rotacion_cartera: float
    cumplimiento_ventas: float
    productividad_personal: float
