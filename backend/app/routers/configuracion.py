import base64
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from app.core.security import (
    RUBROS, ROLES_DISPONIBLES, get_current_usuario, require_administrador, get_empresa_id,
)
from app.models.configuracion import ConfiguracionAlerta, ConfiguracionDocumento, ConfiguracionEmpresa
from app.models.empresa import Empresa
from app.models.models import (
    Usuario, Cliente, Gasto, Proveedor, CategoriaGasto, AreaGasto,
    PagoGasto, Prestamo, CuotaPrestamo, Garantia, PagoGarantia, MovimientoCaja,
)
from app.models.comercial import VentaComercial, PagoCobranza
from app.models.flujo_caja import ConciliacionBancaria, MovimientoConciliacion
from app.services.reportes_export import construir_excel
from app.services.auditoria_service import registrar_log, ip_de

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

LOGO_MAX_BYTES = 2 * 1024 * 1024
LOGO_TIPOS_VALIDOS = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"}


# ══════════════════════════════════════════════════════════════════════════
# Empresa
# ══════════════════════════════════════════════════════════════════════════

def _get_empresa(db: Session, empresa_id: Optional[int] = None) -> ConfiguracionEmpresa:
    q = db.query(ConfiguracionEmpresa)
    if empresa_id is not None:
        q = q.filter(ConfiguracionEmpresa.id == empresa_id)
    empresa = q.first()
    if not empresa:
        if empresa_id is not None:
            raise HTTPException(404, "Empresa no encontrada")
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
        "logo_url":              e.logo_base64 or ("/api/configuracion/empresa/logo" if e.logo_path else None),
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
def obtener_empresa(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_usuario),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    return _serialize_empresa(_get_empresa(db, empresa_id))


# Sin auth a propósito: la pantalla de Login todavía no tiene token y necesita
# mostrar el nombre/RUC de la empresa antes de autenticarse. No reutiliza
# _serialize_empresa/GET /empresa porque ese endpoint expone datos internos
# (smtp_host, smtp_usuario, whatsapp_soporte, email, teléfono, dirección...)
# que no deben quedar accesibles sin login.
@router.get("/empresa-publica")
def obtener_empresa_publica(
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
    subdominio: Optional[str] = None,
):
    # Si llega ?subdominio=xxx (login por URL de empresa), buscar por subdominio
    if subdominio:
        tenant = db.query(Empresa).filter(
            Empresa.subdominio == subdominio,
            Empresa.activo == True,
        ).first()
        if not tenant:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        empresa_id = tenant.id

    empresa = _get_empresa(db, empresa_id)
    return {
        "nombre_empresa": empresa.nombre_empresa or "",
        "ruc": empresa.ruc or "",
        "logo_url": empresa.logo_path or None,
        "color_principal": empresa.color_principal or "#1e40af",
        "subdominio": subdominio or "",
    }


@router.put("/empresa")
def actualizar_empresa(
    data: EmpresaUpdate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    empresa = _get_empresa(db, empresa_id)
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
async def subir_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    if file.content_type not in LOGO_TIPOS_VALIDOS:
        raise HTTPException(400, "Formato de imagen no válido. Usa PNG, JPG, WEBP o SVG.")
    contenido = await file.read()
    if len(contenido) > LOGO_MAX_BYTES:
        raise HTTPException(400, "El logo no debe superar 2 MB")

    # Railway no tiene disco persistente: los archivos subidos se pierden en
    # cada deploy. Se guarda el logo como base64 en la BD en vez de en disco.
    logo_base64 = base64.b64encode(contenido).decode("utf-8")
    logo_data_url = f"data:{file.content_type};base64,{logo_base64}"

    empresa = _get_empresa(db, empresa_id)
    empresa.logo_base64 = logo_data_url
    empresa.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "logo_url": logo_data_url}


@router.get("/empresa/logo")
def ver_logo(
    db: Session = Depends(get_db),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(ConfiguracionEmpresa)
    if empresa_id is not None:
        q = q.filter(ConfiguracionEmpresa.id == empresa_id)
    empresa = q.first()
    if empresa and empresa.logo_base64:
        content_type, _, b64data = empresa.logo_base64.partition(",")
        content_type = content_type.removeprefix("data:").partition(";")[0] or "image/png"
        return Response(content=base64.b64decode(b64data), media_type=content_type)
    if not empresa or not empresa.logo_path or not Path(empresa.logo_path).exists():
        raise HTTPException(404, "Sin logo configurado")
    return FileResponse(empresa.logo_path)


@router.get("/smtp/probar")
def probar_conexion_smtp(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    import smtplib

    q = db.query(ConfiguracionEmpresa)
    if empresa_id is not None:
        q = q.filter(ConfiguracionEmpresa.id == empresa_id)
    empresa = q.first()
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
def obtener_rubro(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_usuario),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    empresa = _get_empresa(db, empresa_id)
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
def actualizar_rubro(
    data: RubroUpdate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    if data.rubro not in RUBROS:
        raise HTTPException(400, "Rubro no reconocido")
    empresa = _get_empresa(db, empresa_id)
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
def listar_usuarios(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(Usuario).order_by(Usuario.nombre.asc())
    if empresa_id is not None:
        q = q.filter(Usuario.empresa_id == empresa_id)
    rows = q.all()
    return {"data": [_serialize_usuario(u) for u in rows], "roles_disponibles": ROLES_DISPONIBLES}


@router.post("/usuarios")
def crear_usuario(
    data: UsuarioCreateReq,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(Usuario).filter(Usuario.email == data.email)
    if empresa_id is not None:
        q = q.filter(Usuario.empresa_id == empresa_id)
    if q.first():
        raise HTTPException(400, "Ya existe un usuario con ese email")
    nuevo = Usuario(
        nombre=data.nombre, email=data.email,
        password=pwd_context.hash(data.password),
        rol=data.rol, activo=data.activo,
        empresa_id=empresa_id,
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return _serialize_usuario(nuevo)


@router.put("/usuarios/{usuario_id}")
def actualizar_usuario(
    usuario_id: int,
    data: UsuarioUpdateReq,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(Usuario).filter(Usuario.id == usuario_id)
    if empresa_id is not None:
        q = q.filter(Usuario.empresa_id == empresa_id)
    target = q.first()
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    if data.email and data.email != target.email:
        dup_q = db.query(Usuario).filter(Usuario.email == data.email, Usuario.id != usuario_id)
        if empresa_id is not None:
            dup_q = dup_q.filter(Usuario.empresa_id == empresa_id)
        if dup_q.first():
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
def eliminar_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    if usuario_id == usuario.id:
        raise HTTPException(400, "No puedes eliminar tu propio usuario")
    q = db.query(Usuario).filter(Usuario.id == usuario_id)
    if empresa_id is not None:
        q = q.filter(Usuario.empresa_id == empresa_id)
    target = q.first()
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


def _asegurar_documentos(db: Session, empresa_id: Optional[int] = None):
    q = db.query(ConfiguracionDocumento)
    if empresa_id is not None:
        q = q.filter(ConfiguracionDocumento.empresa_id == empresa_id)
    existentes = {d.tipo_documento for d in q.all()}
    creado = False
    for tipo, _label, prefijo, numero in DOCUMENTOS_DEFAULT:
        if tipo not in existentes:
            doc = ConfiguracionDocumento(tipo_documento=tipo, prefijo=prefijo, proximo_numero=numero)
            if empresa_id is not None:
                doc.empresa_id = empresa_id
            db.add(doc)
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
def listar_documentos(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    _asegurar_documentos(db, empresa_id)
    q = db.query(ConfiguracionDocumento)
    if empresa_id is not None:
        q = q.filter(ConfiguracionDocumento.empresa_id == empresa_id)
    rows = q.all()
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
def crear_documento(
    data: DocumentoCreate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    _asegurar_documentos(db, empresa_id)
    tipo = data.tipo_documento.strip()
    if not tipo:
        raise HTTPException(400, "El tipo de documento es requerido")
    q = db.query(ConfiguracionDocumento).filter(ConfiguracionDocumento.tipo_documento == tipo)
    if empresa_id is not None:
        q = q.filter(ConfiguracionDocumento.empresa_id == empresa_id)
    if q.first():
        raise HTTPException(400, "Ya existe un documento con ese tipo")
    doc = ConfiguracionDocumento(
        tipo_documento=tipo,
        prefijo=data.prefijo.strip(),
        proximo_numero=data.proximo_numero or 1,
    )
    if empresa_id is not None:
        doc.empresa_id = empresa_id
    db.add(doc)
    db.commit()
    q2 = db.query(ConfiguracionDocumento)
    if empresa_id is not None:
        q2 = q2.filter(ConfiguracionDocumento.empresa_id == empresa_id)
    rows = q2.all()
    rows.sort(key=lambda d: ORDEN_DOCUMENTO.get(d.tipo_documento, 99))
    return {"data": [_serialize_documento(d) for d in rows]}


@router.put("/documentos")
def actualizar_documentos(
    data: DocumentosUpdate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    _asegurar_documentos(db, empresa_id)
    q = db.query(ConfiguracionDocumento)
    if empresa_id is not None:
        q = q.filter(ConfiguracionDocumento.empresa_id == empresa_id)
    por_tipo = {d.tipo_documento: d for d in q.all()}
    for item in data.documentos:
        row = por_tipo.get(item.tipo_documento)
        if row:
            row.prefijo = item.prefijo
            row.proximo_numero = item.proximo_numero
    db.commit()
    q2 = db.query(ConfiguracionDocumento)
    if empresa_id is not None:
        q2 = q2.filter(ConfiguracionDocumento.empresa_id == empresa_id)
    rows = q2.all()
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


def _asegurar_alertas(db: Session, empresa_id: Optional[int] = None):
    q = db.query(ConfiguracionAlerta)
    if empresa_id is not None:
        q = q.filter(ConfiguracionAlerta.empresa_id == empresa_id)
    existentes = {a.tipo_alerta for a in q.all()}
    creado = False
    for tipo, umbral in ALERTAS_DEFAULT.items():
        if tipo not in existentes:
            alerta = ConfiguracionAlerta(tipo_alerta=tipo, activa=True, valor_umbral=umbral, created_at=datetime.utcnow())
            if empresa_id is not None:
                alerta.empresa_id = empresa_id
            db.add(alerta)
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
def listar_alertas(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_usuario),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    _asegurar_alertas(db, empresa_id)
    q = db.query(ConfiguracionAlerta)
    if empresa_id is not None:
        q = q.filter(ConfiguracionAlerta.empresa_id == empresa_id)
    rows = q.all()
    return {"data": [_serialize_alerta(a) for a in rows]}


class AlertaItem(BaseModel):
    tipo_alerta: str
    activa: bool
    valor_umbral: Optional[float] = None


class AlertasUpdate(BaseModel):
    alertas: list[AlertaItem]


@router.put("/alertas")
def actualizar_alertas(
    data: AlertasUpdate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    _asegurar_alertas(db, empresa_id)
    q = db.query(ConfiguracionAlerta)
    if empresa_id is not None:
        q = q.filter(ConfiguracionAlerta.empresa_id == empresa_id)
    por_tipo = {a.tipo_alerta: a for a in q.all()}
    for item in data.alertas:
        row = por_tipo.get(item.tipo_alerta)
        if row:
            row.activa = item.activa
            row.valor_umbral = item.valor_umbral
    db.commit()
    q2 = db.query(ConfiguracionAlerta)
    if empresa_id is not None:
        q2 = q2.filter(ConfiguracionAlerta.empresa_id == empresa_id)
    rows = q2.all()
    return {"data": [_serialize_alerta(a) for a in rows]}


# ══════════════════════════════════════════════════════════════════════════
# Onboarding
# ══════════════════════════════════════════════════════════════════════════

@router.get("/onboarding-status")
def onboarding_status(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_usuario),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    empresa = _get_empresa(db, empresa_id)
    return {"completado": bool(empresa.onboarding_completado)}


@router.post("/resetear-onboarding")
def resetear_onboarding(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    empresa = _get_empresa(db, empresa_id)
    empresa.onboarding_completado = False
    empresa.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "mensaje": "El onboarding se mostrará nuevamente al recargar el sistema."}


# ══════════════════════════════════════════════════════════════════════════
# Sistema — exportar toda la data (backup Excel)
# ══════════════════════════════════════════════════════════════════════════

@router.get("/exportar-data")
def exportar_data(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q_clientes = db.query(Cliente)
    q_proveedores = db.query(Proveedor)
    q_ventas = db.query(VentaComercial).order_by(VentaComercial.fecha.desc())
    q_gastos = db.query(Gasto).order_by(Gasto.fecha.desc())
    q_usuarios = db.query(Usuario).order_by(Usuario.nombre.asc())

    if empresa_id is not None:
        q_clientes = q_clientes.filter(Cliente.empresa_id == empresa_id)
        q_proveedores = q_proveedores.filter(Proveedor.empresa_id == empresa_id)
        q_ventas = q_ventas.filter(VentaComercial.empresa_id == empresa_id)
        q_gastos = q_gastos.filter(Gasto.empresa_id == empresa_id)
        q_usuarios = q_usuarios.filter(Usuario.empresa_id == empresa_id)

    clientes = q_clientes.all()
    proveedores = q_proveedores.all()
    ventas = q_ventas.all()
    gastos = q_gastos.all()
    usuarios = q_usuarios.all()

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
def listar_categorias_gasto(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_usuario),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(CategoriaGasto).order_by(CategoriaGasto.nombre.asc())
    if empresa_id is not None:
        q = q.filter(CategoriaGasto.empresa_id == empresa_id)
    rows = q.all()
    return [_serialize_categoria_area(r) for r in rows]


@router.post("/categorias-gasto")
def crear_categoria_gasto(
    data: CategoriaAreaGastoReq,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    q = db.query(CategoriaGasto).filter(CategoriaGasto.nombre == nombre)
    if empresa_id is not None:
        q = q.filter(CategoriaGasto.empresa_id == empresa_id)
    if q.first():
        raise HTTPException(400, f"Ya existe la categoría {nombre}")
    nueva = CategoriaGasto(nombre=nombre, activo=True, created_at=datetime.utcnow())
    if empresa_id is not None:
        nueva.empresa_id = empresa_id
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return _serialize_categoria_area(nueva)


@router.put("/categorias-gasto/{categoria_id}")
def actualizar_categoria_gasto(
    categoria_id: int,
    data: CategoriaAreaGastoReq,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(CategoriaGasto).filter(CategoriaGasto.id == categoria_id)
    if empresa_id is not None:
        q = q.filter(CategoriaGasto.empresa_id == empresa_id)
    target = q.first()
    if not target:
        raise HTTPException(404, "Categoría no encontrada")
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    dup_q = db.query(CategoriaGasto).filter(CategoriaGasto.nombre == nombre, CategoriaGasto.id != categoria_id)
    if empresa_id is not None:
        dup_q = dup_q.filter(CategoriaGasto.empresa_id == empresa_id)
    if nombre != target.nombre and dup_q.first():
        raise HTTPException(400, f"Ya existe la categoría {nombre}")
    target.nombre = nombre
    if data.activo is not None:
        target.activo = data.activo
    db.commit()
    db.refresh(target)
    return _serialize_categoria_area(target)


@router.delete("/categorias-gasto/{categoria_id}")
def desactivar_categoria_gasto(
    categoria_id: int,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(CategoriaGasto).filter(CategoriaGasto.id == categoria_id)
    if empresa_id is not None:
        q = q.filter(CategoriaGasto.empresa_id == empresa_id)
    target = q.first()
    if not target:
        raise HTTPException(404, "Categoría no encontrada")
    target.activo = False
    db.commit()
    return {"ok": True}


@router.get("/areas-gasto")
def listar_areas_gasto(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_usuario),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(AreaGasto).order_by(AreaGasto.nombre.asc())
    if empresa_id is not None:
        q = q.filter(AreaGasto.empresa_id == empresa_id)
    rows = q.all()
    return [_serialize_categoria_area(r) for r in rows]


@router.post("/areas-gasto")
def crear_area_gasto(
    data: CategoriaAreaGastoReq,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    q = db.query(AreaGasto).filter(AreaGasto.nombre == nombre)
    if empresa_id is not None:
        q = q.filter(AreaGasto.empresa_id == empresa_id)
    if q.first():
        raise HTTPException(400, f"Ya existe el área {nombre}")
    nueva = AreaGasto(nombre=nombre, activo=True, created_at=datetime.utcnow())
    if empresa_id is not None:
        nueva.empresa_id = empresa_id
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return _serialize_categoria_area(nueva)


@router.put("/areas-gasto/{area_id}")
def actualizar_area_gasto(
    area_id: int,
    data: CategoriaAreaGastoReq,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(AreaGasto).filter(AreaGasto.id == area_id)
    if empresa_id is not None:
        q = q.filter(AreaGasto.empresa_id == empresa_id)
    target = q.first()
    if not target:
        raise HTTPException(404, "Área no encontrada")
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    dup_q = db.query(AreaGasto).filter(AreaGasto.nombre == nombre, AreaGasto.id != area_id)
    if empresa_id is not None:
        dup_q = dup_q.filter(AreaGasto.empresa_id == empresa_id)
    if nombre != target.nombre and dup_q.first():
        raise HTTPException(400, f"Ya existe el área {nombre}")
    target.nombre = nombre
    if data.activo is not None:
        target.activo = data.activo
    db.commit()
    db.refresh(target)
    return _serialize_categoria_area(target)


@router.delete("/areas-gasto/{area_id}")
def desactivar_area_gasto(
    area_id: int,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    q = db.query(AreaGasto).filter(AreaGasto.id == area_id)
    if empresa_id is not None:
        q = q.filter(AreaGasto.empresa_id == empresa_id)
    target = q.first()
    if not target:
        raise HTTPException(404, "Área no encontrada")
    target.activo = False
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════
# Backup y Restauración
# ══════════════════════════════════════════════════════════════════════════

BACKUP_VERSION = "1.0"


def _serializar_registro(obj) -> dict:
    """Todas las columnas propias del modelo (sin relaciones ni el
    _sa_instance_state interno de SQLAlchemy que trae obj.__dict__)."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


CAMPOS_EXCLUIDOS_IMPORT = {"id", "_sa_instance_state"}


def _campos_validos(modelo, registro: dict) -> dict:
    """Campos del registro importado que son columnas reales del modelo,
    sin "id" (la BD genera uno nuevo — importar no debe reutilizar el id
    del backup, que puede chocar con un registro ya existente) ni
    "_sa_instance_state" (nunca debería venir en un JSON, pero por si el
    archivo fue editado a mano)."""
    columnas = modelo.__table__.columns.keys()
    return {k: v for k, v in registro.items() if k in columnas and k not in CAMPOS_EXCLUIDOS_IMPORT}


def _insertar_con_savepoint(db: Session, instancia) -> bool:
    """Inserta una fila dentro de su propio SAVEPOINT: si falla (tipo de
    dato inválido, FK inexistente, constraint, etc.) solo se deshace esa
    fila — no arrastra al rollback las filas ya insertadas en esta misma
    importación (que todavía no tienen commit). Requiere Postgres (soporta
    SAVEPOINT vía Session.begin_nested()), el motor de este proyecto."""
    try:
        with db.begin_nested():
            db.add(instancia)
            db.flush()
        return True
    except Exception:
        return False


@router.get("/backup/exportar")
def exportar_backup(
    http_request: Request,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    def _q(modelo):
        q = db.query(modelo)
        if empresa_id is not None and hasattr(modelo, "empresa_id"):
            q = q.filter(modelo.empresa_id == empresa_id)
        return q

    datos = {
        "version": BACKUP_VERSION,
        "fecha_exportacion": datetime.utcnow().isoformat(),
        "exportado_por": usuario.nombre,
        "datos": {
            "clientes":                [_serializar_registro(c) for c in _q(Cliente).filter(Cliente.activo == True).all()],
            "proveedores":              [_serializar_registro(p) for p in _q(Proveedor).filter(Proveedor.estado == "Activo").all()],
            "ventas":                   [_serializar_registro(v) for v in _q(VentaComercial).all()],
            "gastos":                   [_serializar_registro(g) for g in _q(Gasto).all()],
            "pagos_cobranza":           [_serializar_registro(p) for p in db.query(PagoCobranza).join(
                VentaComercial, PagoCobranza.comprobante_id == VentaComercial.id
            ).filter(VentaComercial.empresa_id == empresa_id).all()] if empresa_id is not None else [_serializar_registro(p) for p in db.query(PagoCobranza).all()],
            "pagos_gastos":             [_serializar_registro(p) for p in _q(PagoGasto).all()],
            "prestamos":                [_serializar_registro(p) for p in _q(Prestamo).all()],
            "cuotas_prestamo":          [_serializar_registro(c) for c in _q(CuotaPrestamo).all()],
            "garantias":                [_serializar_registro(g) for g in _q(Garantia).all()],
            "flujo_caja":               [_serializar_registro(f) for f in _q(MovimientoCaja).all()],
            "conciliaciones":           [_serializar_registro(c) for c in db.query(ConciliacionBancaria).all()],
            "movimientos_conciliacion": [_serializar_registro(m) for m in db.query(MovimientoConciliacion).all()],
        },
    }

    fecha = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    nombre_archivo = f"centryx_backup_{fecha}.json"

    registrar_log(
        db, usuario.id, usuario.nombre, "configuracion", "Exportó backup",
        "Descargó un backup completo de los registros del sistema", ip_de(http_request),
    )

    return Response(
        content=json.dumps(datos, default=str, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={nombre_archivo}"},
    )


@router.post("/backup/importar")
async def importar_backup(
    http_request: Request,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    try:
        contenido = json.loads(await archivo.read())
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(400, "El archivo no es un JSON válido")

    if not isinstance(contenido, dict) or "datos" not in contenido or not isinstance(contenido["datos"], dict):
        raise HTTPException(400, "Archivo de backup inválido: falta la clave 'datos'")

    datos = contenido["datos"]
    resumen = {}

    # Se importa en orden que respeta las FK: clientes/proveedores antes de
    # ventas/gastos, y esos antes de sus pagos — igual que en exportar_backup.
    # Solo se insertan registros "nuevos" (según su clave natural); nunca se
    # sobrescribe un registro ya existente. Cada fila se inserta en su propio
    # SAVEPOINT (_insertar_con_savepoint): si una fila falla, se descarta
    # solo esa fila y se sigue con las demás — no se aborta todo el import.
    #
    # El "id" del backup NUNCA se reutiliza (la BD genera uno nuevo), así que
    # los campos que son FK hacia OTRA tabla de este mismo backup (p.ej.
    # pagos_cobranza.comprobante_id -> ventas) se remapean del id viejo al id
    # nuevo con los mapa_* construidos abajo, o se descartan si no se puede
    # resolver (mejor perder un vínculo secundario que insertar una fila con
    # una FK que apunta a otro registro por coincidencia de número).

    # 1. Clientes (dedup por RUC)
    mapa_clientes = {}
    if "clientes" in datos:
        importados = 0
        for c in datos["clientes"]:
            old_id = c.get("id")
            q = db.query(Cliente).filter(Cliente.ruc == c.get("ruc")) if c.get("ruc") else None
            if q is not None and empresa_id is not None:
                q = q.filter(Cliente.empresa_id == empresa_id)
            existe = q.first() if q is not None else None
            if existe:
                if old_id is not None:
                    mapa_clientes[old_id] = existe.id
                continue
            campos = _campos_validos(Cliente, c)
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = Cliente(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
                if old_id is not None:
                    mapa_clientes[old_id] = nuevo.id
        resumen["clientes"] = importados

    # 2. Proveedores (dedup por N° de documento — Proveedor no tiene campo "ruc")
    mapa_proveedores = {}
    if "proveedores" in datos:
        importados = 0
        for p in datos["proveedores"]:
            old_id = p.get("id")
            q = db.query(Proveedor).filter(
                Proveedor.numero_documento == p.get("numero_documento")
            ) if p.get("numero_documento") else None
            if q is not None and empresa_id is not None:
                q = q.filter(Proveedor.empresa_id == empresa_id)
            existe = q.first() if q is not None else None
            if existe:
                if old_id is not None:
                    mapa_proveedores[old_id] = existe.id
                continue
            campos = _campos_validos(Proveedor, p)
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = Proveedor(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
                if old_id is not None:
                    mapa_proveedores[old_id] = nuevo.id
        resumen["proveedores"] = importados

    # 3. Ventas (dedup por N° de factura)
    mapa_ventas = {}
    if "ventas" in datos:
        importados = 0
        for v in datos["ventas"]:
            old_id = v.get("id")
            q = db.query(VentaComercial).filter(
                VentaComercial.numero_factura == v.get("numero_factura")
            ) if v.get("numero_factura") else None
            if q is not None and empresa_id is not None:
                q = q.filter(VentaComercial.empresa_id == empresa_id)
            existe = q.first() if q is not None else None
            if existe:
                if old_id is not None:
                    mapa_ventas[old_id] = existe.id
                continue
            campos = _campos_validos(VentaComercial, v)
            if campos.get("cliente_id") is not None:
                campos["cliente_id"] = mapa_clientes.get(campos["cliente_id"])
            # Solo se puede resolver si la factura relacionada ya se importó
            # antes en este mismo bucle (mejor esfuerzo, sin dos pasadas).
            if campos.get("comprobante_relacionado_id") is not None:
                campos["comprobante_relacionado_id"] = mapa_ventas.get(campos["comprobante_relacionado_id"])
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = VentaComercial(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
                if old_id is not None:
                    mapa_ventas[old_id] = nuevo.id
        resumen["ventas"] = importados

    # 4. Gastos (dedup por N° comprobante + N° documento)
    mapa_gastos = {}
    if "gastos" in datos:
        importados = 0
        for g in datos["gastos"]:
            old_id = g.get("id")
            existe = None
            if g.get("numero_comprobante") or g.get("numero_documento"):
                q = db.query(Gasto).filter(
                    Gasto.numero_comprobante == g.get("numero_comprobante"),
                    Gasto.numero_documento == g.get("numero_documento"),
                )
                if empresa_id is not None:
                    q = q.filter(Gasto.empresa_id == empresa_id)
                existe = q.first()
            if existe:
                if old_id is not None:
                    mapa_gastos[old_id] = existe.id
                continue
            campos = _campos_validos(Gasto, g)
            if campos.get("proveedor_id") is not None:
                campos["proveedor_id"] = mapa_proveedores.get(campos["proveedor_id"])
            # cuota_prestamo_id apunta a cuotas_prestamo, que se importa más
            # abajo (paso 8) — todavía no hay mapa para remapearlo, se
            # descarta el vínculo en vez de dejar el id viejo.
            if campos.get("cuota_prestamo_id") is not None:
                campos["cuota_prestamo_id"] = None
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = Gasto(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
                if old_id is not None:
                    mapa_gastos[old_id] = nuevo.id
        resumen["gastos"] = importados

    # 5. Pagos de cobranza — sin dedup propio (detalle de una venta ya
    # importada); comprobante_id es NOT NULL, así que si la venta referenciada
    # no se pudo resolver (no vino en el backup / no se importó) se descarta
    # la fila en vez de insertar una FK inválida.
    if "pagos_cobranza" in datos:
        importados = 0
        for p in datos["pagos_cobranza"]:
            campos = _campos_validos(PagoCobranza, p)
            nuevo_comprobante_id = mapa_ventas.get(campos.get("comprobante_id"))
            if nuevo_comprobante_id is None:
                continue
            campos["comprobante_id"] = nuevo_comprobante_id
            nuevo = PagoCobranza(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
        resumen["pagos_cobranza"] = importados

    # 6. Pagos de gastos (gasto_id es nullable — solo se remapea si viene con valor)
    if "pagos_gastos" in datos:
        importados = 0
        for p in datos["pagos_gastos"]:
            campos = _campos_validos(PagoGasto, p)
            if campos.get("gasto_id") is not None:
                nuevo_gasto_id = mapa_gastos.get(campos["gasto_id"])
                if nuevo_gasto_id is None:
                    continue
                campos["gasto_id"] = nuevo_gasto_id
            nuevo = PagoGasto(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
        resumen["pagos_gastos"] = importados

    # 7. Préstamos
    mapa_prestamos = {}
    if "prestamos" in datos:
        importados = 0
        for p in datos["prestamos"]:
            old_id = p.get("id")
            campos = _campos_validos(Prestamo, p)
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = Prestamo(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
                if old_id is not None:
                    mapa_prestamos[old_id] = nuevo.id
        resumen["prestamos"] = importados

    # 8. Cuotas de préstamo — prestamo_id es obligatorio: si no se puede
    # resolver, se descarta la fila (misma razón que pagos_cobranza arriba).
    if "cuotas_prestamo" in datos:
        importados = 0
        for c in datos["cuotas_prestamo"]:
            campos = _campos_validos(CuotaPrestamo, c)
            nuevo_prestamo_id = mapa_prestamos.get(campos.get("prestamo_id"))
            if nuevo_prestamo_id is None:
                continue
            campos["prestamo_id"] = nuevo_prestamo_id
            # movimiento_caja_id apunta a flujo_caja, que se importa después
            # (paso 9) — mismo caso que cuota_prestamo_id en gastos.
            if campos.get("movimiento_caja_id") is not None:
                campos["movimiento_caja_id"] = None
            nuevo = CuotaPrestamo(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
        resumen["cuotas_prestamo"] = importados

    # 9. Garantías
    if "garantias" in datos:
        importados = 0
        for g in datos["garantias"]:
            campos = _campos_validos(Garantia, g)
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = Garantia(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
        resumen["garantias"] = importados

    # 10. Flujo de caja
    if "flujo_caja" in datos:
        importados = 0
        for f in datos["flujo_caja"]:
            campos = _campos_validos(MovimientoCaja, f)
            if empresa_id is not None:
                campos["empresa_id"] = empresa_id
            nuevo = MovimientoCaja(**campos)
            if _insertar_con_savepoint(db, nuevo):
                importados += 1
        resumen["flujo_caja"] = importados

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"No se pudo importar el backup: {e}")

    registrar_log(
        db, usuario.id, usuario.nombre, "configuracion", "Importó backup",
        f"Importó backup: {resumen}", ip_de(http_request),
    )

    return {"mensaje": "Backup importado exitosamente", "resumen": resumen}


class LimpiarRegistrosReq(BaseModel):
    confirmar: str


@router.delete("/backup/limpiar")
def limpiar_registros(
    data: LimpiarRegistrosReq,
    http_request: Request,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(require_administrador),
    empresa_id: Optional[int] = Depends(get_empresa_id),
):
    if data.confirmar != "ELIMINAR_TODO":
        raise HTTPException(400, "Confirmación incorrecta")

    # Orden inverso a las FK reales del modelo (no el orden de exportar_backup,
    # que es de lectura): p.ej. PagoGarantia debe borrarse antes que Garantia,
    # y CuotaPrestamo antes que Prestamo/MovimientoCaja (CuotaPrestamo.
    # movimiento_caja_id referencia movimientos_caja).
    try:
        def _del(modelo, extra_filter=None):
            q = db.query(modelo)
            if empresa_id is not None and hasattr(modelo, "empresa_id"):
                q = q.filter(modelo.empresa_id == empresa_id)
            if extra_filter is not None:
                q = q.filter(extra_filter)
            q.delete(synchronize_session=False)

        db.query(MovimientoConciliacion).delete(synchronize_session=False)
        db.query(ConciliacionBancaria).delete(synchronize_session=False)
        _del(PagoGarantia)
        # PagoCobranza: filtra via join con VentaComercial
        if empresa_id is not None:
            sub = db.query(VentaComercial.id).filter(VentaComercial.empresa_id == empresa_id).subquery()
            db.query(PagoCobranza).filter(PagoCobranza.comprobante_id.in_(sub)).delete(synchronize_session=False)
        else:
            db.query(PagoCobranza).delete(synchronize_session=False)
        _del(PagoGasto)
        _del(Gasto)
        _del(VentaComercial)
        _del(CuotaPrestamo)
        _del(Garantia)
        _del(Proveedor)
        _del(Cliente)
        _del(Prestamo)
        _del(MovimientoCaja)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"No se pudo completar la eliminación: {e}")

    registrar_log(
        db, usuario.id, usuario.nombre, "configuracion", "Eliminó todos los registros",
        "Eliminó todos los registros del sistema (ventas, gastos, clientes, proveedores, préstamos, "
        "garantías y flujo de caja) desde Configuración → Backup", ip_de(http_request),
    )

    return {"mensaje": "Todos los registros eliminados correctamente"}
