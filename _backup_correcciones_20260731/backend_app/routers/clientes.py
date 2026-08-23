import io
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db
from app.services import clientes_service as svc
from app.schemas.comercial_schemas import ClienteCreate, ClienteUpdate
from app.models.comercial import DocumentoCliente, VentaComercial, PagoCobranza
from app.models.models import Usuario, Cliente
from app.core.security import get_current_usuario
from app.services.auditoria_service import registrar_log, ip_de
from app.services.empresa_header import get_empresa_header
from app.services.reportes_export import construir_pdf_estado_cuenta
from app.services.email_service import enviar_email, email_configurado, EmailNoConfiguradoError
from datetime import date
from pathlib import Path
from typing import Optional

router = APIRouter()
UPLOAD_BASE = Path("uploads/clientes")

TIPOS_COBRANZA = ["Factura", "Boleta de Venta"]


def _generar_pdf_estado_cuenta(db: Session, cliente_id: int, d: date, h: date):
    """Reconstruye el PDF de Estado de Cuenta para el rango [d, h]. Usado tanto
    por el endpoint de descarga como por el de envío por correo."""
    cliente = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")

    ventas = db.query(VentaComercial).filter(
        VentaComercial.cliente_id == cliente_id,
        VentaComercial.tipo_documento.in_(TIPOS_COBRANZA),
        VentaComercial.fecha >= d, VentaComercial.fecha <= h,
    ).all()

    pagos = (
        db.query(PagoCobranza)
        .join(VentaComercial, PagoCobranza.comprobante_id == VentaComercial.id)
        .filter(
            VentaComercial.cliente_id == cliente_id,
            PagoCobranza.fecha_pago >= d, PagoCobranza.fecha_pago <= h,
        )
        .all()
    )

    movimientos_raw = []
    for v in ventas:
        monto = float(
            v.precio_venta_soles if v.precio_venta_soles is not None
            else (v.precio_venta if v.precio_venta is not None else (v.monto or 0))
        )
        descripcion = f"{v.tipo_documento or 'Factura'} {v.numero_factura or ''}".strip()
        if v.tipo_servicio:
            descripcion += f" — {v.tipo_servicio}"
        movimientos_raw.append({
            "fecha": v.fecha, "numero_documento": v.numero_factura or "—",
            "descripcion": descripcion, "cargo": monto, "abono": 0.0,
        })
    for p in pagos:
        movimientos_raw.append({
            "fecha": p.fecha_pago, "numero_documento": "—",
            "descripcion": f"Pago recibido — {p.metodo_pago or 'N/D'}",
            "cargo": 0.0, "abono": float(p.monto_pagado or 0),
        })
    movimientos_raw.sort(key=lambda m: m["fecha"])

    saldo = 0.0
    total_facturado = 0.0
    total_cobrado = 0.0
    movimientos = []
    for m in movimientos_raw:
        saldo += m["cargo"] - m["abono"]
        total_facturado += m["cargo"]
        total_cobrado += m["abono"]
        movimientos.append({
            "fecha":             m["fecha"].strftime("%d/%m/%Y") if m["fecha"] else "—",
            "numero_documento":  m["numero_documento"],
            "descripcion":       m["descripcion"],
            "cargo":             f"{m['cargo']:,.2f}" if m["cargo"] else "—",
            "abono":             f"{m['abono']:,.2f}" if m["abono"] else "—",
            "saldo":             f"{saldo:,.2f}",
        })

    empresa = get_empresa_header(db)
    cliente_dict = {"razon_social": cliente.razon_social, "ruc": cliente.ruc, "direccion": cliente.direccion}
    resumen = {
        "total_facturado":  round(total_facturado, 2),
        "total_cobrado":    round(total_cobrado, 2),
        "saldo_pendiente":  round(total_facturado - total_cobrado, 2),
    }
    periodo_label = f"{d.strftime('%d/%m/%Y')} al {h.strftime('%d/%m/%Y')}"

    pdf_bytes = construir_pdf_estado_cuenta(cliente_dict, movimientos, resumen, periodo_label, empresa)
    return cliente, pdf_bytes, resumen, periodo_label, empresa


@router.get("")
def listar(search: str = "", estado: str = "todos", page: int = 1,
           per_page: int = 10, db: Session = Depends(get_db)):
    return svc.list_clientes(db, search, estado, page, per_page)


@router.get("/buscar")
def buscar_clientes(q: str = "", db: Session = Depends(get_db)):
    """Autocompletado liviano por RUC o razón social — usado por selectores
    tipo búsqueda (ej. modal Nueva Garantía), a diferencia de GET "" que
    devuelve la lista paginada completa con datos agregados."""
    q = (q or "").strip()
    if len(q) < 3:
        return []
    like = f"%{q}%"
    rows = db.query(Cliente).filter(
        or_(Cliente.ruc.ilike(like), Cliente.razon_social.ilike(like))
    ).order_by(Cliente.razon_social.asc()).limit(20).all()
    return [{"id": c.id, "ruc": c.ruc, "razon_social": c.razon_social} for c in rows]


@router.post("")
def crear(data: ClienteCreate, http_request: Request, db: Session = Depends(get_db),
          usuario: Usuario = Depends(get_current_usuario)):
    resultado = svc.create_cliente(db, data, usuario.nombre)
    registrar_log(
        db, usuario.id, usuario.nombre, "clientes", "Creó cliente",
        f"Creó cliente {resultado['razon_social']}", ip_de(http_request),
    )
    return resultado


@router.get("/{cliente_id}")
def obtener(cliente_id: int, db: Session = Depends(get_db)):
    return svc.get_cliente(db, cliente_id)


@router.put("/{cliente_id}")
def actualizar(cliente_id: int, data: ClienteUpdate, http_request: Request, db: Session = Depends(get_db),
               usuario: Usuario = Depends(get_current_usuario)):
    resultado = svc.update_cliente(db, cliente_id, data, usuario.nombre)
    registrar_log(
        db, usuario.id, usuario.nombre, "clientes", "Editó cliente",
        f"Editó cliente {resultado['razon_social']}", ip_de(http_request),
    )
    return resultado


@router.delete("/{cliente_id}")
def eliminar(cliente_id: int, db: Session = Depends(get_db)):
    return svc.delete_cliente(db, cliente_id)


@router.get("/{cliente_id}/historial")
def historial(cliente_id: int, db: Session = Depends(get_db)):
    return svc.get_historial(db, cliente_id)


@router.get("/{cliente_id}/estado-cuenta")
def estado_cuenta(cliente_id: int, desde: Optional[date] = None, hasta: Optional[date] = None,
                   db: Session = Depends(get_db)):
    hoy = date.today()
    d = desde or hoy.replace(day=1)
    h = hasta or hoy

    cliente, pdf_bytes, _resumen, _periodo_label, _empresa = _generar_pdf_estado_cuenta(db, cliente_id, d, h)

    nombre_archivo = f"EstadoCuenta_{cliente.razon_social.replace(' ', '_')}_{hoy.strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nombre_archivo}"'},
    )


@router.get("/{cliente_id}/estado-cuenta/resumen")
def estado_cuenta_resumen(cliente_id: int, desde: Optional[date] = None, hasta: Optional[date] = None,
                           db: Session = Depends(get_db)):
    """Datos numéricos (sin generar el PDF completo en la respuesta) usados para
    prellenar la plantilla del modal de envío por correo."""
    hoy = date.today()
    d = desde or hoy.replace(day=1)
    h = hasta or hoy

    cliente, _pdf_bytes, resumen, periodo_label, empresa = _generar_pdf_estado_cuenta(db, cliente_id, d, h)

    return {
        "cliente": {"razon_social": cliente.razon_social, "email": cliente.email or "", "ruc": cliente.ruc},
        "resumen": resumen,
        "periodo_label": periodo_label,
        "empresa": {
            "nombre_empresa": empresa.get("nombre_empresa"),
            "telefono":       empresa.get("telefono"),
            "email":          empresa.get("email"),
        },
    }


class EnviarEstadoCuentaReq(BaseModel):
    desde: date
    hasta: date
    destinatario: str
    cc: Optional[str] = None
    asunto: str
    mensaje: str


@router.post("/{cliente_id}/estado-cuenta/enviar")
def enviar_estado_cuenta(cliente_id: int, data: EnviarEstadoCuentaReq, http_request: Request,
                          db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_usuario)):
    if not email_configurado():
        raise HTTPException(400, "Configure el email en el archivo .env para poder enviar correos")
    if not data.destinatario or not data.destinatario.strip():
        raise HTTPException(400, "Debe indicar un correo de destino")

    cliente, pdf_bytes, _resumen, _periodo_label, _empresa = _generar_pdf_estado_cuenta(
        db, cliente_id, data.desde, data.hasta,
    )
    if not pdf_bytes:
        raise HTTPException(500, "Error al generar el PDF del estado de cuenta")

    nombre_cliente = cliente.razon_social.replace(" ", "_")
    nombre_archivo = f"Estado_Cuenta_{nombre_cliente}_{data.hasta.strftime('%Y%m%d')}.pdf"

    try:
        enviar_email(
            destinatario=data.destinatario.strip(),
            asunto=data.asunto,
            cuerpo=data.mensaje,
            adjunto_pdf=pdf_bytes,
            adjunto_nombre=nombre_archivo,
            cc=data.cc.strip() if data.cc else None,
        )
    except EmailNoConfiguradoError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"No se pudo enviar el correo: {e}")

    registrar_log(
        db, usuario.id, usuario.nombre, "clientes", "Envió estado de cuenta por correo",
        f"Envió estado de cuenta de {cliente.razon_social} a {data.destinatario}", ip_de(http_request),
    )

    return {"ok": True, "mensaje": f"Estado de cuenta enviado a {data.destinatario.strip()}"}


# ── Documentos ────────────────────────────────────────────────────────────────

@router.get("/{cliente_id}/documentos")
def listar_docs(
    cliente_id: int,
    tipo: Optional[str] = None,
    estado: Optional[str] = None,
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    venta_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    result = []

    # ── Documentos regulares ──────────────────────────────────────────────
    if not tipo or tipo != "Comprobante":
        q = db.query(DocumentoCliente).filter(DocumentoCliente.cliente_id == cliente_id)
        if tipo:
            q = q.filter(DocumentoCliente.tipo == tipo)
        if estado:
            q = q.filter(DocumentoCliente.estado == estado)
        if fecha_desde:
            q = q.filter(DocumentoCliente.fecha_carga >= fecha_desde)
        if fecha_hasta:
            q = q.filter(DocumentoCliente.fecha_carga <= fecha_hasta)
        if venta_id:
            q = q.filter(DocumentoCliente.venta_id == venta_id)

        for d in q.all():
            venta_info = None
            if d.venta_id:
                v = db.query(VentaComercial).filter(VentaComercial.id == d.venta_id).first()
                if v:
                    venta_info = {
                        "id": v.id, "tipo_servicio": v.tipo_servicio,
                        "descripcion": v.descripcion, "monto": v.monto, "fecha": str(v.fecha),
                    }
            result.append({
                "id": d.id, "tipo_item": "documento",
                "nombre": d.nombre, "tipo": d.tipo,
                "tamano": d.tamano, "fecha_carga": d.fecha_carga,
                "estado": d.estado or "Activo",
                "venta_id": d.venta_id, "venta_info": venta_info,
            })

    # ── Comprobantes de ventas (omitir cuando se filtra por venta específica) ──
    if not venta_id and (not tipo or tipo == "Comprobante"):
        if not estado or estado == "Activo":
            qv = db.query(VentaComercial).filter(
                VentaComercial.cliente_id == cliente_id,
                VentaComercial.comprobante_path != None,
            )
            if fecha_desde:
                qv = qv.filter(VentaComercial.fecha >= fecha_desde)
            if fecha_hasta:
                qv = qv.filter(VentaComercial.fecha <= fecha_hasta)

            for v in qv.all():
                result.append({
                    "id": None, "tipo_item": "comprobante",
                    "nombre": v.comprobante_nombre, "tipo": "Comprobante",
                    "tamano": 0, "fecha_carga": v.fecha,
                    "estado": "Activo",
                    "venta_id": v.id,
                    "venta_info": {
                        "id": v.id, "tipo_servicio": v.tipo_servicio,
                        "descripcion": v.descripcion, "monto": v.monto, "fecha": str(v.fecha),
                    },
                })

    result.sort(key=lambda x: x["fecha_carga"] or date.min, reverse=True)
    return result


@router.post("/{cliente_id}/documentos")
async def subir_doc(
    cliente_id: int,
    file: UploadFile = File(...),
    tipo: str = Form("Otro"),
    venta_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo mayor a 10 MB")
    upload_dir = UPLOAD_BASE / str(cliente_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / file.filename
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    doc = DocumentoCliente(
        cliente_id=cliente_id,
        nombre=file.filename,
        tipo=tipo,
        ruta_archivo=str(file_path),
        tamano=len(content),
        fecha_carga=date.today(),
        venta_id=venta_id,
        estado="Activo",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {
        "id": doc.id, "nombre": doc.nombre, "tipo": doc.tipo,
        "tamano": doc.tamano, "fecha_carga": doc.fecha_carga,
        "estado": doc.estado, "venta_id": doc.venta_id,
    }


@router.get("/{cliente_id}/documentos/{doc_id}")
def ver_doc(cliente_id: int, doc_id: int, download: bool = False,
            db: Session = Depends(get_db)):
    doc = db.query(DocumentoCliente).filter(
        DocumentoCliente.id == doc_id, DocumentoCliente.cliente_id == cliente_id
    ).first()
    if not doc:
        raise HTTPException(404, "Documento no encontrado")
    if not Path(doc.ruta_archivo).exists():
        raise HTTPException(404, "Archivo no encontrado en disco")
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{doc.nombre}"'
    else:
        headers["Content-Disposition"] = f'inline; filename="{doc.nombre}"'
    return FileResponse(doc.ruta_archivo, headers=headers)


@router.patch("/{cliente_id}/documentos/{doc_id}/estado")
def cambiar_estado_doc(
    cliente_id: int, doc_id: int, estado: str, db: Session = Depends(get_db)
):
    doc = db.query(DocumentoCliente).filter(
        DocumentoCliente.id == doc_id, DocumentoCliente.cliente_id == cliente_id
    ).first()
    if not doc:
        raise HTTPException(404, "Documento no encontrado")
    doc.estado = estado
    db.commit()
    return {"id": doc.id, "estado": doc.estado}


@router.delete("/{cliente_id}/documentos/{doc_id}")
def eliminar_doc(cliente_id: int, doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(DocumentoCliente).filter(
        DocumentoCliente.id == doc_id, DocumentoCliente.cliente_id == cliente_id
    ).first()
    if not doc:
        raise HTTPException(404, "Documento no encontrado")
    try:
        Path(doc.ruta_archivo).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(doc)
    db.commit()
    return {"mensaje": "Documento eliminado"}
