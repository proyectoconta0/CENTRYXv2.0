"""
Seed de gastos para Centryx — empresa de andamios.
25 registros base + 5 plantillas recurrentes (Ene 2026).
_generar_recurrentes() en main.py completa los meses posteriores.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import date
from database import SessionLocal
from app.models.models import Gasto

# RUCs ficticios asignados a cada proveedor (formato peruano: 20 + 9 dígitos)
DOCS_PROVEEDOR = {
    "Inmobiliaria Torres SAC":        ("RUC", "20456721089"),
    "Depósitos VES EIRL":             ("RUC", "20345678901"),
    "Claro / Luz del Sur":            ("RUC", "20512088736"),
    "Rimac Seguros":                  ("RUC", "20512891338"),
    "Trans Rápido SAC":               ("RUC", "20567812340"),
    "Tai Loy":                        ("RUC", "20456712345"),
    "Ferretería Industrial Lima":      ("RUC", "20678901234"),
    "Imprenta Gráfica Total":         ("RUC", "20789012345"),
    "Aceros Arequipa":                ("RUC", "20234589012"),
    "Andamios del Pacífico EIRL":     ("RUC", "20567890123"),
    "Estudio Contable Ríos & Asoc.":  ("RUC", "20890123456"),
    "Pinturerías Anypsa":             ("RUC", "20456789012"),
    "Pacifico Seguros":               ("RUC", "20345671234"),
    "Maderería El Bosque SAC":        ("RUC", "20890134567"),
    "Grúas Pesadas Perú SAC":         ("RUC", "20901345678"),
    "Microsoft / Google":             ("RUC", "20601789012"),
    "Agencia Digital Éxito":          ("RUC", "20234567890"),
    "Construcciones y Andamios Lima": ("RUC", "20123451234"),
    "Auto Perú SAC":                  ("RUC", "20789123456"),
    "Muebles del Pacífico SAC":       ("RUC", "20567234567"),
    "Remodelaciones Lima SAC":        ("RUC", "20678345678"),
}

# fmt: (fecha, categoria, descripcion, monto, area, es_recurrente, tipo_comprobante, numero_comprobante, proveedor)
DATA = [
    # ─── Enero 2026 — 5 plantillas recurrentes ───────────────────────────────
    (date(2026, 1, 5),  "Alquiler de oficina",    "Alquiler oficina Miraflores - Ene 2026",        3500.00, "Administrativa", True,  "Factura",                       "F-2026-001", "Inmobiliaria Torres SAC"),
    (date(2026, 1, 7),  "Alquiler de almacén",    "Alquiler almacén Villa El Salvador - Ene 2026", 2800.00, "Operativa",      True,  "Factura",                       "F-2026-002", "Depósitos VES EIRL"),
    (date(2026, 1, 10), "Servicios básicos",       "Internet + luz + teléfono - Ene 2026",           450.00, "Administrativa", True,  "Recibo de Servicios Públicos",  "RSP-2026-01", "Claro / Luz del Sur"),
    (date(2026, 1, 15), "Mano de obra",            "Cuadrilla instalación andamios Sem 2 - Ene",    4200.00, "Operativa",      True,  "Recibo Interno",                "RI-0001", ""),
    (date(2026, 1, 25), "Seguros",                 "Prima seguro responsabilidad civil - Ene 2026", 1200.00, "Administrativa", True,  "Factura",                       "F-2026-003", "Rimac Seguros"),
    # ─── Enero 2026 — otros ──────────────────────────────────────────────────
    (date(2026, 1, 18), "Transporte",              "Flete traslado andamios a obra Surco",            850.00, "Operativa",      False, "Recibo Interno",                "RI-0002", "Trans Rápido SAC"),
    (date(2026, 1, 28), "Gastos administrativos",  "Útiles de oficina y papelería - Enero",           320.00, "Administrativa", False, "Factura",                       "F-2026-004", "Tai Loy"),
    # ─── Febrero 2026 ────────────────────────────────────────────────────────
    (date(2026, 2, 5),  "Mobiliario y Equipo de Oficina", "Escritorios y sillas ergonómicas para oficina", 3200.00, "Activos", False, "Factura",                       "F-2026-018", "Muebles del Pacífico SAC"),
    (date(2026, 2, 12), "Suministros",             "Pernos, tuercas y accesorios andamios",          1650.00, "Operativa",      False, "Factura",                       "F-2026-005", "Ferretería Industrial Lima"),
    (date(2026, 2, 18), "Gastos de ventas",        "Impresión brochures y materiales promo",           480.00, "Ventas",         False, "Factura",                       "F-2026-006", "Imprenta Gráfica Total"),
    (date(2026, 2, 22), "Transporte",              "Flete andamios a obra San Miguel",                 720.00, "Operativa",      False, "Recibo Interno",                "RI-0003", "Trans Rápido SAC"),
    # ─── Marzo 2026 ──────────────────────────────────────────────────────────
    (date(2026, 3, 7),  "Maquinaria y Equipos",    "Andamios tubulares galvanizados - ampliación stock", 5800.00, "Activos",   False, "Factura",                       "F-2026-007", "Aceros Arequipa"),
    (date(2026, 3, 14), "Transporte",              "Flete andamios a obra San Isidro",                 680.00, "Operativa",      False, "Recibo Interno",                "RI-0004", "Trans Rápido SAC"),
    (date(2026, 3, 20), "Alquiler de andamios",    "Subcontrato andamios para obra Callao",          3200.00, "Operativa",      False, "Factura",                       "F-2026-008", "Andamios del Pacífico EIRL"),
    (date(2026, 3, 25), "Gastos administrativos",  "Servicio contabilidad externo - Marzo",           1800.00, "Administrativa", False, "Factura",                       "F-2026-009", "Estudio Contable Ríos & Asoc."),
    # ─── Abril 2026 ──────────────────────────────────────────────────────────
    (date(2026, 4, 8),  "Mano de obra",            "Cuadrilla mantenimiento andamios - Abril",       3600.00, "Operativa",      False, "Recibo Interno",                "RI-0005", ""),
    (date(2026, 4, 15), "Suministros",             "Pinturas anticorrosivas para mantenimiento",       890.00, "Operativa",      False, "Factura",                       "F-2026-010", "Pinturerías Anypsa"),
    (date(2026, 4, 22), "Gastos de ventas",        "Visitas comerciales y viáticos vendedor",          560.00, "Ventas",         False, "Recibo Interno",                "RI-0006", ""),
    (date(2026, 4, 28), "Vehículos",               "Camioneta de reparto para traslado de andamios", 15800.00, "Activos",        False, "Factura",                       "F-2026-011", "Auto Perú SAC"),
    # ─── Mayo 2026 ───────────────────────────────────────────────────────────
    (date(2026, 5, 3),  "Mejoras a Local",         "Remodelación y pintura interior oficina Miraflores", 6500.00, "Activos",    False, "Factura",                       "F-2026-019", "Remodelaciones Lima SAC"),
    (date(2026, 5, 8),  "Materia prima",           "Tablas y maderas soporte andamios - Mayo",       2400.00, "Operativa",      False, "Factura",                       "F-2026-012", "Maderería El Bosque SAC"),
    (date(2026, 5, 15), "Transporte",              "Alquiler grúa montaje Miraflores",               2100.00, "Operativa",      False, "Factura",                       "F-2026-013", "Grúas Pesadas Perú SAC"),
    (date(2026, 5, 20), "Alquiler de andamios",    "Subcontrato andamios obra Barranco",             2800.00, "Operativa",      False, "Factura",                       "F-2026-014", "Andamios del Pacífico EIRL"),
    (date(2026, 5, 27), "Gastos administrativos",  "Renovación licencias software - Mayo",             750.00, "Administrativa", False, "Factura",                       "F-2026-015", "Microsoft / Google"),
    # ─── Junio 2026 ──────────────────────────────────────────────────────────
    (date(2026, 6, 5),  "Mano de obra",            "Cuadrilla instalación proyecto Jesús María",     4800.00, "Operativa",      False, "Recibo Interno",                "RI-0007", ""),
    (date(2026, 6, 10), "Gastos de ventas",        "Publicidad redes sociales - Junio",                400.00, "Ventas",         False, "Factura",                       "F-2026-016", "Agencia Digital Éxito"),
    (date(2026, 6, 15), "Maquinaria y Equipos",    "Andamios usados para reacondicionamiento",        3100.00, "Activos",        False, "Factura",                       "F-2026-017", "Construcciones y Andamios Lima"),
]


def run():
    db = SessionLocal()
    try:
        existing = db.query(Gasto).count()
        if existing > 0:
            print(f"Ya existen {existing} gastos. Seed omitido.")
            return

        for fecha, cat, desc, monto, area, es_rec, tipo_comp, num_comp, prov in DATA:
            tipo_doc, num_doc = DOCS_PROVEEDOR.get(prov, ("", ""))
            g = Gasto(
                fecha=fecha,
                categoria=cat,
                descripcion=desc,
                monto=monto,
                area=area,
                es_recurrente=es_rec,
                recurrente_activo=es_rec,
                tipo_comprobante=tipo_comp or None,
                numero_comprobante=num_comp or None,
                proveedor=prov or None,
                tipo_documento=tipo_doc or None,
                numero_documento=num_doc or None,
                created_at=fecha,
            )
            db.add(g)

        db.commit()
        recurrentes = sum(1 for *_, es_rec, t, n, p in DATA if es_rec)
        print(f"✓ {len(DATA)} gastos insertados ({recurrentes} recurrentes)")
    finally:
        db.close()


if __name__ == "__main__":
    run()
