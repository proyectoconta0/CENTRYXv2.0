from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db
from app.models.comercial import VentaComercial
from pathlib import Path

router = APIRouter()
UPLOAD_BASE = Path("uploads/comprobantes")
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png"}


@router.post("/{venta_id}/comprobante")
async def subir_comprobante(
    venta_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    venta = db.query(VentaComercial).filter(VentaComercial.id == venta_id).first()
    if not venta:
        raise HTTPException(404, "Venta no encontrada")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Solo se aceptan PDF, JPG y PNG")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo mayor a 10 MB")

    if venta.comprobante_path:
        Path(venta.comprobante_path).unlink(missing_ok=True)

    upload_dir = UPLOAD_BASE / str(venta.cliente_id) / str(venta_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / file.filename

    with open(file_path, "wb") as f:
        f.write(content)

    venta.comprobante_path = str(file_path)
    venta.comprobante_nombre = file.filename
    db.commit()

    return {"mensaje": "Comprobante subido", "nombre": file.filename}


@router.get("/{venta_id}/comprobante")
def ver_comprobante(venta_id: int, download: bool = False, db: Session = Depends(get_db)):
    venta = db.query(VentaComercial).filter(VentaComercial.id == venta_id).first()
    if not venta or not venta.comprobante_path:
        raise HTTPException(404, "Comprobante no encontrado")
    if not Path(venta.comprobante_path).exists():
        raise HTTPException(404, "Archivo no encontrado en disco")
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{venta.comprobante_nombre}"'
    else:
        headers["Content-Disposition"] = f'inline; filename="{venta.comprobante_nombre}"'
    return FileResponse(venta.comprobante_path, headers=headers)


@router.delete("/{venta_id}/comprobante")
def eliminar_comprobante(venta_id: int, db: Session = Depends(get_db)):
    venta = db.query(VentaComercial).filter(VentaComercial.id == venta_id).first()
    if not venta:
        raise HTTPException(404, "Venta no encontrada")
    if venta.comprobante_path:
        Path(venta.comprobante_path).unlink(missing_ok=True)
    venta.comprobante_path = None
    venta.comprobante_nombre = None
    db.commit()
    return {"mensaje": "Comprobante eliminado"}
