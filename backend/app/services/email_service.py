"""
Envío de correos genérico vía Gmail SMTP (smtplib, stdlib) — usado por el
envío manual de documentos (p. ej. Estado de Cuenta) desde el frontend.
Configuración leída de variables de entorno (.env): EMAIL_SENDER,
EMAIL_PASSWORD (App Password de Gmail, no la contraseña normal), EMAIL_NOMBRE.
"""
import os
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


class EmailNoConfiguradoError(Exception):
    """El .env no tiene EMAIL_SENDER/EMAIL_PASSWORD configurados."""


def email_configurado() -> bool:
    return bool(os.getenv("EMAIL_SENDER") and os.getenv("EMAIL_PASSWORD"))


def enviar_email(
    destinatario: str,
    asunto: str,
    cuerpo: str,
    adjunto_pdf: Optional[bytes] = None,
    adjunto_nombre: str = "documento.pdf",
    cc: Optional[str] = None,
) -> None:
    sender = os.getenv("EMAIL_SENDER")
    password = os.getenv("EMAIL_PASSWORD")
    nombre = os.getenv("EMAIL_NOMBRE") or "Centryx"

    if not sender or not password:
        raise EmailNoConfiguradoError("Configure el email en el archivo .env para poder enviar correos")

    if adjunto_pdf is not None and len(adjunto_pdf) == 0:
        raise ValueError("El PDF adjunto está vacío — no se generó correctamente")

    msg = MIMEMultipart()
    msg["From"] = f"{nombre} <{sender}>"
    msg["To"] = destinatario
    if cc:
        msg["Cc"] = cc
    msg["Subject"] = asunto

    # Cuerpo del mensaje
    msg.attach(MIMEText(cuerpo, "plain"))

    # Adjuntar PDF (generado en memoria, nunca se guarda en disco)
    if adjunto_pdf:
        adjunto = MIMEBase("application", "octet-stream")
        adjunto.set_payload(adjunto_pdf)
        encoders.encode_base64(adjunto)
        adjunto.add_header(
            "Content-Disposition",
            f'attachment; filename="{adjunto_nombre}"',
        )
        msg.attach(adjunto)

    destinatarios = [destinatario] + ([c.strip() for c in cc.split(",") if c.strip()] if cc else [])

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.starttls()
        server.login(sender, password)
        server.sendmail(sender, destinatarios, msg.as_string())
