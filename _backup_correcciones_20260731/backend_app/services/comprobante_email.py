"""
Envío del comprobante de venta al cliente por correo: cuerpo HTML automático
(el usuario no lo edita) + PDF adjunto vía SMTP (smtplib, stdlib).
"""
import smtplib
from email.message import EmailMessage
from email.utils import formataddr


def construir_cuerpo_html(empresa: dict, s: dict) -> str:
    return f"""
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
      <p>Estimado/a {s.get('cliente_nombre') or 'cliente'},</p>
      <p>Adjunto encontrará su comprobante de pago en formato PDF.</p>
      <p>Ante cualquier consulta, no dude en comunicarse con nosotros.</p>
      <p style="margin-top: 24px;">
        Atentamente,<br>
        {empresa.get('nombre_empresa') or 'Gerencial Pro'}
      </p>
    </div>
    """.strip()


def enviar_email_smtp(
    *,
    smtp_host: str,
    smtp_port: int,
    smtp_usuario: str,
    smtp_password: str,
    from_name: str,
    destinatario: str,
    asunto: str,
    cuerpo_html: str,
    adjunto_bytes: bytes,
    adjunto_nombre: str,
) -> None:
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, smtp_usuario))
    msg["To"] = destinatario
    msg["Subject"] = asunto
    msg.set_content("Este mensaje requiere un cliente de correo compatible con HTML.")
    msg.add_alternative(cuerpo_html, subtype="html")
    msg.add_attachment(adjunto_bytes, maintype="application", subtype="pdf", filename=adjunto_nombre)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.starttls()
        server.login(smtp_usuario, smtp_password)
        server.send_message(msg)
