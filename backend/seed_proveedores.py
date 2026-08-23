"""
Seed / importación de proveedores para Centryx — Módulo 7.
Importa automáticamente los proveedores ya existentes en proveedores_gastos
(registrados desde Módulo 4 - Gastos) a la nueva tabla proveedores,
completando datos faltantes con valores realistas, y vincula los gastos
existentes a su proveedor correspondiente vía proveedor_id.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import date
from database import SessionLocal
from app.models.models import Proveedor, ProveedorGasto, Gasto

DISTRITOS = [
    "San Isidro", "Miraflores", "Surco", "Cercado de Lima", "San Borja",
    "La Victoria", "Ate", "Los Olivos", "San Miguel", "Callao",
    "Surquillo", "Jesús María",
]
CARGOS = [
    "Gerente Comercial", "Jefe de Ventas", "Administrador",
    "Encargado de Cuentas", "Representante Legal", "Coordinador Comercial",
]
CONTACTOS = [
    "Carlos Ramírez", "María Gonzáles", "Jorge Torres", "Ana Quispe",
    "Luis Vargas", "Patricia Flores", "Miguel Rojas", "Sandra Paredes",
    "Roberto Díaz", "Claudia Salazar",
]


def _telefono(idx: int) -> str:
    return f"9{(10000000 + idx * 137) % 90000000:08d}"


def _email(nombre: str, idx: int) -> str:
    slug = "".join(ch for ch in nombre.lower() if ch.isalnum())[:14] or f"proveedor{idx}"
    return f"contacto@{slug}.com.pe"


def _importar_desde_proveedores_gastos(db) -> int:
    hoy = date.today()
    importados = 0
    for i, pg in enumerate(db.query(ProveedorGasto).order_by(ProveedorGasto.id.asc()).all()):
        if not pg.numero_documento or not pg.nombre_proveedor:
            continue
        if db.query(Proveedor).filter(Proveedor.numero_documento == pg.numero_documento).first():
            continue
        distrito = DISTRITOS[i % len(DISTRITOS)]
        db.add(Proveedor(
            tipo_documento=pg.tipo_documento or "RUC",
            numero_documento=pg.numero_documento,
            razon_social=pg.nombre_proveedor,
            direccion=f"Av. {distrito} {150 + i * 20}",
            distrito=distrito,
            telefono=_telefono(i),
            email=_email(pg.nombre_proveedor, i),
            contacto_principal=CONTACTOS[i % len(CONTACTOS)],
            cargo_contacto=CARGOS[i % len(CARGOS)],
            estado="Activo",
            created_at=hoy,
            updated_at=hoy,
        ))
        importados += 1
    if importados:
        db.commit()
    return importados


def _vincular_gastos_existentes(db) -> int:
    vinculados = 0
    sin_vincular = db.query(Gasto).filter(
        Gasto.proveedor_id.is_(None),
        Gasto.numero_documento.isnot(None),
    ).all()
    for g in sin_vincular:
        prov = db.query(Proveedor).filter(Proveedor.numero_documento == g.numero_documento).first()
        if prov:
            g.proveedor_id = prov.id
            vinculados += 1
    if vinculados:
        db.commit()
    return vinculados


def run():
    db = SessionLocal()
    try:
        importados = 0
        if db.query(Proveedor).count() == 0:
            importados = _importar_desde_proveedores_gastos(db)

        vinculados = _vincular_gastos_existentes(db)

        if importados or vinculados:
            print(f"✓ Proveedores: {importados} importados, {vinculados} gastos vinculados")
    finally:
        db.close()


if __name__ == "__main__":
    run()
