# Backup — módulo "Detracciones por Depositar" eliminado 2026-07-21

Se eliminó el módulo completo a pedido del usuario para rehacerlo desde cero
en otra sesión. La estructura de línea de detalle del TXT (Banco de la Nación)
nunca se pudo confirmar contra una fuente oficial verificable durante la
sesión en la que se eliminó — la única versión validada contra datos reales
usaba 107 bytes por línea de detalle y corregía un rechazo real documentado
del banco ("El tipo de documento: 2 no es válido. Los tipos reconocidos son
1 ó 6"). Esa versión es la que quedó respaldada aquí.

## Archivos respaldados

- `detracciones_router.py` — router completo original:
  `backend/app/routers/detracciones.py`
  (endpoints: /pendientes, /resumen-kpis, /generar-txt, /ventas/{id}/marcar-pagada,
  /gastos/{id}/marcar-depositada)
- `DetraccionesPanel.jsx` — panel de frontend original:
  `frontend/src/components/gastos/DetraccionesPanel.jsx`

## Qué se quitó del resto del sistema (no respaldado como archivo, ver diffs)

- `backend/main.py`: import `detracciones as detracciones_router` y
  `app.include_router(detracciones_router.router, ...)`
- `frontend/src/pages/Gastos.jsx`: import de `DetraccionesPanel`, la entrada
  "Detracciones por Depositar" en el selector de sub-pestañas de Pagos
  Tributarios, y el render `{tribSubTab === "detracciones" && <DetraccionesPanel />}`
- `frontend/src/api/comercialApi.js`: las 5 funciones que llamaban a
  `/api/detracciones/*` (getDetraccionesPendientes, getResumenDetraccionesKpis,
  generarTxtDetracciones, marcarDetraccionVentaPagada, marcarDetraccionGastoDepositada)

## Qué NO se tocó (sigue intacto en el sistema)

- Los campos `tiene_detraccion`, `tasa_detraccion`, `monto_detraccion`,
  `concepto_detraccion`, `fecha_limite_detraccion`, `detraccion_pagada` /
  `detraccion_depositada` en `VentaComercial` y `Gasto` — se siguen usando
  desde Ventas y Gastos para marcar/editar detracciones en el comprobante.
- `Proveedor.numero_cuenta` (agregado en esta misma sesión) — queda disponible
  para cuando se rehaga el generador de TXT.
- La migración `_run_detracciones_migrations()` en `main.py` — sigue
  ejecutándose porque esas columnas las usan Ventas/Gastos directamente.
