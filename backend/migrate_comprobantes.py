"""
Ejecutar desde D:\CENTRYX\backend:
    python migrate_comprobantes.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import engine
from sqlalchemy import text

NEW_COLS = [
    ("tipo_documento",       "VARCHAR(50)  DEFAULT 'Factura'"),
    ("base_imponible",       "FLOAT"),
    ("igv",                  "FLOAT"),
    ("precio_venta",         "FLOAT"),
    ("documento_relacionado","VARCHAR(30)"),
    ("ruc_cliente",          "VARCHAR(20)"),
    ("razon_social_cliente", "VARCHAR(200)"),
]

def migrate():
    with engine.connect() as conn:
        # Ampliar numero_factura a VARCHAR(30) si es menor
        try:
            conn.execute(text(
                "ALTER TABLE ventas_comercial ALTER COLUMN numero_factura TYPE VARCHAR(30)"
            ))
            conn.commit()
            print("OK: numero_factura -> VARCHAR(30)")
        except Exception as e:
            conn.rollback()
            print(f"   numero_factura ya es VARCHAR(30) o mayor: {e}")

        for col, col_type in NEW_COLS:
            try:
                conn.execute(text(
                    f"ALTER TABLE ventas_comercial ADD COLUMN IF NOT EXISTS {col} {col_type}"
                ))
                conn.commit()
                print(f"OK: columna '{col}' agregada")
            except Exception as e:
                conn.rollback()
                print(f"   '{col}' no agregada: {e}")

    print("\nMigracion completada.")

if __name__ == "__main__":
    migrate()
