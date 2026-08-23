from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from sqlalchemy.exc import IntegrityError
from database import get_db
from app.models.comercial import VentaComercial, PagoCobranza
from app.models.flujo_caja import ConciliacionBancaria, MovimientoConciliacion
from app.models.configuracion import ConfiguracionEmpresa
from app.models.models import Cliente, Usuario, PagoGarantia, Gasto, PagoGasto
from app.core.security import get_current_usuario
from app.routers.garantias import revertir_cobro_garantia
from app.services.comprobante_print import construir_payload_impresion
from app.services.comprobante_pdf import construir_pdf_comprobante
from app.services.comprobante_email import construir_cuerpo_html, enviar_email_smtp
from app.services.empresa_header import get_empresa_header
from app.services.auditoria_service import registrar_log, ip_de
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime, timedelta
import io
import re
import logging
import shutil
import uuid
import zipfile
import unicodedata
import pdfplumber
from pathlib import Path

logger = logging.getLogger(__name__)

TIPOS_COBRANZA = ["Factura", "Boleta de Venta"]

router = APIRouter()

TIPOS_DOCUMENTO = ["Factura", "Boleta de Venta", "Nota de Crédito", "Nota de Débito", "Anticipo de Cliente", "Recibo Interno"]

# Escenarios de Nota de Crédito — determinan el efecto sobre la factura/boleta
# relacionada (ver _aplicar_nc). Reemplaza la antigua heurística por monto.
TIPOS_NOTA_CREDITO = ["anulacion_simple", "devolucion_cobro", "descuento_parcial"]

# Subtipos de Nota de Débito — solo clasificación, los 3 tienen el mismo
# efecto sobre la factura relacionada (ver _aplicar_nd).
TIPOS_NOTA_DEBITO = ["cargo_adicional", "interes_mora", "penalidad"]

MESES_ES_LOWER = {
    1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
    7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre",
}

# Tipos que registran un monto directo, sin desglose de Base Imponible / IGV.
TIPOS_SIN_IGV = ["Anticipo de Cliente", "Recibo Interno"]


class ComprobanteCreate(BaseModel):
    tipo_documento: str = "Factura"
    numero_documento: str
    documento_relacionado: Optional[str] = None
    # Solo para tipo_documento == "Nota de Crédito" — ver TIPOS_NOTA_CREDITO.
    tipo_nota_credito: Optional[str] = None
    # Datos del egreso — solo cuando tipo_nota_credito == "devolucion_cobro".
    fecha_devolucion: Optional[date] = None
    metodo_devolucion: Optional[str] = None
    banco_devolucion: Optional[str] = None
    numero_cuenta_devolucion: Optional[str] = None
    numero_operacion_devolucion: Optional[str] = None
    # Solo para tipo_documento == "Nota de Débito" — ver TIPOS_NOTA_DEBITO.
    tipo_nota_debito: Optional[str] = None
    ruc_cliente: str
    razon_social_cliente: str
    cliente_id: Optional[int] = None
    tipo_servicio: str
    descripcion: Optional[str] = None
    base_imponible: Optional[float] = None
    monto: Optional[float] = None
    moneda: Optional[str] = "PEN"
    tipo_cambio: Optional[float] = None
    monto_original: Optional[float] = None
    fecha: date
    fecha_vencimiento: Optional[date] = None
    # Referencia al PDF original, staged en TMP_ZIP_DIR por importar-zip —
    # solo se usa desde importar-zip/confirmar (ver _crear_comprobante).
    archivo_temp: Optional[str] = None
    archivo_nombre: Optional[str] = None
    # Detracción (solo Facturas) — monto_detraccion/monto_neto_cobrar se
    # calculan en el servidor, no se reciben del cliente.
    tiene_detraccion: bool = False
    concepto_detraccion: Optional[str] = None
    tasa_detraccion: Optional[float] = None
    fecha_limite_detraccion: Optional[date] = None
    # "Manual" | "Importación PDF" | "Importación ZIP" — si no se especifica,
    # _crear_comprobante lo infiere (ver más abajo).
    metodo_creacion: Optional[str] = None


class ComprobanteUpdate(BaseModel):
    tipo_documento: Optional[str] = None
    numero_documento: Optional[str] = None
    documento_relacionado: Optional[str] = None
    tipo_nota_credito: Optional[str] = None
    fecha_devolucion: Optional[date] = None
    metodo_devolucion: Optional[str] = None
    banco_devolucion: Optional[str] = None
    numero_cuenta_devolucion: Optional[str] = None
    numero_operacion_devolucion: Optional[str] = None
    tipo_nota_debito: Optional[str] = None
    ruc_cliente: Optional[str] = None
    razon_social_cliente: Optional[str] = None
    cliente_id: Optional[int] = None
    tipo_servicio: Optional[str] = None
    descripcion: Optional[str] = None
    base_imponible: Optional[float] = None
    monto: Optional[float] = None
    moneda: Optional[str] = None
    tipo_cambio: Optional[float] = None
    monto_original: Optional[float] = None
    fecha: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    tiene_detraccion: bool = False
    concepto_detraccion: Optional[str] = None
    tasa_detraccion: Optional[float] = None
    fecha_limite_detraccion: Optional[date] = None


class EnviarComprobanteRequest(BaseModel):
    comprobante_id: int
    correo_destino: str


class EnviarComprobanteResponse(BaseModel):
    success: bool
    mensaje: str
    enviado_a: str
    fecha_envio: str


class AnularRequest(BaseModel):
    nota_credito_id: int


def _igv(base: float) -> float:
    return round(base * 0.18, 2)

def _total(base: float) -> float:
    return round(base + _igv(base), 2)

def _fecha_limite_detraccion(fecha_emision: date) -> date:
    # Día 5 del mes siguiente a la emisión.
    mes, anio = fecha_emision.month + 1, fecha_emision.year
    if mes > 12:
        mes, anio = 1, anio + 1
    return date(anio, mes, 5)

def _calcular_detraccion(tipo_documento: str, tiene_detraccion: bool, tasa: Optional[float],
                          total: Optional[float], fecha_emision: Optional[date],
                          fecha_limite_manual: Optional[date]):
    """Solo aplica a Facturas. Devuelve (tiene, tasa, monto_detraccion, monto_neto, fecha_limite)."""
    if not tiene_detraccion or tipo_documento != "Factura" or not tasa or not total:
        return False, None, None, None, None
    monto_det = round(total * (tasa / 100), 2)
    monto_neto = round(total - monto_det, 2)
    fecha_lim = fecha_limite_manual or (_fecha_limite_detraccion(fecha_emision) if fecha_emision else None)
    return True, tasa, monto_det, monto_neto, fecha_lim

def _proximo_ac(db: Session) -> str:
    rows = db.query(VentaComercial.numero_factura).filter(
        VentaComercial.tipo_documento == "Anticipo de Cliente",
        VentaComercial.numero_factura.isnot(None),
    ).all()
    max_num = 0
    for (nf,) in rows:
        if nf and nf.upper().startswith("AC-"):
            try:
                n = int(nf[3:])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return f"AC-{max_num + 1:04d}"


def _proximo_ri_venta(db: Session) -> str:
    """Correlativo RI-00001 propio de Recibo Interno en Ventas. El ticket
    pedía consultar un modelo SerieDocumento que no existe en el sistema
    (sin tabla, sin router de configuración) — igual que se resolvió para
    Recibo Interno en Garantías, se usa el fallback que el propio ticket
    describe para ese caso, pero MAX+1 en vez de COUNT+1 (un COUNT se
    desincroniza y puede repetir un correlativo si algún Recibo Interno se
    llegó a eliminar), mismo criterio que el resto de correlativos de este
    sistema (AC-, GAR-, CRED-, RI- de Garantías)."""
    rows = db.query(VentaComercial.numero_factura).filter(
        VentaComercial.tipo_documento == "Recibo Interno",
        VentaComercial.numero_factura.isnot(None),
    ).all()
    max_num = 0
    for (nf,) in rows:
        if nf and nf.upper().startswith("RI-"):
            try:
                n = int(nf[3:])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return f"RI-{max_num + 1:05d}"


def _proximo_correlativo_generico(db: Session, tipo_documento: str, prefijo: str, digitos: int = 5) -> str:
    """Mismo algoritmo MAX+1 que _proximo_ac/_proximo_ri_venta, parametrizado
    por tipo_documento/prefijo — usado para Nota de Crédito (NC-) y Nota de
    Débito (ND-), sin duplicar esas dos funciones existentes."""
    rows = db.query(VentaComercial.numero_factura).filter(
        VentaComercial.tipo_documento == tipo_documento,
        VentaComercial.numero_factura.isnot(None),
    ).all()
    max_num = 0
    prefijo_up = prefijo.upper() + "-"
    for (nf,) in rows:
        if nf and nf.upper().startswith(prefijo_up):
            try:
                n = int(nf[len(prefijo_up):])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return f"{prefijo}-{max_num + 1:0{digitos}d}"


def _serialize(vc: VentaComercial, cli: Cliente = None) -> dict:
    nombre = (cli.razon_social if cli else None) or vc.razon_social_cliente or "—"
    ruc    = (cli.ruc          if cli else None) or vc.ruc_cliente           or "—"
    base   = vc.base_imponible
    igv_v  = vc.igv
    total  = vc.precio_venta or vc.monto
    if base is None and total and (vc.tipo_documento or "") not in TIPOS_SIN_IGV:
        base  = round(total / 1.18, 2)
        igv_v = round(total - base, 2)  # resta contra el total, no base*0.18 — evita 680 -> 679.99
    return {
        "id":                   vc.id,
        "estado":               "Anulada" if vc.estado == "Anulada" else "Activo",
        "tipo_documento":       vc.tipo_documento or "Factura",
        "numero_documento":     vc.numero_factura,
        "cliente_id":           vc.cliente_id,
        "cliente_nombre":       nombre,
        "cliente_email":        cli.email if cli else None,
        "ruc_cliente":          ruc,
        "razon_social_cliente": vc.razon_social_cliente,
        "tipo_servicio":        vc.tipo_servicio,
        "descripcion":          vc.descripcion,
        "base_imponible":       round(base,  2) if base  is not None else None,
        "igv":                  round(igv_v, 2) if igv_v is not None else None,
        "precio_venta":         total,
        "precio_venta_soles":   round(float(vc.precio_venta_soles), 2) if vc.precio_venta_soles is not None else total,
        "moneda":               vc.moneda or "PEN",
        "tipo_cambio":          round(float(vc.tipo_cambio), 4) if vc.tipo_cambio is not None else None,
        "monto_original":       round(float(vc.monto_original), 2) if vc.monto_original is not None else None,
        "fecha":                vc.fecha,
        "fecha_vencimiento":    str(vc.fecha_vencimiento) if vc.fecha_vencimiento else None,
        "documento_relacionado":vc.documento_relacionado,
        "comprobante_relacionado_id": vc.comprobante_relacionado_id,
        "tipo_nota_credito":    vc.tipo_nota_credito,
        "fecha_devolucion":            str(vc.fecha_devolucion) if vc.fecha_devolucion else None,
        "metodo_devolucion":           vc.metodo_devolucion,
        "banco_devolucion":            vc.banco_devolucion,
        "numero_cuenta_devolucion":    vc.numero_cuenta_devolucion,
        "numero_operacion_devolucion": vc.numero_operacion_devolucion,
        "tipo_nota_debito":     vc.tipo_nota_debito,
        "tiene_comprobante":    bool(vc.comprobante_path),
        "comprobante_nombre":   vc.comprobante_nombre,
        "enviado_email":        bool(vc.enviado_email),
        "fecha_envio_email":    vc.fecha_envio_email.strftime("%d/%m/%Y %H:%M") if vc.fecha_envio_email else None,
        "email_envio_destino":  vc.email_envio_destino,
        "tiene_detraccion":        bool(vc.tiene_detraccion),
        "tasa_detraccion":         round(float(vc.tasa_detraccion), 2) if vc.tasa_detraccion is not None else None,
        "monto_detraccion":        round(float(vc.monto_detraccion), 2) if vc.monto_detraccion is not None else None,
        "monto_neto_cobrar":       round(float(vc.monto_neto_cobrar), 2) if vc.monto_neto_cobrar is not None else None,
        "concepto_detraccion":     vc.concepto_detraccion,
        "fecha_limite_detraccion": str(vc.fecha_limite_detraccion) if vc.fecha_limite_detraccion else None,
        "detraccion_pagada":       bool(vc.detraccion_pagada),
        "creado_por":           vc.creado_por,
        "creado_en":            vc.creado_en.strftime("%d/%m/%Y %H:%M") if vc.creado_en else None,
        "modificado_por":       vc.modificado_por,
        "modificado_en":        vc.modificado_en.strftime("%d/%m/%Y %H:%M") if vc.modificado_en else None,
        "metodo_creacion":      vc.metodo_creacion or "Manual",
    }


def _validar_tipo_nc(tipo_documento: Optional[str], tipo_nota_credito: Optional[str]):
    if tipo_documento != "Nota de Crédito":
        return
    if not tipo_nota_credito:
        raise HTTPException(400, "Selecciona el tipo de Nota de Crédito (anulación, devolución o descuento)")
    if tipo_nota_credito not in TIPOS_NOTA_CREDITO:
        raise HTTPException(400, "Tipo de Nota de Crédito inválido")


def _validar_tipo_nd(tipo_documento: Optional[str], tipo_nota_debito: Optional[str]):
    if tipo_documento != "Nota de Débito":
        return
    if not tipo_nota_debito:
        raise HTTPException(400, "Selecciona el tipo de Nota de Débito (cargo adicional, interés por mora o penalidad)")
    if tipo_nota_debito not in TIPOS_NOTA_DEBITO:
        raise HTTPException(400, "Tipo de Nota de Débito inválido")


def _crear_egreso_nc(db: Session, factura: VentaComercial, nota_credito: VentaComercial,
                      monto: float, etiqueta: str, usuario: Usuario,
                      fecha_pago: Optional[date] = None, metodo_pago: Optional[str] = None,
                      banco: Optional[str] = None, numero_cuenta: Optional[str] = None,
                      numero_operacion: Optional[str] = None) -> None:
    """Registra el dinero devuelto al cliente como un Gasto ya pagado
    (categoría "Devoluciones") + su PagoGasto asociado — mismo patrón que
    _generar_gastos_financieros_cuota en prestamos.py. Basta con insertar en
    estas tablas para que el egreso aparezca solo en "Gastos > Lista de
    Pagos" (GET /gastos/pagos, que ya hace join a través de PagoGasto.gasto),
    sin tocar código de gastos.py.

    fecha_pago/metodo_pago/banco/numero_cuenta/numero_operacion solo llegan
    con datos reales desde el escenario "devolucion_cobro" (ver _aplicar_nc);
    "descuento_parcial" sigue llamando sin ellos, sin cambios de comportamiento."""
    monto_r      = round(monto, 2)
    fecha_egreso = fecha_pago or nota_credito.fecha or date.today()
    gasto = Gasto(
        fecha              = fecha_egreso,
        categoria          = "Devoluciones",
        descripcion        = f"{etiqueta} por NC {nota_credito.numero_factura} — Factura {factura.numero_factura}",
        monto              = monto_r,
        area               = "Administrativa",
        tipo_comprobante   = "Nota de Crédito",
        numero_comprobante = nota_credito.numero_factura,
        proveedor          = factura.razon_social_cliente,
        numero_documento   = factura.ruc_cliente,
        base_imponible     = monto_r,
        igv                = 0,
        moneda             = "PEN",
        monto_soles        = monto_r,
        afecta_utilidad    = True,
        saldo_pendiente    = 0.0,
        estado_pago        = "Pagado",
        created_at         = date.today(),
        creado_por         = usuario.nombre,
        creado_en          = datetime.utcnow(),
        metodo_creacion    = "Nota de Crédito",
    )
    db.add(gasto)
    db.flush()
    db.add(PagoGasto(
        gasto_id         = gasto.id,
        monto_pagado     = monto_r,
        fecha_pago       = fecha_egreso,
        metodo_pago      = metodo_pago or "Nota de Crédito",
        banco            = banco,
        numero_cuenta    = numero_cuenta,
        numero_operacion = numero_operacion,
        created_at       = date.today(),
        tipo             = "devolucion_nc" if etiqueta == "Devolución" else "descuento_nc",
        referencia_id    = nota_credito.id,
    ))


def _recalcular_saldo_post_nc(factura: VentaComercial, total_cobrado: float) -> None:
    """Recalcula saldo_pendiente/estado_cobranza de la factura contra lo
    efectivamente cobrado (cobros no extornados) — mismo criterio usado hoy
    en las 3 rutas de eliminación/reactivación de NC."""
    precio_total = float(factura.precio_venta or factura.monto or 0)
    nuevo_saldo  = round(precio_total - total_cobrado, 2)
    if nuevo_saldo <= 0.01:
        factura.saldo_pendiente = 0.0
        factura.estado_cobranza = "Pagada"
    elif total_cobrado > 0:
        factura.saldo_pendiente = nuevo_saldo
        factura.estado_cobranza = "Pago Parcial"
    else:
        factura.saldo_pendiente = precio_total
        factura.estado_cobranza = "Pendiente"


def _aplicar_nc(db: Session, nota_credito: VentaComercial, factura: VentaComercial,
                 usuario: Usuario) -> Optional[str]:
    """Aplica sobre `factura` el escenario elegido en
    nota_credito.tipo_nota_credito. Devuelve un aviso opcional para mostrar
    al usuario. Lanza HTTPException(400) si el escenario no es consistente
    con el estado real de los cobros de la factura."""
    monto_nc      = float(nota_credito.precio_venta or nota_credito.monto or 0)
    total_factura = float(factura.precio_venta or factura.monto or 0)
    tipo          = nota_credito.tipo_nota_credito
    aviso         = None

    cobros_activos = db.query(PagoCobranza).filter(
        PagoCobranza.comprobante_id == factura.id, PagoCobranza.extornado == False,  # noqa: E712
    ).all()
    total_cobrado = round(sum(float(c.monto_pagado) for c in cobros_activos), 2)

    if tipo == "anulacion_simple":
        if total_cobrado > 0.01:
            raise HTTPException(
                400,
                "Esta factura ya tiene cobros registrados. Usa 'Devolución de cobro realizado' en su lugar.",
            )
        if abs(monto_nc - total_factura) > 0.01:
            raise HTTPException(400, "El monto de la Nota de Crédito debe ser igual al total de la factura para una anulación simple.")
        factura.estado          = "Anulada"
        factura.estado_cobranza = "Anulada"
        factura.saldo_pendiente = 0.0

    elif tipo == "devolucion_cobro":
        if abs(monto_nc - total_factura) > 0.01:
            raise HTTPException(400, "El monto de la Nota de Crédito debe ser igual al total de la factura para una devolución de cobro.")
        factura.estado          = "Anulada"
        factura.estado_cobranza = "Anulada"
        factura.saldo_pendiente = 0.0
        for cobro in cobros_activos:
            cobro.extornado      = True
            cobro.fecha_extorno  = datetime.utcnow()
            cobro.motivo_extorno = f"Devolución por Nota de Crédito {nota_credito.numero_factura}"
            cobro.extornado_por  = usuario.nombre
        if total_cobrado > 0.01:
            if not nota_credito.fecha_devolucion:
                raise HTTPException(400, "La fecha de devolución es obligatoria")
            if not nota_credito.metodo_devolucion:
                raise HTTPException(400, "El método de devolución es obligatorio")
            if nota_credito.metodo_devolucion in ("Transferencia", "Cheque") and (
                not nota_credito.banco_devolucion or not nota_credito.numero_cuenta_devolucion
            ):
                raise HTTPException(400, "La cuenta bancaria es obligatoria para Transferencia o Cheque")
            _crear_egreso_nc(
                db, factura, nota_credito, total_cobrado, "Devolución", usuario,
                fecha_pago=nota_credito.fecha_devolucion, metodo_pago=nota_credito.metodo_devolucion,
                banco=nota_credito.banco_devolucion, numero_cuenta=nota_credito.numero_cuenta_devolucion,
                numero_operacion=nota_credito.numero_operacion_devolucion,
            )
            aviso = f"Se registró un egreso de S/ {total_cobrado:,.2f} en Gastos > Lista de Pagos por la devolución al cliente."

    elif tipo == "descuento_parcial":
        if monto_nc > total_factura + 0.01:
            raise HTTPException(400, "El monto de la Nota de Crédito no puede ser mayor al total de la factura.")
        nuevo_total = round(total_factura - monto_nc, 2)
        factura.precio_venta       = nuevo_total
        factura.monto              = nuevo_total
        factura.precio_venta_soles = nuevo_total
        factura.base_imponible     = round(nuevo_total / 1.18, 2)
        factura.igv                = round(nuevo_total - factura.base_imponible, 2)

        if total_cobrado > nuevo_total + 0.01:
            monto_devolver = round(total_cobrado - nuevo_total, 2)
            factura.saldo_pendiente = 0.0
            factura.estado_cobranza = "Pagada"
            _crear_egreso_nc(db, factura, nota_credito, monto_devolver, "Descuento", usuario)
            aviso = f"Se registró un egreso de S/ {monto_devolver:,.2f} en Gastos > Lista de Pagos por el descuento sobre el monto ya cobrado."
        else:
            _recalcular_saldo_post_nc(factura, total_cobrado)

    nota_credito.comprobante_relacionado_id = factura.id
    return aviso


def _aplicar_nd(db: Session, nota_debito: VentaComercial, factura: VentaComercial,
                 usuario: Usuario) -> Optional[str]:
    """Aumenta el monto de `factura` en el monto de la Nota de Débito — los 3
    subtipos (cargo adicional / interés por mora / penalidad) tienen el mismo
    efecto, solo clasifican (nota_debito.tipo_nota_debito). Recalcula
    base/IGV dividiendo el nuevo total entre 1.18 (mismo criterio que
    descuento_parcial en _aplicar_nc) en vez de sumar componentes sueltos,
    para no arrastrar error de redondeo entre ediciones sucesivas."""
    monto_nd      = float(nota_debito.precio_venta or nota_debito.monto or 0)
    total_factura = float(factura.precio_venta or factura.monto or 0)
    nuevo_total   = round(total_factura + monto_nd, 2)

    factura.precio_venta       = nuevo_total
    factura.monto              = nuevo_total
    factura.precio_venta_soles = nuevo_total
    factura.base_imponible     = round(nuevo_total / 1.18, 2)
    factura.igv                = round(nuevo_total - factura.base_imponible, 2)

    saldo_actual = float(factura.saldo_pendiente or 0)
    factura.saldo_pendiente = round(saldo_actual + monto_nd, 2)
    if factura.estado_cobranza == "Pagada" and factura.saldo_pendiente > 0.01:
        factura.estado_cobranza = "Pago Parcial"

    nota_debito.comprobante_relacionado_id = factura.id
    return None


def _revertir_nd(db: Session, nota_debito: VentaComercial, usuario: Usuario) -> None:
    """Deshace el efecto de _aplicar_nd — usado antes de re-aplicar (edición)
    o al eliminar la Nota de Débito. Simétrico a _revertir_nc pero más simple
    (ND no toca cobros ni genera egresos)."""
    if not nota_debito.comprobante_relacionado_id:
        return
    factura = db.query(VentaComercial).filter(
        VentaComercial.id == nota_debito.comprobante_relacionado_id
    ).first()
    if not factura:
        nota_debito.comprobante_relacionado_id = None
        return

    monto_nd    = float(nota_debito.precio_venta or nota_debito.monto or 0)
    nuevo_total = round(float(factura.precio_venta or factura.monto or 0) - monto_nd, 2)
    factura.precio_venta       = nuevo_total
    factura.monto              = nuevo_total
    factura.precio_venta_soles = nuevo_total
    factura.base_imponible     = round(nuevo_total / 1.18, 2)
    factura.igv                = round(nuevo_total - factura.base_imponible, 2)

    total_cobrado = float(db.query(func.sum(PagoCobranza.monto_pagado)).filter(
        PagoCobranza.comprobante_id == factura.id, PagoCobranza.extornado == False,  # noqa: E712
    ).scalar() or 0)
    _recalcular_saldo_post_nc(factura, total_cobrado)

    nota_debito.comprobante_relacionado_id = None


def _revertir_nc(db: Session, nota_credito: VentaComercial, usuario: Usuario) -> None:
    """Deshace el efecto que esta NC había aplicado sobre la factura
    relacionada — usado antes de re-aplicar (edición de tipo_nota_credito o
    documento_relacionado) y al eliminar la NC."""
    if not nota_credito.comprobante_relacionado_id:
        return
    factura = db.query(VentaComercial).filter(
        VentaComercial.id == nota_credito.comprobante_relacionado_id
    ).first()
    if not factura:
        nota_credito.comprobante_relacionado_id = None
        return

    # Elimina el egreso (Gasto+PagoGasto) que esta NC hubiera generado —
    # borrar el Gasto cascadea su PagoGasto (Gasto.pagos_gastos,
    # cascade="all, delete-orphan").
    pago_nc = db.query(PagoGasto).filter(
        PagoGasto.tipo.in_(["devolucion_nc", "descuento_nc"]),
        PagoGasto.referencia_id == nota_credito.id,
    ).first()
    if pago_nc:
        if pago_nc.gasto_id:
            gasto = db.query(Gasto).filter(Gasto.id == pago_nc.gasto_id).first()
            if gasto:
                db.delete(gasto)
            else:
                db.delete(pago_nc)
        else:
            db.delete(pago_nc)
        db.flush()

    if nota_credito.tipo_nota_credito == "descuento_parcial":
        # Restaura el precio original sumando de vuelta el monto de la NC.
        monto_nc    = float(nota_credito.precio_venta or nota_credito.monto or 0)
        nuevo_total = round(float(factura.precio_venta or factura.monto or 0) + monto_nc, 2)
        factura.precio_venta       = nuevo_total
        factura.monto              = nuevo_total
        factura.precio_venta_soles = nuevo_total
        factura.base_imponible     = round(nuevo_total / 1.18, 2)
        factura.igv                = round(nuevo_total - factura.base_imponible, 2)
    else:
        # anulacion_simple / devolucion_cobro reactivan la factura.
        factura.estado = "Activo"
        if nota_credito.tipo_nota_credito == "devolucion_cobro":
            for cobro in db.query(PagoCobranza).filter(
                PagoCobranza.comprobante_id == factura.id, PagoCobranza.extornado == True,  # noqa: E712
            ).all():
                cobro.extornado      = False
                cobro.fecha_extorno  = None
                cobro.motivo_extorno = None
                cobro.extornado_por  = None

    total_cobrado = float(db.query(func.sum(PagoCobranza.monto_pagado)).filter(
        PagoCobranza.comprobante_id == factura.id, PagoCobranza.extornado == False,  # noqa: E712
    ).scalar() or 0)
    _recalcular_saldo_post_nc(factura, total_cobrado)

    nota_credito.comprobante_relacionado_id = None


def _aplicar_relacion(db: Session, doc: VentaComercial, factura: VentaComercial,
                       usuario: Usuario) -> Optional[str]:
    """Despacha a _aplicar_nc/_aplicar_nd según el tipo del documento — evita
    duplicar la búsqueda de factura (con su fallback regex serie+número) en
    cada punto de integración (crear/editar)."""
    if doc.tipo_documento == "Nota de Crédito":
        return _aplicar_nc(db, doc, factura, usuario)
    if doc.tipo_documento == "Nota de Débito":
        return _aplicar_nd(db, doc, factura, usuario)
    return None


def _revertir_relacion(db: Session, doc: VentaComercial, usuario: Usuario) -> None:
    """Despacha a _revertir_nc/_revertir_nd — usado antes de re-aplicar
    (edición) y al eliminar el documento."""
    if doc.tipo_documento == "Nota de Crédito":
        _revertir_nc(db, doc, usuario)
    elif doc.tipo_documento == "Nota de Débito":
        _revertir_nd(db, doc, usuario)


@router.get("")
def listar(
    search: str = "",
    tipo_documento: str = "",
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
):
    q = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    )
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            VentaComercial.numero_factura.ilike(like),
            VentaComercial.razon_social_cliente.ilike(like),
            Cliente.razon_social.ilike(like),
        ))
    if tipo_documento:
        q = q.filter(VentaComercial.tipo_documento == tipo_documento)
    if fecha_desde:
        q = q.filter(VentaComercial.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(VentaComercial.fecha <= fecha_hasta)

    total = q.count()
    rows  = q.order_by(VentaComercial.fecha.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "total": total, "page": page, "per_page": per_page,
        "data": [_serialize(vc, cli) for vc, cli in rows],
    }


@router.get("/por-cliente/{ruc}")
def facturas_por_cliente(ruc: str, db: Session = Depends(get_db)):
    """Facturas/Boletas activas de un cliente por RUC — usado por el
    selector de "Documento Relacionado" al crear una Nota de Crédito
    (ver FormComprobante.jsx). Ruta estática, debe ir antes de /{comp_id}."""
    rows = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.estado != "Anulada",
        VentaComercial.ruc_cliente == ruc,
    ).order_by(VentaComercial.fecha.desc()).all()
    return [
        {
            "numero_factura":   vc.numero_factura,
            "fecha":            vc.fecha,
            "precio_venta":     round(float(vc.precio_venta or vc.monto or 0), 2),
            "saldo_pendiente":  round(float(
                vc.saldo_pendiente if vc.saldo_pendiente is not None else (vc.precio_venta or vc.monto or 0)
            ), 2),
            "estado_cobranza":  vc.estado_cobranza or "Pendiente",
        }
        for vc in rows
    ]


@router.post("")
def crear(data: ComprobanteCreate, http_request: Request, db: Session = Depends(get_db),
          usuario: Usuario = Depends(get_current_usuario)):
    return _crear_comprobante(data, http_request, db, usuario)


def _crear_comprobante(data: ComprobanteCreate, http_request: Request, db: Session, usuario: Usuario) -> dict:
    """Lógica de creación de un comprobante, compartida por el endpoint
    POST /comprobantes y por la confirmación de importación masiva
    (POST /comprobantes/importar-zip/confirmar)."""
    numero_documento = data.numero_documento
    if data.tipo_documento == "Anticipo de Cliente" and not numero_documento:
        numero_documento = _proximo_ac(db)
    elif data.tipo_documento == "Recibo Interno":
        # Siempre autogenerado — el frontend lo deja de solo lectura para este
        # tipo, así que cualquier valor recibido del cliente se ignora.
        numero_documento = _proximo_ri_venta(db)
    elif data.tipo_documento == "Nota de Crédito" and not numero_documento:
        # A diferencia de Recibo Interno, aquí SÍ importa "and not
        # numero_documento": una NC/ND importada por PDF o ZIP trae su
        # número real de SUNAT y no debe pisarse con un correlativo interno.
        numero_documento = _proximo_correlativo_generico(db, "Nota de Crédito", "NC")
    elif data.tipo_documento == "Nota de Débito" and not numero_documento:
        numero_documento = _proximo_correlativo_generico(db, "Nota de Débito", "ND")

    if db.query(VentaComercial).filter(
        VentaComercial.numero_factura == numero_documento
    ).first():
        raise HTTPException(400, f"Ya existe un comprobante con el número {numero_documento}")

    # La importación ZIP es un flujo por lotes sin UI para elegir el
    # escenario/tipo por archivo — esas Notas de Crédito/Débito se crean sin
    # escenario (soft-fail, igual que cuando no se encuentra la factura
    # relacionada) y se completan luego editándolas (ver PUT /{comp_id}).
    if not data.archivo_temp:
        _validar_tipo_nc(data.tipo_documento, data.tipo_nota_credito)
        _validar_tipo_nd(data.tipo_documento, data.tipo_nota_debito)
        # La importación ZIP sí puede crear NC/ND sin documento_relacionado
        # (se completa después vía PUT, ver comentario más abajo); pero la
        # creación manual no debe permitir una NC/ND "huérfana" sin que el
        # usuario se entere.
        if data.tipo_documento in ("Nota de Crédito", "Nota de Débito"):
            if not data.documento_relacionado:
                raise HTTPException(400,
                    "Una Nota de Crédito/Débito requiere "
                    "un documento relacionado obligatorio."
                )
            # Misma búsqueda flexible (serie+número sin ceros) que se usa más
            # abajo al aplicar la relación, para no rechazar por un falso
            # negativo un número válido con relleno de ceros distinto.
            factura_check = db.query(VentaComercial).filter(
                VentaComercial.numero_factura == data.documento_relacionado,
                VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
                VentaComercial.estado != "Anulada",
            ).first()
            if not factura_check:
                m_check = re.match(r'([A-Z]\d{3})-0*(\d+)$', data.documento_relacionado)
                if m_check:
                    serie_chk, numero_chk = m_check.group(1), m_check.group(2)
                    factura_check = db.query(VentaComercial).filter(
                        VentaComercial.numero_factura.ilike(f"%{serie_chk}%{numero_chk}"),
                        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
                        VentaComercial.estado != "Anulada",
                    ).first()
            if not factura_check:
                raise HTTPException(404,
                    f"No se encontró la factura {data.documento_relacionado}. "
                    "Verifica el número de documento relacionado."
                )

    cliente_id          = data.cliente_id
    razon_social_cli    = data.razon_social_cliente
    aviso               = None

    if not cliente_id and data.ruc_cliente:
        cli_existente = db.query(Cliente).filter(Cliente.ruc == data.ruc_cliente).first()
        if cli_existente:
            # RUC ya registrado: se usa el cliente existente, sin crear duplicado.
            cliente_id       = cli_existente.id
            razon_social_cli = cli_existente.razon_social
            if data.razon_social_cliente and data.razon_social_cliente.strip() != cli_existente.razon_social:
                aviso = f"Comprobante asociado al cliente existente: {cli_existente.razon_social}"
        else:
            # RUC no existe: se crea un cliente nuevo automáticamente con los datos del comprobante.
            nuevo_cliente = Cliente(
                razon_social = data.razon_social_cliente,
                ruc          = data.ruc_cliente,
                activo       = True,
            )
            db.add(nuevo_cliente)
            db.flush()
            cliente_id       = nuevo_cliente.id
            razon_social_cli = nuevo_cliente.razon_social

    if data.tipo_documento in TIPOS_SIN_IGV:
        if data.monto is None:
            raise HTTPException(400, "El monto es obligatorio")
        total = round(data.monto, 2)
        if data.tipo_documento == "Recibo Interno":
            # Sin desglose de IGV: la base imponible es el monto total.
            base  = total
            igv_v = 0.0
        else:
            base  = None
            igv_v = None
    else:
        if data.base_imponible is None:
            raise HTTPException(400, "La base imponible es obligatoria")
        base  = data.base_imponible
        igv_v = _igv(base)
        total = _total(base)

    # Inicializar campos de cobranza para Facturas y Boletas
    if data.tipo_documento in TIPOS_COBRANZA:
        fecha_venc   = data.fecha_vencimiento if data.fecha_vencimiento else (data.fecha + timedelta(days=30))
        saldo_pend   = total
        est_cobranza = "Pendiente"
    else:
        fecha_venc   = None
        saldo_pend   = None
        est_cobranza = None

    moneda = data.moneda or "PEN"

    tiene_det, tasa_det, monto_det, monto_neto, fecha_lim_det = _calcular_detraccion(
        data.tipo_documento, data.tiene_detraccion, data.tasa_detraccion, total,
        data.fecha, data.fecha_limite_detraccion,
    )

    venta = VentaComercial(
        cliente_id           = cliente_id,
        tipo_servicio        = data.tipo_servicio,
        descripcion          = data.descripcion,
        monto                = total,
        fecha                = data.fecha,
        numero_factura       = numero_documento,
        estado               = "Activo",
        tipo_documento       = data.tipo_documento,
        base_imponible       = base,
        igv                  = igv_v,
        precio_venta         = total,
        precio_venta_soles   = total,
        moneda               = moneda,
        tipo_cambio          = round(data.tipo_cambio, 4) if moneda == "USD" and data.tipo_cambio else None,
        monto_original       = round(data.monto_original, 2) if moneda == "USD" and data.monto_original is not None else None,
        documento_relacionado= data.documento_relacionado,
        tipo_nota_credito    = data.tipo_nota_credito if data.tipo_documento == "Nota de Crédito" else None,
        fecha_devolucion            = data.fecha_devolucion            if data.tipo_nota_credito == "devolucion_cobro" else None,
        metodo_devolucion           = data.metodo_devolucion           if data.tipo_nota_credito == "devolucion_cobro" else None,
        banco_devolucion            = data.banco_devolucion            if data.tipo_nota_credito == "devolucion_cobro" else None,
        numero_cuenta_devolucion    = data.numero_cuenta_devolucion    if data.tipo_nota_credito == "devolucion_cobro" else None,
        numero_operacion_devolucion = data.numero_operacion_devolucion if data.tipo_nota_credito == "devolucion_cobro" else None,
        tipo_nota_debito     = data.tipo_nota_debito if data.tipo_documento == "Nota de Débito" else None,
        ruc_cliente          = data.ruc_cliente,
        razon_social_cliente = razon_social_cli,
        fecha_vencimiento    = fecha_venc,
        saldo_pendiente      = saldo_pend,
        estado_cobranza      = est_cobranza,
        tiene_detraccion        = tiene_det,
        tasa_detraccion         = tasa_det,
        monto_detraccion        = monto_det,
        monto_neto_cobrar       = monto_neto,
        concepto_detraccion     = data.concepto_detraccion if tiene_det else None,
        fecha_limite_detraccion = fecha_lim_det,
        creado_por              = usuario.nombre,
        creado_en               = datetime.utcnow(),
        metodo_creacion         = data.metodo_creacion or ("Importación ZIP" if data.archivo_temp else "Manual"),
    )
    db.add(venta)
    db.commit()
    db.refresh(venta)

    # Si el comprobante viene de importar-zip/confirmar, mueve el PDF
    # original (staged en TMP_ZIP_DIR por importar-zip) a su ubicación
    # definitiva y lo asocia — mismo destino que usa POST /ventas/{id}/comprobante.
    # Path(...).name descarta cualquier componente de ruta que venga en
    # archivo_temp, así que no hay forma de escapar de TMP_ZIP_DIR.
    if data.archivo_temp:
        origen = TMP_ZIP_DIR / Path(data.archivo_temp).name
        if origen.is_file():
            upload_dir = Path("uploads/comprobantes") / str(cliente_id) / str(venta.id)
            upload_dir.mkdir(parents=True, exist_ok=True)
            nombre_final = data.archivo_nombre or origen.name
            destino = upload_dir / nombre_final
            shutil.move(str(origen), str(destino))
            venta.comprobante_path = str(destino)
            venta.comprobante_nombre = nombre_final
            db.commit()

    registrar_log(
        db, usuario.id, usuario.nombre, "ventas", "Creó comprobante",
        f"Creó comprobante {venta.numero_factura}", ip_de(http_request),
    )

    # Si es una Nota de Crédito o Débito vinculada a una Factura/Boleta
    # existente, aplica el efecto elegido por el usuario (_aplicar_relacion —
    # despacha a _aplicar_nc o _aplicar_nd). Si no se encuentra la factura
    # (typo, o importación ZIP sin escenario todavía) queda registrada sin
    # vincular, igual que antes.
    if data.tipo_documento in ("Nota de Crédito", "Nota de Débito") and data.documento_relacionado:
        factura = db.query(VentaComercial).filter(
            VentaComercial.numero_factura == data.documento_relacionado,
            VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
            VentaComercial.estado != "Anulada",
        ).first()
        if not factura:
            # El PDF suele traer el correlativo con relleno de ceros distinto
            # al que quedó guardado (ej. "E001-00000430" vs "E001-430" real),
            # así que se reintenta con una búsqueda flexible por serie+número.
            m_ref = re.match(r'([A-Z]\d{3})-0*(\d+)$', data.documento_relacionado)
            if m_ref:
                serie, numero_sin_ceros = m_ref.group(1), m_ref.group(2)
                factura = db.query(VentaComercial).filter(
                    VentaComercial.numero_factura.ilike(f"%{serie}%{numero_sin_ceros}"),
                    VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
                    VentaComercial.estado != "Anulada",
                ).first()
        tiene_escenario = venta.tipo_nota_credito if venta.tipo_documento == "Nota de Crédito" else venta.tipo_nota_debito
        if factura and tiene_escenario:
            aviso_rel = _aplicar_relacion(db, venta, factura, usuario)
            db.commit()
            if aviso_rel:
                aviso = (aviso + " " if aviso else "") + aviso_rel

    cli = db.query(Cliente).filter(Cliente.id == venta.cliente_id).first() if venta.cliente_id else None
    result = _serialize(venta, cli)
    result["aviso"] = aviso
    return result


@router.post("/{comp_id}/anular")
def anular(comp_id: int, data: AnularRequest, http_request: Request, db: Session = Depends(get_db),
           usuario: Usuario = Depends(get_current_usuario)):
    factura = db.query(VentaComercial).filter(VentaComercial.id == comp_id).first()
    if not factura:
        raise HTTPException(404, "Comprobante no encontrado")
    if factura.estado == "Anulada":
        raise HTTPException(400, "El comprobante ya está anulado")

    nota_credito = db.query(VentaComercial).filter(VentaComercial.id == data.nota_credito_id).first()
    if not nota_credito:
        raise HTTPException(404, "Nota de crédito no encontrada")
    if nota_credito.tipo_documento != "Nota de Crédito":
        raise HTTPException(400, "El comprobante indicado no es una Nota de Crédito")

    factura.estado                       = "Anulada"
    factura.saldo_pendiente              = 0.0
    factura.estado_cobranza              = "Anulada"
    nota_credito.comprobante_relacionado_id = factura.id
    db.commit()
    db.refresh(factura)

    registrar_log(
        db, usuario.id, usuario.nombre, "ventas", "Anuló comprobante",
        f"Anuló el comprobante {factura.numero_factura} mediante la Nota de Crédito {nota_credito.numero_factura}",
        ip_de(http_request),
    )

    cli = db.query(Cliente).filter(Cliente.id == factura.cliente_id).first() if factura.cliente_id else None
    return _serialize(factura, cli)


# ── Importación de PDF (SUNAT) ─────────────────────────────────────────────

TAMANO_MAXIMO_PDF = 10 * 1024 * 1024

# El tipo se detecta por su etiqueta de texto, en orden del más específico
# al más general. Una Nota de Crédito casi siempre menciona en su propio
# texto la "FACTURA ELECTRÓNICA" que anula (ej. "Documento relacionado:
# FACTURA ELECTRÓNICA F001-00023"), así que si "Factura" se revisara primero
# el documento se clasificaba mal como Factura en vez de Nota de Crédito.
_PATRONES_TIPO = [
    ("Nota de Crédito", r'NOTA\s+DE\s+CR[EÉ]DITO'),
    ("Nota de Débito",  r'NOTA\s+DE\s+D[EÉ]BITO'),
    ("Boleta de Venta", r'BOLETA\s+DE\s+VENTA'),
    ("Factura",         r'FACTURA\s+ELECTR[OÓ]NICA'),
]

# Patrón de número por tipo ya detectado (más preciso que el genérico).
# Cada tipo prueba una lista de patrones en orden. Las Notas de Crédito/Débito
# reales de SUNAT no siempre usan un prefijo "NC"/"ND" propio — muchas veces
# comparten la misma serie electrónica que las facturas (ej. una NC con
# número "E001-66"), así que primero se busca el número justo debajo de su
# propia etiqueta de tipo, y solo si eso falla se prueba el prefijo NC/ND.
_PREFIJOS_NUMERO = {
    "Nota de Crédito": [
        r'NOTA\s+DE\s+CR[EÉ]DITO\s+ELECTR[OÓ]NICA\s*\n?\s*([A-Z]\d{3}\s*-\s*\d{1,8})',
        r'\b(NC-\d{2}-\d{1,8}|NC-\d{1,8})\b',
    ],
    "Nota de Débito": [
        r'NOTA\s+DE\s+D[EÉ]BITO\s+ELECTR[OÓ]NICA\s*\n?\s*([A-Z]\d{3}\s*-\s*\d{1,8})',
        r'\b(ND-\d{2}-\d{1,8}|ND-\d{1,8})\b',
    ],
    "Boleta de Venta": [r'\b(B\d{3}-\d{1,8})\b'],
    "Factura":         [r'\b([FE]\d{3}-\d{1,8})\b'],
}

# Serie + correlativo genérico: 1-4 letras, 0-4 dígitos, guion, 1-8 dígitos.
# Se usa como respaldo cuando el tipo no se detectó o su patrón específico
# no matcheó (cubre series atípicas no contempladas arriba).
_PATRON_NUMERO_DOC = r'\b([A-Z]{1,4}\d{0,4}-\d{1,8})\b'


# El PDF de NC de SUNAT incluye la factura que anula en un campo como:
#   "Documento que modifica: Factura Electrónica : E001 - 430"  (formato real:
#   nótese los espacios alrededor del guion entre serie y correlativo)
#   "FACTURA ELECTRÓNICA: F001-00003365"
#   "Factura Electrónica N°: F001-00003365"
#   "Documento de Referencia: F001-00003365"
# Los dos primeros patrones capturan serie y número por separado (para poder
# normalizar el espaciado real "E001 - 430"); el resto ya trae "serie-número"
# junto y se usa tal cual.
_PATRONES_DOC_RELACIONADO = [
    r'Documento\s+que\s+modifica[:\s]+Factura\s+Electr[oó]nica\s*:\s*([A-Z]\d{3})\s*-\s*(\d+)',
    r'Documento\s+que\s+modifica[:\s]+\w+\s+\w+\s*:\s*([A-Z]\d{3})\s*-\s*(\d+)',
    r'FACTURA\s+ELECTR[OÓ]NICA[:\s°N]+([A-Z]\d{3})\s*-\s*(\d+)',
    r'DOCUMENTO\s+DE\s+REFERENCIA[:\s]+([A-Z]\d{3})\s*-\s*(\d+)',
    r'COMPROBANTE\s+(?:DE\s+REFERENCIA|RELACIONADO)[:\s]+([A-Z]\d{3})\s*-\s*(\d+)',
    r'(?:SERIE\s+Y\s+N[UÚ]MERO|N[°º])[:\s]+(F\d{3})\s*-\s*(\d+)',
    # Respaldo: etiqueta genérica con texto de relleno antes del número
    # (ej. "Documento relacionado: FACTURA ELECTRÓNICA F001-00023").
    r'(?:FACTURA|DOCUMENTO)\s+(?:RELACIONAD[AO]|DE\s+REFERENCIA)[:\s]+[A-ZÁÉÍÓÚÑ\s]*?([FE]\d{3})\s*-\s*(\d+)',
]


def _extraer_documento_relacionado(texto: str):
    for patron in _PATRONES_DOC_RELACIONADO:
        match = re.search(patron, texto, re.IGNORECASE)
        if not match:
            continue
        serie  = match.group(1).upper()
        numero = match.group(2).zfill(8)
        return f"{serie}-{numero}"
    return None


def _extraer_motivo(texto: str):
    m = re.search(r'Motivo\s+o\s+Sustento\s*:\s*(.+?)(?:\n|ANULACI)', texto, re.IGNORECASE)
    if not m:
        m = re.search(r'MOTIVO[:\s]+(.+)', texto, re.IGNORECASE)
    if not m:
        return None
    return re.sub(r'\s{2,}', ' ', m.group(1).strip().split("\n")[0]).strip()[:200] or None


_CAMPOS_CLAVE = [
    "numero_documento", "tipo_documento", "ruc_cliente", "razon_social",
    "fecha_emision", "base_imponible", "igv", "precio_venta",
]


def _detectar_numero_y_tipo(texto: str):
    tipo = None
    for tipo_candidato, patron_tipo in _PATRONES_TIPO:
        if re.search(patron_tipo, texto, re.IGNORECASE):
            tipo = tipo_candidato
            break

    numero_documento = None
    for patron in _PREFIJOS_NUMERO.get(tipo, []):
        m = re.search(patron, texto, re.IGNORECASE)
        if m:
            numero_documento = re.sub(r'\s+', '', m.group(1)).upper()
            break
    if not numero_documento:
        m = re.search(_PATRON_NUMERO_DOC, texto, re.IGNORECASE)
        if m:
            numero_documento = m.group(1).upper()

    return tipo, numero_documento


def _extraer_ruc_razon_social(texto: str):
    matches = list(re.finditer(r'(?:RUC|R\.U\.C\.)[:\s]+(\d{11})', texto, re.IGNORECASE))
    if not matches:
        return None, None, None

    # El RUC del emisor va en el encabezado; el del cliente aparece junto a
    # "Señor(es)"/"Cliente"/"Razón Social" más abajo. Si no se distingue por
    # contexto, se asume que el del cliente es el último en aparecer.
    elegido = None
    for m in matches:
        ventana_previa = texto[max(0, m.start() - 60): m.start()]
        if re.search(r'SE[NÑ]OR|CLIENTE|RAZ[OÓ]N\s+SOCIAL', ventana_previa, re.IGNORECASE):
            elegido = m
            break
    if elegido is None:
        elegido = matches[-1]

    ruc = elegido.group(1)

    # RUC emisor: el primer RUC del documento que no sea el del cliente
    # (normalmente aparece en el encabezado, antes de los datos del cliente).
    ruc_emisor = next((m.group(1) for m in matches if m is not elegido), None)

    # 1) Layout típico de NC reales: el nombre viene en la misma línea que
    #    la etiqueta ("Señor(es) : SEGUROC SOCIEDAD ANONIMA").
    razon_social = None
    m_nombre = re.search(r'SE[NÑ]OR\(ES\)|SE[NÑ]OR|CLIENTE', texto, re.IGNORECASE)
    if m_nombre:
        fin_etiqueta = texto.find(":", m_nombre.end())
        if fin_etiqueta != -1:
            linea = texto[fin_etiqueta + 1:].strip().split("\n")[0].strip(" :-")
            if linea:
                razon_social = re.sub(r'\s{2,}', ' ', linea).strip()[:120]

    # 2) Respaldo: layout donde el nombre queda después del RUC, no de la
    #    etiqueta (ej. facturas donde "Señor(es)"/"RUC"/nombre vienen
    #    intercalados en líneas separadas por el diseño a dos columnas).
    if not razon_social:
        resto = texto[elegido.end(): elegido.end() + 200]
        linea = resto.strip().split("\n")[0].strip(" :-")
        razon_social = re.sub(r'\s{2,}', ' ', linea).strip()[:120] or None

    return ruc_emisor, ruc, razon_social


def _extraer_fecha(texto: str, patron: str):
    m = re.search(patron, texto, re.IGNORECASE)
    if not m:
        return None
    d, mes, anio = m.group(1).split("/")
    try:
        return date(int(anio), int(mes), int(d)).isoformat()
    except ValueError:
        return None


def _extraer_monto(texto: str, patron: str):
    m = re.search(patron, texto, re.IGNORECASE)
    if not m:
        return None
    crudo = m.group(1).replace(",", "")
    try:
        return round(float(crudo), 2)
    except ValueError:
        return None


def _extraer_descripcion(texto: str):
    lineas = texto.split("\n")
    for i, linea in enumerate(lineas):
        if not re.search(r'DESCRIPCI[OÓ]N', linea, re.IGNORECASE):
            continue
        # La descripción del ítem viene en una de las líneas siguientes: en
        # PDFs simples es texto suelto; en tablas SUNAT reales viene en la
        # fila de detalle junto con cantidad/unidad al inicio y montos al
        # final (ej. "1.00 UNIDAD SERIVIO ASESORIA 169.49152 0.00").
        for candidata in lineas[i + 1: i + 4]:
            candidata = candidata.strip()
            if not candidata:
                continue
            fila = re.match(r'^[\d.,]+\s+\S+\s+(.+?)\s+[\d.,]+(?:\s+[\d.,]+)*$', candidata)
            texto_desc = fila.group(1) if fila else candidata
            return re.sub(r'\s{2,}', ' ', texto_desc).strip()[:200] or None
        return None
    return None


def _extraer_datos_pdf(texto: str) -> dict:
    tipo_documento, numero_documento = _detectar_numero_y_tipo(texto)
    ruc_emisor, ruc_cliente, razon_social = _extraer_ruc_razon_social(texto)
    fecha_emision      = _extraer_fecha(texto, r'FECHA\s+DE\s+EMISI[OÓ]N[:\s]+(\d{2}/\d{2}/\d{4})')
    fecha_vencimiento  = _extraer_fecha(texto, r'FECHA\s+DE\s+VENCIMIENTO[:\s]+(\d{2}/\d{2}/\d{4})')
    base_imponible     = _extraer_monto(texto, r'(?:OP\.?\s*GRAVADAS?|BASE\s+IMPONIBLE|VALOR\s+VENTA|SUB\s+TOTAL\s+VENTAS)[:\s]+S?/?\s*([\d,\.]+)')
    igv                = _extraer_monto(texto, r'IGV\s*(?:18%)?[:\s]+S?/?\s*([\d,\.]+)')
    precio_venta       = _extraer_monto(texto, r'(?:IMPORTE\s+TOTAL|TOTAL)[:\s]+S?/?\s*([\d,\.]+)')
    descripcion        = _extraer_descripcion(texto)

    documento_relacionado = None
    motivo                = None
    if tipo_documento == "Nota de Crédito":
        documento_relacionado = _extraer_documento_relacionado(texto)
        motivo                = _extraer_motivo(texto)
        if not descripcion and motivo:
            descripcion = motivo

    detectados = {
        "numero_documento": numero_documento,
        "tipo_documento":   tipo_documento,
        "ruc_cliente":      ruc_cliente,
        "razon_social":     razon_social,
        "fecha_emision":    fecha_emision,
        "base_imponible":   base_imponible,
        "igv":              igv,
        "precio_venta":     precio_venta,
    }
    campos_no_detectados = [c for c in _CAMPOS_CLAVE if not detectados.get(c)]
    # El tipo de servicio nunca viene en el PDF de SUNAT: siempre es manual,
    # pero no debe penalizar la confianza de lo que sí se pudo leer del PDF.
    confianza = round(1 - len(campos_no_detectados) / len(_CAMPOS_CLAVE), 2)
    campos_no_detectados.append("tipo_servicio")

    return {
        "tipo_documento":       tipo_documento,
        "numero_documento":     numero_documento,
        "fecha_emision":        fecha_emision,
        "fecha_vencimiento":    fecha_vencimiento,
        "ruc_emisor":           ruc_emisor,
        "ruc_cliente":          ruc_cliente,
        "razon_social":         razon_social,
        "descripcion":          descripcion,
        "documento_relacionado":documento_relacionado,
        "motivo":               motivo,
        "base_imponible":       base_imponible,
        "igv":                  igv,
        "precio_venta":         precio_venta,
        "moneda":               "PEN",
        "confianza":            max(0.0, min(1.0, confianza)),
        "campos_no_detectados": campos_no_detectados,
    }


MAX_PDFS_POR_ZIP = 100
TAMANO_MAXIMO_ZIP = 50 * 1024 * 1024

# Staging temporal para los PDFs extraídos de un ZIP: importar-zip solo
# previsualiza los datos (todavía no existe ningún VentaComercial), así que
# el archivo original se guarda aquí con un nombre único y se recupera recién
# en importar-zip/confirmar, cuando ya se conoce el id del comprobante creado.
TMP_ZIP_DIR = Path("uploads/comprobantes/_tmp_zip")


def _procesar_pdf_individual(contenido: bytes, nombre_archivo: str, db: Session) -> dict:
    """Extrae y clasifica los datos de un PDF de comprobante SUNAT.

    No lanza excepciones por PDFs inválidos: siempre retorna un dict con
    "estado" ("listo" | "revisar" | "no_valido" | "duplicado") para que el
    llamador (carga individual o masiva) decida qué hacer con cada archivo.
    "no_valido_ilegible" distingue el único caso que la carga individual
    sigue rechazando con 422 (PDF corrupto o imagen escaneada sin texto),
    para no cambiar el comportamiento ya existente de ese flujo.
    """
    try:
        with pdfplumber.open(io.BytesIO(contenido)) as pdf:
            paginas_texto = [pagina.extract_text() or "" for pagina in pdf.pages]
    except Exception:
        return {
            "estado": "no_valido", "no_valido_ilegible": True,
            "error": "No se pudo leer el archivo. Verifique que sea un PDF válido",
        }

    for i, texto_pagina in enumerate(paginas_texto):
        logger.info("procesar-pdf %s — página %d texto extraído:\n%s", nombre_archivo, i + 1, texto_pagina)

    texto = "\n".join(paginas_texto)

    if len(texto.strip()) < 20:
        return {
            "estado": "no_valido", "no_valido_ilegible": True,
            "error": ("Este PDF es una imagen escaneada. Los datos no pudieron extraerse "
                      "automáticamente. Por favor usa Nuevo Comprobante para registrarlo."),
        }

    resultado = _extraer_datos_pdf(texto)
    resultado["no_valido_ilegible"] = False
    logger.info("procesar-pdf %s — datos detectados: %s", nombre_archivo, resultado)

    existente = None
    if resultado["numero_documento"]:
        existente = db.query(VentaComercial).filter(
            VentaComercial.numero_factura == resultado["numero_documento"]
        ).first()

    if existente:
        resultado["estado"] = "duplicado"
        resultado["ya_registrado"] = True
        resultado["mensaje_duplicado"] = (
            f"Este comprobante ya está registrado: {existente.numero_factura} "
            f"del {existente.fecha.strftime('%d/%m/%Y')}"
        )
    else:
        resultado["ya_registrado"] = False
        resultado["mensaje_duplicado"] = None
        if not resultado["tipo_documento"]:
            resultado["estado"] = "no_valido"
            resultado["error"] = "No se reconoce como un comprobante electrónico de SUNAT"
        else:
            campos_criticos_faltantes = [c for c in resultado["campos_no_detectados"] if c != "tipo_servicio"]
            resultado["estado"] = "revisar" if campos_criticos_faltantes else "listo"

    return resultado


@router.post("/importar-pdf")
async def importar_pdf(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "El archivo debe ser un PDF")

    contenido = await file.read()
    if len(contenido) > TAMANO_MAXIMO_PDF:
        raise HTTPException(400, "El archivo supera el tamaño máximo de 10 MB")

    resultado = _procesar_pdf_individual(contenido, file.filename, db)
    if resultado.get("no_valido_ilegible"):
        raise HTTPException(422, resultado["error"])
    return resultado


@router.post("/importar-zip")
async def importar_zip(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(400, "El archivo debe ser un ZIP")

    contenido = await file.read()
    if len(contenido) > TAMANO_MAXIMO_ZIP:
        raise HTTPException(400, "El archivo ZIP supera el tamaño máximo de 50 MB")

    try:
        zf = zipfile.ZipFile(io.BytesIO(contenido))
    except zipfile.BadZipFile:
        raise HTTPException(400, "El archivo no es un ZIP válido")

    # Incluye PDFs en subcarpetas: zipfile siempre usa "/" como separador en
    # namelist(), sin importar el sistema operativo donde se creó el ZIP.
    pdf_names = [n for n in zf.namelist() if n.lower().endswith(".pdf") and not n.endswith("/")]
    if not pdf_names:
        raise HTTPException(400, "El ZIP no contiene archivos PDF")
    if len(pdf_names) > MAX_PDFS_POR_ZIP:
        raise HTTPException(400, f"El ZIP contiene {len(pdf_names)} PDFs; el máximo permitido es {MAX_PDFS_POR_ZIP}")

    resultados = []
    for pdf_name in pdf_names:
        try:
            with zf.open(pdf_name) as pf:
                contenido_pdf = pf.read()
        except RuntimeError as e:
            if "password" in str(e).lower():
                raise HTTPException(
                    400,
                    "El archivo ZIP está protegido con contraseña, por favor descomprímelo primero",
                )
            raise
        nombre_corto = pdf_name.rsplit("/", 1)[-1]
        resultado = _procesar_pdf_individual(contenido_pdf, nombre_corto, db)
        resultado["archivo"] = nombre_corto

        # Validaciones exclusivas de la carga masiva (no aplican a
        # importar-pdf individual): RUC emisor debe ser el de la propia
        # empresa, y el RUC del cliente debe existir ya en el sistema. Solo
        # se evalúan si el PDF fue reconocido y no es un duplicado, ya que
        # en esos otros casos ruc_emisor/ruc_cliente no son confiables.
        if resultado["estado"] in ("listo", "revisar"):
            empresa_cfg = db.query(ConfiguracionEmpresa).first()
            ruc_empresa = empresa_cfg.ruc if empresa_cfg else None
            ruc_emisor_pdf = resultado.get("ruc_emisor")
            ruc_cliente_pdf = resultado.get("ruc_cliente")

            if ruc_empresa and ruc_emisor_pdf and ruc_emisor_pdf != ruc_empresa:
                resultado["estado"] = "no_valido"
                resultado["error"] = (
                    f"RUC emisor no corresponde a tu empresa "
                    f"(PDF: {ruc_emisor_pdf}, tu empresa: {ruc_empresa})"
                )
            else:
                cliente_existe = (
                    db.query(Cliente).filter(Cliente.ruc == ruc_cliente_pdf).first()
                    if ruc_cliente_pdf else None
                )
                if not cliente_existe:
                    resultado["estado"] = "no_valido"
                    resultado["error"] = (
                        f"Cliente no registrado en el sistema (RUC: {ruc_cliente_pdf or 'no detectado'})"
                    )

        # Se conserva el PDF original en staging para poder adjuntarlo al
        # comprobante si el usuario confirma su importación (ver
        # importar_zip_confirmar / _crear_comprobante). Se guarda incluso
        # para filas "revisar"/"no_valido" por simplicidad; los archivos no
        # confirmados quedan huérfanos en TMP_ZIP_DIR (limpieza manual).
        TMP_ZIP_DIR.mkdir(parents=True, exist_ok=True)
        nombre_temp = f"{uuid.uuid4().hex}.pdf"
        with open(TMP_ZIP_DIR / nombre_temp, "wb") as f:
            f.write(contenido_pdf)
        resultado["archivo_temp"] = nombre_temp

        resultados.append(resultado)

    return {"total": len(pdf_names), "resultados": resultados}


class ImportarZipConfirmarRequest(BaseModel):
    comprobantes: List[ComprobanteCreate]


@router.post("/importar-zip/confirmar")
def importar_zip_confirmar(data: ImportarZipConfirmarRequest, http_request: Request,
                            db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    resultados = []
    for item in data.comprobantes:
        try:
            r = _crear_comprobante(item, http_request, db, usuario)
            resultados.append({
                "numero_documento": item.numero_documento, "exito": True,
                "id": r["id"], "aviso": r.get("aviso"),
            })
        except HTTPException as e:
            resultados.append({
                "numero_documento": item.numero_documento, "exito": False,
                "error": e.detail,
            })

    exitosos = sum(1 for r in resultados if r["exito"])
    return {"total": len(resultados), "exitosos": exitosos, "resultados": resultados}


@router.get("/exportar")
def exportar_comprobantes(
    search: str = "",
    tipo_documento: str = "",
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    cliente_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    q = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    )
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            VentaComercial.numero_factura.ilike(like),
            VentaComercial.razon_social_cliente.ilike(like),
            Cliente.razon_social.ilike(like),
        ))
    if cliente_id:
        q = q.filter(VentaComercial.cliente_id == cliente_id)
    if tipo_documento:
        q = q.filter(VentaComercial.tipo_documento == tipo_documento)
    if fecha_desde:
        q = q.filter(VentaComercial.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(VentaComercial.fecha <= fecha_hasta)

    rows = q.order_by(VentaComercial.fecha.desc()).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Comprobantes"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="16A34A")  # verde
    alt_fill    = PatternFill("solid", fgColor="F0FDF4")
    center      = Alignment(horizontal="center")

    HEADERS = [
        "Tipo", "N° Documento", "Cliente", "RUC", "Tipo de Servicio",
        "Moneda", "Monto Original", "T/C", "Base Imponible", "IGV", "Total", "Fecha Emisión", "Estado",
    ]
    COL_WIDTHS = [18, 20, 36, 16, 28, 10, 16, 10, 16, 12, 14, 16, 12]

    ws.append(HEADERS)
    for col_idx, (hdr, w) in enumerate(zip(HEADERS, COL_WIDTHS), start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font      = header_font
        cell.fill      = header_fill
        cell.alignment = center
        ws.column_dimensions[cell.column_letter].width = w

    for row_idx, (vc, cli) in enumerate(rows, start=2):
        s = _serialize(vc, cli)
        if s["moneda"] == "USD":
            label_moneda = "US$"
            monto_o      = s["monto_original"] if s["monto_original"] is not None else s["precio_venta_soles"]
            tc_g         = s["tipo_cambio"]
        else:
            label_moneda = "S/"
            monto_o      = s["precio_venta_soles"]
            tc_g         = 1.00

        if s["tipo_documento"] in ["Nota de Crédito", "NC"]:
            precio_venta   = -abs(s["precio_venta"] or 0)
            base_imponible = -abs(s["base_imponible"] or 0)
            igv            = -abs(s["igv"] or 0)
        else:
            precio_venta   = s["precio_venta"] or 0
            base_imponible = s["base_imponible"] or 0
            igv            = s["igv"] or 0

        ws.append([
            s["tipo_documento"],
            s["numero_documento"] or "—",
            s["cliente_nombre"],
            s["ruc_cliente"] or "—",
            s["tipo_servicio"] or "—",
            label_moneda,
            monto_o,
            tc_g,
            base_imponible,
            igv,
            precio_venta,
            str(vc.fecha) if vc.fecha else "—",
            s["estado"],
        ])
        if row_idx % 2 == 0:
            for col_idx in range(1, len(HEADERS) + 1):
                ws.cell(row=row_idx, column=col_idx).fill = alt_fill

    ws.freeze_panes = "A2"

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    hoy = date.today().strftime("%Y%m%d")
    filename = f"Comprobantes_{hoy}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/proximo-correlativo")
def proximo_correlativo(tipo: str = "AC", db: Session = Depends(get_db)):
    # OJO: antes de este fix el parámetro "tipo" se ignoraba y siempre
    # devolvía el correlativo AC-, sin importar qué se pidiera.
    if tipo == "RI":
        return {"proximo": _proximo_ri_venta(db)}
    if tipo == "NC":
        return {"proximo": _proximo_correlativo_generico(db, "Nota de Crédito", "NC")}
    if tipo == "ND":
        return {"proximo": _proximo_correlativo_generico(db, "Nota de Débito", "ND")}
    return {"proximo": _proximo_ac(db)}


@router.get("/{comp_id}")
def obtener(comp_id: int, db: Session = Depends(get_db)):
    row = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(VentaComercial.id == comp_id).first()
    if not row:
        raise HTTPException(404, "Comprobante no encontrado")
    return _serialize(row[0], row[1])


@router.get("/{comp_id}/imprimir")
def imprimir(comp_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    row = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(VentaComercial.id == comp_id).first()
    if not row:
        raise HTTPException(404, "Comprobante no encontrado")
    vc, cli = row
    s = _serialize(vc, cli)
    es_sin_igv = s["tipo_documento"] in TIPOS_SIN_IGV

    descripcion_item = s["tipo_servicio"] or "Servicio"
    if s["descripcion"]:
        descripcion_item = f"{descripcion_item} - {s['descripcion']}"

    items = [{
        "cantidad":    1,
        "unidad":      "SERVICIO",
        "codigo":      "",
        "descripcion": descripcion_item,
        "v_unit":      s["precio_venta"] if es_sin_igv else s["base_imponible"],
        "igv":         0 if es_sin_igv else s["igv"],
        "p_unit":      s["precio_venta"],
        "total":       s["precio_venta"],
    }]

    return construir_payload_impresion(
        db, usuario,
        tipo_documento=s["tipo_documento"],
        numero_documento=s["numero_documento"],
        fecha_emision=vc.fecha,
        fecha_vencimiento=vc.fecha_vencimiento,
        moneda=s["moneda"],
        cliente_nombre=s["cliente_nombre"],
        cliente_ruc=s["ruc_cliente"],
        cliente_direccion=cli.direccion if cli else None,
        cliente_label="CLIENTE",
        items=items,
        base_imponible=0 if es_sin_igv else s["base_imponible"],
        igv=0 if es_sin_igv else s["igv"],
        total=s["precio_venta"],
        documento_relacionado=s["documento_relacionado"],
    )


def _nombre_adjunto_comprobante(tipo_documento: str, numero_documento: str) -> str:
    """Construye el nombre del adjunto como '{Tipo}_{numero}.pdf', p.ej.
    'Factura_F001-00023.pdf' o 'NotaCredito_E001-66.pdf'."""
    tipo = (tipo_documento or "Comprobante").replace(" de ", " ")
    tipo = "".join(c for c in unicodedata.normalize("NFKD", tipo) if not unicodedata.combining(c))
    tipo = "".join(tipo.split())
    numero = (numero_documento or "comprobante").strip().replace(" ", "_").replace("/", "-")
    return f"{tipo}_{numero}.pdf"


@router.post("/{comp_id}/enviar-correo", response_model=EnviarComprobanteResponse)
def enviar_correo(comp_id: int, data: EnviarComprobanteRequest, db: Session = Depends(get_db)):
    row = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(VentaComercial.id == comp_id).first()
    if not row:
        raise HTTPException(404, "Comprobante no encontrado")
    vc, cli = row
    s = _serialize(vc, cli)

    empresa_cfg = db.query(ConfiguracionEmpresa).first()
    if not empresa_cfg or not empresa_cfg.smtp_host or not empresa_cfg.smtp_usuario or not empresa_cfg.smtp_password:
        raise HTTPException(400, "Verifique la configuración SMTP en Configuración")

    empresa = get_empresa_header(db)
    asunto = f"Comprobante de pago {s['numero_documento']} – {empresa.get('nombre_empresa') or 'Centryx'}"
    cuerpo_html = construir_cuerpo_html(empresa, s)
    nombre_pdf = _nombre_adjunto_comprobante(s["tipo_documento"], s["numero_documento"])

    # Si el comprobante fue importado desde un PDF original (o tiene uno subido
    # manualmente), se adjunta ese archivo tal cual en vez de regenerar una
    # plantilla — solo se recurre al PDF generado si no hay original en disco.
    pdf_original = Path(vc.comprobante_path) if vc.comprobante_path else None
    if pdf_original and pdf_original.suffix.lower() == ".pdf" and pdf_original.exists():
        pdf_bytes = pdf_original.read_bytes()
    else:
        pdf_bytes = construir_pdf_comprobante(empresa, s)

    try:
        enviar_email_smtp(
            smtp_host=empresa_cfg.smtp_host,
            smtp_port=empresa_cfg.smtp_port or 587,
            smtp_usuario=empresa_cfg.smtp_usuario,
            smtp_password=empresa_cfg.smtp_password,
            from_name=empresa_cfg.smtp_from_name or empresa.get("nombre_empresa") or "Centryx",
            destinatario=data.correo_destino,
            asunto=asunto,
            cuerpo_html=cuerpo_html,
            adjunto_bytes=pdf_bytes,
            adjunto_nombre=nombre_pdf,
        )
    except Exception as e:
        raise HTTPException(500, f"No se pudo enviar el correo: {e}")

    ahora = datetime.now()
    vc.enviado_email = True
    vc.fecha_envio_email = ahora
    vc.email_envio_destino = data.correo_destino
    db.commit()

    return EnviarComprobanteResponse(
        success=True,
        mensaje="Comprobante enviado correctamente",
        enviado_a=data.correo_destino,
        fecha_envio=ahora.strftime("%d/%m/%Y %H:%M"),
    )


@router.put("/{comp_id}")
def actualizar(comp_id: int, data: ComprobanteUpdate, http_request: Request, db: Session = Depends(get_db),
                usuario: Usuario = Depends(get_current_usuario)):
    venta = db.query(VentaComercial).filter(VentaComercial.id == comp_id).first()
    if not venta:
        raise HTTPException(404, "Comprobante no encontrado")

    if data.numero_documento and data.numero_documento != venta.numero_factura:
        if db.query(VentaComercial).filter(
            VentaComercial.numero_factura == data.numero_documento,
            VentaComercial.id != comp_id
        ).first():
            raise HTTPException(400, f"Ya existe un comprobante con el número {data.numero_documento}")

    fields = data.model_dump(exclude_unset=True)
    # Factura/Boleta cambian de precio vía "base_imponible"; Recibo Interno
    # (sin IGV) vía "monto" — ambos deben disparar el recálculo de cobranza
    # de más abajo. Anticipo de Cliente también usa "monto" pero no lleva
    # saldo_pendiente/estado_cobranza (no está en TIPOS_COBRANZA), así que
    # se excluye a propósito.
    precio_cambio = ("base_imponible" in fields and fields["base_imponible"] is not None) or (
        "monto" in fields and fields["monto"] is not None and venta.tipo_documento == "Recibo Interno"
    )
    documento_relacionado_cambio = "documento_relacionado" in fields
    documento_relacionado_anterior = venta.documento_relacionado
    tipo_nc_cambio = "tipo_nota_credito" in fields
    tipo_nota_credito_anterior = venta.tipo_nota_credito
    tipo_nd_cambio = "tipo_nota_debito" in fields
    tipo_nota_debito_anterior = venta.tipo_nota_debito
    if "numero_documento" in fields:
        venta.numero_factura = fields.pop("numero_documento")
    if "base_imponible" in fields:
        base = fields.pop("base_imponible")
        # Para tipos SIN_IGV (Anticipo, Recibo Interno) el frontend manda
        # base_imponible=null explícito (no aplica IGV) — con
        # exclude_unset=True eso SÍ entra en `fields` con valor None, y
        # _igv(None)/_total(None) explotaban (TypeError). El monto real de
        # esos tipos llega por "monto", manejado más abajo.
        if base is not None:
            venta.base_imponible     = base
            venta.igv                = _igv(base)
            venta.precio_venta       = _total(base)
            venta.monto              = venta.precio_venta
            venta.precio_venta_soles = venta.precio_venta
    if "monto" in fields:
        m = fields.pop("monto")
        if m is not None and (venta.tipo_documento or "") in TIPOS_SIN_IGV:
            venta.monto              = round(m, 2)
            venta.precio_venta       = venta.monto
            venta.precio_venta_soles = venta.monto
            if venta.tipo_documento == "Recibo Interno":
                # Mantiene base_imponible = monto tras editar (sin esto queda
                # desincronizada con la del momento de la creación).
                venta.base_imponible = venta.monto
                venta.igv            = 0.0

    # Detracción — se recalcula server-side (monto_detraccion/monto_neto_cobrar),
    # no debe pasar por el setattr genérico de abajo.
    tiene_det_in     = fields.pop("tiene_detraccion", None)
    concepto_det_in  = fields.pop("concepto_detraccion", None)
    tasa_det_in      = fields.pop("tasa_detraccion", None)
    fecha_lim_det_in = fields.pop("fecha_limite_detraccion", None)

    for k, v in fields.items():
        setattr(venta, k, v)

    if tiene_det_in is not None:
        tiene_det, tasa_det, monto_det, monto_neto, fecha_lim_det = _calcular_detraccion(
            venta.tipo_documento, tiene_det_in, tasa_det_in, venta.precio_venta or venta.monto,
            venta.fecha, fecha_lim_det_in,
        )
        venta.tiene_detraccion        = tiene_det
        venta.tasa_detraccion         = tasa_det
        venta.monto_detraccion        = monto_det
        venta.monto_neto_cobrar       = monto_neto
        venta.concepto_detraccion     = concepto_det_in if tiene_det else None
        venta.fecha_limite_detraccion = fecha_lim_det

    # Si cambió el precio de venta de una Factura/Boleta/Recibo Interno,
    # recalcular cobranza (saldo_pendiente / estado_cobranza) en base a lo ya
    # pagado. Recibo Interno no está en TIPOS_COBRANZA (no se le asignan
    # esos campos al crearlo — ver _crear_comprobante) por eso se agrega acá
    # aparte en vez de sumarlo a esa constante compartida, que también
    # controla comportamiento de creación y de Notas de Crédito/Débito.
    if precio_cambio and ((venta.tipo_documento or "") in TIPOS_COBRANZA or venta.tipo_documento == "Recibo Interno"):
        total_pagado = float(db.query(func.sum(PagoCobranza.monto_pagado)).filter(
            PagoCobranza.comprobante_id == comp_id
        ).scalar() or 0)
        nuevo_precio = float(venta.precio_venta or venta.monto or 0)

        if total_pagado > nuevo_precio + 0.01:
            raise HTTPException(
                400,
                f"El nuevo monto no puede ser menor a lo ya cobrado (S/ {total_pagado:,.2f})",
            )

        nuevo_saldo = round(nuevo_precio - total_pagado, 2)
        if nuevo_saldo <= 0.01:
            venta.saldo_pendiente = 0.0
            venta.estado_cobranza = "Pagada"
        elif total_pagado > 0:
            venta.saldo_pendiente = nuevo_saldo
            venta.estado_cobranza = "Pago Parcial"
        else:
            venta.saldo_pendiente = nuevo_precio
            venta.estado_cobranza = "Pendiente"

    # Si se edita manualmente el documento_relacionado o el tipo_nota_credito/
    # tipo_nota_debito de una NC/ND ya vinculada: 1) deshace el efecto
    # anterior sobre la factura que tenía vinculada (_revertir_relacion —
    # reactiva/restaura precio/des-extorna cobros según corresponda), 2)
    # aplica el nuevo escenario/tipo sobre la factura resultante
    # (_aplicar_relacion). Sin esto, la factura anterior quedaría
    # "Anulada"/con el monto alterado para siempre aunque el documento ya no
    # la referencie o haya cambiado de escenario.
    aviso_edit = None
    tipo_cambio_relacion = (
        (tipo_nc_cambio and venta.tipo_documento == "Nota de Crédito") or
        (tipo_nd_cambio and venta.tipo_documento == "Nota de Débito")
    )
    if (documento_relacionado_cambio or tipo_cambio_relacion) and venta.tipo_documento in ("Nota de Crédito", "Nota de Débito"):
        tipo_nc_nuevo = venta.tipo_nota_credito
        tipo_nd_nuevo = venta.tipo_nota_debito
        venta.tipo_nota_credito = tipo_nota_credito_anterior
        venta.tipo_nota_debito  = tipo_nota_debito_anterior
        _revertir_relacion(db, venta, usuario)
        venta.tipo_nota_credito = tipo_nc_nuevo
        venta.tipo_nota_debito  = tipo_nd_nuevo

        if venta.documento_relacionado:
            _validar_tipo_nc(venta.tipo_documento, venta.tipo_nota_credito)
            _validar_tipo_nd(venta.tipo_documento, venta.tipo_nota_debito)
            factura_rel = db.query(VentaComercial).filter(
                VentaComercial.numero_factura == venta.documento_relacionado,
                VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
                VentaComercial.estado != "Anulada",
            ).first()
            if not factura_rel:
                # Misma búsqueda flexible por serie+número que en creación,
                # antes de rechazar por un falso negativo de relleno de ceros.
                m_put = re.match(r'([A-Z]\d{3})-0*(\d+)$', venta.documento_relacionado)
                if m_put:
                    serie_put, numero_put = m_put.group(1), m_put.group(2)
                    factura_rel = db.query(VentaComercial).filter(
                        VentaComercial.numero_factura.ilike(f"%{serie_put}%{numero_put}"),
                        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
                        VentaComercial.estado != "Anulada",
                    ).first()
            if not factura_rel:
                raise HTTPException(404,
                    f"No se encontró la factura {venta.documento_relacionado}. "
                    "Verifica el número de documento relacionado."
                )
            aviso_edit = _aplicar_relacion(db, venta, factura_rel, usuario)

    venta.modificado_por = usuario.nombre
    venta.modificado_en  = datetime.utcnow()

    db.commit()
    db.refresh(venta)

    registrar_log(
        db, usuario.id, usuario.nombre, "ventas", "Editó comprobante",
        f"Editó comprobante {venta.numero_factura}", ip_de(http_request),
    )

    cli = db.query(Cliente).filter(Cliente.id == venta.cliente_id).first() if venta.cliente_id else None
    result = _serialize(venta, cli)
    result["aviso"] = aviso_edit
    return result


class EliminarMasivoRequest(BaseModel):
    ids: List[int]


@router.delete("/eliminar-masivo")
def eliminar_comprobantes_masivo(data: EliminarMasivoRequest, http_request: Request,
                                  db: Session = Depends(get_db),
                                  usuario: Usuario = Depends(get_current_usuario)):
    """Elimina varios comprobantes a la vez, respetando las mismas foreign
    keys que /{comp_id}/eliminar-cascada (pagos_cobranza, movimientos de
    conciliación y reactivación de factura anulada por Nota de Crédito)."""
    resultados = []
    for comp_id in data.ids:
        venta = db.query(VentaComercial).filter(VentaComercial.id == comp_id).first()
        if not venta:
            resultados.append({"id": comp_id, "exito": False, "error": "Comprobante no encontrado"})
            continue

        try:
            factura_reactivada = None
            if venta.tipo_documento in ("Nota de Crédito", "Nota de Débito") and venta.comprobante_relacionado_id:
                factura_ref = db.query(VentaComercial).filter(
                    VentaComercial.id == venta.comprobante_relacionado_id
                ).first()
                factura_reactivada = factura_ref.numero_factura if factura_ref else None
                _revertir_relacion(db, venta, usuario)

            pagos = db.query(PagoCobranza).filter(PagoCobranza.comprobante_id == comp_id).all()
            for pago in pagos:
                revertir_cobro_garantia(db, pago)
                movs = db.query(MovimientoConciliacion).filter(
                    MovimientoConciliacion.referencia_sistema_tipo == "cobranza",
                    MovimientoConciliacion.referencia_sistema_id == pago.id,
                ).all()
                for m in movs:
                    if m.origen == "banco":
                        m.conciliado              = False
                        m.referencia_sistema_id   = None
                        m.referencia_sistema_tipo = None
                    else:
                        db.delete(m)
                db.delete(pago)
            db.query(PagoGarantia).filter(PagoGarantia.venta_id == comp_id).update({"venta_id": None})
            db.flush()

            numero_documento = venta.numero_factura
            db.delete(venta)
            db.commit()

            registrar_log(
                db, usuario.id, usuario.nombre, "ventas", "Eliminó comprobante",
                f"Eliminó comprobante {numero_documento} (eliminación masiva)", ip_de(http_request),
            )
            resultados.append({
                "id": comp_id, "exito": True,
                "numero_documento": numero_documento,
                "factura_reactivada": factura_reactivada,
            })
        except IntegrityError as e:
            db.rollback()
            resultados.append({"id": comp_id, "exito": False, "error": f"No se puede eliminar: {str(e)}"})

    exitosos = sum(1 for r in resultados if r["exito"])
    return {"total": len(data.ids), "exitosos": exitosos, "resultados": resultados}


@router.delete("/{comp_id}")
def eliminar(comp_id: int, http_request: Request, db: Session = Depends(get_db),
             usuario: Usuario = Depends(get_current_usuario)):
    venta = db.query(VentaComercial).filter(VentaComercial.id == comp_id).first()
    if not venta:
        raise HTTPException(404, "Comprobante no encontrado")

    factura_reactivada = None
    if venta.tipo_documento in ("Nota de Crédito", "Nota de Débito") and venta.comprobante_relacionado_id:
        factura_ref = db.query(VentaComercial).filter(
            VentaComercial.id == venta.comprobante_relacionado_id
        ).first()
        if factura_ref:
            factura_reactivada = factura_ref.numero_factura
            _revertir_relacion(db, venta, usuario)
            registrar_log(
                db, usuario.id, usuario.nombre, "ventas", "Reactivó comprobante",
                f"Reactivó/restauró el comprobante {factura_ref.numero_factura} al eliminar "
                f"el documento {venta.numero_factura} ({venta.tipo_documento}) que lo afectaba",
                ip_de(http_request),
            )

    # Si el comprobante tiene cobros que vinieron de ejecutar una garantía (o
    # de un crédito generado por una), hay que devolverles el monto antes de
    # que el cascade de venta.pagos los borre — si no, la garantía se queda
    # creyendo que sigue aplicada a un documento que ya no existe.
    garantias_revertidas = []
    for cobro in db.query(PagoCobranza).filter(PagoCobranza.comprobante_id == comp_id).all():
        detalle = revertir_cobro_garantia(db, cobro)
        if detalle:
            garantias_revertidas.append(detalle)
    # PagoGarantia.venta_id (historial de a qué documento se aplicó cada
    # ejecución) tiene FK a ventas_comercial — sin desvincularlo acá, el
    # DELETE de más abajo revienta con ForeignKeyViolation. Se conserva la
    # fila (es el historial de la garantía) y solo se limpia la referencia;
    # numero_documento_generado ya guarda el número como texto plano.
    db.query(PagoGarantia).filter(PagoGarantia.venta_id == comp_id).update({"venta_id": None})

    numero_eliminado = venta.numero_factura
    db.delete(venta)
    db.commit()

    registrar_log(
        db, usuario.id, usuario.nombre, "ventas", "Eliminó comprobante",
        f"Eliminó comprobante {numero_eliminado}"
        + (f" — {', '.join(garantias_revertidas)}" if garantias_revertidas else ""),
        ip_de(http_request),
    )

    return {"mensaje": "Comprobante eliminado", "factura_reactivada": factura_reactivada}


@router.get("/{comp_id}/eliminar-cascada/preview")
def eliminar_cascada_preview(comp_id: int, db: Session = Depends(get_db)):
    """Detecta todo lo vinculado a un comprobante (pagos en pagos_cobranza y,
    para cada pago, si está conciliado en una conciliación bancaria) para
    mostrarlo en el asistente de eliminación en cascada."""
    row = db.query(VentaComercial, Cliente).outerjoin(
        Cliente, VentaComercial.cliente_id == Cliente.id
    ).filter(VentaComercial.id == comp_id).first()
    if not row:
        raise HTTPException(404, "Comprobante no encontrado")
    vc, cli = row

    pagos = db.query(PagoCobranza).filter(PagoCobranza.comprobante_id == comp_id).all()
    pagos_info = []
    for p in pagos:
        mov = db.query(MovimientoConciliacion).filter(
            MovimientoConciliacion.referencia_sistema_tipo == "cobranza",
            MovimientoConciliacion.referencia_sistema_id == p.id,
            MovimientoConciliacion.conciliado == True,
        ).first()
        conciliacion_label = None
        if mov:
            conc = db.query(ConciliacionBancaria).filter(
                ConciliacionBancaria.id == mov.conciliacion_id
            ).first()
            if conc:
                mes = MESES_ES_LOWER.get(conc.periodo_desde.month, "")
                conciliacion_label = f"conciliación {mes} {conc.periodo_desde.year}"
        pagos_info.append({
            "id":                 p.id,
            "monto_pagado":       round(float(p.monto_pagado), 2),
            "fecha_pago":         str(p.fecha_pago),
            "conciliado":         bool(mov),
            "conciliacion_label": conciliacion_label,
        })

    return {
        "id":               vc.id,
        "numero_documento": vc.numero_factura,
        "cliente_nombre":   (cli.razon_social if cli else None) or vc.razon_social_cliente or "—",
        "precio_venta":     vc.precio_venta or vc.monto,
        "pagos":            pagos_info,
    }


@router.delete("/{comp_id}/eliminar-cascada")
def eliminar_cascada(comp_id: int, http_request: Request, db: Session = Depends(get_db),
                      usuario: Usuario = Depends(get_current_usuario)):
    """Elimina un comprobante y todo lo vinculado:
    - Movimientos de conciliación con origen='sistema' que referencian el pago
      son un simple reflejo del pago en la conciliación (se insertan en
      confirmar_conciliacion) — al desaparecer el pago no representan nada, así
      que se ELIMINAN (desconciliarlos los dejaría huérfanos, ver bug previo).
    - Movimientos con origen='banco' SON el extracto bancario real (vino del
      archivo importado): esa plata sí se movió, por lo que NUNCA se eliminan.
      Si estaban conciliados, solo se desconcilian y vuelven a "Solo en Banco".
    - Se eliminan sus pagos en pagos_cobranza y por último el comprobante.
    """
    venta = db.query(VentaComercial).filter(VentaComercial.id == comp_id).first()
    if not venta:
        raise HTTPException(404, "Comprobante no encontrado")

    pagos = db.query(PagoCobranza).filter(PagoCobranza.comprobante_id == comp_id).all()
    movimientos_eliminados     = 0
    movimientos_desconciliados = 0
    garantias_revertidas       = []
    for pago in pagos:
        detalle = revertir_cobro_garantia(db, pago)
        if detalle:
            garantias_revertidas.append(detalle)
        movs = db.query(MovimientoConciliacion).filter(
            MovimientoConciliacion.referencia_sistema_tipo == "cobranza",
            MovimientoConciliacion.referencia_sistema_id == pago.id,
        ).all()
        for m in movs:
            if m.origen == "banco":
                m.conciliado              = False
                m.referencia_sistema_id   = None
                m.referencia_sistema_tipo = None
                movimientos_desconciliados += 1
            else:
                db.delete(m)
                movimientos_eliminados += 1
        db.delete(pago)
    db.query(PagoGarantia).filter(PagoGarantia.venta_id == comp_id).update({"venta_id": None})
    db.flush()

    numero_documento = venta.numero_factura
    db.delete(venta)
    db.commit()

    registrar_log(
        db, usuario.id, usuario.nombre, "ventas", "Eliminó comprobante",
        f"Eliminó comprobante {numero_documento} y cobros asociados"
        + (f" — {', '.join(garantias_revertidas)}" if garantias_revertidas else ""),
        ip_de(http_request),
    )

    return {
        "mensaje":                     f"Comprobante {numero_documento} eliminado correctamente",
        "pagos_eliminados":            len(pagos),
        "movimientos_eliminados":      movimientos_eliminados,
        "movimientos_desconciliados":  movimientos_desconciliados,
    }
