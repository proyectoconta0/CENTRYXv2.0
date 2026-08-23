from database import engine
from sqlalchemy import text

with engine.connect() as conn:
    r = conn.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='ventas_comercial' ORDER BY ordinal_position"
    ))
    cols = [row[0] for row in r]
    print("ventas_comercial:", cols)

    r2 = conn.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='documentos_cliente' ORDER BY ordinal_position"
    ))
    cols2 = [row[0] for row in r2]
    print("documentos_cliente:", cols2)
