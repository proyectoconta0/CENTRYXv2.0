import io
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.models.comercial import VentaComercial
from app.models.models import Gasto, DetraccionLote, LoteDetraccion, LoteDetraccionDetalle, Proveedor
from app.services.empresa_header import get_empresa_header
from database import get_db

router = APIRouter()


def _estado_detraccion(fecha_limite: Optional[date]) -> dict:
    if not fecha_limite:
        return {"semaforo": "sin_fecha", "estado": "Sin fecha límite"}
    dias = (fecha_limite - date.today()).days
    if dias < 0:
        return {"semaforo": "rojo", "estado": f"Vencido hace {abs(dias)} día(s)"}
    elif dias < 3:
        return {"semaforo": "rojo", "estado": f"Vence en {dias} día(s)"}
    elif dias <= 7:
        return {"semaforo": "amarillo", "estado": f"Vence en {dias} día(s)"}
    else:
        return {"semaforo": "verde", "estado": f"Vence en {dias} día(s)"}


def _query_ventas_pendientes(db: Session, periodo_mes: Optional[int], periodo_anio: Optional[int]):
    q = db.query(VentaComercial).filter(
        VentaComercial.tipo_documento == "Factura",
        VentaComercial.tiene_detraccion.is_(True),
        VentaComercial.detraccion_pagada.is_(False),
    )
    if periodo_mes:
        q = q.filter(extract("month", VentaComercial.fecha) == periodo_mes)
    if periodo_anio:
        q = q.filter(extract("year", VentaComercial.fecha) == periodo_anio)
    return q.all()


def _query_gastos_pendientes(db: Session, periodo_mes: Optional[int], periodo_anio: Optional[int]):
    q = db.query(Gasto).filter(
        Gasto.tipo_comprobante == "Factura",
        Gasto.tiene_detraccion.is_(True),
        Gasto.detraccion_depositada.is_(False),
    )
    if periodo_mes:
        q = q.filter(extract("month", Gasto.fecha) == periodo_mes)
    if periodo_anio:
        q = q.filter(extract("year", Gasto.fecha) == periodo_anio)
    return q.all()


@router.get("/pendientes")
def listar_pendientes(
    periodo_mes:  Optional[int] = None,
    periodo_anio: Optional[int] = None,
    db: Session = Depends(get_db),
):
    filas = []

    for v in _query_ventas_pendientes(db, periodo_mes, periodo_anio):
        filas.append({
            "id":               f"v{v.id}",
            "tipo":             "Venta",
            "fecha":            str(v.fecha) if v.fecha else None,
            "ruc":              v.ruc_cliente or "",
            "nombre":           v.razon_social_cliente or "",
            "concepto":         v.concepto_detraccion or "",
            "base":             round(float(v.base_imponible or 0), 2),
            "tasa":             round(float(v.tasa_detraccion or 0), 2),
            "monto_detraccion": round(float(v.monto_detraccion or 0), 2),
            "numero_documento": v.numero_factura or "",
            "fecha_limite":     str(v.fecha_limite_detraccion) if v.fecha_limite_detraccion else None,
            **_estado_detraccion(v.fecha_limite_detraccion),
        })

    for g in _query_gastos_pendientes(db, periodo_mes, periodo_anio):
        filas.append({
            "id":               f"g{g.id}",
            "tipo":             "Compra",
            "fecha":            str(g.fecha) if g.fecha else None,
            "ruc":              g.numero_documento or "",
            "nombre":           g.proveedor or "",
            "concepto":         g.concepto_detraccion or "",
            "base":             round(float(g.base_imponible or 0), 2),
            "tasa":             round(float(g.tasa_detraccion or 0), 2),
            "monto_detraccion": round(float(g.monto_detraccion or 0), 2),
            "numero_documento": g.numero_comprobante or "",
            "fecha_limite":     str(g.fecha_limite_detraccion) if g.fecha_limite_detraccion else None,
            **_estado_detraccion(g.fecha_limite_detraccion),
        })

    filas.sort(key=lambda f: f["fecha_limite"] or "9999-99-99")
    return {"total": len(filas), "data": filas}


@router.get("/resumen-kpis")
def resumen_kpis(db: Session = Depends(get_db)):
    hoy       = date.today()
    en_3_dias = hoy + timedelta(days=3)

    ventas = _query_ventas_pendientes(db, None, None)
    gastos = _query_gastos_pendientes(db, None, None)
    todas  = list(ventas) + list(gastos)

    total_pendiente = sum(float(r.monto_detraccion or 0) for r in todas)
    por_vencer = vencidas = 0.0
    for r in todas:
        fl = r.fecha_limite_detraccion
        if not fl:
            continue
        monto = float(r.monto_detraccion or 0)
        if fl < hoy:
            vencidas += monto
        elif fl <= en_3_dias:
            por_vencer += monto

    return {
        "total_pendiente":    round(total_pendiente, 2),
        "por_vencer_3_dias":  round(por_vencer, 2),
        "vencidas":           round(vencidas, 2),
        "cantidad_pendiente": len(todas),
    }


# ── Lotes de Detracciones Por Pagar (carrito manual) ────────────────────────
# Distinto del historial automático `DetraccionLote` usado por /generar-txt:
# aquí el usuario crea el lote vacío primero y va agregando/quitando Gastos
# con detracción pendiente antes de pagarlos y recién ahí generar el TXT
# para ese lote puntual. Solo aplica a Gastos (Compras) — igual que el TXT,
# las detracciones de Ventas no participan de este flujo.

class AgregarGastosBody(BaseModel):
    gasto_ids: List[int]


def _serializar_gasto_lote(g: Gasto) -> dict:
    return {
        "id":                   g.id,
        "fecha":                str(g.fecha) if g.fecha else None,
        "ruc":                  g.numero_documento or "",
        "nombre":               g.proveedor or "",
        "concepto":             g.concepto_detraccion or "",
        "base":                 round(float(g.base_imponible or 0), 2),
        "tasa":                 round(float(g.tasa_detraccion or 0), 2),
        "monto_detraccion":     round(float(g.monto_detraccion or 0), 2),
        "numero_documento":     g.numero_comprobante or "",
        "fecha_limite":         str(g.fecha_limite_detraccion) if g.fecha_limite_detraccion else None,
        "detraccion_depositada": bool(g.detraccion_depositada),
        "saldo_pendiente":      round(float(g.saldo_pendiente if g.saldo_pendiente is not None else (g.monto or 0)), 2),
        "monto":                round(float(g.monto or 0), 2),
        **_estado_detraccion(g.fecha_limite_detraccion),
    }


def _serializar_lote(lote: LoteDetraccion) -> dict:
    return {
        "id":                 lote.id,
        "numero_lote":        lote.numero_lote,
        "fecha":              str(lote.fecha) if lote.fecha else None,
        "importe_total":      round(float(lote.importe_total or 0), 2),
        "estado":             lote.estado,
        "cantidad":           len(lote.detalles),
        "fecha_pago":         str(lote.fecha_pago) if lote.fecha_pago else None,
        "metodo_pago":        lote.metodo_pago,
        "numero_operacion":   lote.numero_operacion,
        "banco":              lote.banco,
        "numero_cuenta":      lote.numero_cuenta,
    }


def _recalcular_importe_lote(lote: LoteDetraccion) -> None:
    lote.importe_total = round(
        sum(float(d.gasto.monto_detraccion or 0) for d in lote.detalles if d.gasto), 2
    )


def _siguiente_numero_lote_carrito(db: Session) -> str:
    lotes = db.query(LoteDetraccion.numero_lote).all()
    maximo = 0
    for (numero,) in lotes:
        try:
            maximo = max(maximo, int(numero))
        except (TypeError, ValueError):
            continue
    return str(maximo + 1).zfill(4)


@router.get("/lotes")
def listar_lotes(db: Session = Depends(get_db)):
    lotes = db.query(LoteDetraccion).order_by(LoteDetraccion.numero_lote.desc()).all()
    return [_serializar_lote(l) for l in lotes]


@router.post("/lotes")
def crear_lote(db: Session = Depends(get_db)):
    lote = LoteDetraccion(
        numero_lote=_siguiente_numero_lote_carrito(db),
        fecha=date.today(),
        importe_total=0,
        estado="pendiente",
        created_at=date.today(),
    )
    db.add(lote)
    db.commit()
    db.refresh(lote)
    return _serializar_lote(lote)


@router.get("/lotes/{lote_id}")
def detalle_lote(lote_id: int, db: Session = Depends(get_db)):
    lote = db.query(LoteDetraccion).filter(LoteDetraccion.id == lote_id).first()
    if not lote:
        raise HTTPException(404, "Lote no encontrado")

    ids_en_lotes = {
        d.gasto_id for d in db.query(LoteDetraccionDetalle).all() if d.gasto_id is not None
    }

    disponibles = [
        _serializar_gasto_lote(g)
        for g in _query_gastos_pendientes(db, None, None)
        if g.id not in ids_en_lotes
    ]
    detalle = [_serializar_gasto_lote(d.gasto) for d in lote.detalles if d.gasto]

    return {**_serializar_lote(lote), "disponibles": disponibles, "detalle": detalle}


@router.post("/lotes/{lote_id}/agregar-gastos")
def agregar_gastos_lote(lote_id: int, body: AgregarGastosBody, db: Session = Depends(get_db)):
    lote = db.query(LoteDetraccion).filter(LoteDetraccion.id == lote_id).first()
    if not lote:
        raise HTTPException(404, "Lote no encontrado")

    ya_en_este_lote = {d.gasto_id for d in lote.detalles}
    ya_en_otro_lote = {
        d.gasto_id for d in db.query(LoteDetraccionDetalle)
        .filter(LoteDetraccionDetalle.lote_id != lote_id).all()
    }

    for gasto_id in body.gasto_ids:
        if gasto_id in ya_en_este_lote or gasto_id in ya_en_otro_lote:
            continue
        gasto = db.query(Gasto).filter(Gasto.id == gasto_id).first()
        if not gasto:
            continue
        db.add(LoteDetraccionDetalle(lote_id=lote_id, gasto_id=gasto_id))

    db.flush()
    db.refresh(lote)
    _recalcular_importe_lote(lote)
    db.commit()
    db.refresh(lote)
    return _serializar_lote(lote)


class PagarLoteBody(BaseModel):
    fecha_pago:       date
    metodo_pago:      str
    numero_operacion: Optional[str] = None
    banco:            Optional[str] = None
    numero_cuenta:    Optional[str] = None


@router.put("/lotes/{lote_id}/marcar-pagado")
def marcar_lote_pagado(lote_id: int, data: PagarLoteBody, db: Session = Depends(get_db)):
    """Pago consolidado del lote: UN solo registro (los campos de pago del
    propio LoteDetraccion), no un PagoGasto por factura. Marca
    detraccion_depositada=True en todas las facturas del lote de una sola
    vez y NO toca saldo_pendiente/estado_pago de cada Gasto — pagar la
    detracción es distinto de pagar la factura al proveedor."""
    lote = db.query(LoteDetraccion).filter(LoteDetraccion.id == lote_id).first()
    if not lote:
        raise HTTPException(404, "Lote no encontrado")
    if lote.estado == "pagado":
        raise HTTPException(400, "Este lote ya fue pagado")
    if not lote.detalles:
        raise HTTPException(400, "El lote no tiene facturas para pagar")

    lote.estado            = "pagado"
    lote.fecha_pago         = data.fecha_pago
    lote.metodo_pago        = data.metodo_pago
    lote.numero_operacion   = data.numero_operacion or None
    lote.banco              = data.banco or None
    lote.numero_cuenta      = data.numero_cuenta or None
    for d in lote.detalles:
        if d.gasto:
            d.gasto.detraccion_depositada = True
    db.commit()
    db.refresh(lote)
    return _serializar_lote(lote)


@router.delete("/lotes/{lote_id}/pago")
def revertir_pago_lote(lote_id: int, db: Session = Depends(get_db)):
    """Revierte el pago consolidado: el lote vuelve a 'pendiente' y sus
    facturas vuelven a aparecer como pendientes de depósito. No borra el
    lote ni sus facturas agrupadas, solo el estado de pago."""
    lote = db.query(LoteDetraccion).filter(LoteDetraccion.id == lote_id).first()
    if not lote:
        raise HTTPException(404, "Lote no encontrado")
    if lote.estado != "pagado":
        raise HTTPException(400, "Este lote no está pagado")

    lote.estado            = "pendiente"
    lote.fecha_pago         = None
    lote.metodo_pago        = None
    lote.numero_operacion   = None
    lote.banco              = None
    lote.numero_cuenta      = None
    for d in lote.detalles:
        if d.gasto:
            d.gasto.detraccion_depositada = False
    db.commit()
    db.refresh(lote)
    return _serializar_lote(lote)


@router.delete("/lotes/{lote_id}/gastos/{gasto_id}")
def quitar_gasto_lote(lote_id: int, gasto_id: int, db: Session = Depends(get_db)):
    lote = db.query(LoteDetraccion).filter(LoteDetraccion.id == lote_id).first()
    if not lote:
        raise HTTPException(404, "Lote no encontrado")

    detalle = db.query(LoteDetraccionDetalle).filter(
        LoteDetraccionDetalle.lote_id == lote_id,
        LoteDetraccionDetalle.gasto_id == gasto_id,
    ).first()
    if detalle:
        db.delete(detalle)
        db.flush()
        db.refresh(lote)
        _recalcular_importe_lote(lote)
        db.commit()
        db.refresh(lote)
    return _serializar_lote(lote)


# ── Generador TXT — formato Banco de la Nación, CASO 1 ──────────────────────
# "Adquiriente con múltiples proveedores": nosotros somos el adquiriente que
# deposita detracciones de nuestras COMPRAS (Gasto). Las detracciones de
# VENTAS (donde el cliente nos retiene a nosotros) no aplican a este formato
# — el depositante ahí es el cliente, con su propio archivo.
#
# NOTA DE IMPLEMENTACIÓN: los bloques de ejemplo (líneas literales) provistos
# originalmente en la especificación no coincidían en longitud con los anchos
# de campo declarados explícitamente (68 bytes línea 1 / 107 bytes línea
# detalle). Esta implementación sigue el MAPA DE POSICIONES aritméticamente
# consistente, con una corrección aplicada tras un rechazo real del Banco de
# la Nación ("tipo de documento: 2 no válido — reconocidos 1 ó 6"): se agregó
# el campo "Tipo de Documento" (pos 68, ausente en la especificación
# original) y se recortó "N° documento adicional" en 1 byte para compensar:
# 11(RUC)+2(mes)+4(año)+18(N°comp.)+18(serie)+14(base)+1(tipo doc)+2(bien/serv)
# +14(detracción)+8(fecha)+3(período)+12(doc. adicional) = 107.
# La línea de encabezado también se corrigió: el ancho Nombre/Monto se había
# inferido como 35/15 (solo la suma, 50, era derivable de "68 bytes total");
# un ejemplo real de producción descompuso limpiamente con 30/20 en cambio
# (ver LEN_NOMBRE_ADQUIR/LEN_MONTO_CABECERA más abajo) — cambio hecho el
# 2026-07-21. Con 30/20, SUNAT sigue rechazando el archivo: "Línea de
# cabecera incorrecta. El número de lote no coincide con el del nombre del
# archivo". 2026-07-22: se vuelve a 35/15 como PRUEBA sin fuente oficial
# confirmada (no hay validador ni documento de posiciones a la mano) — si
# SUNAT lo sigue rechazando, ninguno de los dos anchos es el correcto y hay
# que conseguir el mapa de posiciones oficial en vez de seguir probando por
# ensayo y error.
# Antes de usar en producción, validar el archivo generado contra el
# validador oficial del Banco de la Nación / SUNAT.

LEN_RUC            = 11
LEN_NOMBRE_ADQUIR  = 35   # 2026-07-22: revertido a 35 como prueba sin fuente oficial (ver nota
LEN_LOTE           = 6    # arriba). El 2026-07-21 se había cambiado a 30 porque, con 35, un
LEN_MONTO_CABECERA = 15   # ejemplo real de producción mostraba el nombre cortado a mitad de
                           # palabra y dígitos del lote "sangrando" dentro del campo nombre.

# Códigos de bien/servicio: la tabla de la especificación lista "012/019/022/037"
# (3 caracteres) pero el mapa de posiciones fija el campo en 2 dígitos (pos 68-69).
# Se interpreta el 0 inicial como relleno de la tabla de referencia, no parte
# del código real (12/19/22/37) — mapeo best-effort desde nuestros conceptos
# de detracción (TASAS_DETRACCION en Gastos.jsx) a esas 4 categorías conocidas;
# los conceptos sin código explícito en la especificación caen en "37" (Demás
# servicios gravados) como default razonable.
CODIGO_BIEN_SERVICIO = {
    "Alquiler de bienes muebles":       "12",
    "Transporte de bienes":             "19",
    "Demás servicios gravados con IGV": "22",
    "Otros servicios empresariales":    "37",
    "Mantenimiento y reparación":       "37",
    "Construcción":                     "37",
    "Contratos de construcción":        "37",
    "Otro":                             "37",
}


def _solo_digitos(valor: Optional[str]) -> str:
    return "".join(c for c in (valor or "") if c.isdigit())


def _pad_izq(valor: Optional[str], ancho: int, relleno: str = "0") -> str:
    valor = (valor or "")[:ancho]
    return valor.rjust(ancho, relleno)


def _pad_der(valor: Optional[str], ancho: int) -> str:
    valor = (valor or "")[:ancho]
    return valor.ljust(ancho, " ")


def _centavos(monto: Optional[float]) -> str:
    return str(int(round(float(monto or 0) * 100)))


def _partir_serie_correlativo(numero_documento: Optional[str]):
    """'F001-00023' -> ('F001', '00023'); sin guion -> ('', numero_documento)."""
    nd = (numero_documento or "").strip()
    if "-" in nd:
        serie, correlativo = nd.split("-", 1)
        return serie, correlativo
    return "", nd


def _codigo_bien_servicio(concepto: Optional[str]) -> str:
    return CODIGO_BIEN_SERVICIO.get(concepto or "", "37")


# El Banco de la Nación rechazó un archivo real con "El tipo de documento: 2
# no es válido. Los tipos reconocidos son 1 ó 6" — la especificación original
# no traía un campo "Tipo de Documento" explícito en el mapa de posiciones.
# Se agrega en la posición 68 (1 byte), inmediatamente después del monto base
# y antes del código de bien/servicio, y se compensa el byte adicional
# recortando "N° documento adicional" (el único campo sin definición real en
# la especificación, ya vacío) de 13 a 12 bytes — el total se mantiene en 107.
#
# Coincidencia defensiva de variantes: hoy Gasto.tipo_comprobante solo puede
# ser uno de los valores fijos del selector en Gastos.jsx (nunca "Boleta de
# Venta" — ese tipo no existe como opción para Gastos), por lo que en la
# práctica esta función siempre devuelve "1". Se acepta un match flexible
# igual, por si se agregan variantes o se reutiliza esta función en otro
# contexto en el futuro.
_TIPOS_BOLETA = {"boleta de venta", "boleta", "b"}


def _tipo_documento_txt(tipo_comprobante: Optional[str]) -> str:
    valor = (tipo_comprobante or "").strip().lower()
    if valor in _TIPOS_BOLETA:
        return "03"
    return "01"  # Factura, y cualquier otro valor no reconocido, por defecto


def _linea_detalle(g: Gasto, db: Session) -> str:
    """107 bytes, posiciones 1-107.

    Reestructurada 2026-07-22: RUC/cuenta del proveedor en vez de mes/año/N°
    comprobante en los primeros bytes. tipo_doc_comprobante (col09, "01"
    Factura / "03" Boleta) se conserva porque el Banco de la Nación rechazó
    un archivo real por no traer el campo "tipo de documento"; ver
    _tipo_documento_txt().

    Mapa: 1+11+44+3+11+15+2+6+2+12 = 107.
    """
    from app.models.models import Proveedor

    # col01: Tipo doc proveedor (1 byte) = "6"
    col01 = "6"

    # col02: RUC proveedor (11 bytes)
    col02 = _pad_izq(_solo_digitos(g.numero_documento), 11)

    # col03: Espacios vacíos (44 bytes)
    col03 = " " * 44

    # col04: Código detracción (3 bytes)
    col04 = (g.codigo_detraccion or "037").strip().zfill(3)[-3:]

    # col05: Número cuenta proveedor (11 bytes)
    proveedor = db.query(Proveedor).filter(
        Proveedor.numero_documento == _solo_digitos(g.numero_documento)
    ).first()
    col05 = _pad_izq(proveedor.numero_cuenta or "", 11) if proveedor else _pad_izq("", 11)

    # col06: Importe detracción (15 bytes, incluye 2 decimales sin punto)
    monto_centavos = int(round(float(g.monto_detraccion or 0) * 100))
    col06 = _pad_izq(str(monto_centavos), 15)

    # col07: Tipo operación siempre "01" (2 bytes)
    col07 = "01"

    # col08: Período YYYYMM (6 bytes)
    col08 = g.fecha.strftime("%Y%m") if g.fecha else "000000"

    # col09: Tipo comprobante (2 bytes) — 01 Factura / 03 Boleta
    col09 = _tipo_documento_txt(g.tipo_comprobante)

    # col10: Número de factura (12 bytes) — serie(4) + correlativo(8)
    if g.numero_comprobante and "-" in g.numero_comprobante:
        serie = g.numero_comprobante.split("-")[0]
        numero = g.numero_comprobante.split("-")[1]
    else:
        serie = ""
        numero = g.numero_comprobante or ""
    col10 = _pad_der(serie[:4], 4) + _pad_izq(numero[-8:], 8)

    linea = col01+col02+col03+col04+col05+col06+col07+col08+col09+col10
    assert len(linea) == 107, f"Línea con {len(linea)} bytes (esperados 107)"
    return linea


def _linea_encabezado(ruc_empresa: str, nombre_empresa: str, numero_lote: int, monto_total: float) -> str:
    """68 bytes: * + RUC(11) + Nombre(30) + Lote(6) + Monto en céntimos(20)."""
    ruc    = _pad_izq(_solo_digitos(ruc_empresa), LEN_RUC)
    nombre = _pad_der((nombre_empresa or "").upper(), LEN_NOMBRE_ADQUIR)
    lote   = _pad_izq(str(numero_lote), LEN_LOTE)
    monto  = _pad_izq(_centavos(monto_total), LEN_MONTO_CABECERA)
    linea  = f"*{ruc}{nombre}{lote}{monto}"
    assert len(linea) == 68, f"Línea de encabezado con {len(linea)} bytes (se esperaban 68)"
    return linea


def _siguiente_numero_lote(db: Session) -> int:
    ultimo = db.query(func.max(DetraccionLote.numero_lote)).scalar()
    return (ultimo or 0) + 1


@router.get("/generar-txt")
def generar_txt(
    ids: str = "",
    db: Session = Depends(get_db),
):
    if not ids:
        raise HTTPException(400, "Debe seleccionar al menos una detracción")

    ids_gasto = []
    hay_ventas_excluidas = False
    for token in ids.split(","):
        token = token.strip()
        if not token:
            continue
        if token.startswith("g"):
            ids_gasto.append(int(token[1:]))
        elif token.startswith("v"):
            hay_ventas_excluidas = True

    if not ids_gasto:
        raise HTTPException(
            400,
            "El archivo TXT del Banco de la Nación (Caso 1) solo aplica a detracciones de "
            "Compras (Gastos), donde usted es el adquiriente que debe depositar. Las "
            "detracciones de Ventas no generan este archivo.",
        )

    gastos = db.query(Gasto).filter(Gasto.id.in_(ids_gasto)).order_by(Gasto.fecha.asc()).all()
    if not gastos:
        raise HTTPException(404, "No se encontraron detracciones para los IDs indicados")

    empresa        = get_empresa_header(db)
    ruc_empresa    = empresa.get("ruc") or ""
    nombre_empresa = empresa.get("nombre_empresa") or ""
    if not _solo_digitos(ruc_empresa):
        raise HTTPException(400, "Configure el RUC de la empresa en Configuración antes de generar el archivo")

    monto_total  = sum(float(g.monto_detraccion or 0) for g in gastos)
    numero_lote  = _siguiente_numero_lote(db)

    # Validación explícita por línea: si algún campo produce un ancho
    # incorrecto, identificar exactamente cuál registro y cuántos bytes tiene
    # en vez de dejar que un AssertionError genérico tumbe la petición.
    try:
        linea1 = _linea_encabezado(ruc_empresa, nombre_empresa, numero_lote, monto_total)
    except AssertionError as e:
        raise HTTPException(500, f"Error de formato en la línea de encabezado: {e}")

    detalle = []
    for g in gastos:
        try:
            detalle.append(_linea_detalle(g, db))
        except AssertionError as e:
            raise HTTPException(
                500,
                f"Error de formato en la detracción del Gasto #{g.id} "
                f"({g.numero_comprobante or 'sin N° comprobante'}): {e}",
            )

    contenido = linea1 + "\n" + "\n".join(detalle)

    fname = f"D{_pad_izq(_solo_digitos(ruc_empresa), LEN_RUC)}{_pad_izq(str(numero_lote), LEN_LOTE)}.TXT"

    db.add(DetraccionLote(
        numero_lote=numero_lote,
        fecha=date.today(),
        monto_total=round(monto_total, 2),
        archivo_generado=fname,
        created_at=date.today(),
    ))
    db.commit()

    return StreamingResponse(
        io.BytesIO(contenido.encode("utf-8")),
        media_type="text/plain",
        headers={
            "Content-Disposition": f"attachment; filename={fname}",
            "X-Ventas-Excluidas":  "true" if hay_ventas_excluidas else "false",
        },
    )


@router.get("/lotes/{lote_id}/generar-txt")
def generar_txt_lote(lote_id: int, db: Session = Depends(get_db)):
    """Igual formato que /generar-txt, pero acotado a los Gastos de un lote
    puntual y usando el N° de lote que el usuario ya asignó al crearlo."""
    lote = db.query(LoteDetraccion).filter(LoteDetraccion.id == lote_id).first()
    if not lote:
        raise HTTPException(404, "Lote no encontrado")

    gastos = sorted(
        (d.gasto for d in lote.detalles if d.gasto),
        key=lambda g: g.fecha or date.min,
    )
    if not gastos:
        raise HTTPException(400, "El lote no tiene detracciones agregadas")

    empresa        = get_empresa_header(db)
    ruc_empresa    = empresa.get("ruc") or ""
    nombre_empresa = empresa.get("nombre_empresa") or ""
    if not _solo_digitos(ruc_empresa):
        raise HTTPException(400, "Configure el RUC de la empresa en Configuración antes de generar el archivo")

    monto_total = sum(float(g.monto_detraccion or 0) for g in gastos)

    try:
        linea1 = _linea_encabezado(ruc_empresa, nombre_empresa, lote.numero_lote, monto_total)
    except AssertionError as e:
        raise HTTPException(500, f"Error de formato en la línea de encabezado: {e}")

    detalle = []
    for g in gastos:
        try:
            detalle.append(_linea_detalle(g, db))
        except AssertionError as e:
            raise HTTPException(
                500,
                f"Error de formato en la detracción del Gasto #{g.id} "
                f"({g.numero_comprobante or 'sin N° comprobante'}): {e}",
            )

    contenido = linea1 + "\n" + "\n".join(detalle)
    fname = f"D{_pad_izq(_solo_digitos(ruc_empresa), LEN_RUC)}{_pad_izq(str(lote.numero_lote), LEN_LOTE)}.TXT"

    lote.importe_total = round(monto_total, 2)
    db.commit()

    return StreamingResponse(
        io.BytesIO(contenido.encode("utf-8")),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.put("/ventas/{venta_id}/marcar-pagada")
def marcar_venta_pagada(venta_id: int, db: Session = Depends(get_db)):
    v = db.query(VentaComercial).filter(VentaComercial.id == venta_id).first()
    if not v:
        raise HTTPException(404, "Comprobante no encontrado")
    v.detraccion_pagada = True
    db.commit()
    return {"mensaje": "Detracción marcada como pagada"}


@router.put("/gastos/{gasto_id}/marcar-depositada")
def marcar_gasto_depositada(gasto_id: int, db: Session = Depends(get_db)):
    g = db.query(Gasto).filter(Gasto.id == gasto_id).first()
    if not g:
        raise HTTPException(404, "Gasto no encontrado")
    g.detraccion_depositada = True
    db.commit()
    return {"mensaje": "Detracción marcada como depositada"}
