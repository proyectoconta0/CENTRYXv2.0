"""
Agrega comprobante_path y comprobante_nombre a ventas_comercial.
Ejecutar una sola vez: python migrate_ventas_comprobante.py
"""
from database import engine
from sqlalchemy import text


def run():
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE ventas_comercial "
            "ADD COLUMN IF NOT EXISTS comprobante_path VARCHAR(500)"
        ))
        conn.execute(text(
            "ALTER TABLE ventas_comercial "
            "ADD COLUMN IF NOT EXISTS comprobante_nombre VARCHAR(200)"
        ))
        conn.commit()
    print("Migración ventas comprobante completada.")


if __name__ == "__main__":
    run()
