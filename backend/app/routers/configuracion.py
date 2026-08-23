import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from app.core.security import (
    RUBROS, ROLES_DISPONIBLES, get_current_usuario, require_administrador,
)
from app.models.configuracion import ConfiguracionAlerta, ConfiguracionDocumento, ConfiguracionEmpresa
from app.models.models import Usuario, Cliente, Gasto, Proveedor, CategoriaGasto, AreaGasto
from app.models.comercial import VentaComercial
from app.services.reportes_export import construir_excel

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

LOGO_DIR = Path("uploads/empresa")
LOGO_MAX_BYTES = 2 * 1024 * 1024
LOGO_TIPOS_VALIDOS = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"}


# ══════════════════════════════════════════════════════════════════════════
# Empresa
# ══════════════════════════════════════════════════════════════════════════

def _get_empresa(db: Session) -> ConfiguracionEmpresa:
    empresa = db.query(ConfiguracionEmpresa).first()
    if not empresa:
        empresa = ConfiguracionEmpresa(
            nombre_empresa="Centryx", color_principal="#1e40af", moneda_principal="PEN",
            onboarding_completado=False, tiempo_sesion_horas=8,
            created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
        )
        db.add(empresa)
        db.commit()
        db.refresh(empresa)
    return empresa


def _serialize_empresa(e: ConfiguracionEmpresa) -> dict:
    return {
        "id":                    e.id,
        "nombre_empresa":        e.nombre_empresa or "",
        "ruc":                   e.ruc or "",
        "direccion":             e.direccion or "",
        "distrito":              e.distrito or "",
        "telefono":              e.telefono or "",
        "email":                 e.email or "",
        "web":                   e.web or "",
        "whatsapp_soporte":      e.whatsapp_soporte or "",
        "mensaje_comprobante":   e.mensaje_comprobante or "",
        "logo_url":              "/api/configuracion/empresa/logo" if e.logo_path else None,
        "color_principal":       e.color_principal or "#1e40af",
        "moneda_principal":      e.moneda_principal or "PEN",
        "rubro":                 e.rubro or "",
        "tipos_servicio":        json.loads(e.tipos_servicio_json) if e.tipos_servicio_json else [],
        "categorias_gastos":     json.loads(e.categorias_gastos_json) if e.categorias_gastos_json else [],
        "onboarding_completado": bool(e.onboarding_completado),
        "tiempo_sesion_horas":   e.tiempo_sesion_horas or 8,
        "updated_at":            str(e.updated_at) if e.updated_at else None,
        "smtp_host":             e.smtp_host or "",
        "smtp_port":             e.smtp_port or 587,
        "smtp_usuario":          e.smtp_usuario or "",
        "smtp_from_name":        e.smtp_from_name or "",
        "smtp_password_configurado": bool(e.smtp_password),
    }


class EmpresaUpdate(BaseModel):
    nombre_empresa: Optional[str] = None
    ruc: Optional[str] = None
    direccion: Optional[str] = None
    distrito: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    web: Optional[str] = None
    whatsapp_soporte: Optional[str] = None
    mensaje_comprobante: Optional[str] = None
    color_principal: Optional[str] = None
    moneda_principal: Optional[str] = None
    tiempo_sesion_horas: Optional[int] = None
    onboarding_completado: Optional[bool] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_usuario: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from_name: Optional[str] = None


@router.get("/empresa")
def obtener_empresa(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    return _serialize_empresa(_get_empresa(db))


# Sin auth a propósito: la pantalla de Login todavía no tiene token y necesita
# mostrar el nombre/RUC de la empresa antes de autenticarse. No reutiliza
# _serialize_empresa/GET /empresa porque ese endpoint expone datos internos
# (smtp_host, smtp_usuario, whatsapp_soporte, email, teléfono, dirección...)
# que no deben quedar accesibles sin login.
@router.get("/empresa-publica")
def obtener_empresa_publica(db: Session = Depends(get_db)):
    empresa = _get_empresa(db)
    return {
        "nombre_empresa": empresa.nombre_empresa or "",
        "ruc": empresa.ruc or "",
    }


@router.put("/empresa")
def actualizar_empresa(data: EmpresaUpdate, db: Session = Depends(get_db),
                        usuario: Usuario = Depends(require_administrador)):
    empresa = _get_empresa(db)
    campos = data.dict(exclude_unset=True)
    if not campos.get("smtp_password"):
        # Campo enmascarado en el frontend: una cadena vacía significa
        # "no cambiar", nunca se debe borrar una contraseña ya guardada.
        campos.pop("smtp_password", None)
    elif os.getenv("FERNET_KEY"):
        from cryptography.fernet import Fernet
        f = Fernet(os.getenv("FERNET_KEY").encode())
        campos["smtp_password"] = f.encrypt(campos["smtp_password"].encode()).decode()
    for campo, valor in campos.items():
        setattr(empresa, campo, valor)
    empresa.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(empresa)
    return _serialize_empresa(empresa)


@router.post("/empresa/logo")
async def subir_logo(file: UploadFile = File(...), db: Session = Depends(get_db),
                      usuario: Usuario = Depends(require_administrador)):
    if file.content_type not in LOGO_TIPOS_VALIDOS:
        raise HTTPException(400, "Formato de imagen no válido. Usa PNG, JPG, WEBP o SVG.")
    contenido = await file.read()
    if len(contenido) > LOGO_MAX_BYTES:
        raise HTTPException(400, "El logo no debe superar 2 MB")

    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "logo.png").suffix or ".png"
    ruta = LOGO_DIR / f"logo{ext}"
    ruta.write_bytes(contenido)

    empresa = _get_empresa(db)
    empresa.logo_path = str(ruta)
    empresa.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "logo_url": "/api/configuracion/empresa/logo"}


@router.get("/empresa/logo")
def ver_logo(db: Session = Depends(get_db)):
    empresa = db.query(ConfiguracionEmpresa).first()
    if not empresa or not empresa.logo_path or not Path(empresa.logo_path).exists():
        raise HTTPException(404, "Sin logo configurado")
    return FileResponse(empresa.logo_path)


@router.get("/smtp/probar")
def probar_conexion_smtp(db: Session = Depends(get_db), usuario: Usuario = Depends(require_administrador)):
    import smtplib

    empresa = db.query(ConfiguracionEmpresa).first()
    if not empresa or not empresa.smtp_host or not empresa.smtp_usuario or not empresa.smtp_password:
        return {"success": False, "mensaje": "Complete y guarde los datos SMTP antes de probar la conexión"}

    try:
        from app.services.comprobante_email import descifrar_smtp_password
        with smtplib.SMTP(empresa.smtp_host, empresa.smtp_port or 587, timeout=10) as server:
            server.starttls()
            server.login(empresa.smtp_usuario, descifrar_smtp_password(empresa.smtp_password))
        return {"success": True, "mensaje": "Conexión SMTP exitosa"}
    except smtplib.SMTPAuthenticationError:
        return {"success": False, "mensaje": "Error de autenticación. Verifique usuario y contraseña (para Gmail use una contraseña de aplicación)"}
    except smtplib.SMTPException as e:
        return {"success": False, "mensaje": f"Error SMTP: {e}"}
    except (OSError, TimeoutError) as e:
        return {"success": False, "mensaje": f"Error de conexión: {e}"}


# ══════════════════════════════════════════════════════════════════════════
# Rubro
# ══════════════════════════════════════════════════════════════════════════

@router.get("/rubro")
def obtener_rubro(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    empresa = _get_empresa(db)
    return {
        "rubro_actual":      empresa.rubro or "",
        "tipos_servicio":    json.loads(empresa.tipos_servicio_json) if empresa.tipos_servicio_json else [],
        "categorias_gastos": json.loads(empresa.categorias_gastos_json) if empresa.categorias_gastos_json else [],
        "catalogo":          RUBROS,
    }


class RubroUpdate(BaseModel):
    rubro: str
    tipos_servicio: Optional[list] = None
    categorias_gastos: Optional[list] = None


@router.put("/rubro")
def actualizar_rubro(data: RubroUpdate, db: Session = Depends(get_db),
                      usuario: Usuario = Depends(require_administrador)):
    if data.rubro not in RUBROS:
        raise HTTPException(400, "Rubro no reconocido")
    empresa = _get_empresa(db)
    empresa.rubro = data.rubro
    tipos = data.tipos_servicio if data.tipos_servicio is not None else RUBROS[data.rubro]["tipos_servicio"]
    categorias = data.categorias_gastos if data.categorias_gastos is not None else RUBROS[data.rubro]["categorias_gastos"]
    empresa.tipos_servicio_json = json.dumps(tipos)
    empresa.categorias_gastos_json = json.dumps(categorias)
    empresa.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "rubro": data.rubro, "tipos_servicio": tipos, "categorias_gastos": categorias}


# ══════════════════════════════════════════════════════════════════════════
# Usuarios
# ══════════════════════════════════════════════════════════════════════════

def _serialize_usuario(u: Usuario) -> dict:
    return {"id": u.id, "nombre": u.nombre, "email": u.email, "rol": u.rol, "activo": bool(u.activo)}


class UsuarioCreateReq(BaseModel):
    nombre: str
    email: str
    password: str
    rol: str = "Vendedor"
    activo: bool = True


class UsuarioUpdateReq(BaseModel):
    nombre: Optional[str] = None
    email: Optional[str] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None
    password: Optional[str] = None


@router.get("/usuarios")
def listar_usuarios(db: Session = Depends(get_db), usuario: Usuario = Depends(require_administrador)):
    rows = db.query(Usuario).order_by(Usuario.nombre.asc()).all()
    return {"data": [_serialize_usuario(u) for u in rows], "roles_disponibles": ROLES_DISPONIBLES}


@router.post("/usuarios")
def crear_usuario(data: UsuarioCreateReq, db: Session = Depends(get_db),
                   usuario: Usuario = Depends(require_administrador)):
    if db.query(Usuario).filter(Usuario.email == data.email).first():
        raise HTTPException(400, "Ya existe un usuario con ese email")
    nuevo = Usuario(
        nombre=data.nombre, email=data.email,
        password=pwd_context.hash(data.password),
        rol=data.rol, activo=data.activo,
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return _serialize_usuario(nuevo)


@router.put("/usuarios/{usuario_id}")
def actualizar_usuario(usuario_id: int, data: UsuarioUpdateReq, db: Session = Depends(get_db),
                        usuario: Usuario = Depends(require_administrador)):
    target = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    if data.email and data.email != target.email:
        if db.query(Usuario).filter(Usuario.email == data.email, Usuario.id != usuario_id).first():
            raise HTTPException(400, "Ya existe un usuario con ese email")
        target.email = data.email
    if data.nombre is not None:
        target.nombre = data.nombre
    if data.rol is not None:
        target.rol = data.rol
    if data.activo is not None:
        target.activo = data.activo
    if data.password:
        target.password = pwd_context.hash(data.password)
    db.commit()
    db.refresh(target)
    return _serialize_usuario(target)


@router.delete("/usuarios/{usuario_id}")
def eliminar_usuario(usuario_id: int, db: Session = Depends(get_db),
                      usuario: Usuario = Depends(require_administrador)):
    if usuario_id == usuario.id:
        raise HTTPException(400, "No puedes eliminar tu propio usuario")
    target = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    db.delete(target)
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════
# Documentos (correlativos)
# ══════════════════════════════════════════════════════════════════════════

DOCUMENTOS_DEFAULT = [
    ("facturas",           "Facturas",            "F001-", 21),
    ("boletas",            "Boletas",             "B001-", 6),
    ("notas_credito",      "Notas de Crédito",    "NC-",   2),
    ("notas_debito",       "Notas de Débito",     "ND-",   2),
    ("recibo_interno",     "Recibo Interno",      "RI-",   2),
    ("garantia",           "Garantía",            "GAR-",  1),
    ("anticipo_cliente",   "Anticipo de Cliente", "AC-",   1),
    ("anticipo_proveedor", "Anticipo de Proveedor","AP-",  1),
    ("gastos_bancarios",   "Gastos Bancarios",    "GB-",   3),
    ("orden_servicio",     "Orden de Servicio",   "OS-",   1),
]
LABEL_DOCUMENTO = {t[0]: t[1] for t in DOCUMENTOS_DEFAULT}
ORDEN_DOCUMENTO = {t[0]: i for i, t in enumerate(DOCUMENTOS_DEFAULT)}


def _asegurar_documentos(db: Session):
    existentes = {d.tipo_documento for d in db.query(ConfiguracionDocumento).all()}
    creado = False
    for tipo, _label, prefijo, numero in DOCUMENTOS_DEFAULT:
        if tipo not in existentes:
            db.add(ConfiguracionDocumento(tipo_documento=tipo, prefijo=prefijo, proximo_numero=numero))
            creado = True
    if creado:
        db.commit()


def _serialize_documento(d: ConfiguracionDocumento) -> dict:
    numero_str = str(d.proximo_numero or 1).zfill(5)
    return {
        "id":             d.id,
        "tipo_documento": d.tipo_documento,
        "label":          LABEL_DOCUMENTO.get(d.tipo_documento, d.tipo_documento),
        "prefijo":        d.prefijo or "",
        "proximo_numero": d.proximo_numero or 1,
        "ejemplo":        f"{d.prefijo or ''}{numero_str}",
    }


@router.get("/documentos")
def listar_documentos(db: Session = Depends(get_db), usuario: Usuario = Depends(require_administrador)):
    _asegurar_documentos(db)
    rows = db.query(ConfiguracionDocumento).all()
    rows.sort(key=lambda d: ORDEN_DOCUMENTO.get(d.tipo_documento, 99))
    return {"data": [_serialize_documento(d) for d in rows]}


class DocumentoItem(BaseModel):
    tipo_documento: str
    prefijo: str
    proximo_numero: int


class DocumentosUpdate(BaseModel):
    documentos: list[DocumentoItem]


class DocumentoCreate(BaseModel):
    tipo_documento: str
    prefijo: str = ""
    proximo_numero: int = 1


@router.post("/documentos")
def crear_documento(data: DocumentoCreate, db: Session = Depends(get_db),
                     usuario: Usuario = Depends(require_administrador)):
    _asegurar_documentos(db)
    tipo = data.tipo_documento.strip()
    if not tipo:
        raise HTTPException(400, "El tipo de documento es requerido")
    existente = db.query(ConfiguracionDocumento).filter(ConfiguracionDocumento.tipo_documento == tipo).first()
    if existente:
        raise HTTPException(400, "Ya existe un documento con ese tipo")
    db.add(ConfiguracionDocumento(
        tipo_documento=tipo,
        prefijo=data.prefijo.strip(),
        proximo_numero=data.proximo_numero or 1,
    ))
    db.commit()
    rows = db.query(ConfiguracionDocumento).all()
    rows.sort(key=lambda d: ORDEN_DOCUMENTO.get(d.tipo_documento, 99))
    return {"data": [_serialize_documento(d) for d in rows]}


@router.put("/documentos")
def actualizar_documentos(data: DocumentosUpdate, db: Session = Depends(get_db),
                           usuario: Usuario = Depends(require_administrador)):
    _asegurar_documentos(db)
    por_tipo = {d.tipo_documento: d for d in db.query(ConfiguracionDocumento).all()}
    for item in data.documentos:
        row = por_tipo.get(item.tipo_documento)
        if row:
            row.prefijo = item.prefijo
            row.proximo_numero = item.proximo_numero
    db.commit()
    rows = db.query(ConfiguracionDocumento).all()
    rows.sort(key=lambda d: ORDEN_DOCUMENTO.get(d.tipo_documento, 99))
    return {"data": [_serialize_documento(d) for d in rows]}


# ══════════════════════════════════════════════════════════════════════════
# Alertas
# ══════════════════════════════════════════════════════════════════════════

ALERTAS_DEFAULT = {
    "cobranza_por_vencer":           7,
    "cobranza_vencida":              15,
    "cliente_deuda_alta":            5000,
    "gastos_por_vencer":             7,
    "gastos_recurrentes_pendientes": None,
    "saldo_bancario_bajo":           5000,
    "deficit_proyectado":            None,
}

ALERTAS_META = {
    "cobranza_por_vencer":           {"grupo": "cobranza",   "label": "Facturas por vencer",              "unidad": "dias",  "descripcion": "Avisa cuando una factura está por vencer dentro de N días."},
    "cobranza_vencida":              {"grupo": "cobranza",   "label": "Facturas vencidas",                 "unidad": "dias",  "descripcion": "Avisa cuando una factura lleva más de N días vencida."},
    "cliente_deuda_alta":            {"grupo": "cobranza",   "label": "Cliente con deuda alta",            "unidad": "monto", "descripcion": "Avisa cuando un cliente acumula una deuda mayor a S/ N."},
    "gastos_por_vencer":             {"grupo": "gastos",     "label": "Pagos pendientes por vencer",       "unidad": "dias",  "descripcion": "Avisa cuando un pago a proveedor está por vencer dentro de N días."},
    "gastos_recurrentes_pendientes": {"grupo": "gastos",     "label": "Gastos recurrentes sin registrar",  "unidad": None,    "descripcion": "Avisa cuando un gasto recurrente del mes aún no ha sido registrado."},
    "saldo_bancario_bajo":           {"grupo": "flujo_caja", "label": "Saldo bancario bajo",               "unidad": "monto", "descripcion": "Avisa cuando el saldo bancario cae por debajo de S/ N."},
    "deficit_proyectado":            {"grupo": "flujo_caja", "label": "Déficit proyectado",                "unidad": None,    "descripcion": "Avisa cuando se proyecta un déficit de caja para el próximo mes."},
}


def _asegurar_alertas(db: Session):
    existentes = {a.tipo_alerta for a in db.query(ConfiguracionAlerta).all()}
    creado = False
    for tipo, umbral in ALERTAS_DEFAULT.items():
        if tipo not in existentes:
            db.add(ConfiguracionAlerta(tipo_alerta=tipo, activa=True, valor_umbral=umbral, created_at=datetime.utcnow()))
            creado = True
    if creado:
        db.commit()


def _serialize_alerta(a: ConfiguracionAlerta) -> dict:
    meta = ALERTAS_META.get(a.tipo_alerta, {})
    return {
        "id":            a.id,
        "tipo_alerta":   a.tipo_alerta,
        "grupo":         meta.get("grupo", ""),
        "label":         meta.get("label", a.tipo_alerta),
        "descripcion":   meta.get("descripcion", ""),
        "unidad":        meta.get("unidad"),
        "activa":        bool(a.activa),
        "valor_umbral":  float(a.valor_umbral) if a.valor_umbral is not None else None,
    }


@router.get("/alertas")
def listar_alertas(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    _asegurar_alertas(db)
    rows = db.query(ConfiguracionAlerta).all()
    return {"data": [_serialize_alerta(a) for a in rows]}


class AlertaItem(BaseModel):
    tipo_alerta: str
    activa: bool
    valor_umbral: Optional[float] = None


class AlertasUpdate(BaseModel):
    alertas: list[AlertaItem]


@router.put("/alertas")
def actualizar_alertas(data: AlertasUpdate, db: Session = Depends(get_db),
                        usuario: Usuario = Depends(require_administrador)):
    _asegurar_alertas(db)
    por_tipo = {a.tipo_alerta: a for a in db.query(ConfiguracionAlerta).all()}
    for item in data.alertas:
        row = por_tipo.get(item.tipo_alerta)
        if row:
            row.activa = item.activa
            row.valor_umbral = item.valor_umbral
    db.commit()
    rows = db.query(ConfiguracionAlerta).all()
    return {"data": [_serialize_alerta(a) for a in rows]}


# ══════════════════════════════════════════════════════════════════════════
# Onboarding
# ══════════════════════════════════════════════════════════════════════════

@router.get("/onboarding-status")
def onboarding_status(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    empresa = _get_empresa(db)
    return {"completado": bool(empresa.onboarding_completado)}


@router.post("/resetear-onboarding")
def resetear_onboarding(db: Session = Depends(get_db), usuario: Usuario = Depends(require_administrador)):
    empresa = _get_empresa(db)
    empresa.onboarding_completado = False
    empresa.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "mensaje": "El onboarding se mostrará nuevamente al recargar el sistema."}


# ══════════════════════════════════════════════════════════════════════════
# Sistema — exportar toda la data (backup Excel)
# ══════════════════════════════════════════════════════════════════════════

@router.get("/exportar-data")
def exportar_data(db: Session = Depends(get_db), usuario: Usuario = Depends(require_administrador)):
    clientes = db.query(Cliente).all()
    proveedores = db.query(Proveedor).all()
    ventas = db.query(VentaComercial).order_by(VentaComercial.fecha.desc()).all()
    gastos = db.query(Gasto).order_by(Gasto.fecha.desc()).all()
    usuarios = db.query(Usuario).order_by(Usuario.nombre.asc()).all()

    sheets = [
        {
            "titulo": "Clientes",
            "headers": ["Razón Social", "RUC", "Contacto", "Teléfono", "Email", "Dirección", "Activo"],
            "widths": [30, 14, 22, 16, 26, 30, 10],
            "rows": [[c.razon_social, c.ruc, c.contacto, c.telefono, c.email, c.direccion, "Sí" if c.activo else "No"] for c in clientes],
        },
        {
            "titulo": "Proveedores",
            "headers": ["Razón Social", "N° Documento", "Contacto", "Teléfono", "Email", "Estado"],
            "widths": [30, 16, 22, 16, 26, 12],
            "rows": [[p.razon_social, p.numero_documento, p.contacto_principal, p.telefono, p.email, p.estado] for p in proveedores],
        },
        {
            "titulo": "Ventas",
            "headers": ["Fecha", "N° Comprobante", "Cliente", "Tipo Servicio", "Monto", "Estado Cobro"],
            "widths": [12, 18, 28, 20, 14, 14],
            "rows": [[str(v.fecha), v.numero_factura, v.razon_social_cliente, v.tipo_servicio,
                      float(v.precio_venta_soles if v.precio_venta_soles is not None else (v.precio_venta or v.monto or 0)),
                      v.estado_cobranza] for v in ventas],
            "money_cols": {5},
        },
        {
            "titulo": "Gastos",
            "headers": ["Fecha", "Categoría", "Descripción", "Proveedor", "Monto", "Estado Pago"],
            "widths": [12, 20, 30, 24, 14, 14],
            "rows": [[str(g.fecha), g.categoria, g.descripcion, g.proveedor,
                      float(g.monto_soles if g.monto_soles is not None else (g.monto or 0)), g.estado_pago] for g in gastos],
            "money_cols": {5},
        },
        {
            "titulo": "Usuarios",
            "headers": ["Nombre", "Email", "Rol", "Activo"],
            "widths": [26, 30, 16, 10],
            "rows": [[u.nombre, u.email, u.rol, "Sí" if u.activo else "No"] for u in usuarios],
        },
    ]
    contenido = construir_excel(sheets)
    nombre = f"Backup_Centryx_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        iter([contenido]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={nombre}"},
    )


# ══════════════════════════════════════════════════════════════════════════
# Gastos — Categorías y Áreas (gestión dinámica desde Configuración → Gastos)
# ══════════════════════════════════════════════════════════════════════════

class CategoriaAreaGastoReq(BaseModel):
    nombre: str
    activo: Optional[bool] = None


def _serialize_categoria_area(row) -> dict:
    return {"id": row.id, "nombre": row.nombre, "activo": bool(row.activo)}


@router.get("/categorias-gasto")
def listar_categorias_gasto(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    rows = db.query(CategoriaGasto).order_by(CategoriaGasto.nombre.asc()).all()
    return [_serialize_categoria_area(r) for r in rows]


@router.post("/categorias-gasto")
def crear_categoria_gasto(data: CategoriaAreaGastoReq, db: Session = Depends(get_db),
                           usuario: Usuario = Depends(require_administrador)):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    if db.query(CategoriaGasto).filter(CategoriaGasto.nombre == nombre).first():
        raise HTTPException(400, f"Ya existe la categoría {nombre}")
    nueva = CategoriaGasto(nombre=nombre, activo=True, created_at=datetime.utcnow())
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return _serialize_categoria_area(nueva)


@router.put("/categorias-gasto/{categoria_id}")
def actualizar_categoria_gasto(categoria_id: int, data: CategoriaAreaGastoReq, db: Session = Depends(get_db),
                                usuario: Usuario = Depends(require_administrador)):
    target = db.query(CategoriaGasto).filter(CategoriaGasto.id == categoria_id).first()
    if not target:
        raise HTTPException(404, "Categoría no encontrada")
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    if nombre != target.nombre and db.query(CategoriaGasto).filter(
        CategoriaGasto.nombre == nombre, CategoriaGasto.id != categoria_id
    ).first():
        raise HTTPException(400, f"Ya existe la categoría {nombre}")
    target.nombre = nombre
    if data.activo is not None:
        target.activo = data.activo
    db.commit()
    db.refresh(target)
    return _serialize_categoria_area(target)


@router.delete("/categorias-gasto/{categoria_id}")
def desactivar_categoria_gasto(categoria_id: int, db: Session = Depends(get_db),
                                usuario: Usuario = Depends(require_administrador)):
    target = db.query(CategoriaGasto).filter(CategoriaGasto.id == categoria_id).first()
    if not target:
        raise HTTPException(404, "Categoría no encontrada")
    target.activo = False
    db.commit()
    return {"ok": True}


@router.get("/areas-gasto")
def listar_areas_gasto(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    rows = db.query(AreaGasto).order_by(AreaGasto.nombre.asc()).all()
    return [_serialize_categoria_area(r) for r in rows]


@router.post("/areas-gasto")
def crear_area_gasto(data: CategoriaAreaGastoReq, db: Session = Depends(get_db),
                      usuario: Usuario = Depends(require_administrador)):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    if db.query(AreaGasto).filter(AreaGasto.nombre == nombre).first():
        raise HTTPException(400, f"Ya existe el área {nombre}")
    nueva = AreaGasto(nombre=nombre, activo=True, created_at=datetime.utcnow())
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return _serialize_categoria_area(nueva)


@router.put("/areas-gasto/{area_id}")
def actualizar_area_gasto(area_id: int, data: CategoriaAreaGastoReq, db: Session = Depends(get_db),
                           usuario: Usuario = Depends(require_administrador)):
    target = db.query(AreaGasto).filter(AreaGasto.id == area_id).first()
    if not target:
        raise HTTPException(404, "Área no encontrada")
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    if nombre != target.nombre and db.query(AreaGasto).filter(
        AreaGasto.nombre == nombre, AreaGasto.id != area_id
    ).first():
        raise HTTPException(400, f"Ya existe el área {nombre}")
    target.nombre = nombre
    if data.activo is not None:
        target.activo = data.activo
    db.commit()
    db.refresh(target)
    return _serialize_categoria_area(target)


@router.delete("/areas-gasto/{area_id}")
def desactivar_area_gasto(area_id: int, db: Session = Depends(get_db),
                           usuario: Usuario = Depends(require_administrador)):
    target = db.query(AreaGasto).filter(AreaGasto.id == area_id).first()
    if not target:
        raise HTTPException(404, "Área no encontrada")
    target.activo = False
    db.commit()
    return {"ok": True}
