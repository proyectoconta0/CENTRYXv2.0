from typing import Optional
from sqlalchemy.orm import Session
from app.models.auditoria import AuditoriaLog


def registrar_log(
    db: Session,
    usuario_id: Optional[int],
    usuario_nombre: Optional[str],
    modulo: str,
    accion: str,
    descripcion: str,
    ip_address: Optional[str] = None,
):
    """Inserta una fila en auditoria_logs.

    Se llama DESPUÉS de que la operación principal ya hizo su propio commit
    (crear/editar/eliminar, login, etc.), con su propia transacción — así un
    log nunca deja a medias el cambio que audita. Si el registro de auditoría
    fallara por cualquier motivo, no debe tumbar la respuesta al usuario: se
    atrapa el error y solo se deja constancia en consola.
    """
    try:
        log = AuditoriaLog(
            usuario_id=usuario_id,
            usuario_nombre=usuario_nombre,
            modulo=modulo,
            accion=accion,
            descripcion=descripcion,
            ip_address=ip_address,
        )
        db.add(log)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[auditoria_service] No se pudo registrar el log: {e}")


def ip_de(request) -> Optional[str]:
    """Extrae la IP del cliente de un Request de FastAPI, si está disponible."""
    if request is None or request.client is None:
        return None
    return request.client.host
