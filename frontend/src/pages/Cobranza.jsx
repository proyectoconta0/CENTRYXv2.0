import React, { useState, useEffect, useCallback, useMemo } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import {
  getCobranza, getResumenCobranza, getMorosidadClientes,
  registrarPago, getHistorialPagos,
  getCuentasBancarias,
  updatePago, deletePago, exportarCobranza,
  eliminarOrdenCobro, getPagosCobranza, extornarPago, eliminarGarantia,
  getOrdenCobroPdf,
  getMorosidadDetalle, enviarRecordatorioMorosidad,
} from "../api/comercialApi";
import { getClientes } from "../api/comercialApi";
import ModalCrearOrdenCobro from "../components/cobranza/ModalCrearOrdenCobro";
import ModalDetalleOrdenCobro from "../components/cobranza/ModalDetalleOrdenCobro";
import GarantiasTab from "../components/cobranza/GarantiasTab";
import Toast from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  HiSearch, HiEye, HiX, HiCheckCircle, HiExclamationCircle,
  HiPencil, HiTrash, HiDownload, HiPrinter,
} from "react-icons/hi";

// ─── Constantes ───────────────────────────────────────────────────────────────

const METODOS_PAGO = ["Efectivo", "Transferencia", "Depósito", "Cheque", "Yape o Plin"];

const TOLERANCIA_REDONDEO = 5.00; // S/ 5.00 — debe coincidir con backend/app/routers/cobranza.py

const METODOS_COBRO_FILTRO = ["Todos", "Efectivo", "Transferencia", "Cheque"];

const SEM_OPTIONS = [
  { value: "",                  label: "Todos" },
  { value: "verde",             label: "🟢  Al día" },
  { value: "amarillo",          label: "🟡  Vencido 1-15 días" },
  { value: "rojo",              label: "🔴  Vencido +15 días" },
  { value: "pagada",            label: "✅  Cobrados" },
  { value: "garantia_completo", label: "💎  Aplicado c/Garantía" },
  { value: "garantia_parcial",  label: "💎  Parcial c/Garantía" },
];

const PER_PAGE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("es-PE", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function hoy() {
  return new Date().toISOString().split("T")[0];
}

function parsearError(err) {
  if (!err?.response) return "No se pudo conectar al servidor. Verifique que el backend está activo.";
  const detail = err.response?.data?.detail;
  if (!detail) return `Error del servidor (${err.response.status})`;
  if (Array.isArray(detail)) return "Error de validación: " + detail.map(e => e.msg).join(", ");
  return String(detail);
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SemaforoIcon({ valor }) {
  if (valor === "pagada") return <HiCheckCircle className="w-5 h-5 text-green-500" />;
  const palette = { verde: "bg-green-500", amarillo: "bg-yellow-400", rojo: "bg-red-500" };
  const labels  = { verde: "Al día", amarillo: "Vencido 1-15 días", rojo: "Vencido +15 días" };
  return <span className={`inline-block w-3 h-3 rounded-full ${palette[valor] || "bg-gray-400"}`} title={labels[valor]} />;
}

// Traduce valores de estado_cobranza (backend) a la terminología de Cobranza
// en la interfaz — el valor almacenado sigue siendo "Pago Parcial"/"Pagada",
// solo cambia lo que ve el usuario.
const ESTADO_COBRANZA_LABEL = {
  "Pago Parcial": "Cobro Parcial",
  "Pagada":       "Cobrado",
};

function EstadoBadge({ estado, pagadoConGarantia }) {
  if (pagadoConGarantia) {
    return estado === "Pagada" ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 whitespace-nowrap">💎 Aplicado c/Garantía</span>
    ) : (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 whitespace-nowrap">💎 Parcial c/Garantía</span>
    );
  }
  const map = {
    "Pendiente":    "bg-blue-100 text-blue-700",
    "Pago Parcial": "bg-yellow-100 text-yellow-700",
    "Pagada":       "bg-green-100 text-green-700",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[estado] || "bg-gray-100 text-gray-600"}`}>
      {ESTADO_COBRANZA_LABEL[estado] || estado || "—"}
    </span>
  );
}

// Escenario de la última Nota de Crédito vinculada a esta factura (ver
// tipo_nota_credito en comprobantes.py/_aplicar_nc). Para "descuento_parcial"
// la factura sigue con su estado_cobranza normal (Pendiente/Pago
// Parcial/Pagada) — este badge se muestra ADEMÁS del EstadoBadge, no en su
// reemplazo. Para los otros dos escenarios estado_cobranza ya es "Anulada".
const NOTA_CREDITO_BADGE = {
  anulacion_simple:  { texto: "🚫 Anulada",        clase: "bg-gray-100 text-gray-600" },
  devolucion_cobro:  { texto: "↩️ Devuelta",       clase: "bg-red-100 text-red-700" },
  descuento_parcial: { texto: "💸 Con descuento",  clase: "bg-orange-100 text-orange-700" },
};

function NotaCreditoBadge({ tipo }) {
  const cfg = NOTA_CREDITO_BADGE[tipo];
  if (!cfg) return null;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.clase}`}>
      {cfg.texto}
    </span>
  );
}

// Modal "Ver Detalle" de un cobro individual en Lista de Cobros — a
// diferencia de ModalDetalleOrdenCobro, no necesita fetch propio: la fila ya
// trae todos los campos (listar_pagos_cobranza los devuelve completos).
function ModalDetalleCobro({ pago, onClose }) {
  if (!pago) return null;
  const filas = [
    ["Fecha de cobro", fmtFecha(pago.fecha_cobro)],
    ["Cliente", pago.cliente_nombre || "—"],
    ["N° Documento", pago.numero_documento || "—"],
    ["Descripción", pago.descripcion || "—"],
    ["Monto cobrado", fmtS(pago.monto_cobrado)],
    ["Método de pago", pago.metodo_cobro || "—"],
    ["Banco", pago.banco || "—"],
    ["N° Cuenta", pago.numero_cuenta || "—"],
    ["N° Operación", pago.numero_operacion || "—"],
    ["Registrado por", pago.creado_por || "—"],
    ["Fecha registro", pago.creado_en || "—"],
  ];
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Detalle del Cobro</h2>
            <p className="text-sm text-gray-500 mt-0.5">{pago.numero_documento || "—"}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5"><HiX className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-2.5">
          {filas.map(([label, valor]) => (
            <div key={label} className="flex items-center justify-between text-sm gap-4">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-gray-800 text-right">{valor}</span>
            </div>
          ))}
          {pago.extornado && (
            <div className="text-xs text-red-600 font-medium mt-2 pt-2 border-t border-gray-100 space-y-0.5">
              <p>↩️ Extornado el: {pago.fecha_extorno || "—"}</p>
              {pago.motivo_extorno && <p>📝 Motivo: {pago.motivo_extorno}</p>}
            </div>
          )}
        </div>
        <div className="flex px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// Mismo criterio que _semaforo() en backend/app/routers/cobranza.py (el que
// alimenta SemaforoIcon en la tabla principal de Cuentas por Cobrar / la
// pestaña Morosidad por Cliente): <=0 días → verde, 1-15 → amarillo, >15 →
// rojo. El detalle del modal reutiliza este mismo cálculo y SemaforoIcon
// para que el color coincida exactamente con la tabla principal.
function semaforoPorDiasVencido(dias) {
  if (dias <= 0) return "verde";
  if (dias <= 15) return "amarillo";
  return "rojo";
}

// Mismas clases de texto que usa la columna "Días de Mora" en la pestaña
// Morosidad por Cliente (ver más abajo, m.dias_mora_max).
const TEXTO_DIAS_VENCIDO = { verde: "text-green-600", amarillo: "text-yellow-600", rojo: "text-red-600 font-medium" };

function ModalDetalleMorosidad({ ruc, onClose, onEnviarRecordatorio, enviandoRecordatorio }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ruc) return;
    setLoading(true);
    setError("");
    getMorosidadDetalle(ruc)
      .then(setData)
      .catch(() => setError("No se pudo cargar el detalle de morosidad."))
      .finally(() => setLoading(false));
  }, [ruc]);

  if (!ruc) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">
              {data?.razon_social || "Cliente"} — Detalle de Morosidad
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{ruc}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5"><HiX className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-12">Cargando…</p>
          ) : error ? (
            <p className="text-center text-red-500 text-sm py-12">{error}</p>
          ) : !data?.facturas?.length ? (
            <p className="text-center text-gray-400 text-sm py-12">Sin facturas vencidas para este cliente</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left   text-xs font-semibold text-gray-500 uppercase">N° Factura</th>
                    <th className="px-3 py-2 text-left   text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                    <th className="px-3 py-2 text-left   text-xs font-semibold text-gray-500 uppercase">F. Emisión</th>
                    <th className="px-3 py-2 text-left   text-xs font-semibold text-gray-500 uppercase">Vencimiento</th>
                    <th className="px-3 py-2 text-right  text-xs font-semibold text-gray-500 uppercase">Monto Total</th>
                    <th className="px-3 py-2 text-right  text-xs font-semibold text-gray-500 uppercase">Saldo Pendiente</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Días Vencido</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">🚦</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.facturas.map((f, i) => {
                    const sem = semaforoPorDiasVencido(f.dias_vencido);
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{f.numero_factura || "—"}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{f.tipo_documento}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(f.fecha_emision)}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(f.fecha_vencimiento)}</td>
                        <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(f.monto_total)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600 whitespace-nowrap">{fmtS(f.saldo_pendiente)}</td>
                        <td className={`px-3 py-2 text-center whitespace-nowrap ${TEXTO_DIAS_VENCIDO[sem]}`}>{f.dias_vencido}</td>
                        <td className="px-3 py-2 text-center"><div className="flex justify-center"><SemaforoIcon valor={sem} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && !error && data?.facturas?.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm bg-gray-50">
            <span className="font-semibold text-gray-700">
              TOTAL DEUDA: <span className="text-red-600">{fmtS(data.total_deuda)}</span>
            </span>
            <span className="font-semibold text-gray-700">PROMEDIO: {data.dias_promedio} días</span>
          </div>
        )}

        <div className="flex gap-3 px-6 pb-6 pt-3">
          <button
            onClick={() => onEnviarRecordatorio(ruc)}
            disabled={enviandoRecordatorio || loading || !data?.facturas?.length}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {enviandoRecordatorio ? "Enviando…" : "📧 Enviar recordatorio"}
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, colorBorder, colorText, colorRing, onClick, isActive }) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      className={[
        "bg-white rounded-xl border-l-4 p-4 transition-all select-none",
        colorBorder,
        clickable ? "cursor-pointer" : "",
        isActive
          ? `ring-2 ${colorRing} shadow-lg`
          : clickable ? "shadow-sm hover:shadow-md" : "shadow-sm",
      ].join(" ")}
    >
      <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 ${colorText}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 truncate" title={sub}>{sub}</p>}
      {isActive && (
        <p className={`text-xs font-semibold mt-1.5 ${colorText} flex items-center gap-1`}>
          <span>✓</span> Filtro activo
        </p>
      )}
    </div>
  );
}

// Campos dinámicos reutilizables según método de pago
// Transferencia / Depósito → Banco + N° Cuenta
// Cheque                   → Banco + N° Cheque
function CamposMetodoPago({ form, setForm, cuentasBancarias, opcionesBanco }) {
  if (form.metodo_pago === "Transferencia" || form.metodo_pago === "Depósito") {
    return (
      <div className="space-y-3 border-t border-gray-100 pt-3">
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">Banco</label>
          {cuentasBancarias.length > 0 ? (
            <select value={form.banco}
              onChange={e => {
                const sel = cuentasBancarias.find(c => c.banco === e.target.value.split(" — ")[0]);
                setForm(f => ({ ...f, banco: e.target.value, numero_cuenta: sel ? sel.numero_cuenta : "" }));
              }}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleccionar cuenta bancaria…</option>
              {opcionesBanco.map(o => <option key={o} value={o}>{o}</option>)}
              <option value="__manual__">Otro (ingresar manualmente)</option>
            </select>
          ) : (
            <input type="text" value={form.banco} placeholder="Nombre del banco"
              onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">N° de Cuenta Bancaria</label>
          <input type="text" value={form.numero_cuenta} placeholder="Ej: 191-123456789-0-12"
            onChange={e => setForm(f => ({ ...f, numero_cuenta: e.target.value }))}
            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    );
  }
  if (form.metodo_pago === "Cheque") {
    return (
      <div className="space-y-3 border-t border-gray-100 pt-3">
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">Banco</label>
          {cuentasBancarias.length > 0 ? (
            <select value={form.banco}
              onChange={e => setForm(f => ({ ...f, banco: e.target.value.split(" — ")[0] }))}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleccionar banco…</option>
              {cuentasBancarias.map(c => <option key={c.id} value={c.banco}>{c.banco}</option>)}
              <option value="__manual__">Otro (ingresar manualmente)</option>
            </select>
          ) : (
            <input type="text" value={form.banco} placeholder="Nombre del banco"
              onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">N° de Cheque</label>
          <input type="text" value={form.numero_cheque} placeholder="Ej: 0001234"
            onChange={e => setForm(f => ({ ...f, numero_cheque: e.target.value }))}
            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    );
  }
  return null;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Cobranza() {
  // Datos de cobranza
  const [cuentas,    setCuentas]    = useState([]);
  const [total,      setTotal]      = useState(0);
  const [resumen,    setResumen]    = useState(null);
  const [morosidad,  setMorosidad]  = useState([]);

  // Cuentas bancarias
  const [cuentasBancarias, setCuentasBancarias] = useState([]);

  // UI
  const [activeTab,         setActiveTab]        = useState("cuentas");
  const [page,              setPage]             = useState(1);
  const [search,            setSearch]           = useState("");
  const [filterSem,         setFilterSem]        = useState("");
  const [loading,           setLoading]          = useState(true);
  const [loadingResumen,    setLoadingResumen]   = useState(true);
  const [loadingMorosidad,  setLoadingMorosidad] = useState(false);

  // ── Lista de Cobros: una sola tabla con cobros individuales + órdenes ────
  const [pagosCobranza,   setPagosCobranza]   = useState([]);
  const [loadingPagos,    setLoadingPagos]    = useState(false);
  const [pfDesde,         setPfDesde]         = useState("");
  const [pfHasta,         setPfHasta]         = useState("");
  const [pfCliente,       setPfCliente]       = useState("");
  const [pfMetodo,        setPfMetodo]        = useState("Todos");
  const [crearOrdenCobroModal, setCrearOrdenCobroModal] = useState(false);
  const [ordenDetalleId,     setOrdenDetalleId]     = useState(null);
  const [eliminandoOrdenId,  setEliminandoOrdenId]  = useState(null);
  const [imprimiendoOrdenId, setImprimiendoOrdenId] = useState(null);
  const [eliminandoGarantiaId, setEliminandoGarantiaId] = useState(null);

  // Avisos y confirmaciones (reemplazan alert()/window.confirm() nativos)
  const [toast, setToast] = useState(null);
  const [confirmarEliminarPago, setConfirmarEliminarPago] = useState(null); // pagoId
  const [confirmarEliminarOrden, setConfirmarEliminarOrden] = useState(null); // row (fila de la orden)
  const [confirmarEliminarGarantia, setConfirmarEliminarGarantia] = useState(null); // row (fila del cobro_garantia)

  // Modal exportar
  const [exportModal,     setExportModal]     = useState(false);
  const [exportDesde,     setExportDesde]     = useState("");
  const [exportHasta,     setExportHasta]     = useState("");
  const [exportClienteId, setExportClienteId] = useState("");
  const [exportClientes,  setExportClientes]  = useState([]);
  const [exportando,      setExportando]      = useState(false);
  const [exportError,     setExportError]     = useState("");

  // Modal registrar pago (nuevo)
  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm,  setPagoForm]  = useState({
    monto_pagado: "", fecha_pago: hoy(), metodo_pago: "Efectivo",
    banco: "", numero_cuenta: "", numero_cheque: "",
  });
  const [pagoError, setPagoError] = useState("");
  const [saving,    setSaving]    = useState(false);

  // Modal detalle + historial
  const [detalleModal,     setDetalleModal]     = useState(null);
  const [historial,        setHistorial]        = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  // Modal editar pago
  const [editPagoModal,  setEditPagoModal]  = useState(null);
  const [editPagoForm,   setEditPagoForm]   = useState({
    monto_pagado: "", fecha_pago: hoy(), metodo_pago: "Efectivo",
    banco: "", numero_cuenta: "", numero_cheque: "",
  });
  const [editPagoError,  setEditPagoError]  = useState("");
  const [savingEditPago, setSavingEditPago] = useState(false);
  const [deletingPagoId, setDeletingPagoId] = useState(null);

  // Modal ver detalle de un cobro individual (Lista de Cobros)
  const [detalleCobroModal, setDetalleCobroModal] = useState(null); // el pago (fila de filasListaCobros)

  // Modal detalle de morosidad por cliente (drill-down desde la tabla de la pestaña Morosidad)
  const [morosidadRuc, setMorosidadRuc] = useState(null); // RUC del cliente con el modal abierto, o null
  const [enviandoRecordatorio, setEnviandoRecordatorio] = useState(false);

  // Modal extornar pago
  const [extornarModal, setExtornarModal] = useState(null); // el pago (fila de filasListaCobros)
  const [extornarMotivo, setExtornarMotivo] = useState("");
  const [extornarError, setExtornarError] = useState("");
  const [extornando, setExtornando] = useState(false);

  // ── Carga de datos ──────────────────────────────────────────────────────────

  const cargarResumen = useCallback(async () => {
    setLoadingResumen(true);
    try   { setResumen(await getResumenCobranza()); }
    catch { setResumen(null); }
    finally { setLoadingResumen(false); }
  }, []);

  const cargarCuentas = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, per_page: PER_PAGE };
      if (search)    params.search   = search;
      if (filterSem) params.semaforo = filterSem;
      const r = await getCobranza(params);
      setCuentas(r.data || []);
      setTotal(r.total  || 0);
    } catch {
      setCuentas([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterSem]);

  const cargarMorosidad = useCallback(async () => {
    setLoadingMorosidad(true);
    try   { setMorosidad(await getMorosidadClientes() || []); }
    catch { setMorosidad([]); }
    finally { setLoadingMorosidad(false); }
  }, []);

  const cargarCuentasBancarias = useCallback(async () => {
    try { setCuentasBancarias(await getCuentasBancarias() || []); }
    catch { setCuentasBancarias([]); }
  }, []);

  const cargarPagosCobranza = useCallback(async (override = {}) => {
    setLoadingPagos(true);
    try {
      const f = { desde: pfDesde, hasta: pfHasta, cliente: pfCliente, metodo: pfMetodo, ...override };
      const params = {};
      if (f.desde)   params.desde       = f.desde;
      if (f.hasta)   params.hasta       = f.hasta;
      if (f.cliente) params.cliente     = f.cliente;
      if (f.metodo && f.metodo !== "Todos") params.metodo_pago = f.metodo;
      setPagosCobranza(await getPagosCobranza(params) || []);
    } catch {
      setPagosCobranza([]);
    } finally {
      setLoadingPagos(false);
    }
  }, [pfDesde, pfHasta, pfCliente, pfMetodo]);

  useEffect(() => { cargarResumen(); },          [cargarResumen]);
  useEffect(() => { cargarCuentas(); },          [cargarCuentas]);
  useEffect(() => { cargarCuentasBancarias(); }, [cargarCuentasBancarias]);
  useEffect(() => { if (activeTab === "morosidad") cargarMorosidad(); }, [activeTab, cargarMorosidad]);
  // Carga solo al entrar a la pestaña — los filtros se aplican con el botón
  // "Filtrar" explícito, no en vivo mientras se escribe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "ordenes") cargarPagosCobranza(); }, [activeTab]);

  // ── Acciones ────────────────────────────────────────────────────────────────

  const abrirPago = (cuenta) => {
    setPagoModal(cuenta);
    setPagoForm({ monto_pagado: "", fecha_pago: hoy(), metodo_pago: "Efectivo", banco: "", numero_cuenta: "", numero_cheque: "" });
    setPagoError("");
  };

  const abrirDetalle = async (cuenta) => {
    setDetalleModal(cuenta);
    setHistorial([]);
    setLoadingHistorial(true);
    try   { setHistorial(await getHistorialPagos(cuenta.id) || []); }
    catch { setHistorial([]); }
    finally { setLoadingHistorial(false); }
  };

  const abrirEditarPago = (pago) => {
    setEditPagoModal(pago);
    setEditPagoForm({
      monto_pagado:  String(pago.monto_pagado),
      fecha_pago:    pago.fecha_pago ? String(pago.fecha_pago) : hoy(),
      metodo_pago:   pago.metodo_pago || "Efectivo",
      banco:         pago.banco || "",
      numero_cuenta: pago.numero_cuenta || "",
      numero_cheque: pago.numero_cheque || "",
    });
    setEditPagoError("");
  };

  const handleRegistrarPago = async () => {
    if (!pagoModal) return;
    const monto = parseFloat(pagoForm.monto_pagado);
    if (isNaN(monto) || monto <= 0) {
      setPagoError("Ingrese un monto válido mayor a 0.");
      return;
    }
    const saldo = pagoModal.saldo_pendiente || 0;
    if (monto > saldo + TOLERANCIA_REDONDEO + 0.01) {
      setPagoError(`El monto no puede superar el saldo pendiente (${fmtS(saldo)}) en más de ${fmtS(TOLERANCIA_REDONDEO)}.`);
      return;
    }
    if (pagoForm.metodo_pago === "Transferencia" || pagoForm.metodo_pago === "Depósito") {
      if (!pagoForm.banco.trim())         { setPagoError("Ingrese el banco para el cobro por transferencia o depósito."); return; }
      if (!pagoForm.numero_cuenta.trim()) { setPagoError("Ingrese el N° de cuenta para el cobro por transferencia o depósito."); return; }
    }
    if (pagoForm.metodo_pago === "Cheque") {
      if (!pagoForm.banco.trim())         { setPagoError("Ingrese el banco para el cobro por cheque."); return; }
      if (!pagoForm.numero_cheque.trim()) { setPagoError("Ingrese el N° de cheque para el cobro por cheque."); return; }
    }

    const payload = {
      monto_pagado: monto,
      fecha_pago:   pagoForm.fecha_pago,
      metodo_pago:  pagoForm.metodo_pago,
    };
    if (pagoForm.metodo_pago === "Transferencia" || pagoForm.metodo_pago === "Depósito") {
      payload.banco         = pagoForm.banco        || null;
      payload.numero_cuenta = pagoForm.numero_cuenta || null;
    } else if (pagoForm.metodo_pago === "Cheque") {
      payload.banco         = pagoForm.banco        || null;
      payload.numero_cheque = pagoForm.numero_cheque || null;
    }

    setSaving(true);
    setPagoError("");
    try {
      await registrarPago(pagoModal.id, payload);
      setPagoModal(null);
      cargarCuentas();
      cargarResumen();
    } catch (err) {
      setPagoError(parsearError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEditarPago = async () => {
    if (!editPagoModal) return;
    const monto = parseFloat(editPagoForm.monto_pagado);
    if (isNaN(monto) || monto <= 0) {
      setEditPagoError("Ingrese un monto válido mayor a 0.");
      return;
    }
    if (editPagoForm.metodo_pago === "Transferencia" || editPagoForm.metodo_pago === "Depósito") {
      if (!editPagoForm.banco.trim())         { setEditPagoError("Ingrese el banco para el cobro por transferencia o depósito."); return; }
      if (!editPagoForm.numero_cuenta.trim()) { setEditPagoError("Ingrese el N° de cuenta para el cobro por transferencia o depósito."); return; }
    }
    if (editPagoForm.metodo_pago === "Cheque") {
      if (!editPagoForm.banco.trim())         { setEditPagoError("Ingrese el banco para el cobro por cheque."); return; }
      if (!editPagoForm.numero_cheque.trim()) { setEditPagoError("Ingrese el N° de cheque para el cobro por cheque."); return; }
    }

    const payload = {
      monto_pagado: monto,
      fecha_pago:   editPagoForm.fecha_pago,
      metodo_pago:  editPagoForm.metodo_pago,
    };
    if (editPagoForm.metodo_pago === "Transferencia" || editPagoForm.metodo_pago === "Depósito") {
      payload.banco         = editPagoForm.banco        || null;
      payload.numero_cuenta = editPagoForm.numero_cuenta || null;
    } else if (editPagoForm.metodo_pago === "Cheque") {
      payload.banco         = editPagoForm.banco        || null;
      payload.numero_cheque = editPagoForm.numero_cheque || null;
    }

    setSavingEditPago(true);
    setEditPagoError("");
    try {
      const result = await updatePago(editPagoModal.id, payload);
      setEditPagoModal(null);
      if (detalleModal) {
        const newHistorial = await getHistorialPagos(detalleModal.id);
        setHistorial(newHistorial || []);
        setDetalleModal(prev => ({
          ...prev,
          saldo_pendiente: result.saldo_pendiente,
          estado_cobranza: result.estado_cobranza,
        }));
      } else {
        cargarPagosCobranza();
      }
      cargarCuentas();
      cargarResumen();
    } catch (err) {
      setEditPagoError(parsearError(err));
    } finally {
      setSavingEditPago(false);
    }
  };

  const handleEliminarPago = async (pagoId) => {
    setDeletingPagoId(pagoId);
    try {
      const result = await deletePago(pagoId);
      const newHistorial = await getHistorialPagos(detalleModal.id);
      setHistorial(newHistorial || []);
      setDetalleModal(prev => ({
        ...prev,
        saldo_pendiente: result.saldo_pendiente,
        estado_cobranza: result.estado_cobranza,
      }));
      cargarCuentas();
      cargarResumen();
    } catch (err) {
      setToast({ message: parsearError(err), type: "error" });
    } finally {
      setDeletingPagoId(null);
    }
  };

  const handleEliminarOrdenCobro = async (row) => {
    setEliminandoOrdenId(row.orden_id);
    try {
      await eliminarOrdenCobro(row.orden_id);
      cargarPagosCobranza();
      cargarCuentas();
      cargarResumen();
    } catch {
      setToast({ message: "No se pudo eliminar la orden de cobro.", type: "error" });
    } finally {
      setEliminandoOrdenId(null);
    }
  };

  // ── imprimir Orden de Cobro (PDF generado por el backend) ───────────────────
  const handleImprimirOrdenCobro = async (ordenId) => {
    const ventana = window.open("", "_blank");
    setImprimiendoOrdenId(ordenId);
    try {
      const blob = await getOrdenCobroPdf(ordenId);
      const url  = window.URL.createObjectURL(blob);
      if (ventana) ventana.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      if (ventana) ventana.close();
      setToast({ message: "No se pudo generar el PDF de la orden de cobro", type: "error" });
    } finally {
      setImprimiendoOrdenId(null);
    }
  };

  const handleEliminarCobroGarantia = async (row) => {
    // La fila "cobro_garantia" es la garantía misma (ver GET /cobranza/pagos)
    // — no hay un registro de cobro separado que borrar. Eliminarla acá
    // reutiliza el mismo DELETE /garantias/{id} que ya usa la pestaña
    // Garantías: revierte cualquier ejecución/crédito que haya generado y
    // borra la garantía por completo (no solo "vuelve a Retenida" — si ya
    // fue ejecutada o devuelta, no existe un estado intermedio al que volver).
    setEliminandoGarantiaId(row.id);
    try {
      await eliminarGarantia(row.id);
      cargarPagosCobranza();
      cargarCuentas();
      cargarResumen();
    } catch (err) {
      setToast({ message: parsearError(err), type: "error" });
    } finally {
      setEliminandoGarantiaId(null);
    }
  };

  const abrirExtornar = (p) => {
    setExtornarModal(p);
    setExtornarMotivo("");
    setExtornarError("");
  };

  const handleExtornar = async () => {
    if (!extornarModal) return;
    if (!extornarMotivo.trim()) { setExtornarError("El motivo del extorno es obligatorio"); return; }
    setExtornando(true);
    setExtornarError("");
    try {
      await extornarPago(extornarModal.id, { motivo: extornarMotivo.trim() });
      setExtornarModal(null);
      cargarPagosCobranza();
      cargarCuentas();
      cargarResumen();
    } catch (err) {
      setExtornarError(parsearError(err));
    } finally {
      setExtornando(false);
    }
  };

  const limpiarFiltrosPagos = () => {
    setPfDesde(""); setPfHasta(""); setPfCliente(""); setPfMetodo("Todos");
    cargarPagosCobranza({ desde: "", hasta: "", cliente: "", metodo: "Todos" });
  };

  const handleEnviarRecordatorioMorosidad = async (ruc) => {
    setEnviandoRecordatorio(true);
    try {
      const r = await enviarRecordatorioMorosidad(ruc);
      setToast({ message: r?.mensaje || "Recordatorio enviado correctamente", type: "success" });
    } catch (err) {
      setToast({ message: parsearError(err), type: "error" });
    } finally {
      setEnviandoRecordatorio(false);
    }
  };

  const abrirExportModal = async () => {
    setExportModal(true);
    setExportError("");
    try {
      const r = await getClientes({ per_page: 500 });
      setExportClientes(r.data || []);
    } catch {
      setExportClientes([]);
    }
  };

  const handleExportar = async () => {
    setExportando(true);
    setExportError("");
    try {
      const params = {};
      if (exportDesde)     params.desde      = exportDesde;
      if (exportHasta)     params.hasta      = exportHasta;
      if (exportClienteId) params.cliente_id = exportClienteId;

      const blob = await exportarCobranza(params);
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const url  = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href  = url;
      link.setAttribute("download", `Reporte_Cuentas_Por_Cobrar_${fecha}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportModal(false);
    } catch (err) {
      setExportError(parsearError(err));
    } finally {
      setExportando(false);
    }
  };

  const limpiarFiltros = () => { setSearch(""); setFilterSem(""); setPage(1); };
  const totalPages = Math.ceil(total / PER_PAGE);
  const opcionesBanco = cuentasBancarias.map(c => `${c.banco} — cta. ${c.numero_cuenta}`);

  // "Lista de Cobros": una sola tabla que mezcla cobros individuales
  // (PagoCobranza) y órdenes de cobro. El backend (GET /cobranza/pagos)
  // devuelve una fila por CADA documento dentro de una orden; acá se agrupan
  // por orden_id en una sola fila con el monto total, para que cada orden
  // aparezca una única vez (igual que en Gastos/Lista de Pagos).
  const filasListaCobros = useMemo(() => {
    const ordenes = new Map();
    const individuales = [];
    for (const p of pagosCobranza) {
      if (p.tipo === "orden_cobro") {
        const acc = ordenes.get(p.orden_id);
        if (acc) {
          acc.monto_cobrado += p.monto_cobrado;
          acc.cantidad_documentos += 1;
        } else {
          ordenes.set(p.orden_id, { ...p, cantidad_documentos: 1 });
        }
      } else {
        individuales.push(p);
      }
    }
    const filas = [...individuales, ...ordenes.values()];
    filas.sort((a, b) => (b.fecha_cobro || "").localeCompare(a.fecha_cobro || "") || (b.id - a.id));
    return filas;
  }, [pagosCobranza]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Cobranza" />

        <main className="flex-1 overflow-y-auto p-6">

          {/* Encabezado */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Cuentas por Cobrar</h1>
              <p className="text-sm text-gray-500 mt-0.5">Seguimiento de cobranza y morosidad</p>
            </div>
          </div>

          {/* ── KPIs ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            <KPICard
              label="Total por Cobrar" value={loadingResumen ? "…" : fmtS(resumen?.total_pendiente)}
              colorBorder="border-blue-500" colorText="text-blue-700" colorRing="ring-blue-500"
              isActive={filterSem === ""}
              onClick={() => { setFilterSem(""); setPage(1); setActiveTab("cuentas"); }}
            />
            <KPICard
              label="Al Día" value={loadingResumen ? "…" : fmtS(resumen?.al_dia)}
              colorBorder="border-green-500" colorText="text-green-700" colorRing="ring-green-500"
              isActive={filterSem === "verde"}
              onClick={() => { setFilterSem("verde"); setPage(1); setActiveTab("cuentas"); }}
            />
            <KPICard
              label="Vencido 1-15 días" value={loadingResumen ? "…" : fmtS(resumen?.por_vencer_15)}
              colorBorder="border-yellow-400" colorText="text-yellow-700" colorRing="ring-yellow-400"
              isActive={filterSem === "amarillo"}
              onClick={() => { setFilterSem("amarillo"); setPage(1); setActiveTab("cuentas"); }}
            />
            <KPICard
              label="Vencido +15 días" value={loadingResumen ? "…" : fmtS(resumen?.vencido_mas_15)}
              colorBorder="border-red-500" colorText="text-red-700" colorRing="ring-red-500"
              isActive={filterSem === "rojo"}
              onClick={() => { setFilterSem("rojo"); setPage(1); setActiveTab("cuentas"); }}
            />
            <KPICard
              label="Mayor Deudor" value={loadingResumen ? "…" : fmtS(resumen?.mayor_deudor?.total)}
              sub={resumen?.mayor_deudor?.nombre || "—"}
              colorBorder="border-purple-500" colorText="text-purple-700"
            />
          </div>

          {/* ── Tabs + Exportar ──────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
              {[
                { key: "cuentas",   label: "Cuentas por Cobrar" },
                { key: "ordenes",   label: "Lista de Cobros" },
                { key: "garantias", label: "Garantías" },
                { key: "morosidad", label: "Morosidad por Cliente" },
              ].map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={abrirExportModal}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors">
              <HiDownload className="w-4 h-4" />
              Exportar
            </button>
          </div>

          {/* ══ Tab: Cuentas por Cobrar ════════════════════════════════════ */}
          {activeTab === "cuentas" && (
            <>
              {/* Filtros */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Buscar por N° documento o cliente…" value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <select value={filterSem} onChange={e => { setFilterSem(e.target.value); setPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {SEM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {(search || filterSem) && (
                  <button onClick={limpiarFiltros} className="text-sm text-gray-500 hover:text-gray-700">Limpiar filtros</button>
                )}
              </div>

              {/* Tabla */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-12">Sem.</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">N° Documento</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Cliente</th>
                        <th className="px-4 py-3 text-right  text-xs font-semibold text-gray-500 uppercase">Monto</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">F. Emisión</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">F. Vencimiento</th>
                        <th className="px-4 py-3 text-right  text-xs font-semibold text-gray-500 uppercase">Saldo Pendiente</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Estado</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loading ? (
                        <tr><td colSpan={9} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : cuentas.length === 0 ? (
                        <tr><td colSpan={9} className="text-center py-12 text-gray-400 text-sm">No hay cuentas por cobrar</td></tr>
                      ) : cuentas.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-center"><div className="flex justify-center"><SemaforoIcon valor={c.semaforo} /></div></td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">{c.numero_documento || "—"}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              c.tipo_documento === "Factura" ? "bg-blue-100 text-blue-700" :
                              c.tipo_documento === "Recibo Interno" ? "bg-gray-200 text-gray-700" :
                              "bg-green-100 text-green-700"
                            }`}>{c.tipo_documento}</span>
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <p className="font-medium text-gray-800 truncate">{c.cliente_nombre}</p>
                            <p className="text-xs text-gray-500">{c.ruc_cliente}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-700">{fmtS(c.monto_total)}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(c.fecha_emision)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={c.semaforo === "rojo" ? "text-red-600 font-medium" : c.semaforo === "amarillo" ? "text-yellow-600 font-medium" : "text-gray-600"}>
                              {fmtFecha(c.fecha_vencimiento)}
                            </span>
                            {c.dias_vencido > 0 && c.estado_cobranza !== "Pagada" && (
                              <p className="text-xs text-red-500">{c.dias_vencido} días</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${c.saldo_pendiente > 0 ? "text-red-600" : "text-green-600"}`}>{fmtS(c.saldo_pendiente)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <EstadoBadge estado={c.estado_cobranza} pagadoConGarantia={c.pagado_con_garantia} />
                              <NotaCreditoBadge tipo={c.nota_credito_tipo} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              {c.estado_cobranza !== "Pagada" && (
                                <button onClick={() => abrirPago(c)}
                                  className="text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap">
                                  Registrar Cobro
                                </button>
                              )}
                              {(c.estado_cobranza === "Pagada" || c.estado_cobranza === "Pago Parcial") && (
                                <button onClick={() => abrirDetalle(c)} title="Editar Cobro"
                                  className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                                  <HiPencil className="w-4 h-4" />
                                </button>
                              )}
                              <button onClick={() => abrirDetalle(c)} title="Ver detalle"
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <HiEye className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm text-gray-500">{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de {total}</span>
                    <div className="flex gap-2">
                      <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Anterior</button>
                      <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══ Tab: Lista de Cobros ═══════════════════════════════════════ */}
          {activeTab === "ordenes" && (
            <>
              {/* Filtros + botón Crear Orden de Cobro */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Fecha Desde</label>
                  <input type="date" value={pfDesde} onChange={e => setPfDesde(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Fecha Hasta</label>
                  <input type="date" value={pfHasta} onChange={e => setPfHasta(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                  <label className="text-xs text-gray-500">Cliente</label>
                  <input type="text" value={pfCliente} placeholder="RUC o nombre del cliente…"
                    onChange={e => setPfCliente(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Método de Cobro</label>
                  <select value={pfMetodo} onChange={e => setPfMetodo(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {METODOS_COBRO_FILTRO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <button onClick={() => cargarPagosCobranza()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors whitespace-nowrap">
                  🔍 Filtrar
                </button>
                <button onClick={limpiarFiltrosPagos}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
                  🗑️ Limpiar
                </button>
                <button onClick={() => setCrearOrdenCobroModal(true)}
                  className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors whitespace-nowrap">
                  ➕ Crear Orden de Cobro
                </button>
              </div>

              {/* Tabla única: cobros individuales + órdenes de cobro */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">N° Orden/Documento</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Cliente</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Descripción</th>
                        <th className="px-4 py-3 text-right  text-xs font-semibold text-gray-500 uppercase">Monto</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Método Pago</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Banco</th>
                        <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">N° Cuenta</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Estado</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingPagos ? (
                        <tr><td colSpan={10} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : filasListaCobros.length === 0 ? (
                        <tr><td colSpan={10} className="text-center py-12 text-gray-400 text-sm">No hay cobros registrados</td></tr>
                      ) : filasListaCobros.map(p => (
                        <tr key={`${p.tipo}-${p.tipo === "orden_cobro" ? p.orden_id : p.id}`} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(p.fecha_cobro)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">
                            {p.tipo === "orden_cobro" ? p.numero_orden : (p.numero_documento || "—")}
                          </td>
                          <td className="px-4 py-3 max-w-[200px] truncate text-gray-800" title={p.cliente_nombre}>{p.cliente_nombre || "—"}</td>
                          <td className="px-4 py-3 max-w-[200px] truncate text-gray-600" title={p.descripcion}>{p.descripcion || "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold text-green-700 whitespace-nowrap">{fmtS(p.monto_cobrado)}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.metodo_cobro || "—"}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.banco || "—"}</td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs whitespace-nowrap">{p.numero_cuenta || "—"}</td>
                          <td className="px-4 py-3 text-center">
                            {p.tipo === "orden_cobro" ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Cobrado</span>
                            ) : p.tipo === "cobro_garantia" ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Garantía retenida</span>
                            ) : (p.metodo_cobro === "Ejecución de Garantía" || p.metodo_cobro === "Crédito por Garantía") ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 whitespace-nowrap">💎 Cobrado por Garantía</span>
                            ) : (
                              <EstadoBadge estado={p.estado} />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {p.tipo === "orden_cobro" ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={() => setOrdenDetalleId(p.orden_id)} title="Ver Detalle"
                                  className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <HiEye className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleImprimirOrdenCobro(p.orden_id)} disabled={imprimiendoOrdenId === p.orden_id} title="Imprimir"
                                  className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40">
                                  <HiPrinter className="w-4 h-4" />
                                </button>
                                <button onClick={() => setConfirmarEliminarOrden(p)} disabled={eliminandoOrdenId === p.orden_id} title="Eliminar"
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                  <HiTrash className="w-4 h-4" />
                                </button>
                              </div>
                            ) : p.tipo === "cobro_garantia" ? (
                              <div className="flex justify-center">
                                <button onClick={() => setConfirmarEliminarGarantia(p)} disabled={eliminandoGarantiaId === p.id} title="Eliminar"
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                  <HiTrash className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={() => setDetalleCobroModal(p)} title="Ver Detalle"
                                  className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <HiEye className="w-4 h-4" />
                                </button>
                                <button onClick={() => abrirEditarPago({
                                  id:            p.id,
                                  monto_pagado:  p.monto_cobrado,
                                  fecha_pago:    p.fecha_cobro,
                                  metodo_pago:   p.metodo_cobro,
                                  banco:         p.banco,
                                  numero_cuenta: p.numero_cuenta,
                                  numero_cheque: p.numero_cheque,
                                })} title="Editar cobro"
                                  className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <HiPencil className="w-4 h-4" />
                                </button>
                                {p.extornado ? (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                                    ↩️ Extornado
                                  </span>
                                ) : (
                                  <button onClick={() => abrirExtornar(p)} title="Extornar"
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                    ↩️ Extornar
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ══ Tab: Garantías ═════════════════════════════════════════════ */}
          {activeTab === "garantias" && <GarantiasTab />}

          {/* ══ Tab: Morosidad por Cliente ════════════════════════════════ */}
          {activeTab === "morosidad" && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase">Cliente</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">N° Facturas</th>
                      <th className="px-4 py-3 text-right  text-xs font-semibold text-gray-500 uppercase">Monto Total</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Días de Mora</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Semáforo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loadingMorosidad ? (
                      <tr><td colSpan={5} className="text-center py-12 text-gray-400">Cargando…</td></tr>
                    ) : morosidad.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-12 text-gray-400">Sin datos de morosidad</td></tr>
                    ) : morosidad.map((m, i) => (
                      <tr key={i} onClick={() => setMorosidadRuc(m.ruc)}
                        className="hover:bg-gray-100 cursor-pointer transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{m.cliente_nombre}</p>
                          <p className="text-xs text-gray-500">{m.ruc}</p>
                        </td>
                        <td className="px-4 py-3 text-center font-medium text-gray-700">{m.facturas_pendientes}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600">{fmtS(m.monto_total)}</td>
                        <td className="px-4 py-3 text-center">
                          {m.dias_mora_max > 0
                            ? <span className={`font-medium ${m.dias_mora_max > 15 ? "text-red-600" : "text-yellow-600"}`}>{m.dias_mora_max} días</span>
                            : <span className="text-green-600">Al día</span>}
                        </td>
                        <td className="px-4 py-3"><div className="flex justify-center"><SemaforoIcon valor={m.semaforo} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ══ Modal: Detalle de Morosidad ═════════════════════════════════════ */}
      {morosidadRuc && (
        <ModalDetalleMorosidad
          ruc={morosidadRuc}
          onClose={() => setMorosidadRuc(null)}
          onEnviarRecordatorio={handleEnviarRecordatorioMorosidad}
          enviandoRecordatorio={enviandoRecordatorio}
        />
      )}

      {/* ══ Modal: Registrar Cobro ══════════════════════════════════════════ */}
      {pagoModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Registrar Cobro</h2>
                <p className="text-sm text-gray-500 mt-0.5">{pagoModal.numero_documento}</p>
              </div>
              <button onClick={() => setPagoModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5"><HiX className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Cliente</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5 truncate">{pagoModal.cliente_nombre}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Tipo</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5">{pagoModal.tipo_documento}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
                <div>
                  <p className="text-xs text-gray-500">Monto Total</p>
                  <p className="text-sm font-semibold text-gray-700">{fmtS(pagoModal.monto_total)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Saldo Pendiente</p>
                  <p className="text-lg font-bold text-red-600">{fmtS(pagoModal.saldo_pendiente)}</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Monto a Cobrar <span className="text-red-500">*</span></label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                  <input type="number" step="0.01" min="0.01" max={(pagoModal.saldo_pendiente || 0) + TOLERANCIA_REDONDEO}
                    value={pagoForm.monto_pagado}
                    onChange={e => setPagoForm(f => ({ ...f, monto_pagado: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00" autoFocus />
                </div>
                <button onClick={() => setPagoForm(f => ({ ...f, monto_pagado: String(pagoModal.saldo_pendiente || "") }))}
                  className="text-xs text-blue-600 hover:underline mt-1">
                  Cobrar saldo completo ({fmtS(pagoModal.saldo_pendiente)})
                </button>
                {(() => {
                  const montoNum = parseFloat(pagoForm.monto_pagado);
                  if (isNaN(montoNum) || montoNum <= 0) return null;
                  const diferencia = Math.round((montoNum - (pagoModal.saldo_pendiente || 0)) * 100) / 100;
                  if (Math.abs(diferencia) < 0.01) return null;

                  // Sobrepasa lo que el backend permite cobrar (saldo + tolerancia) — se rechazará.
                  if (diferencia > TOLERANCIA_REDONDEO) {
                    return (
                      <p className="text-xs text-red-600 mt-1.5 font-medium">
                        ⚠️ El monto supera el saldo pendiente en más de {fmtS(TOLERANCIA_REDONDEO)} — no se puede registrar
                      </p>
                    );
                  }
                  // Pagó de más, pero dentro de tolerancia → cierra deuda con redondeo a favor.
                  if (diferencia > 0) {
                    return (
                      <p className="text-xs text-green-600 mt-1.5 font-medium">
                        ⬆️ Redondeo a favor: {fmtS(diferencia)} (ganancia) — se cerrará la deuda
                      </p>
                    );
                  }
                  // Pagó de menos, más allá de la tolerancia → pago parcial normal (no es redondeo).
                  if (diferencia < -TOLERANCIA_REDONDEO) {
                    return (
                      <p className="text-xs text-red-600 mt-1.5 font-medium">
                        ⚠️ La diferencia supera {fmtS(TOLERANCIA_REDONDEO)} — se registrará como pago parcial
                      </p>
                    );
                  }
                  // Pagó de menos, dentro de tolerancia → cierra deuda con redondeo a favor del cliente.
                  return (
                    <p className="text-xs text-orange-600 mt-1.5 font-medium">
                      ⬇️ Redondeo a favor del cliente: {fmtS(Math.abs(diferencia))} (pérdida) — se cerrará la deuda
                    </p>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Cobro</label>
                  <input type="date" value={pagoForm.fecha_pago}
                    onChange={e => setPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Método de Cobro</label>
                  <select value={pagoForm.metodo_pago}
                    onChange={e => setPagoForm(f => ({ ...f, metodo_pago: e.target.value, banco: "", numero_cuenta: "", numero_cheque: "" }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <CamposMetodoPago form={pagoForm} setForm={setPagoForm} cuentasBancarias={cuentasBancarias} opcionesBanco={opcionesBanco} />

              {pagoError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {pagoError}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setPagoModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleRegistrarPago} disabled={saving}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? "Registrando…" : "Registrar Cobro"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Detalle + Historial ═══════════════════════════════════════ */}
      {detalleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[88vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Detalle del Comprobante</h2>
                <p className="text-sm text-gray-500 mt-0.5">{detalleModal.numero_documento}</p>
              </div>
              <button onClick={() => setDetalleModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5"><HiX className="w-5 h-5" /></button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {[["Cliente", detalleModal.cliente_nombre], ["RUC", detalleModal.ruc_cliente], ["Tipo Documento", detalleModal.tipo_documento], ["Estado", null], ["Monto Total", fmtS(detalleModal.monto_total)], ["Saldo Pendiente", null], ["Fecha Emisión", fmtFecha(detalleModal.fecha_emision)], ["Fecha Vencto.", fmtFecha(detalleModal.fecha_vencimiento)]].map(([lbl, val]) => (
                  <div key={lbl}>
                    <p className="text-xs text-gray-500 uppercase font-medium">{lbl}</p>
                    {lbl === "Estado" ? (
                        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <EstadoBadge estado={detalleModal.estado_cobranza} />
                          <NotaCreditoBadge tipo={detalleModal.nota_credito_tipo} />
                        </div>
                      )
                      : lbl === "Saldo Pendiente" ? <p className={`text-sm font-bold mt-0.5 ${detalleModal.saldo_pendiente > 0 ? "text-red-600" : "text-green-600"}`}>{fmtS(detalleModal.saldo_pendiente)}</p>
                      : <p className="text-sm text-gray-800 mt-0.5 font-medium">{val}</p>}
                  </div>
                ))}
              </div>

              {detalleModal.dias_vencido > 0 && detalleModal.estado_cobranza !== "Pagada" && (
                <div className="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0" />
                  Vencida hace {detalleModal.dias_vencido} días
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Historial de Cobros</h3>
                {loadingHistorial ? (
                  <p className="text-sm text-gray-400 text-center py-4">Cargando…</p>
                ) : historial.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Sin cobros registrados</p>
                ) : (
                  <div className="space-y-2">
                    {historial.map((p, i) => (
                      <div key={p.id || i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-green-700">{fmtS(p.monto_pagado)}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {p.metodo_pago}
                            {p.banco && ` · ${p.banco}`}
                            {p.numero_cuenta && ` · ${p.numero_cuenta}`}
                            {p.numero_cheque && ` · Cheque ${p.numero_cheque}`}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                            👤 Creado por: {p.creado_por || "—"} · 📅 {p.creado_en || "—"} · 📥 {p.metodo_creacion || "Manual"}
                            {p.modificado_por && ` · ✏️ Modificado por: ${p.modificado_por} · 📅 ${p.modificado_en}`}
                          </p>
                          {p.redondeo_tipo && (
                            <p className={`text-xs font-medium mt-0.5 ${p.redondeo_tipo === "ganancia" ? "text-green-600" : "text-orange-600"}`}>
                              📊 Redondeo: {p.redondeo_tipo === "ganancia" ? "+" : "-"}{fmtS(p.redondeo_monto)} ({p.redondeo_tipo === "ganancia" ? "ganancia" : "pérdida"})
                            </p>
                          )}
                          {p.extornado && (
                            <div className="text-xs text-red-600 font-medium mt-1 space-y-0.5">
                              <p>↩️ Extornado el: {p.fecha_extorno || "—"}</p>
                              <p>👤 Por: {p.extornado_por || "—"}</p>
                              {p.motivo_extorno && <p>📝 Motivo: {p.motivo_extorno}</p>}
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 whitespace-nowrap">{fmtFecha(p.fecha_pago)}</p>
                        <div className="flex items-center gap-1 ml-1">
                          <button onClick={() => abrirEditarPago(p)} title="Editar cobro"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <HiPencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setConfirmarEliminarPago(p.id)} title="Eliminar cobro"
                            disabled={deletingPagoId === p.id}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                            <HiTrash className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setDetalleModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cerrar</button>
              {detalleModal.estado_cobranza !== "Pagada" && (
                <button onClick={() => { setDetalleModal(null); abrirPago(detalleModal); }}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
                  Registrar Cobro
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Editar Cobro ══════════════════════════════════════════════ */}
      {editPagoModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Editar Cobro</h2>
                <p className="text-sm text-gray-500 mt-0.5">{detalleModal?.numero_documento}</p>
              </div>
              <button onClick={() => setEditPagoModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5"><HiX className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Monto Cobrado <span className="text-red-500">*</span></label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                  <input type="number" step="0.01" min="0.01"
                    value={editPagoForm.monto_pagado}
                    onChange={e => setEditPagoForm(f => ({ ...f, monto_pagado: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00" autoFocus />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Cobro</label>
                  <input type="date" value={editPagoForm.fecha_pago}
                    onChange={e => setEditPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Método de Cobro</label>
                  <select value={editPagoForm.metodo_pago}
                    onChange={e => setEditPagoForm(f => ({ ...f, metodo_pago: e.target.value, banco: "", numero_cuenta: "", numero_cheque: "" }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <CamposMetodoPago form={editPagoForm} setForm={setEditPagoForm} cuentasBancarias={cuentasBancarias} opcionesBanco={opcionesBanco} />

              {editPagoError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {editPagoError}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setEditPagoModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleEditarPago} disabled={savingEditPago}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingEditPago ? "Guardando…" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Extornar Pago ═════════════════════════════════════════════ */}
      {extornarModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Extornar Pago</h2>
                <p className="text-sm text-gray-500 mt-0.5">{extornarModal.numero_documento || "—"}</p>
              </div>
              <button onClick={() => setExtornarModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5"><HiX className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Cliente</p>
                  <p className="text-sm font-medium text-gray-800 truncate">{extornarModal.cliente_nombre}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Monto</p>
                  <p className="text-sm font-semibold text-gray-800">{fmtS(extornarModal.monto_cobrado)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Fecha de Cobro</p>
                  <p className="text-sm font-semibold text-gray-800">{fmtFecha(extornarModal.fecha_cobro)}</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Motivo del Extorno <span className="text-red-500">*</span></label>
                <textarea value={extornarMotivo} onChange={e => setExtornarMotivo(e.target.value)} rows={2}
                  placeholder="Ej: Banco rechazó la transferencia"
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
              </div>

              {extornarError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {extornarError}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setExtornarModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleExtornar} disabled={extornando}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
                {extornando ? "Extornando…" : "Confirmar Extorno"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Exportar a Excel ═════════════════════════════════════════ */}
      {exportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Exportar Reporte</h2>
                <p className="text-sm text-gray-500 mt-0.5">Cuentas por Cobrar</p>
              </div>
              <button onClick={() => setExportModal(false)} className="text-gray-400 hover:text-gray-600"><HiX className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Desde</label>
                  <input type="date" value={exportDesde}
                    onChange={e => setExportDesde(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Hasta</label>
                  <input type="date" value={exportHasta}
                    onChange={e => setExportHasta(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Cliente</label>
                <select value={exportClienteId} onChange={e => setExportClienteId(e.target.value)}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos los clientes</option>
                  {exportClientes.map(c => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>

              {exportError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {exportError}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setExportModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleExportar} disabled={exportando}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                <HiDownload className="w-4 h-4" />
                {exportando ? "Generando…" : "Exportar a Excel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Crear Orden de Cobro ══════════════════════════════════════ */}
      {crearOrdenCobroModal && (
        <ModalCrearOrdenCobro
          cuentasBancarias={cuentasBancarias}
          onClose={() => setCrearOrdenCobroModal(false)}
          onSuccess={cargarPagosCobranza}
        />
      )}

      {/* ══ Modal: Detalle de Orden de Cobro ═════════════════════════════════ */}
      {ordenDetalleId && (
        <ModalDetalleOrdenCobro
          ordenId={ordenDetalleId}
          onClose={() => setOrdenDetalleId(null)}
          onChange={cargarPagosCobranza}
        />
      )}

      {detalleCobroModal && (
        <ModalDetalleCobro pago={detalleCobroModal} onClose={() => setDetalleCobroModal(null)} />
      )}

      <ConfirmDialog
        open={!!confirmarEliminarPago}
        title="Eliminar cobro"
        message="El saldo y estado de la factura se recalcularán."
        danger
        confirmLabel="Eliminar"
        onConfirm={async () => { const id = confirmarEliminarPago; setConfirmarEliminarPago(null); await handleEliminarPago(id); }}
        onCancel={() => setConfirmarEliminarPago(null)}
      />

      <ConfirmDialog
        open={!!confirmarEliminarOrden}
        title={confirmarEliminarOrden ? `Eliminar Orden de Cobro ${confirmarEliminarOrden.numero_orden}` : "Eliminar Orden de Cobro"}
        message={confirmarEliminarOrden
          ? `Se revertirán los cobros de ${confirmarEliminarOrden.cantidad_documentos ?? ""} documento${confirmarEliminarOrden.cantidad_documentos === 1 ? "" : "s"}.\nLos saldos pendientes volverán a su estado anterior.`
          : ""}
        danger
        confirmLabel="Eliminar"
        onConfirm={async () => { const row = confirmarEliminarOrden; setConfirmarEliminarOrden(null); await handleEliminarOrdenCobro(row); }}
        onCancel={() => setConfirmarEliminarOrden(null)}
      />

      <ConfirmDialog
        open={!!confirmarEliminarGarantia}
        title="Eliminar cobro por garantía"
        message="Este cobro corresponde a una garantía. Al eliminarlo se eliminará la garantía por completo: se revertirán las ejecuciones/créditos que haya generado y los saldos de los documentos afectados se restaurarán."
        danger
        confirmLabel="Eliminar"
        onConfirm={async () => { const row = confirmarEliminarGarantia; setConfirmarEliminarGarantia(null); await handleEliminarCobroGarantia(row); }}
        onCancel={() => setConfirmarEliminarGarantia(null)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />

    </div>
  );
}
