import io
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.models.comercial import VentaComercial
from app.models.models import Gasto, DetraccionLote
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
# un ejemplo real de producción descompone limpiamente con 30/20 en cambio
# (ver LEN_NOMBRE_ADQUIR/LEN_MONTO_CABECERA más abajo).
# Antes de usar en producción, validar el archivo generado contra el
# validador oficial del Banco de la Nación / SUNAT.

LEN_RUC            = 11
LEN_NOMBRE_ADQUIR  = 30   # corregido 2026-07-21: un ejemplo real de producción descompone
LEN_LOTE           = 6    # limpio en un nombre de empresa completo a ancho 30 ("CASA BLANCA
LEN_MONTO_CABECERA = 20   # INMOBILIARIA S.A.C"); el ancho 35 previo cortaba el nombre en medio
                           # de la palabra y sangraba dígitos del lote dentro del campo nombre.

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
        return "6"
    return "1"  # Factura, y cualquier otro valor no reconocido, por defecto


def _linea_detalle(g: Gasto) -> str:
    """107 bytes, posiciones 1-107."""
    ruc_prov  = _pad_izq(_solo_digitos(g.numero_documento), LEN_RUC)                       # 1-11
    mes       = _pad_izq(str(g.fecha.month) if g.fecha else "", 2)                         # 12-13
    anio      = _pad_izq(str(g.fecha.year)  if g.fecha else "", 4)                         # 14-17
    serie, correlativo = _partir_serie_correlativo(g.numero_comprobante)
    n_comprobante = _pad_izq(correlativo, 18)                                              # 18-35
    n_serie       = _pad_izq(serie, 18)                                                    # 36-53
    monto_base    = _pad_izq(_centavos(g.base_imponible), 14)                              # 54-67
    tipo_doc      = _tipo_documento_txt(g.tipo_comprobante)                                # 68      (NUEVO)
    cod_bien      = _pad_izq(_codigo_bien_servicio(g.concepto_detraccion), 2)               # 69-70
    monto_det     = _pad_izq(_centavos(g.monto_detraccion), 14)                            # 71-84
    fecha_emision = g.fecha.strftime("%Y%m%d") if g.fecha else _pad_izq("", 8)             # 85-92
    cod_periodo   = _pad_izq("", 3)                                                        # 93-95 (sin definición en la especificación)
    doc_adicional = _pad_izq("", 12)                                                       # 96-107 (sin definición en la especificación)

    linea = (ruc_prov + mes + anio + n_comprobante + n_serie + monto_base +
              tipo_doc + cod_bien + monto_det + fecha_emision + cod_periodo + doc_adicional)
    assert len(linea) == 107, f"Línea de detalle con {len(linea)} bytes (se esperaban 107)"
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
            detalle.append(_linea_detalle(g))
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
