"""
Agrega numero_factura VARCHAR(20) a ventas_comercial (nullable).
Ejecutar una sola vez: python migrate_numero_factura.py
"""
from database import engine
from sqlalchemy import text


def run():
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE ventas_comercial "
            "ADD COLUMN IF NOT EXISTS numero_factura VARCHAR(20)"
        ))
        conn.commit()
    print("Migración numero_factura completada.")


if __name__ == "__main__":
    run()
