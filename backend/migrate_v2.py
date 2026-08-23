"""
Migración v2: agrega columnas venta_id y estado a documentos_cliente.
Ejecutar UNA sola vez: python migrate_v2.py
"""
from database import engine
from sqlalchemy import text


def run():
    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE documentos_cliente
            ADD COLUMN IF NOT EXISTS venta_id INTEGER REFERENCES ventas_comercial(id) ON DELETE SET NULL
        """))
        conn.execute(text("""
            ALTER TABLE documentos_cliente
            ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'Activo'
        """))
        conn.execute(text("""
            UPDATE documentos_cliente SET estado = 'Activo' WHERE estado IS NULL
        """))
        conn.commit()
    print("Migración v2 completada.")


if __name__ == "__main__":
    run()
