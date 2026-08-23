import axios from "axios";

const API = axios.create({ baseURL: `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api` });

API.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("gp_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      // Sin respuesta del servidor → backend caído
      window.dispatchEvent(new CustomEvent("server:offline"));
      return Promise.reject(error);
    }
    if (error.response.status === 401) {
      // Token inválido o expirado → limpiar sesión y redirigir
      localStorage.removeItem("gp_token");
      localStorage.removeItem("gp_usuario");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ── Clientes ─────────────────────────────────────────────────────────────────
export const getClientes = (params) => API.get("/clientes", { params }).then(r => r.data);
export const buscarClientes = (q) => API.get("/clientes/buscar", { params: { q } }).then(r => r.data);
export const getCliente  = (id)     => API.get(`/clientes/${id}`).then(r => r.data);
export const createCliente = (data) => API.post("/clientes", data).then(r => r.data);
export const updateCliente = (id, data) => API.put(`/clientes/${id}`, data).then(r => r.data);
export const deleteCliente = (id)   => API.delete(`/clientes/${id}`).then(r => r.data);
export const getHistorialCliente = (id) => API.get(`/clientes/${id}/historial`).then(r => r.data);
export const getEstadoCuentaCliente = (id, params) =>
  API.get(`/clientes/${id}/estado-cuenta`, { params, responseType: "blob" }).then(r => r.data);
export const getEstadoCuentaResumen = (id, params) =>
  API.get(`/clientes/${id}/estado-cuenta/resumen`, { params }).then(r => r.data);
export const enviarEstadoCuentaCliente = (id, data) =>
  API.post(`/clientes/${id}/estado-cuenta/enviar`, data).then(r => r.data);

// ── Documentos de cliente ─────────────────────────────────────────────────────
export const getDocumentos = (cid, params = {}) =>
  API.get(`/clientes/${cid}/documentos`, { params }).then(r => r.data);
export const subirDocumento = (cid, formData) =>
  API.post(`/clientes/${cid}/documentos`, formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const eliminarDocumento = (cid, did) =>
  API.delete(`/clientes/${cid}/documentos/${did}`).then(r => r.data);
export const actualizarEstadoDocumento = (cid, did, estado) =>
  API.patch(`/clientes/${cid}/documentos/${did}/estado`, null, { params: { estado } }).then(r => r.data);
// El router de /clientes exige login (dependencies=_mod("clientes") en
// main.py) igual que /ventas — no se puede navegar directo a la URL (no
// lleva el header Authorization), se descarga como blob vía axios.
export const getDocumentoBlob = (cid, did, download = false) =>
  API.get(`/clientes/${cid}/documentos/${did}`, {
    params: download ? { download: true } : {},
    responseType: "blob",
  }).then(r => r.data);

// ── Comprobantes de venta ─────────────────────────────────────────────────────
export const subirComprobante = (ventaId, formData) =>
  API.post(`/ventas/${ventaId}/comprobante`, formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const eliminarComprobante = (ventaId) =>
  API.delete(`/ventas/${ventaId}/comprobante`).then(r => r.data);
// El router de /ventas exige login (dependencies=_mod("ventas") en main.py),
// así que el PDF original no puede abrirse con una URL directa vía
// window.open (no lleva el header Authorization) — se descarga como blob vía
// axios, que sí lo adjunta mediante el interceptor de arriba.
export const getComprobanteBlob = (ventaId, download = false) =>
  API.get(`/ventas/${ventaId}/comprobante`, {
    params: download ? { download: true } : {},
    responseType: "blob",
  }).then(r => r.data);

// ── Documentos de Sustento (vista general) ────────────────────────────────────
export const getTodosDocumentos = (params = {}) =>
  API.get("/documentos-sustento", { params }).then(r => r.data);

// ── Comprobantes ──────────────────────────────────────────────────────────────
export const getComprobantes      = (params = {}) => API.get("/comprobantes", { params }).then(r => r.data);
export const getComprobante       = (id)           => API.get(`/comprobantes/${id}`).then(r => r.data);
export const createComprobante    = (data)         => API.post("/comprobantes", data).then(r => r.data);
export const updateComprobante    = (id, data)     => API.put(`/comprobantes/${id}`, data).then(r => r.data);
export const deleteComprobante    = (id)           => API.delete(`/comprobantes/${id}`).then(r => r.data);
export const getEliminarCascadaPreview = (id)      => API.get(`/comprobantes/${id}/eliminar-cascada/preview`).then(r => r.data);
export const getFacturasPorCliente = (ruc)         => API.get(`/comprobantes/por-cliente/${ruc}`).then(r => r.data);
export const eliminarComprobanteCascada = (id)     => API.delete(`/comprobantes/${id}/eliminar-cascada`).then(r => r.data);
export const eliminarComprobantesMasivo = (ids)    => API.delete("/comprobantes/eliminar-masivo", { data: { ids } }).then(r => r.data);
export const exportarComprobantes = (params = {})  => API.get("/comprobantes/exportar", { params, responseType: "blob" }).then(r => r.data);
export const getProximoCorrelativoComprobante = (tipo = "AC") => API.get("/comprobantes/proximo-correlativo", { params: { tipo } }).then(r => r.data);
export const getComprobanteImprimir = (id) => API.get(`/comprobantes/${id}/imprimir`).then(r => r.data);
export const importarComprobantePdf = (formData) =>
  API.post("/comprobantes/importar-pdf", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const anularComprobante = (id, notaCreditoId) =>
  API.post(`/comprobantes/${id}/anular`, { nota_credito_id: notaCreditoId }).then(r => r.data);
export const importarComprobanteZip = (formData) =>
  API.post("/comprobantes/importar-zip", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const confirmarImportacionZip = (comprobantes) =>
  API.post("/comprobantes/importar-zip/confirmar", { comprobantes }).then(r => r.data);
export const enviarComprobantePorCorreo = (id, correo_destino) =>
  API.post(`/comprobantes/${id}/enviar-correo`, { comprobante_id: id, correo_destino }).then(r => r.data);
export const getGastoImprimir       = (id) => API.get(`/gastos/${id}/imprimir`).then(r => r.data);

// ── Comercial ────────────────────────────────────────────────────────────────
export const getResumenComercial     = () => API.get("/comercial/resumen").then(r => r.data);
export const getHistorialPorServicio = () => API.get("/comercial/historial-por-servicio").then(r => r.data);

// ── Cobranza (Módulo 3) ───────────────────────────────────────────────────────
export const getCobranza           = (params = {})        => API.get("/cobranza", { params }).then(r => r.data);
export const getResumenCobranza    = ()                   => API.get("/cobranza/resumen").then(r => r.data);
export const getMorosidadClientes  = ()                   => API.get("/cobranza/morosidad-por-cliente").then(r => r.data);
export const registrarPago         = (id, data)           => API.post(`/cobranza/${id}/pago`, data).then(r => r.data);
export const getHistorialPagos     = (id)                 => API.get(`/cobranza/${id}/historial-pagos`).then(r => r.data);
export const updatePago            = (pagoId, data)       => API.put(`/cobranza/pagos/${pagoId}`, data).then(r => r.data);
export const deletePago            = (pagoId)             => API.delete(`/cobranza/pagos/${pagoId}`).then(r => r.data);
export const extornarPago          = (pagoId, data)       => API.put(`/cobranza/pagos/${pagoId}/extornar`, data).then(r => r.data);
export const exportarCobranza      = (params = {})        => API.get("/cobranza/exportar", { params, responseType: "blob" }).then(r => r.data);
export const getPagosCobranza      = (params = {})        => API.get("/cobranza/pagos", { params }).then(r => r.data);

// ── Garantías (depósitos de clientes, no ingresos) ────────────────────────────
export const getGarantias          = (params = {})        => API.get("/garantias", { params }).then(r => r.data);
export const getResumenGarantias   = ()                   => API.get("/garantias/resumen").then(r => r.data);
export const getGarantia           = (id)                 => API.get(`/garantias/${id}`).then(r => r.data);
export const crearGarantia         = (data)               => API.post("/garantias", data).then(r => r.data);
export const actualizarGarantia    = (id, data)           => API.put(`/garantias/${id}`, data).then(r => r.data);
export const devolverGarantia      = (id, data)           => API.put(`/garantias/${id}/devolver`, data).then(r => r.data);
export const ejecutarGarantia      = (id, data)           => API.put(`/garantias/${id}/ejecutar`, data).then(r => r.data);
export const eliminarGarantia      = (id)                 => API.delete(`/garantias/${id}`).then(r => r.data);
export const eliminarDevolucionGarantia = (pagoId)        => API.delete(`/garantias/pagos/${pagoId}`).then(r => r.data);
export const getCreditosDisponibles = (clienteRuc)        => API.get(`/garantias/creditos/${clienteRuc}`).then(r => r.data);
export const aplicarCreditoGarantia = (data)               => API.post("/garantias/aplicar-credito", data).then(r => r.data);
export const getFacturasPendientesGarantia = (clienteRuc) => API.get(`/garantias/facturas-pendientes/${clienteRuc}`).then(r => r.data);
export const getRecibosInternosPendientesGarantia = (clienteRuc) => API.get(`/garantias/recibos-internos-pendientes/${clienteRuc}`).then(r => r.data);

// ── Préstamos ──────────────────────────────────────────────────────────────────
export const getPrestamos          = (params = {})        => API.get("/prestamos", { params }).then(r => r.data);
export const getResumenPrestamos   = ()                   => API.get("/prestamos/resumen").then(r => r.data);
export const getPrestamo           = (id)                 => API.get(`/prestamos/${id}`).then(r => r.data);
export const crearPrestamo         = (data)               => API.post("/prestamos", data).then(r => r.data);
export const actualizarPrestamo    = (id, data)           => API.put(`/prestamos/${id}`, data).then(r => r.data);
export const eliminarPrestamo      = (id)                 => API.delete(`/prestamos/${id}`).then(r => r.data);
export const pagarCuotaPrestamo    = (id, data)           => API.post(`/prestamos/${id}/pagar-cuota`, data).then(r => r.data);
export const editarCuotaPrestamo   = (id, cuotaId, data)  => API.put(`/prestamos/${id}/cuotas/${cuotaId}`, data).then(r => r.data);
export const eliminarCuotaPrestamo = (id, cuotaId)        => API.delete(`/prestamos/${id}/cuotas/${cuotaId}`).then(r => r.data);
export const calcularAmortizacion  = (data)               => API.post("/prestamos/calcular-amortizacion", data).then(r => r.data);
export const getCronograma         = (id)                 => API.get(`/prestamos/${id}/cronograma`).then(r => r.data);
export const guardarCronograma     = (id, cuotas)          => API.post(`/prestamos/${id}/cronograma`, { cuotas }).then(r => r.data);
export const pagarCuotaCronograma  = (id, cuotaId, data)  => API.put(`/prestamos/${id}/cuotas/${cuotaId}/pagar`, data).then(r => r.data);
export const editarFilaCronograma  = (id, cuotaId, data)  => API.put(`/prestamos/${id}/cronograma/${cuotaId}`, data).then(r => r.data);
export const eliminarFilaCronograma = (id, cuotaId)        => API.delete(`/prestamos/${id}/cronograma/${cuotaId}`).then(r => r.data);
export const importarCronogramaPdf = (formData) =>
  API.post("/prestamos/importar-cronograma-pdf", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);

// ── Cuentas Bancarias ─────────────────────────────────────────────────────────
export const getCuentasBancarias   = ()                   => API.get("/cuentas-bancarias").then(r => r.data);
export const createCuentaBancaria  = (data)               => API.post("/cuentas-bancarias", data).then(r => r.data);
export const updateCuentaBancaria  = (id, data)            => API.put(`/cuentas-bancarias/${id}`, data).then(r => r.data);
export const deleteCuentaBancaria  = (id)                  => API.delete(`/cuentas-bancarias/${id}`).then(r => r.data);

// ── Gastos (Módulo 4) ─────────────────────────────────────────────────────────
export const getGastos             = (params = {})        => API.get("/gastos", { params }).then(r => r.data);
export const getGasto              = (id)                 => API.get(`/gastos/${id}`).then(r => r.data);
export const createGasto           = (data)               => API.post("/gastos", data).then(r => r.data);
export const updateGasto           = (id, data)           => API.put(`/gastos/${id}`, data).then(r => r.data);
export const deleteGasto           = (id)                 => API.delete(`/gastos/${id}`).then(r => r.data);
export const eliminarGastosMasivo  = (ids)                => API.delete("/gastos/eliminar-masivo", { data: { ids } }).then(r => r.data);
export const getResumenGastos      = ()                   => API.get("/gastos/resumen").then(r => r.data);
export const getGastosPorCategoria = (params = {})        => API.get("/gastos/por-categoria", { params }).then(r => r.data);
export const getGastosPorArea      = ()                   => API.get("/gastos/por-area").then(r => r.data);
export const getEvolucionMensual   = ()                   => API.get("/gastos/evolucion-mensual").then(r => r.data);
export const exportarGastos        = (params = {})        => API.get("/gastos/exportar", { params, responseType: "blob" }).then(r => r.data);
export const toggleRecurrenteGasto  = (id)                 => API.post(`/gastos/${id}/toggle-recurrente`).then(r => r.data);
export const getProximoCorrelativo    = (tipo = "RI") => API.get("/gastos/proximo-correlativo", { params: { tipo } }).then(r => r.data);
export const buscarProveedoresGastos  = (q)     => API.get("/proveedores-gastos/buscar", { params: { q } }).then(r => r.data);
export const importarGastoPdf         = (formData) =>
  API.post("/gastos/importar-pdf", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const importarGastoZip         = (formData) =>
  API.post("/gastos/importar-zip", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const confirmarImportacionZipGasto = (gastos) =>
  API.post("/gastos/importar-zip/confirmar", { gastos }).then(r => r.data);
export const subirComprobanteGasto = (gastoId, formData) =>
  API.post(`/gastos/${gastoId}/comprobante`, formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const eliminarComprobanteGasto = (gastoId) =>
  API.delete(`/gastos/${gastoId}/comprobante`).then(r => r.data);
// Nota: el visor de comprobante de gasto requiere el token de autenticación
// (el router de /gastos exige login), así que no puede abrirse con una URL
// directa vía window.open — debe descargarse como blob a través de axios
// (que sí adjunta el header Authorization mediante el interceptor de arriba).
export const getComprobanteGastoBlob = (gastoId, download = false) =>
  API.get(`/gastos/${gastoId}/comprobante`, {
    params: download ? { download: true } : {},
    responseType: "blob",
  }).then(r => r.data);

// ── Cuentas por Pagar (sub-módulo de Gastos) ─────────────────────────────────
export const getCuentasPorPagar       = (params = {}) => API.get("/gastos/cuentas-por-pagar", { params }).then(r => r.data);
export const getResumenCuentasPorPagar = ()            => API.get("/gastos/cuentas-por-pagar/resumen").then(r => r.data);
export const exportarCuentasPorPagar  = (params = {}) => API.get("/gastos/cuentas-por-pagar/exportar", { params, responseType: "blob" }).then(r => r.data);
export const registrarPagoGasto       = (id, data)    => API.post(`/gastos/${id}/pago`, data).then(r => r.data);
export const getHistorialPagosGasto   = (id)          => API.get(`/gastos/${id}/historial-pagos`).then(r => r.data);
export const updatePagoGasto          = (pagoId, data) => API.put(`/gastos/pagos/${pagoId}`, data).then(r => r.data);
export const deletePagoGasto          = (pagoId)      => API.delete(`/gastos/pagos/${pagoId}`).then(r => r.data);
export const getPagosGastos           = (params = {}) => API.get("/gastos/pagos", { params }).then(r => r.data);

// ── Pagos Tributarios (sub-módulo de Gastos) ──────────────────────────────────
export const getPagosTributarios       = (params = {}) => API.get("/gastos/pagos-tributarios", { params }).then(r => r.data);
export const getResumenPagosTributarios = ()            => API.get("/gastos/pagos-tributarios/resumen-kpis").then(r => r.data);
export const exportarPagosTributarios  = (params = {}) => API.get("/gastos/pagos-tributarios/exportar", { params, responseType: "blob" }).then(r => r.data);

// ── Detracciones (Ventas + Gastos) ────────────────────────────────────────────
export const getDetraccionesPendientes = (params = {}) => API.get("/detracciones/pendientes", { params }).then(r => r.data);
export const getResumenDetraccionesKpis = ()            => API.get("/detracciones/resumen-kpis").then(r => r.data);
// Devuelve la respuesta completa (no solo .data): el nombre real del archivo
// (con el N° de lote asignado por el servidor) viaja en el header
// Content-Disposition, que el frontend necesita leer.
export const generarTxtDetracciones    = (params = {}) => API.get("/detracciones/generar-txt", { params, responseType: "blob" });
export const marcarDetraccionVentaPagada = (id)         => API.put(`/detracciones/ventas/${id}/marcar-pagada`).then(r => r.data);
export const marcarDetraccionGastoDepositada = (id)     => API.put(`/detracciones/gastos/${id}/marcar-depositada`).then(r => r.data);

// ── Lotes de Detracciones Por Pagar (carrito manual) ──────────────────────────
export const getLotesDetraccion   = ()                  => API.get("/detracciones/lotes").then(r => r.data);
export const crearLoteDetraccion  = ()                  => API.post("/detracciones/lotes").then(r => r.data);
export const getDetalleLoteDetraccion = (loteId)        => API.get(`/detracciones/lotes/${loteId}`).then(r => r.data);
export const agregarGastosLoteDetraccion = (loteId, gastoIds) =>
  API.post(`/detracciones/lotes/${loteId}/agregar-gastos`, { gasto_ids: gastoIds }).then(r => r.data);
export const quitarGastoLoteDetraccion = (loteId, gastoId) =>
  API.delete(`/detracciones/lotes/${loteId}/gastos/${gastoId}`).then(r => r.data);
// Mismo motivo que generarTxtDetracciones: el nombre real del archivo viaja
// en Content-Disposition y el frontend lo necesita para el download.
export const generarTxtLoteDetraccion = (loteId)        => API.get(`/detracciones/lotes/${loteId}/generar-txt`, { responseType: "blob" });
export const marcarLoteDetraccionPagado = (loteId, data) => API.put(`/detracciones/lotes/${loteId}/marcar-pagado`, data).then(r => r.data);
export const revertirPagoLoteDetraccion = (loteId)       => API.delete(`/detracciones/lotes/${loteId}/pago`).then(r => r.data);

// ── Órdenes de Pago (Cuentas por Pagar — pago consolidado de varias facturas) ──
export const getOrdenesPago         = ()                  => API.get("/ordenes-pago").then(r => r.data);
export const crearOrdenPago         = (data)               => API.post("/ordenes-pago", data).then(r => r.data);
export const getDetalleOrdenPago    = (ordenId)             => API.get(`/ordenes-pago/${ordenId}/detalle`).then(r => r.data);
export const editarDetalleOrdenPago = (ordenId, detalleId, data) =>
  API.put(`/ordenes-pago/${ordenId}/detalle/${detalleId}`, data).then(r => r.data);
export const eliminarOrdenPago      = (ordenId)             => API.delete(`/ordenes-pago/${ordenId}`).then(r => r.data);
export const getDocumentosPendientesOrdenPago = (params = {}) =>
  API.get("/ordenes-pago/documentos-pendientes", { params }).then(r => r.data);
export const getOrdenPagoPdf = (ordenId) =>
  API.get(`/ordenes-pago/${ordenId}/pdf`, { responseType: "blob" }).then(r => r.data);

// ── Órdenes de Cobro (Cuentas por Cobrar — cobro consolidado de varios documentos) ──
export const getOrdenesCobro         = (params = {})       => API.get("/ordenes-cobro", { params }).then(r => r.data);
export const crearOrdenCobro         = (data)               => API.post("/ordenes-cobro", data).then(r => r.data);
export const getDetalleOrdenCobro    = (ordenId)             => API.get(`/ordenes-cobro/${ordenId}/detalle`).then(r => r.data);
export const editarDetalleOrdenCobro = (ordenId, detalleId, data) =>
  API.put(`/ordenes-cobro/${ordenId}/detalle/${detalleId}`, data).then(r => r.data);
export const eliminarOrdenCobro      = (ordenId)             => API.delete(`/ordenes-cobro/${ordenId}`).then(r => r.data);
export const getDocumentosPendientesOrdenCobro = (params = {}) =>
  API.get("/ordenes-cobro/documentos-pendientes", { params }).then(r => r.data);
export const getOrdenCobroPdf = (ordenId) =>
  API.get(`/ordenes-cobro/${ordenId}/pdf`, { responseType: "blob" }).then(r => r.data);


// ── Flujo de Caja (Módulo 5) ──────────────────────────────────────────────────
export const getFlujoCajaKpis         = ()            => API.get("/flujo-caja/resumen-kpis").then(r => r.data);
export const getFlujoCajaProyectado   = (meses = 6)   => API.get("/flujo-caja/proyectado", { params: { meses } }).then(r => r.data);
export const exportarFlujoCaja        = ()            => API.get("/flujo-caja/exportar", { responseType: "blob" }).then(r => r.data);

// ── Conciliación Bancaria (Módulo 5) ─────────────────────────────────────────
export const getConciliacionCuentas         = ()         => API.get("/conciliacion/cuentas").then(r => r.data);
export const getHistorialConciliaciones     = ()         => API.get("/conciliacion/historial").then(r => r.data);
export const descargarPlantillaConciliacion = ()         => API.get("/conciliacion/descargar-plantilla", { responseType: "blob" }).then(r => r.data);
export const importarEstadoCuenta           = (formData) => API.post("/conciliacion/importar", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const importarEstadoCuentaPdf        = (formData) => API.post("/conciliacion/importar-pdf", formData, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
export const getPreviewConciliacion       = (id)          => API.get(`/conciliacion/preview/${id}`).then(r => r.data);
export const confirmarConciliacion        = (id)          => API.post(`/conciliacion/confirmar/${id}`).then(r => r.data);
export const getMovimientosConciliacion   = (id)          => API.get(`/conciliacion/${id}/movimientos`).then(r => r.data);
export const toggleConciliado             = (id, movId)   => API.put(`/conciliacion/${id}/movimientos/${movId}/conciliar`).then(r => r.data);
export const desconciliarMovimiento       = (movId)        => API.put(`/conciliacion/movimientos/${movId}/desconciliar`).then(r => r.data);
export const getDetalleMovimientoConciliacion = (movId)    => API.get(`/conciliacion/movimientos/${movId}/detalle`).then(r => r.data);
export const registrarEnSistema           = (id, movId)   => API.post(`/conciliacion/${id}/registrar-en-sistema/${movId}`).then(r => r.data);
export const guardarConciliacion          = (id)          => API.put(`/conciliacion/${id}/guardar`).then(r => r.data);
export const exportarConciliacion             = (id)        => API.get(`/conciliacion/${id}/exportar`, { responseType: "blob" }).then(r => r.data);
export const exportarConciliados              = (id)        => API.get(`/conciliacion/${id}/exportar-conciliados`, { responseType: "blob" }).then(r => r.data);
export const registrarGastosBancariosBulk     = (id)        => API.post(`/conciliacion/${id}/registrar-gastos-bancarios`).then(r => r.data);
export const registrarGastoBancarioIndividual = (id, movId) => API.post(`/conciliacion/${id}/movimientos/${movId}/registrar-gasto-bancario`).then(r => r.data);
export const eliminarConciliacion             = (id)        => API.delete(`/conciliacion/${id}`).then(r => r.data);
export const actualizarConciliacion           = (id)        => API.put(`/conciliacion/${id}/actualizar`).then(r => r.data);
export const reconciliarMovimiento            = (movId)     => API.put(`/conciliacion/movimientos/${movId}/reconciliar`).then(r => r.data);

// ── Utils ─────────────────────────────────────────────────────────────────────
export const consultarRuc = (ruc) => API.get(`/utils/consultar-ruc/${ruc}`).then(r => r.data);

// ── Órdenes de Servicio (Módulo 6) ────────────────────────────────────────────
export const getOrdenes                 = (params = {}) => API.get("/ordenes", { params }).then(r => r.data);
export const getOrden                   = (id)           => API.get(`/ordenes/${id}`).then(r => r.data);
export const createOrden                = (data)         => API.post("/ordenes", data).then(r => r.data);
export const updateOrden                = (id, data)     => API.put(`/ordenes/${id}`, data).then(r => r.data);
export const deleteOrden                = (id)           => API.delete(`/ordenes/${id}`).then(r => r.data);
export const getResumenKpisOrdenes      = ()             => API.get("/ordenes/resumen-kpis").then(r => r.data);
export const getCalendarioOrdenes       = (mes, anio)    => API.get("/ordenes/calendario", { params: { mes, "año": anio } }).then(r => r.data);
export const getGastosDeOrden           = (id)           => API.get(`/ordenes/${id}/gastos`).then(r => r.data);
export const exportarOrdenes            = (params = {})  => API.get("/ordenes/exportar", { params, responseType: "blob" }).then(r => r.data);
export const getProximoCorrelativoOrden = ()             => API.get("/ordenes/proximo-correlativo").then(r => r.data);

// ── Proveedores (Módulo 7) ────────────────────────────────────────────────────
export const getProveedores               = (params = {}) => API.get("/proveedores", { params }).then(r => r.data);
export const getProveedor                 = (id)           => API.get(`/proveedores/${id}`).then(r => r.data);
export const createProveedor              = (data)         => API.post("/proveedores", data).then(r => r.data);
export const updateProveedor              = (id, data)     => API.put(`/proveedores/${id}`, data).then(r => r.data);
export const deleteProveedor              = (id)           => API.delete(`/proveedores/${id}`).then(r => r.data);
export const getResumenKpisProveedores    = ()             => API.get("/proveedores/resumen-kpis").then(r => r.data);
export const getHistorialComprasProveedor = (id, params = {}) => API.get(`/proveedores/${id}/historial-compras`, { params }).then(r => r.data);
export const getCuentasPorPagarProveedor  = (id)           => API.get(`/proveedores/${id}/cuentas-por-pagar`).then(r => r.data);
export const exportarProveedores          = (params = {})  => API.get("/proveedores/exportar", { params, responseType: "blob" }).then(r => r.data);
export const importarProveedoresDesdeGastos = ()           => API.post("/proveedores/importar-desde-gastos").then(r => r.data);

// ── Indicadores KPI (Módulo 9) ────────────────────────────────────────────────
export const getIndicadoresResumen      = (periodo = "mes") => API.get("/indicadores/resumen", { params: { periodo } }).then(r => r.data);
export const getIndicadoresRentabilidad = (params = {}) => API.get("/indicadores/rentabilidad", { params }).then(r => r.data);
export const getIndicadoresLiquidez     = (params = {}) => API.get("/indicadores/liquidez", { params }).then(r => r.data);
export const getIndicadoresCobranza     = (params = {}) => API.get("/indicadores/cobranza", { params }).then(r => r.data);
export const getIndicadoresGastos       = (params = {}) => API.get("/indicadores/gastos", { params }).then(r => r.data);
export const getIndicadoresVentas       = (params = {}) => API.get("/indicadores/ventas", { params }).then(r => r.data);
export const getIndicadoresEvolucion    = (meses = 6)    => API.get("/indicadores/evolucion", { params: { meses } }).then(r => r.data);
export const getIndicadoresSaludGeneral = (params = {}) => API.get("/indicadores/salud-general", { params }).then(r => r.data);
export const getDetalleVentas      = (periodo = "mes") => API.get("/indicadores/detalle/ventas", { params: { periodo } }).then(r => r.data);
export const getDetalleGastos      = (periodo = "mes") => API.get("/indicadores/detalle/gastos", { params: { periodo } }).then(r => r.data);
export const getDetalleGanaste     = (periodo = "mes") => API.get("/indicadores/detalle/ganaste", { params: { periodo } }).then(r => r.data);
export const getDetalleTeDeben     = ()                => API.get("/indicadores/detalle/te-deben").then(r => r.data);
export const getDetalleEnBanco     = ()                => API.get("/indicadores/detalle/en-banco").then(r => r.data);
export const getDetalleDebesPagar  = ()                => API.get("/indicadores/detalle/debes-pagar").then(r => r.data);
export const exportarIndicadores        = (params = {}) => API.get("/indicadores/exportar", { params, responseType: "blob" }).then(r => r.data);

// ── Cotizaciones (Módulo 2) ───────────────────────────────────────────────────
export const getCotizaciones = (params = {}) => API.get("/cotizaciones", { params }).then(r => r.data);
export const getCotizacion   = (id)          => API.get(`/cotizaciones/${id}`).then(r => r.data);
export const createCotizacion = (data)       => API.post("/cotizaciones", data).then(r => r.data);
export const updateCotizacion = (id, data)   => API.put(`/cotizaciones/${id}`, data).then(r => r.data);
export const deleteCotizacion = (id)         => API.delete(`/cotizaciones/${id}`).then(r => r.data);
export const convertirVenta   = (id)         => API.post(`/cotizaciones/${id}/convertir-venta`).then(r => r.data);
