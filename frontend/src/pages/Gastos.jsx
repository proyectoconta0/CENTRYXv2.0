import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import ConfirmDialog from "../components/ConfirmDialog";
import Toast from "../components/Toast";
import GastosDonutChart from "../charts/GastosDonutChart";
import {
  getGastos, getGasto, createGasto, updateGasto, deleteGasto, eliminarGastosMasivo, subirComprobanteGasto,
  getResumenGastos, getGastosPorCategoria, getGastosPorArea, getEvolucionMensual,
  exportarGastos, toggleRecurrenteGasto, getProximoCorrelativo, consultarRuc,
  getCuentasPorPagar, getResumenCuentasPorPagar, exportarCuentasPorPagar,
  getHistorialPagosGasto, updatePagoGasto, deletePagoGasto,
  getCuentasBancarias, getGastoImprimir, getComprobanteGastoBlob,
} from "../api/comercialApi";
import { getRubro, getCategoriasGasto, getAreasGasto } from "../api/configuracionApi";
import { imprimirComprobante } from "../components/comercial/PlantillaComprobante";
import ModalElegirImportacion from "../components/comercial/ModalElegirImportacion";
import ModalImportarPdfGasto from "../components/gastos/ModalImportarPdfGasto";
import CargaMasivaGasto from "../components/gastos/CargaMasivaGasto";
import CamposMetodoPagoGasto from "../components/gastos/CamposMetodoPagoGasto";
import ModalRegistrarPagoGasto from "../components/gastos/ModalRegistrarPagoGasto";
import {
  HiSearch, HiPlus, HiEye, HiPencil, HiTrash, HiDownload,
  HiX, HiExclamationCircle, HiCheckCircle, HiRefresh, HiPrinter,
  HiCurrencyDollar, HiClipboardList, HiUpload,
} from "react-icons/hi";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── Constantes ────────────────────────────────────────────────────────────────

const CATEGORIA_PLANILLA          = "Planilla";
const CATEGORIA_PAGOS_TRIBUTARIOS = "Pagos Tributarios";

// Estas dos categorías siempre deben estar disponibles al registrar un
// gasto, sin importar el área o el rubro configurado — "Planilla" sí es
// gasto operativo (afecta utilidad); "Pagos Tributarios" sale del banco
// pero no es gasto operativo (no afecta utilidad). Ver afecta_utilidad en
// el backend (app/routers/gastos.py).
const CATEGORIAS_ESPECIALES = [CATEGORIA_PLANILLA, CATEGORIA_PAGOS_TRIBUTARIOS];

// Subcategorías que se ofrecen en el campo "Descripción" cuando se elige
// una de las categorías especiales, en vez de texto libre.
const SUBCATEGORIAS = {
  [CATEGORIA_PLANILLA]: ["Sueldos brutos", "ESSALUD (9%)", "AFP", "ONP (13%)", "Otros beneficios"],
  [CATEGORIA_PAGOS_TRIBUTARIOS]: ["IGV mensual", "Impuesto a la Renta", "Otros tributos SUNAT"],
};

const CATEGORIAS_OPERATIVAS = [
  "Alquiler de oficina", "Alquiler de almacén", "Mano de obra",
  "Transporte", "Suministros", "Materia prima", "Alquiler de andamios",
  "Servicios básicos", "Seguros", "Gastos administrativos", "Gastos de ventas",
  "Gastos Bancarios", ...CATEGORIAS_ESPECIALES, "Otros",
];
const CATEGORIAS_ACTIVOS = [
  "Maquinaria y Equipos", "Vehículos", "Mobiliario y Equipo de Oficina",
  "Mejoras a Local", "Otros Activos",
];
const TODAS_CATEGORIAS = [...CATEGORIAS_OPERATIVAS, ...CATEGORIAS_ACTIVOS];
const AREAS = ["Administrativa", "Operativa", "Ventas", "Activos"];

// `categoriasBase` es la lista dinámica gestionada desde Configuración → Gastos
// (ver getCategoriasGasto/useEffect en el componente); si aún no cargó o la
// API falla, cae a CATEGORIAS_OPERATIVAS hardcodeada como red de seguridad.
function categoriasParaArea(area, categoriasRubro, categoriasBase = CATEGORIAS_OPERATIVAS) {
  let resultado;
  if (area === "Activos") {
    resultado = [...CATEGORIAS_ACTIVOS, "Gastos Bancarios"];
  } else if (categoriasRubro && categoriasRubro.length > 0) {
    const base = categoriasRubro.includes("Gastos Bancarios")
      ? categoriasRubro
      : [...categoriasRubro, "Gastos Bancarios"];
    // "Planilla"/"Pagos Tributarios" siempre deben poder elegirse, aunque
    // el rubro configurado en Configuración no las incluya explícitamente.
    resultado = [...base, ...CATEGORIAS_ESPECIALES.filter(c => !base.includes(c))];
  } else if (categoriasBase && categoriasBase.length > 0) {
    const extras = ["Gastos Bancarios", "Otros"];
    const baseConExtras = [...categoriasBase, ...extras.filter(e => !categoriasBase.includes(e))];
    resultado = [...baseConExtras, ...CATEGORIAS_ESPECIALES.filter(c => !baseConExtras.includes(c))];
  } else {
    resultado = CATEGORIAS_OPERATIVAS; // fallback final: ya incluye Gastos Bancarios y las especiales
  }
  // "Pagos Tributarios" ya no se registra desde Nuevo/Editar Gasto: solo
  // desde la pestaña dedicada "Pagos Tributarios".
  return resultado.filter(c => c !== CATEGORIA_PAGOS_TRIBUTARIOS);
}
const PER_PAGE = 20;

const TIPOS_COMPROBANTE = ["Factura", "Recibo por Honorarios", "Recibo de Servicios Públicos", "Recibo Interno", "Gastos Bancarios", "Anticipo de Proveedor"];
const TIPOS_DOCUMENTO   = ["RUC", "DNI", "Carnet de Extranjería"];
const METODOS_PAGO      = ["Efectivo", "Transferencia", "Depósito", "Cheque", "Yape o Plin"];
const SEM_OPTIONS_CPP   = [
  { value: "",          label: "Todos" },
  { value: "verde",     label: "🟢  Al día" },
  { value: "amarillo",  label: "🟡  Vencido 1-15 días" },
  { value: "rojo",      label: "🔴  Vencido +15 días" },
  { value: "pagado",    label: "✅  Pagados" },
  { value: "sin_fecha", label: "⚪  Sin fecha límite" },
];

// Columnas ocultables de la tabla "Cuentas por Pagar" (selector "⚙ Columnas").
// "Acciones" no está acá porque siempre es visible (forzada en el render).
const CPP_COLUMNAS = [
  { id: "semaforo",    label: "Semáforo" },
  { id: "fecha",       label: "Fecha" },
  { id: "categoria",   label: "Categoría" },
  { id: "area",        label: "Área" },
  { id: "descripcion", label: "Descripción" },
  { id: "comprobante", label: "Tipo/N° Comprobante" },
  { id: "ruc",         label: "RUC/Doc" },
  { id: "proveedor",   label: "Proveedor" },
  { id: "monto",       label: "Monto" },
  { id: "saldo",       label: "Saldo Pendiente" },
  { id: "vencimiento", label: "Vencimiento" },
  { id: "estado",      label: "Estado" },
];
const CPP_COLUMNAS_DEFAULT = Object.fromEntries(CPP_COLUMNAS.map(c => [c.id, true]));
const CPP_COLUMNAS_STORAGE_KEY = "gastos_cpp_columnas_visibles";
const CPP_COLUMNAS_MIN_VISIBLES = 3;

// ── Detracción (solo Tipo Comprobante = Factura) ────────────────────────────
const TASAS_DETRACCION = [
  { concepto: "Alquiler de bienes muebles",       tasa: 10 },
  { concepto: "Mantenimiento y reparación",       tasa: 10 },
  { concepto: "Otros servicios empresariales",    tasa: 10 },
  { concepto: "Transporte de bienes",             tasa: 4 },
  { concepto: "Construcción",                     tasa: 4 },
  { concepto: "Contratos de construcción",        tasa: 4 },
  { concepto: "Demás servicios gravados con IGV", tasa: 12 },
  { concepto: "Otro",                             tasa: null },
];

// Código de bien/servicio (tabla SUNAT) autoseleccionado según la categoría
// del Gasto cuando Tipo de Comprobante = Factura. Solo cubre las categorías
// operativas que tienen un código definido; las demás no autoseleccionan
// (el usuario lo completa manualmente si aplica).
const CATEGORIA_A_CODIGO_DETRACCION = {
  "Alquiler de andamios":      "019",
  "Alquiler de oficina":       "019",
  "Alquiler de almacén":       "019",
  "Mano de obra":              "012",
  "Transporte":                "027",
  "Suministros":               "037",
  "Materia prima":             "037",
  "Servicios básicos":         "037",
  "Seguros":                   "037",
  "Gastos administrativos":    "037",
  "Gastos de ventas":          "037",
  "Contratos de construcción": "030",
};

// Fecha límite de depósito: día 5 del mes siguiente a la emisión.
function sugerirFechaLimiteDetraccion(fechaEmision) {
  if (!fechaEmision) return "";
  const [y, m] = fechaEmision.split("-").map(Number);
  let mm = m + 1, yy = y;
  if (mm > 12) { mm = 1; yy += 1; }
  return `${yy}-${String(mm).padStart(2, "0")}-05`;
}

const FORM_DEFAULT = {
  fecha: "", categoria: "", descripcion: "", monto: "",
  area: "", es_recurrente: false,
  tipo_comprobante: "", numero_comprobante: "",
  tipo_documento: "", numero_documento: "", proveedor: "",
  fecha_vencimiento: "",
  moneda: "PEN", tipo_cambio: "3.75",
  tiene_detraccion:        false,
  concepto_detraccion:     TASAS_DETRACCION[0].concepto,
  tasa_detraccion:         String(TASAS_DETRACCION[0].tasa),
  ruc_cuenta_detraccion:   "",
  fecha_limite_detraccion: "",
  codigo_detraccion:       "",
  aplicar_retencion_ir:    false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtFecha(d) {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

function hoy() { return new Date().toISOString().split("T")[0]; }
function primeroDelMes() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split("T")[0];
}

function parsearError(err) {
  if (!err?.response) return "No se pudo conectar al servidor.";
  const d = err.response?.data?.detail;
  if (!d) return `Error del servidor (${err.response.status})`;
  if (Array.isArray(d)) return "Error de validación: " + d.map(e => e.msg).join(", ");
  return String(d);
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function KPICard({ label, value, sub, colorBorder, colorText, colorRing, onClick, isActive }) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      className={[
        "bg-white rounded-xl border-l-4 p-4 transition-all select-none",
        colorBorder,
        clickable ? "cursor-pointer" : "",
        isActive ? `ring-2 ${colorRing} shadow-lg` : clickable ? "shadow-sm hover:shadow-md" : "shadow-sm",
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

function CategoriaBadge({ categoria }) {
  const colores = {
    "Alquiler de oficina":           "bg-blue-100 text-blue-700",
    "Alquiler de almacén":           "bg-indigo-100 text-indigo-700",
    "Mano de obra":                  "bg-orange-100 text-orange-700",
    "Transporte":                    "bg-cyan-100 text-cyan-700",
    "Suministros":                   "bg-teal-100 text-teal-700",
    "Materia prima":                 "bg-yellow-100 text-yellow-700",
    "Alquiler de andamios":          "bg-purple-100 text-purple-700",
    "Servicios básicos":             "bg-green-100 text-green-700",
    "Seguros":                       "bg-red-100 text-red-700",
    "Gastos administrativos":        "bg-gray-100 text-gray-700",
    "Gastos de ventas":              "bg-pink-100 text-pink-700",
    "Maquinaria y Equipos":          "bg-amber-100 text-amber-800",
    "Vehículos":                     "bg-rose-100 text-rose-800",
    "Mobiliario y Equipo de Oficina":"bg-yellow-100 text-yellow-800",
    "Mejoras a Local":               "bg-lime-100 text-lime-800",
    "Otros Activos":                 "bg-stone-100 text-stone-700",
    [CATEGORIA_PLANILLA]:            "bg-green-100 text-green-700",
  };
  // "Pagos Tributarios" no afecta utilidad: se distingue con badge gris
  // "Tributario" en vez del nombre completo de la categoría.
  if (categoria === CATEGORIA_PAGOS_TRIBUTARIOS) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-200 text-gray-700">
        Tributario
      </span>
    );
  }
  const esActivo = CATEGORIAS_ACTIVOS.includes(categoria);
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${colores[categoria] || "bg-gray-100 text-gray-600"}`}>
      {esActivo && <span className="text-[9px]">⚙</span>}{categoria}
    </span>
  );
}

function SemaforoGasto({ valor }) {
  if (valor === "pagado")    return <HiCheckCircle className="w-5 h-5 text-green-500" title="Pagado" />;
  if (valor === "sin_fecha") return <span className="inline-block w-3 h-3 rounded-full bg-gray-300" title="Sin fecha límite" />;
  const c = { verde: "bg-green-500", amarillo: "bg-yellow-400", rojo: "bg-red-500" };
  const t = { verde: "Al día", amarillo: "Vencido 1-15 días", rojo: "Vencido +15 días" };
  return <span className={`inline-block w-3 h-3 rounded-full ${c[valor] || "bg-gray-300"}`} title={t[valor] || valor} />;
}

function EstadoPagoBadge({ estado }) {
  const m = {
    "Pendiente":    "bg-blue-100 text-blue-700",
    "Pago Parcial": "bg-yellow-100 text-yellow-700",
    "Pagado":       "bg-green-100 text-green-700",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${m[estado] || "bg-gray-100 text-gray-600"}`}>
      {estado || "—"}
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function Gastos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [imprimiendoId, setImprimiendoId] = useState(null);

  // ── datos ──────────────────────────────────────────────────────────────────
  const [resumen,        setResumen]        = useState(null);
  const [porCategoria,   setPorCategoria]   = useState([]);
  const [porArea,        setPorArea]        = useState([]);
  const [evolucion,      setEvolucion]      = useState([]);
  const [recurrentes,    setRecurrentes]    = useState([]);

  // ── filtros (tab "Cuentas por Pagar" — muestra todos los gastos) ───────────
  const [filterCategoria, setFilterCategoria]= useState("");
  const [filterArea,      setFilterArea]     = useState("");
  // Sin rango de fecha por defecto: "Cuentas por Pagar" debe mostrar TODAS las
  // deudas pendientes (incluidas las de meses anteriores), no solo el mes actual.
  const [filterDesde,     setFilterDesde]    = useState("");
  const [filterHasta,     setFilterHasta]    = useState("");
  const [activeKPI,       setActiveKPI]      = useState("total_mes");

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [activeTab,       setActiveTab]      = useState("cuentas_por_pagar");
  const [loadingResumen,  setLoadingResumen] = useState(true);

  // ── modal formulario ───────────────────────────────────────────────────────
  const [formModal,  setFormModal]  = useState(null);  // null | "nuevo" | gasto
  const [form,       setForm]       = useState(FORM_DEFAULT);
  const [formError,  setFormError]  = useState("");
  const [saving,     setSaving]     = useState(false);
  // Adjuntar comprobante al crear un gasto manualmente (opcional) — se sube
  // recién después de creado el gasto, igual que en ModalImportarPdfGasto.jsx.
  const [comprobanteFile, setComprobanteFile]         = useState(null);
  const [dragOverComprobante, setDragOverComprobante] = useState(false);
  const comprobanteFileRef = useRef(null);
  const [categoriasRubro, setCategoriasRubro] = useState(null); // categorías configuradas en Configuración → Rubro (fallback: hardcodeadas)

  // Categorías/áreas gestionadas dinámicamente desde Configuración → Gastos
  // (ver GastosTab.jsx). Si la API falla o aún no cargó, los usos de estas
  // listas caen a las constantes hardcodeadas (CATEGORIAS_OPERATIVAS / AREAS).
  const [categoriasGastoDB, setCategoriasGastoDB] = useState([]);
  const [areasGastoDB,      setAreasGastoDB]      = useState([]);
  const nombresCategoriasActivas = categoriasGastoDB.filter(c => c.activo).map(c => c.nombre);
  const nombresAreasActivas      = areasGastoDB.filter(a => a.activo).map(a => a.nombre);
  const todasCategoriasDinamicas = [
    ...(nombresCategoriasActivas.length ? nombresCategoriasActivas : CATEGORIAS_OPERATIVAS),
    ...CATEGORIAS_ACTIVOS,
  ];
  const todasAreasDinamicas = nombresAreasActivas.length ? nombresAreasActivas : AREAS;

  useEffect(() => {
    getRubro()
      .then(r => setCategoriasRubro(r.categorias_gastos?.length ? r.categorias_gastos : null))
      .catch(() => setCategoriasRubro(null));
    getCategoriasGasto().then(setCategoriasGastoDB).catch(() => setCategoriasGastoDB([]));
    getAreasGasto().then(setAreasGastoDB).catch(() => setAreasGastoDB([]));
  }, []);

  // ── modal ver ──────────────────────────────────────────────────────────────
  const [verModal, setVerModal] = useState(null);

  // ── modal importar PDF de factura de proveedor ────────────────────────────
  const [elegirImportacion, setElegirImportacion] = useState(false);
  const [importarPdf,       setImportarPdf]       = useState(false);
  const [cargaMasiva,       setCargaMasiva]       = useState(false);

  // ── modal exportar ─────────────────────────────────────────────────────────
  const [exportModal, setExportModal] = useState(false);
  const [exportForm,  setExportForm]  = useState({ desde: "", hasta: "", categoria: "", area: "", tipos_comprobante: [] });
  const [exportando,  setExportando]  = useState(false);
  const [exportError, setExportError] = useState("");

  // ── acciones ───────────────────────────────────────────────────────────────
  const [togglingId,         setTogglingId]         = useState(null);
  const [deletingId,         setDeletingId]         = useState(null);
  const [confirmarEliminarGasto, setConfirmarEliminarGasto] = useState(null); // id del gasto a eliminar | null
  const [loadingCorrelativo, setLoadingCorrelativo] = useState(false);
  const [cppSeleccionados,      setCppSeleccionados]      = useState([]);
  const [confirmDelMasivoCpp,   setConfirmDelMasivoCpp]   = useState(false);
  const [deletingMasivoCpp,     setDeletingMasivoCpp]     = useState(false);
  const [toast, setToast] = useState(null); // reemplaza alert() nativo — { message, type } | null

  // ── autocompletado proveedor vía SUNAT ────────────────────────────────────
  const [buscandoRucProv, setBuscandoRucProv] = useState(false);
  const [rucProvMsg,      setRucProvMsg]      = useState("");

  // ── Cuentas por Pagar ──────────────────────────────────────────────────────
  const [cppGastos,        setCppGastos]        = useState([]);
  const [cppTotal,         setCppTotal]         = useState(0);
  const [cppResumen,       setCppResumen]       = useState(null);
  const [loadingCpp,       setLoadingCpp]       = useState(false);
  const [filterCppSem,     setFilterCppSem]     = useState("");
  const [filterCppEstado,  setFilterCppEstado]  = useState("");
  const [searchCpp,        setSearchCpp]        = useState("");
  const [cppPage,          setCppPage]          = useState(1);

  // ── Cuentas por Pagar: selector de columnas visibles ("⚙ Columnas") ───────
  const [cppColumnas, setCppColumnas] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CPP_COLUMNAS_STORAGE_KEY));
      return guardado ? { ...CPP_COLUMNAS_DEFAULT, ...guardado } : { ...CPP_COLUMNAS_DEFAULT };
    } catch { return { ...CPP_COLUMNAS_DEFAULT }; }
  });
  const [cppColumnasMenuAbierto, setCppColumnasMenuAbierto] = useState(false);
  const cppColumnasMenuRef = useRef(null);

  useEffect(() => {
    if (!cppColumnasMenuAbierto) return;
    const handleClickFuera = (e) => {
      if (cppColumnasMenuRef.current && !cppColumnasMenuRef.current.contains(e.target)) {
        setCppColumnasMenuAbierto(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [cppColumnasMenuAbierto]);

  const toggleCppColumna = (id) => {
    setCppColumnas(cols => {
      const visibles = Object.values(cols).filter(Boolean).length;
      if (cols[id] && visibles <= CPP_COLUMNAS_MIN_VISIBLES) return cols; // no bajar de 3 visibles
      const next = { ...cols, [id]: !cols[id] };
      localStorage.setItem(CPP_COLUMNAS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const restablecerCppColumnas = () => {
    const next = { ...CPP_COLUMNAS_DEFAULT };
    setCppColumnas(next);
    localStorage.setItem(CPP_COLUMNAS_STORAGE_KEY, JSON.stringify(next));
  };

  const cppColSpan = 2 + CPP_COLUMNAS.filter(c => cppColumnas[c.id]).length; // +2 = checkbox y Acciones, siempre visibles

  // ── Modal registrar pago ───────────────────────────────────────────────────
  const [pagoModal,    setPagoModal]    = useState(null);

  // ── Modal detalle + historial ──────────────────────────────────────────────
  const [detalleModal,     setDetalleModal]     = useState(null);
  const [historialPagos,   setHistorialPagos]   = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  // ── Modal editar pago ──────────────────────────────────────────────────────
  const [editPagoModal,  setEditPagoModal]  = useState(null);
  const [editPagoForm,   setEditPagoForm]   = useState({ monto_pagado: "", fecha_pago: hoy(), metodo_pago: "Efectivo", banco: "", numero_cuenta: "", numero_cheque: "" });
  const [editPagoError,  setEditPagoError]  = useState("");
  const [savingEditPago, setSavingEditPago] = useState(false);
  const [deletingPagoId, setDeletingPagoId] = useState(null);
  const [confirmarEliminarPago, setConfirmarEliminarPago] = useState(null); // id del pago a eliminar | null

  // ── Modal exportar CPP ─────────────────────────────────────────────────────
  const [cppExportModal, setCppExportModal] = useState(false);
  const [cppExportForm,  setCppExportForm]  = useState({ desde: "", hasta: "", proveedor: "", estado: "", categoria: "", area: "" });
  const [exportandoCpp,  setExportandoCpp]  = useState(false);
  const [cppExportError, setCppExportError] = useState("");

  // ── Cuentas bancarias (compartidas con Cobranza) ───────────────────────────
  const [cuentasBancarias, setCuentasBancarias] = useState([]);

  // ── carga de datos ─────────────────────────────────────────────────────────

  const cargarResumen = useCallback(async () => {
    setLoadingResumen(true);
    try { setResumen(await getResumenGastos()); }
    catch { setResumen(null); }
    finally { setLoadingResumen(false); }
  }, []);

  const cargarReporte = useCallback(async () => {
    try {
      const [cat, area, evol] = await Promise.all([
        getGastosPorCategoria(), getGastosPorArea(), getEvolucionMensual(),
      ]);
      setPorCategoria(cat || []);
      setPorArea(area || []);
      setEvolucion(evol || []);
    } catch { /* silent */ }
  }, []);

  const cargarRecurrentes = useCallback(async () => {
    try {
      const r = await getGastos({ solo_recurrentes: true, per_page: 100 });
      setRecurrentes(r.data || []);
    } catch { setRecurrentes([]); }
  }, []);

  const cargarCpp = useCallback(async () => {
    setLoadingCpp(true);
    try {
      const params = { page: cppPage, per_page: PER_PAGE };
      if (searchCpp)       params.search    = searchCpp;
      if (filterCppSem)    params.semaforo  = filterCppSem;
      if (filterCppEstado) params.estado    = filterCppEstado;
      if (filterCategoria) params.categoria = filterCategoria;
      if (filterArea)      params.area      = filterArea;
      if (filterDesde)     params.desde     = filterDesde;
      if (filterHasta)     params.hasta     = filterHasta;
      const r = await getCuentasPorPagar(params);
      setCppGastos(r.data || []);
      setCppTotal(r.total || 0);
      setCppSeleccionados([]);
    } catch { setCppGastos([]); setCppTotal(0); }
    finally { setLoadingCpp(false); }
  }, [cppPage, searchCpp, filterCppSem, filterCppEstado, filterCategoria, filterArea, filterDesde, filterHasta]);

  const cargarCppResumen = useCallback(async () => {
    try { setCppResumen(await getResumenCuentasPorPagar()); }
    catch { setCppResumen(null); }
  }, []);

  useEffect(() => { cargarResumen(); },     [cargarResumen]);
  useEffect(() => {
    if (activeTab === "reporte")          cargarReporte();
    if (activeTab === "recurrentes")      cargarRecurrentes();
    if (activeTab === "cuentas_por_pagar") { cargarCpp(); cargarCppResumen(); }
  }, [activeTab, cargarReporte, cargarRecurrentes, cargarCpp, cargarCppResumen]); // eslint-disable-line
  useEffect(() => {
    if (activeTab === "cuentas_por_pagar") cargarCpp();
  }, [cppPage, searchCpp, filterCppSem, filterCppEstado, filterCategoria, filterArea, filterDesde, filterHasta]); // eslint-disable-line

  useEffect(() => {
    getCuentasBancarias().then(r => setCuentasBancarias(r || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const esAuto = form.tipo_comprobante === "Recibo Interno" || form.tipo_comprobante === "Gastos Bancarios" || form.tipo_comprobante === "Anticipo de Proveedor";
    if (esAuto && !form.numero_comprobante) {
      setLoadingCorrelativo(true);
      const tipo = form.tipo_comprobante === "Gastos Bancarios" ? "GB" : form.tipo_comprobante === "Anticipo de Proveedor" ? "AP" : "RI";
      getProximoCorrelativo(tipo)
        .then(r => setForm(f => ({ ...f, numero_comprobante: r.proximo })))
        .catch(() => {})
        .finally(() => setLoadingCorrelativo(false));
    }
  }, [form.tipo_comprobante]); // eslint-disable-line

  // ── KPI cards ──────────────────────────────────────────────────────────────

  const kpiTotalMes = () => {
    setActiveKPI("total_mes");
    setFilterCategoria("");
    setFilterArea("");
    setFilterDesde(primeroDelMes());
    setFilterHasta(hoy());
    setCppPage(1);
    setActiveTab("cuentas_por_pagar");
  };

  const kpiTopCategoria = () => {
    if (!resumen?.gasto_mas_alto) return;
    setActiveKPI("top_cat");
    setFilterCategoria(resumen.gasto_mas_alto.categoria);
    setFilterArea("");
    setFilterDesde("");
    setFilterHasta("");
    setCppPage(1);
    setActiveTab("cuentas_por_pagar");
  };

  const kpiAnio = () => {
    const d = new Date();
    setActiveKPI("anio");
    setFilterCategoria("");
    setFilterArea("");
    setFilterDesde(`${d.getFullYear()}-01-01`);
    setFilterHasta(hoy());
    setCppPage(1);
    setActiveTab("cuentas_por_pagar");
  };

  const limpiarFiltros = () => {
    setSearchCpp(""); setFilterCategoria(""); setFilterArea("");
    setFilterDesde(""); setFilterHasta(""); setFilterCppSem(""); setFilterCppEstado("");
    setActiveKPI("total_mes"); setCppPage(1);
  };

  // ── formulario ─────────────────────────────────────────────────────────────

  const abrirNuevo = () => {
    setForm({ ...FORM_DEFAULT, fecha: hoy() });
    setFormError("");
    setRucProvMsg("");
    setComprobanteFile(null);
    setDragOverComprobante(false);
    setFormModal("nuevo");
  };

  const abrirEditar = (g) => {
    setForm({
      fecha:              g.fecha || hoy(),
      categoria:          g.categoria || "",
      descripcion:        g.descripcion || "",
      monto:              g.moneda === "USD" ? String(g.monto_original || g.monto || "") : String(g.monto || ""),
      area:               g.area || "",
      es_recurrente:      g.es_recurrente || false,
      tipo_comprobante:   g.tipo_comprobante || "",
      numero_comprobante: g.numero_comprobante || "",
      tipo_documento:     g.tipo_documento || "",
      numero_documento:   g.numero_documento || "",
      proveedor:          g.proveedor || "",
      fecha_vencimiento:  g.fecha_vencimiento || "",
      moneda:             g.moneda || "PEN",
      tipo_cambio:        g.tipo_cambio ? String(g.tipo_cambio) : "3.75",
      tiene_detraccion:        g.tiene_detraccion || false,
      concepto_detraccion:     g.concepto_detraccion || TASAS_DETRACCION[0].concepto,
      tasa_detraccion:         g.tasa_detraccion != null ? String(g.tasa_detraccion) : String(TASAS_DETRACCION[0].tasa),
      ruc_cuenta_detraccion:   g.ruc_cuenta_detraccion || "",
      fecha_limite_detraccion: g.fecha_limite_detraccion || "",
      codigo_detraccion:       g.codigo_detraccion || "",
      // No se persiste en el Gasto: se recalcula/decide de nuevo cada vez
      // que se abre el formulario (ver checkbox "Aplicar Retención IR (8%)").
      aplicar_retencion_ir:    false,
    });
    setFormError("");
    setRucProvMsg("");
    setFormModal(g);
  };

  // Deep-link desde el Buscador Global: /gastos?ver=X → abre el detalle del gasto X
  useEffect(() => {
    const verId = searchParams.get("ver");
    if (verId) {
      getGasto(verId).then(setVerModal).catch(() => {});
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNumDocChange = async (val) => {
    setForm(f => ({ ...f, numero_documento: val }));
    setRucProvMsg("");
    if (form.tipo_documento === "RUC" && val.length === 11 && /^\d{11}$/.test(val)) {
      setBuscandoRucProv(true);
      setRucProvMsg("Buscando...");
      try {
        const data = await consultarRuc(val);
        if (data?.razon_social) {
          setForm(f => ({ ...f, numero_documento: val, proveedor: data.razon_social }));
          setRucProvMsg("Proveedor encontrado en SUNAT");
        } else {
          setRucProvMsg("RUC no encontrado — ingrese el nombre manualmente");
        }
      } catch (err) {
        const detalle = err?.response?.data?.detail || "";
        setRucProvMsg(detalle.includes("no encontrado")
          ? "RUC no encontrado — ingrese el nombre manualmente"
          : "Error al consultar — ingrese manualmente");
      } finally {
        setBuscandoRucProv(false);
      }
    }
  };

  const handleGuardar = async () => {
    if (!form.fecha)              { setFormError("La fecha es obligatoria."); return; }
    if (!form.categoria)          { setFormError("La categoría es obligatoria."); return; }
    if (!form.descripcion.trim()) { setFormError("La descripción es obligatoria."); return; }
    const monto = parseFloat(form.monto);
    if (isNaN(monto) || monto <= 0) { setFormError("Ingrese un monto válido mayor a 0."); return; }
    if (!form.area)               { setFormError("El área es obligatoria."); return; }
    if (form.moneda === "USD") {
      const tc = parseFloat(form.tipo_cambio);
      if (isNaN(tc) || tc <= 0) { setFormError("Ingrese un tipo de cambio válido."); return; }
    }

    const payload = {
      fecha:              form.fecha,
      categoria:          form.categoria,
      descripcion:        form.descripcion.trim(),
      monto,
      area:               form.area,
      es_recurrente:      form.es_recurrente,
      tipo_comprobante:   form.tipo_comprobante || null,
      numero_comprobante: form.numero_comprobante.trim() || null,
      tipo_documento:     form.tipo_documento || null,
      numero_documento:   form.numero_documento.trim() || null,
      proveedor:          form.proveedor.trim() || null,
      fecha_vencimiento:  form.fecha_vencimiento || null,
      moneda:             form.moneda || "PEN",
      tipo_cambio:        form.moneda === "USD" ? parseFloat(form.tipo_cambio) : null,
      tiene_detraccion:        form.tipo_comprobante === "Factura" && form.tiene_detraccion,
      concepto_detraccion:     form.tipo_comprobante === "Factura" && form.tiene_detraccion ? form.concepto_detraccion : null,
      tasa_detraccion:         form.tipo_comprobante === "Factura" && form.tiene_detraccion ? parseFloat(form.tasa_detraccion) : null,
      ruc_cuenta_detraccion:   form.tipo_comprobante === "Factura" && form.tiene_detraccion ? (form.ruc_cuenta_detraccion.trim() || null) : null,
      fecha_limite_detraccion: form.tipo_comprobante === "Factura" && form.tiene_detraccion ? (form.fecha_limite_detraccion || null) : null,
      codigo_detraccion:       form.tipo_comprobante === "Factura" ? (form.codigo_detraccion.trim() || null) : null,
    };

    setSaving(true); setFormError("");
    try {
      if (formModal === "nuevo") {
        const nuevoGasto = await createGasto(payload);
        // Adjuntar comprobante es opcional y best-effort: si falla, el gasto
        // ya quedó registrado igual (mismo criterio que ModalImportarPdfGasto.jsx).
        if (comprobanteFile) {
          try {
            const fd = new FormData();
            fd.append("file", comprobanteFile);
            await subirComprobanteGasto(nuevoGasto.id, fd);
          } catch { /* el gasto ya se registró; el adjunto es best-effort */ }
        }
      } else {
        await updateGasto(formModal.id, payload);
      }
      setFormModal(null);
      cargarCpp();
      cargarCppResumen();
      cargarResumen();
    } catch (err) {
      setFormError(parsearError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async () => {
    if (!confirmarEliminarGasto) return;
    const id = confirmarEliminarGasto;
    setDeletingId(id);
    try {
      await deleteGasto(id);
      cargarCpp(); cargarCppResumen(); cargarResumen();
      setConfirmarEliminarGasto(null);
    } catch (err) { setToast({ message: parsearError(err), type: "error" }); }
    finally { setDeletingId(null); }
  };

  const toggleCppSeleccionado = (id) => {
    setCppSeleccionados(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };
  const cppTodosSeleccionados = cppGastos.length > 0 && cppGastos.every(g => cppSeleccionados.includes(g.id));
  const toggleCppTodos = () => {
    setCppSeleccionados(cppTodosSeleccionados ? [] : cppGastos.map(g => g.id));
  };

  const handleEliminarMasivoCpp = async () => {
    setDeletingMasivoCpp(true);
    try {
      await eliminarGastosMasivo(cppSeleccionados);
      setConfirmDelMasivoCpp(false);
      setCppSeleccionados([]);
      cargarCpp(); cargarCppResumen(); cargarResumen();
    } catch (err) { setToast({ message: parsearError(err), type: "error" }); }
    finally { setDeletingMasivoCpp(false); }
  };

  const handleToggle = async (g) => {
    setTogglingId(g.id);
    try {
      await toggleRecurrenteGasto(g.id);
      cargarRecurrentes(); cargarResumen();
    } catch (err) { setToast({ message: parsearError(err), type: "error" }); }
    finally { setTogglingId(null); }
  };

  // ── exportar ───────────────────────────────────────────────────────────────

  const handleExportar = async () => {
    setExportando(true); setExportError("");
    try {
      const params = {};
      if (exportForm.desde)     params.desde     = exportForm.desde;
      if (exportForm.hasta)     params.hasta     = exportForm.hasta;
      if (exportForm.categoria) params.categoria = exportForm.categoria;
      if (exportForm.area)      params.area      = exportForm.area;
      if (exportForm.tipos_comprobante.length > 0)
        params.tipos_comprobante = exportForm.tipos_comprobante.join(",");
      const blob = await exportarGastos(params);
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const url  = window.URL.createObjectURL(new Blob([blob]));
      const a    = document.createElement("a");
      a.href = url; a.setAttribute("download", `Reporte_Gastos_${fecha}.xlsx`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      setExportModal(false);
    } catch (err) { setExportError(parsearError(err)); }
    finally { setExportando(false); }
  };

  // ── CPP handlers ──────────────────────────────────────────────────────────

  const abrirPago = (g) => setPagoModal(g);

  const abrirDetalle = async (g) => {
    setDetalleModal(g);
    setLoadingHistorial(true);
    try { setHistorialPagos(await getHistorialPagosGasto(g.id)); }
    catch { setHistorialPagos([]); }
    finally { setLoadingHistorial(false); }
  };

  const abrirEditarPago = (pago) => {
    setEditPagoModal(pago);
    setEditPagoForm({
      monto_pagado:  String(pago.monto_pagado),
      fecha_pago:    pago.fecha_pago,
      metodo_pago:   pago.metodo_pago || "Efectivo",
      banco:         pago.banco || "",
      numero_cuenta: pago.numero_cuenta || "",
      numero_cheque: pago.numero_cheque || "",
    });
    setEditPagoError("");
  };

  const handleEditarPago = async () => {
    const monto = parseFloat(editPagoForm.monto_pagado);
    if (isNaN(monto) || monto <= 0) { setEditPagoError("Ingrese un monto válido."); return; }
    setSavingEditPago(true); setEditPagoError("");
    try {
      await updatePagoGasto(editPagoModal.id, {
        monto_pagado:  monto,
        fecha_pago:    editPagoForm.fecha_pago,
        metodo_pago:   editPagoForm.metodo_pago,
        banco:         editPagoForm.banco || null,
        numero_cuenta: editPagoForm.numero_cuenta || null,
        numero_cheque: editPagoForm.numero_cheque || null,
      });
      setEditPagoModal(null);
      if (detalleModal) {
        const updated = await getHistorialPagosGasto(detalleModal.id);
        setHistorialPagos(updated);
      }
      cargarCpp(); cargarCppResumen();
    } catch (err) { setEditPagoError(parsearError(err)); }
    finally { setSavingEditPago(false); }
  };

  const handleEliminarPago = async () => {
    if (!confirmarEliminarPago) return;
    const pagoId = confirmarEliminarPago;
    setDeletingPagoId(pagoId);
    try {
      await deletePagoGasto(pagoId);
      if (detalleModal) {
        const updated = await getHistorialPagosGasto(detalleModal.id);
        setHistorialPagos(updated);
      }
      cargarCpp(); cargarCppResumen();
      setConfirmarEliminarPago(null);
    } catch (err) { setToast({ message: parsearError(err), type: "error" }); }
    finally { setDeletingPagoId(null); }
  };

  const handleExportarCpp = async () => {
    setExportandoCpp(true); setCppExportError("");
    try {
      const params = {};
      if (cppExportForm.desde)     params.desde     = cppExportForm.desde;
      if (cppExportForm.hasta)     params.hasta     = cppExportForm.hasta;
      if (cppExportForm.proveedor) params.proveedor = cppExportForm.proveedor;
      if (cppExportForm.estado)    params.estado    = cppExportForm.estado;
      if (cppExportForm.categoria) params.categoria = cppExportForm.categoria;
      if (cppExportForm.area)      params.area      = cppExportForm.area;
      const blob = await exportarCuentasPorPagar(params);
      const url  = window.URL.createObjectURL(new Blob([blob]));
      const a    = document.createElement("a");
      a.href = url;
      a.setAttribute("download", `Cuentas_Por_Pagar_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.xlsx`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      setCppExportModal(false);
    } catch (err) { setCppExportError(parsearError(err)); }
    finally { setExportandoCpp(false); }
  };

  const cppTotalPages = Math.ceil(cppTotal / PER_PAGE);

  // ── imprimir (Recibo Interno / Factura de gasto) ──────────────────────────────

  const handleImprimirGasto = async (g) => {
    // Si el gasto viene de una factura PDF importada, se abre el archivo
    // original tal cual (sin regenerar un documento nuevo). El endpoint
    // exige autenticación, así que no puede abrirse con window.open() directo
    // (no envía el token) — se descarga como blob vía axios y se abre ese
    // blob en una pestaña nueva.
    if (g.tiene_comprobante) {
      // La pestaña se abre ANTES del await para no disparar el bloqueador de
      // pop-ups del navegador (solo permite window.open síncrono al click).
      const ventana = window.open("", "_blank");
      setImprimiendoId(g.id);
      try {
        const blob = await getComprobanteGastoBlob(g.id);
        const url  = window.URL.createObjectURL(blob);
        if (ventana) ventana.location.href = url;
        else window.open(url, "_blank");
        setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      } catch {
        if (ventana) ventana.close();
        setToast({ message: "No se pudo abrir el comprobante original", type: "error" });
      } finally {
        setImprimiendoId(null);
      }
      return;
    }
    setImprimiendoId(g.id);
    try {
      const data = await getGastoImprimir(g.id);
      await imprimirComprobante(data);
    } catch {
      setToast({ message: "No se pudo cargar el comprobante para imprimir", type: "error" });
    } finally {
      setImprimiendoId(null);
    }
  };

  // ── variación helper ───────────────────────────────────────────────────────
  const variacion = resumen?.variacion_pct ?? 0;
  const varPositivo = variacion > 0; // gasto subió → malo (rojo)

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Gastos" />

        <main className="flex-1 overflow-y-auto p-6">

          {/* Encabezado */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Registro de Gastos</h1>
              <p className="text-sm text-gray-500 mt-0.5">Control y seguimiento de gastos operativos y administrativos</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setElegirImportacion(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-xl transition-colors shadow-sm">
                📥 Importar factura PDF
              </button>
              <button onClick={abrirNuevo}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
                <HiPlus className="w-4 h-4" /> Nuevo Gasto
              </button>
            </div>
          </div>

          {/* ── KPI Cards ──────────────────────────────────────────────────── */}
          {activeTab !== "cuentas_por_pagar" && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <KPICard
                label="Total Gastos del Mes"
                value={loadingResumen ? "…" : fmtS(resumen?.total_mes)}
                sub={`${new Date().toLocaleString("es-PE",{month:"long",year:"numeric"})}`}
                colorBorder="border-blue-500" colorText="text-blue-700" colorRing="ring-blue-500"
                isActive={activeKPI === "total_mes"}
                onClick={kpiTotalMes}
              />
              <KPICard
                label="Gasto Más Alto"
                value={loadingResumen ? "…" : fmtS(resumen?.gasto_mas_alto?.monto)}
                sub={resumen?.gasto_mas_alto?.categoria || "—"}
                colorBorder="border-red-500" colorText="text-red-700" colorRing="ring-red-500"
                isActive={activeKPI === "top_cat"}
                onClick={kpiTopCategoria}
              />
              <KPICard
                label="vs Mes Anterior"
                value={loadingResumen ? "…" : `${variacion > 0 ? "+" : ""}${variacion}%`}
                sub={`Anterior: ${fmtS(resumen?.total_mes_ant)}`}
                colorBorder={varPositivo ? "border-red-400" : "border-green-500"}
                colorText={varPositivo ? "text-red-600" : "text-green-700"}
                colorRing={varPositivo ? "ring-red-400" : "ring-green-500"}
              />
              <KPICard
                label="Total Gastos del Año"
                value={loadingResumen ? "…" : fmtS(resumen?.total_anio)}
                sub={`Año ${new Date().getFullYear()}`}
                colorBorder="border-purple-500" colorText="text-purple-700" colorRing="ring-purple-500"
                isActive={activeKPI === "anio"}
                onClick={kpiAnio}
              />
            </div>
          )}
          {activeTab === "cuentas_por_pagar" && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <KPICard
                label="Total por Pagar"
                value={cppResumen ? fmtS(cppResumen.total_pendiente) : "…"}
                sub="Saldo pendiente total"
                colorBorder="border-blue-500" colorText="text-blue-700" colorRing="ring-blue-500"
                isActive={filterCppSem === ""}
                onClick={() => { setFilterCppSem(""); setCppPage(1); }}
              />
              <KPICard
                label="Al Día"
                value={cppResumen ? fmtS(cppResumen.al_dia) : "…"}
                sub="Vencimiento futuro"
                colorBorder="border-green-500" colorText="text-green-700" colorRing="ring-green-500"
                isActive={filterCppSem === "verde"}
                onClick={() => { setFilterCppSem("verde"); setCppPage(1); }}
              />
              <KPICard
                label="Vencido 1-15 días"
                value={cppResumen ? fmtS(cppResumen.por_vencer_15) : "…"}
                sub="Urgente"
                colorBorder="border-yellow-400" colorText="text-yellow-600" colorRing="ring-yellow-400"
                isActive={filterCppSem === "amarillo"}
                onClick={() => { setFilterCppSem("amarillo"); setCppPage(1); }}
              />
              <KPICard
                label="Vencido +15 días"
                value={cppResumen ? fmtS(cppResumen.vencido_mas_15) : "…"}
                sub="Crítico"
                colorBorder="border-red-500" colorText="text-red-700" colorRing="ring-red-500"
                isActive={filterCppSem === "rojo"}
                onClick={() => { setFilterCppSem("rojo"); setCppPage(1); }}
              />
            </div>
          )}
          {/* ── Tabs + Exportar ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
              {[
                { key: "cuentas_por_pagar", label: "Cuentas por Pagar" },
                { key: "recurrentes",       label: "Gastos Recurrentes" },
                { key: "reporte",           label: "Reporte" },
              ].map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {activeTab === "cuentas_por_pagar" ? (
              <div className="flex items-center gap-2">
                {cppSeleccionados.length > 0 && (
                  <button onClick={() => setConfirmDelMasivoCpp(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 shadow-sm transition-colors">
                    🗑️ Eliminar seleccionadas ({cppSeleccionados.length})
                  </button>
                )}
                <button onClick={() => { setCppExportModal(true); setCppExportError(""); }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors">
                  <HiDownload className="w-4 h-4" /> Exportar CPP
                </button>
              </div>
            ) : (
              <button onClick={() => { setExportModal(true); setExportError(""); }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors">
                <HiDownload className="w-4 h-4" /> Exportar
              </button>
            )}
          </div>

          {/* ══ Tab: Cuentas por Pagar (todos los gastos + seguimiento de pago) ═ */}
          {activeTab === "cuentas_por_pagar" && (
            <>
              {/* Filtros */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[180px]">
                  <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Buscar por descripción, proveedor, N° doc…" value={searchCpp}
                    onChange={e => { setSearchCpp(e.target.value); setCppPage(1); }}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <select value={filterCategoria} onChange={e => { setFilterCategoria(e.target.value); setCppPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todas las categorías</option>
                  {todasCategoriasDinamicas.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterArea} onChange={e => { setFilterArea(e.target.value); setCppPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todas las áreas</option>
                  {todasAreasDinamicas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Desde</label>
                  <input type="date" value={filterDesde} onChange={e => { setFilterDesde(e.target.value); setCppPage(1); }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <label className="text-xs font-semibold text-gray-600 uppercase">Hasta</label>
                  <input type="date" value={filterHasta} onChange={e => { setFilterHasta(e.target.value); setCppPage(1); }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <select value={filterCppSem} onChange={e => { setFilterCppSem(e.target.value); setCppPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {SEM_OPTIONS_CPP.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={filterCppEstado} onChange={e => { setFilterCppEstado(e.target.value); setCppPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Estado: Todos</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Pago Parcial">Pagado Parcialmente</option>
                  <option value="Pagado">Pagado</option>
                </select>
                {(searchCpp || filterCategoria || filterArea || filterCppSem || filterCppEstado) && (
                  <button onClick={limpiarFiltros} className="text-sm text-gray-500 hover:text-gray-700">Limpiar</button>
                )}
                <div className="relative ml-auto" ref={cppColumnasMenuRef}>
                  <button onClick={() => setCppColumnasMenuAbierto(o => !o)}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap">
                    ⚙ Columnas
                  </button>
                  {cppColumnasMenuAbierto && (
                    <div className="absolute right-0 mt-1.5 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-2">
                      <div className="max-h-72 overflow-y-auto px-1">
                        {CPP_COLUMNAS.map(c => (
                          <label key={c.id}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
                            <input type="checkbox" checked={cppColumnas[c.id]} onChange={() => toggleCppColumna(c.id)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            {c.label}
                          </label>
                        ))}
                        <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 select-none">
                          <input type="checkbox" checked disabled className="w-4 h-4 rounded border-gray-300" />
                          Acciones
                        </div>
                      </div>
                      <div className="border-t border-gray-100 mt-1 pt-1 px-3">
                        <button onClick={restablecerCppColumnas}
                          className="w-full text-left text-sm text-blue-600 hover:text-blue-700 py-1">
                          Restablecer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Tabla */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-3 text-center w-10">
                          <input type="checkbox" checked={cppTodosSeleccionados} onChange={toggleCppTodos}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        </th>
                        {cppColumnas.semaforo && <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-10"></th>}
                        {cppColumnas.fecha && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>}
                        {cppColumnas.categoria && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Categoría</th>}
                        {cppColumnas.descripcion && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Descripción</th>}
                        {cppColumnas.comprobante && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tipo / N° Comprobante</th>}
                        {cppColumnas.ruc && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">RUC/DOC</th>}
                        {cppColumnas.proveedor && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Proveedor</th>}
                        {cppColumnas.monto && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Monto</th>}
                        {cppColumnas.area && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Área</th>}
                        {cppColumnas.saldo && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Saldo</th>}
                        {cppColumnas.vencimiento && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">F. Vencimiento</th>}
                        {cppColumnas.estado && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>}
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingCpp ? (
                        <tr><td colSpan={cppColSpan} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : cppGastos.length === 0 ? (
                        <tr><td colSpan={cppColSpan} className="text-center py-12 text-gray-400 text-sm">No hay gastos para los filtros seleccionados</td></tr>
                      ) : cppGastos.map(g => (
                        <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={cppSeleccionados.includes(g.id)} onChange={() => toggleCppSeleccionado(g.id)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          </td>
                          {cppColumnas.semaforo && (
                          <td className="px-3 py-3 text-center">
                            <SemaforoGasto valor={g.semaforo} />
                          </td>
                          )}
                          {cppColumnas.fecha && (
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            <p>{fmtFecha(g.fecha)}</p>
                            {g.dias_vencido > 0 && (
                              <p className="text-xs text-red-500 font-medium">{g.dias_vencido}d mora</p>
                            )}
                          </td>
                          )}
                          {cppColumnas.categoria && (
                          <td className="px-4 py-3">
                            <CategoriaBadge categoria={g.categoria} />
                            {g.categoria === CATEGORIA_PAGOS_TRIBUTARIOS && (
                              <button onClick={() => navigate("/pagos", { state: { tab: "tributarios" } })}
                                className="block text-xs text-blue-600 hover:text-blue-800 hover:underline mt-0.5 whitespace-nowrap">
                                Ver en Pagos Tributarios →
                              </button>
                            )}
                          </td>
                          )}
                          {cppColumnas.descripcion && (
                          <td className="px-4 py-3 max-w-[200px]">
                            <p className="text-gray-800 truncate" title={g.descripcion}>{g.descripcion || "—"}</p>
                            {g.es_recurrente && (
                              <span className="text-xs text-purple-600 font-medium flex items-center gap-0.5">
                                <HiRefresh className="w-3 h-3" /> Recurrente
                              </span>
                            )}
                          </td>
                          )}
                          {cppColumnas.comprobante && (
                          <td className="px-4 py-3 max-w-[150px]">
                            {g.tipo_comprobante ? (
                              <div>
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${
                                  g.tipo_comprobante === "Recibo Interno" ? "bg-purple-100 text-purple-700"
                                  : g.tipo_comprobante === "Factura" ? "bg-blue-100 text-blue-700"
                                  : g.tipo_comprobante === "Anticipo de Proveedor" ? "bg-orange-100 text-orange-700"
                                  : "bg-teal-100 text-teal-700"
                                }`}>
                                  {g.tipo_comprobante === "Recibo de Servicios Públicos" ? "Rec. SSPP" : g.tipo_comprobante === "Anticipo de Proveedor" ? "Anticipo Proveedor" : g.tipo_comprobante}
                                </span>
                                {g.numero_comprobante && <p className="text-xs font-mono text-gray-600 mt-0.5">{g.numero_comprobante}</p>}
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          )}
                          {cppColumnas.ruc && (
                          <td className="px-4 py-3 whitespace-nowrap">
                            {g.tipo_documento && g.numero_documento ? (
                              <div>
                                <span className="text-xs font-semibold text-gray-500">{g.tipo_documento === "Carnet de Extranjería" ? "CE" : g.tipo_documento}:</span>
                                <p className="text-xs font-mono text-gray-700">{g.numero_documento}</p>
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          )}
                          {cppColumnas.proveedor && (
                          <td className="px-4 py-3 max-w-[150px]">
                            <p className="text-sm text-gray-700 truncate" title={g.proveedor}>{g.proveedor || <span className="text-gray-300">—</span>}</p>
                          </td>
                          )}
                          {cppColumnas.monto && (
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <p className="font-semibold text-gray-800">{fmtS(g.monto_soles ?? g.monto)}</p>
                            {g.moneda === "USD" && g.monto_original != null && (
                              <p className="text-xs text-orange-500 font-medium">US$ {g.monto_original.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            )}
                          </td>
                          )}
                          {cppColumnas.area && (
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">{g.area || "—"}</span>
                          </td>
                          )}
                          {cppColumnas.saldo && (
                          <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                            <span className={g.estado_pago === "Pagado" ? "text-green-600" : g.saldo_pendiente < g.monto ? "text-yellow-600" : "text-gray-800"}>
                              {fmtS(g.saldo_pendiente)}
                            </span>
                          </td>
                          )}
                          {cppColumnas.vencimiento && (
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                            {g.fecha_vencimiento ? fmtFecha(g.fecha_vencimiento) : <span className="text-gray-300">—</span>}
                          </td>
                          )}
                          {cppColumnas.estado && <td className="px-4 py-3"><EstadoPagoBadge estado={g.estado_pago} /></td>}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setVerModal(g)} title="Ver detalle"
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <HiEye className="w-4 h-4" />
                              </button>
                              <button onClick={() => abrirEditar(g)} title="Editar"
                                className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                                <HiPencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => abrirDetalle(g)} title="Ver historial de pagos"
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <HiClipboardList className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirmarEliminarGasto(g.id)} disabled={deletingId === g.id} title="Eliminar"
                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                <HiTrash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {cppTotalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm text-gray-500">{(cppPage-1)*PER_PAGE+1}–{Math.min(cppPage*PER_PAGE,cppTotal)} de {cppTotal}</span>
                    <div className="flex gap-2">
                      <button disabled={cppPage===1} onClick={() => setCppPage(p=>p-1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Anterior</button>
                      <button disabled={cppPage===cppTotalPages} onClick={() => setCppPage(p=>p+1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══ Tab: Reporte ══════════════════════════════════════════════════ */}
          {activeTab === "reporte" && (
            <div className="space-y-4">

              {/* Fila 1: Dona de categorías + Evolución mensual */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* Donut por categoría */}
                <div style={{ height: 290 }}>
                  <GastosDonutChart data={porCategoria} />
                </div>

                {/* Bar chart mensual compacto */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col" style={{ height: 290 }}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Evolución Mensual — Últimos 6 Meses</h3>
                  {evolucion.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Sin datos</div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <Bar
                        data={{
                          labels: evolucion.map(e => e.mes),
                          datasets: [{
                            label: "Gastos (S/)",
                            data: evolucion.map(e => e.total),
                            backgroundColor: "rgba(99,102,241,0.75)",
                            borderColor: "rgba(99,102,241,1)",
                            borderWidth: 1,
                            borderRadius: 4,
                          }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              callbacks: {
                                label: ctx => ` S/ ${ctx.parsed.y.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`,
                              },
                            },
                          },
                          scales: {
                            y: {
                              ticks: {
                                callback: v => `S/ ${(v / 1000).toFixed(0)}k`,
                                font: { size: 10 },
                                maxTicksLimit: 5,
                              },
                              grid: { color: "rgba(0,0,0,0.04)" },
                            },
                            x: {
                              ticks: { font: { size: 11 } },
                              grid: { display: false },
                            },
                          },
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Fila 2: Tabla por área — ancho completo */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700">Gasto por Área — Año Actual</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Categoría: tipo de gasto &nbsp;·&nbsp; Área: departamento que generó el gasto
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Área</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total (S/)</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">%</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Distribución</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {porArea.length === 0 ? (
                        <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-sm">Sin datos</td></tr>
                      ) : porArea.map(r => (
                        <tr key={r.area} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-800">{r.area}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtS(r.monto)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{r.porcentaje}%</td>
                          <td className="px-4 py-2.5">
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden w-40">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${r.porcentaje}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* ══ Tab: Recurrentes ══════════════════════════════════════════════ */}
          {activeTab === "recurrentes" && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Gastos Recurrentes Configurados</h3>
                  <p className="text-xs text-gray-400 mt-0.5">El sistema genera automáticamente estos gastos cada mes</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Descripción</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Categoría</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Monto</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Área</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Estado</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recurrentes.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-400 text-sm">No hay gastos recurrentes configurados</td></tr>
                    ) : recurrentes.map(g => (
                      <tr key={g.id} className={`hover:bg-gray-50 transition-colors ${!g.recurrente_activo ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800 truncate max-w-[220px]">{g.descripcion}</p>
                          <p className="text-xs text-gray-400">Desde {fmtFecha(g.fecha)}</p>
                        </td>
                        <td className="px-4 py-3"><CategoriaBadge categoria={g.categoria} /></td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <p className="font-semibold text-gray-800">{fmtS(g.monto_soles ?? g.monto)}</p>
                          {g.moneda === "USD" && g.monto_original != null && (
                            <p className="text-xs text-orange-500 font-medium">US$ {g.monto_original.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">{g.area || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {g.recurrente_activo ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                              <HiCheckCircle className="w-3.5 h-3.5" /> Activo
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Inactivo</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => handleToggle(g)} disabled={togglingId === g.id}
                              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                                g.recurrente_activo
                                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                                  : "bg-green-50 text-green-700 hover:bg-green-100"
                              }`}>
                              {togglingId === g.id ? "…" : g.recurrente_activo ? "Desactivar" : "Activar"}
                            </button>
                            <button onClick={() => abrirEditar(g)} title="Editar"
                              className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                              <HiPencil className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ══ Modal: Formulario Nuevo / Editar ══════════════════════════════════ */}
      {formModal !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">
                  {formModal === "nuevo" ? "Nuevo Gasto" : "Editar Gasto"}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {formModal === "nuevo" ? "Registra un nuevo gasto operativo" : `Editando gasto #${formModal.id}`}
                </p>
              </div>
              <button onClick={() => setFormModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {/* Fecha + Área */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Fecha <span className="text-red-500">*</span></label>
                  <input type="date" value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Área <span className="text-red-500">*</span></label>
                  <select value={form.area}
                    onChange={e => setForm(f => ({ ...f, area: e.target.value, categoria: "" }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Seleccionar…</option>
                    {todasAreasDinamicas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Categoría — dinámica según Área */}
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">
                  Categoría *
                  {form.area === "Activos" && (
                    <span className="ml-1.5 text-[10px] font-normal text-amber-600 normal-case">⚙ Activos fijos</span>
                  )}
                </label>
                <select value={form.categoria}
                  onChange={e => {
                    const categoria = e.target.value;
                    setForm(f => {
                      const next = { ...f, categoria, descripcion: "" };
                      // Autoseleccionar código de detracción solo para Facturas.
                      if (f.tipo_comprobante === "Factura" && CATEGORIA_A_CODIGO_DETRACCION[categoria]) {
                        next.codigo_detraccion = CATEGORIA_A_CODIGO_DETRACCION[categoria];
                      }
                      return next;
                    });
                  }}
                  disabled={!form.area}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400">
                  <option value="">{form.area ? "Seleccionar…" : "Selecciona un área primero"}</option>
                  {categoriasParaArea(form.area, categoriasRubro, nombresCategoriasActivas.length ? nombresCategoriasActivas : undefined).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {form.categoria === CATEGORIA_PAGOS_TRIBUTARIOS && (
                  <p className="mt-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠️ Este gasto no afecta la utilidad — es un pago tributario
                  </p>
                )}
                {form.categoria === CATEGORIA_PLANILLA && (
                  <p className="mt-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    ✅ Este gasto afecta la utilidad
                  </p>
                )}
              </div>

              {/* Descripción — subcategoría fija para Planilla / Pagos Tributarios */}
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">
                  {SUBCATEGORIAS[form.categoria] ? "Subcategoría" : "Descripción"} <span className="text-red-500">*</span>
                </label>
                {SUBCATEGORIAS[form.categoria] ? (
                  <select value={form.descripcion}
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Seleccionar…</option>
                    {SUBCATEGORIAS[form.categoria].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input type="text" value={form.descripcion} placeholder="Ej: Alquiler oficina Miraflores - Junio 2026"
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>

              {/* Tipo Comprobante + N° Comprobante */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Comprobante</label>
                  <select value={form.tipo_comprobante}
                    onChange={e => {
                      const tipo = e.target.value;
                      setForm(f => {
                        const next = { ...f, tipo_comprobante: tipo, numero_comprobante: "" };
                        // Autoseleccionar código de detracción al pasar a Factura,
                        // si la categoría ya elegida tiene un código mapeado.
                        if (tipo === "Factura" && CATEGORIA_A_CODIGO_DETRACCION[f.categoria]) {
                          next.codigo_detraccion = CATEGORIA_A_CODIGO_DETRACCION[f.categoria];
                        }
                        return next;
                      });
                    }}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Sin comprobante</option>
                    {TIPOS_COMPROBANTE.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">
                    N° de Comprobante
                    {(form.tipo_comprobante === "Recibo Interno" || form.tipo_comprobante === "Gastos Bancarios" || form.tipo_comprobante === "Anticipo de Proveedor") && (
                      <span className="ml-1 text-purple-600 font-normal normal-case">(auto)</span>
                    )}
                  </label>
                  {(form.tipo_comprobante === "Recibo Interno" || form.tipo_comprobante === "Gastos Bancarios" || form.tipo_comprobante === "Anticipo de Proveedor") ? (
                    <input type="text"
                      value={loadingCorrelativo ? "Generando…" : form.numero_comprobante}
                      readOnly
                      className="w-full mt-1.5 px-3 py-2.5 border border-purple-300 rounded-xl text-sm bg-purple-50 font-mono font-semibold text-purple-700 cursor-not-allowed" />
                  ) : (
                    <input type="text" value={form.numero_comprobante}
                      disabled={!form.tipo_comprobante}
                      placeholder={
                        form.tipo_comprobante === "Factura" ? "Ej: F-2026-001" :
                        form.tipo_comprobante === "Recibo de Servicios Públicos" ? "Ej: RSP-001" : ""
                      }
                      onChange={e => setForm(f => ({ ...f, numero_comprobante: e.target.value }))}
                      className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400" />
                  )}
                </div>
              </div>

              {/* Tipo Documento + N° Documento con consulta SUNAT */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Documento</label>
                  <select value={form.tipo_documento}
                    onChange={e => { setForm(f => ({ ...f, tipo_documento: e.target.value })); setRucProvMsg(""); }}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Seleccionar…</option>
                    {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">N° de RUC o Documento</label>
                  <div className="relative mt-1.5">
                    <input type="text" value={form.numero_documento}
                      placeholder="Ej: 20123456789"
                      maxLength={form.tipo_documento === "RUC" ? 11 : 20}
                      onChange={e => handleNumDocChange(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8" />
                    {buscandoRucProv && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 animate-pulse">⟳</span>
                    )}
                  </div>
                  {rucProvMsg && (
                    <p className={`text-xs mt-1 font-medium ${
                      rucProvMsg.startsWith("Proveedor encontrado") ? "text-blue-600" :
                      rucProvMsg.startsWith("Buscando")            ? "text-gray-400" :
                                                                      "text-amber-600"
                    }`}>{rucProvMsg}</p>
                  )}
                </div>
              </div>

              {/* Proveedor */}
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Proveedor</label>
                <input type="text" value={form.proveedor} placeholder="Nombre del proveedor"
                  onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Moneda + Tipo de Cambio */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Moneda</label>
                  <select value={form.moneda}
                    onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="PEN">🇵🇪 Soles (S/)</option>
                    <option value="USD">🇺🇸 Dólares (US$)</option>
                  </select>
                </div>
                {form.moneda === "USD" && (
                  <div>
                    <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Cambio</label>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">S/</span>
                      <input type="number" step="0.0001" min="0.01" value={form.tipo_cambio} placeholder="3.75"
                        onChange={e => setForm(f => ({ ...f, tipo_cambio: e.target.value }))}
                        className="w-full pl-7 pr-3 py-2.5 border border-orange-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-orange-50" />
                    </div>
                    <p className="text-xs text-orange-500 mt-1">Tipo de cambio del día</p>
                  </div>
                )}
              </div>

              {/* Base Imponible, IGV y Precio de Venta / Monto */}
              {(() => {
                const aplicaIgv = form.tipo_comprobante === "Factura" || form.tipo_comprobante === "Recibo de Servicios Públicos";
                const montoSoles = form.moneda === "USD"
                  ? parseFloat(form.monto) * parseFloat(form.tipo_cambio || 0)
                  : parseFloat(form.monto);
                const base = isNaN(montoSoles) || montoSoles <= 0 ? null : Math.round(montoSoles / 1.18 * 100) / 100;
                const igv  = base != null ? Math.round((montoSoles - base) * 100) / 100 : null;
                const fmt  = n => n != null ? `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                return (
                  <>
                    {/* Base Imponible e IGV — solo lectura, calculados a partir del Precio de Venta */}
                    {aplicaIgv && (
                      <div className="grid grid-cols-2 gap-4 bg-blue-50 rounded-xl p-3 border border-blue-200">
                        <div>
                          <label className="text-xs font-semibold text-blue-700 uppercase">Base Imponible (S/)</label>
                          <div className="mt-1.5 px-3 py-2.5 bg-white border border-blue-200 rounded-xl text-sm font-semibold text-blue-800 cursor-not-allowed">
                            {fmt(base)}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-blue-700 uppercase">IGV 18% (S/)</label>
                          <div className="mt-1.5 px-3 py-2.5 bg-white border border-blue-200 rounded-xl text-sm font-semibold text-blue-800 cursor-not-allowed">
                            {fmt(igv)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Precio de Venta (Factura / Recibo de Servicios Públicos) o Monto (resto) — campo editable principal */}
                    <div>
                      <label className="text-xs font-semibold text-gray-700 uppercase">
                        {form.moneda === "USD" ? "Monto (US$)" : aplicaIgv ? "Precio de Venta (S/)" : "Monto (S/)"} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative mt-1.5">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                          {form.moneda === "USD" ? "US$" : "S/"}
                        </span>
                        <input type="number" step="0.01" min="0.01" value={form.monto} placeholder="0.00"
                          onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                          className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      {form.moneda === "USD" && parseFloat(form.monto) > 0 && parseFloat(form.tipo_cambio) > 0 && (
                        <p className="text-xs text-orange-600 mt-1 font-medium">
                          ≈ S/ {(parseFloat(form.monto) * parseFloat(form.tipo_cambio)).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} soles
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* Retención (8%) y Total Neto (solo Recibo por Honorarios) — la
                  retención es opcional: no siempre aplica (ej. suspensión de
                  retenciones del emisor), así que el usuario decide con el
                  checkbox en vez de calcularse siempre automáticamente. Sin
                  umbral de monto: la decisión es enteramente del checkbox. */}
              {form.tipo_comprobante === "Recibo por Honorarios" && (() => {
                const montoSolesRh = form.moneda === "USD"
                  ? parseFloat(form.monto) * parseFloat(form.tipo_cambio || 0)
                  : parseFloat(form.monto);
                const montoValido = !isNaN(montoSolesRh) && montoSolesRh > 0;
                const retencionRh = !montoValido
                  ? null
                  : (form.aplicar_retencion_ir ? Math.round(montoSolesRh * 0.08 * 100) / 100 : 0);
                const totalNetoRh = montoValido ? Math.round((montoSolesRh - retencionRh) * 100) / 100 : null;
                const fmtRh = n => n != null ? `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                return (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={form.aplicar_retencion_ir}
                        onChange={e => setForm(f => ({ ...f, aplicar_retencion_ir: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm font-medium text-gray-700">Aplicar Retención IR (8%)</span>
                    </label>

                    <div className="grid grid-cols-2 gap-4 bg-amber-50 rounded-xl p-3 border border-amber-200">
                      <div>
                        <label className="text-xs font-semibold text-amber-700 uppercase">Retención IR (8%)</label>
                        <div className="mt-1.5 px-3 py-2.5 bg-white border border-amber-200 rounded-xl text-sm font-semibold text-amber-800 cursor-not-allowed">
                          {fmtRh(retencionRh)}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-amber-700 uppercase">Total Neto Recibido (S/)</label>
                        <div className="mt-1.5 px-3 py-2.5 bg-white border border-amber-200 rounded-xl text-sm font-semibold text-amber-800 cursor-not-allowed">
                          {fmtRh(totalNetoRh)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Fecha Vencimiento */}
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Vencimiento (Pago)</label>
                <input type="date" value={form.fecha_vencimiento}
                  onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-400 mt-1">Opcional — visible en "Cuentas por Pagar"</p>
              </div>

              {/* Recurrente */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={form.es_recurrente}
                  onChange={e => setForm(f => ({ ...f, es_recurrente: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Marcar como recurrente</p>
                  <p className="text-xs text-gray-400">El sistema registrará automáticamente este gasto cada mes</p>
                </div>
              </label>

              {/* Detracción (solo Tipo Comprobante = Factura) */}
              {form.tipo_comprobante === "Factura" && (
                <div className="border-t border-gray-100 pt-4 space-y-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Detracción</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.tiene_detraccion}
                      onChange={e => {
                        const checked = e.target.checked;
                        setForm(f => ({
                          ...f, tiene_detraccion: checked,
                          fecha_limite_detraccion: checked && !f.fecha_limite_detraccion ? sugerirFechaLimiteDetraccion(f.fecha) : f.fecha_limite_detraccion,
                        }));
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-gray-700">Aplica detracción (debo depositar)</span>
                  </label>

                  <div>
                    <label className="text-xs font-semibold text-gray-700 uppercase">Código de Detracción (bien/servicio)</label>
                    <input type="text" maxLength={3} value={form.codigo_detraccion}
                      placeholder="Ej: 019"
                      onChange={e => setForm(f => ({ ...f, codigo_detraccion: e.target.value }))}
                      className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">Autoseleccionado según la categoría; editable si necesita cambiarlo</p>
                  </div>

                  {form.tiene_detraccion && (() => {
                    const montoSolesDet = form.moneda === "USD"
                      ? parseFloat(form.monto) * parseFloat(form.tipo_cambio || 0)
                      : parseFloat(form.monto);
                    const tasaNum   = parseFloat(form.tasa_detraccion);
                    const montoDet  = !isNaN(montoSolesDet) && !isNaN(tasaNum) ? Math.round(montoSolesDet * (tasaNum / 100) * 100) / 100 : null;
                    const montoNeto = !isNaN(montoSolesDet) && montoDet != null ? Math.round((montoSolesDet - montoDet) * 100) / 100 : null;
                    const fmtDet    = n => n != null ? `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                    return (
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Servicio (Tasa)</label>
                          <select value={form.concepto_detraccion}
                            onChange={e => {
                              const concepto = e.target.value;
                              const opt = TASAS_DETRACCION.find(t => t.concepto === concepto);
                              setForm(f => ({ ...f, concepto_detraccion: concepto, tasa_detraccion: opt && opt.tasa != null ? String(opt.tasa) : f.tasa_detraccion }));
                            }}
                            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {TASAS_DETRACCION.map(t => (
                              <option key={t.concepto} value={t.concepto}>{t.concepto}{t.tasa != null ? ` (${t.tasa}%)` : ""}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-700 uppercase">Tasa (%){form.concepto_detraccion === "Otro" && <span className="text-red-500"> *</span>}</label>
                          <input type="number" step="0.01" min="0" max="100" value={form.tasa_detraccion}
                            onChange={e => setForm(f => ({ ...f, tasa_detraccion: e.target.value }))}
                            disabled={form.concepto_detraccion !== "Otro"}
                            className={`w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${form.concepto_detraccion !== "Otro" ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}`} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-semibold text-gray-700 uppercase">Monto Detracción (S/) — calculado</label>
                            <div className="mt-1.5 px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-500">{fmtDet(montoDet)}</div>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-700 uppercase">Monto Neto a Pagar (S/) — calculado</label>
                            <div className="mt-1.5 px-3 py-2.5 border border-green-200 rounded-xl text-sm bg-green-50 text-green-700 font-semibold">{fmtDet(montoNeto)}</div>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-700 uppercase">RUC Cuenta Detracciones del Proveedor</label>
                          <input type="text" value={form.ruc_cuenta_detraccion} placeholder="Ej: 20100897608"
                            onChange={e => setForm(f => ({ ...f, ruc_cuenta_detraccion: e.target.value }))}
                            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-700 uppercase">Fecha Límite de Depósito</label>
                          <input type="date" value={form.fecha_limite_detraccion}
                            onChange={e => setForm(f => ({ ...f, fecha_limite_detraccion: e.target.value }))}
                            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <p className="text-xs text-gray-400 mt-1">Sugerido: día 5 del mes siguiente a la emisión</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {formModal === "nuevo" && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">
                    📎 Adjuntar Comprobante <span className="text-gray-400 normal-case font-normal">(opcional)</span>
                  </label>
                  {comprobanteFile ? (
                    <div className="mt-1.5 flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-4 py-3 bg-gray-50">
                      <div className="flex items-center gap-2 min-w-0">
                        <HiCheckCircle className="text-green-500 text-lg flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{comprobanteFile.name}</span>
                      </div>
                      <button type="button" onClick={() => setComprobanteFile(null)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                        <HiX className="text-base" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOverComprobante(true); }}
                      onDragLeave={() => setDragOverComprobante(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverComprobante(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) setComprobanteFile(f);
                      }}
                      onClick={() => comprobanteFileRef.current?.click()}
                      className={`mt-1.5 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 px-4 cursor-pointer transition-colors ${
                        dragOverComprobante ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                      }`}
                    >
                      <HiUpload className="text-3xl text-gray-300" />
                      <p className="text-sm text-gray-600">Arrastra tu PDF aquí o</p>
                      <button type="button" onClick={(e) => { e.stopPropagation(); comprobanteFileRef.current?.click(); }}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
                        Seleccionar archivo
                      </button>
                      <p className="text-xs text-gray-400">Formatos: PDF, JPG, PNG (máx. 10MB)</p>
                      <input
                        ref={comprobanteFileRef}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && setComprobanteFile(e.target.files[0])}
                      />
                    </div>
                  )}
                </div>
              )}

              {formError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {formError}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setFormModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleGuardar} disabled={saving}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? "Guardando…" : formModal === "nuevo" ? "Registrar Gasto" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Ver Gasto ══════════════════════════════════════════════════ */}
      {verModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Detalle del Gasto</h2>
                <p className="text-sm text-gray-500 mt-0.5">#{verModal.id} — {fmtFecha(verModal.fecha)}</p>
              </div>
              <button onClick={() => setVerModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  ["Fecha",      fmtFecha(verModal.fecha)],
                  ["Monto (S/)", fmtS(verModal.monto_soles ?? verModal.monto)],
                  ["Área",       verModal.area || "—"],
                  ["Recurrente", verModal.es_recurrente ? "Sí" : "No"],
                ].map(([lbl, val]) => (
                  <div key={lbl}>
                    <p className="text-xs text-gray-500 uppercase font-medium">{lbl}</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{val}</p>
                  </div>
                ))}
              </div>
              {verModal.moneda === "USD" && verModal.monto_original != null && (
                <div className="grid grid-cols-3 gap-3 bg-orange-50 rounded-xl p-3 border border-orange-200">
                  <div>
                    <p className="text-xs text-orange-600 uppercase font-semibold">Moneda</p>
                    <p className="text-sm font-bold text-orange-800 mt-0.5">US$ Dólares</p>
                  </div>
                  <div>
                    <p className="text-xs text-orange-600 uppercase font-semibold">Monto Original</p>
                    <p className="text-sm font-bold text-orange-800 mt-0.5">US$ {verModal.monto_original.toLocaleString("es-PE", { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div>
                    <p className="text-xs text-orange-600 uppercase font-semibold">T/C</p>
                    <p className="text-sm font-bold text-orange-800 mt-0.5">S/ {verModal.tipo_cambio}</p>
                  </div>
                </div>
              )}
              {(verModal.base_imponible != null || verModal.igv != null) && (
                <div className="grid grid-cols-2 gap-3 bg-blue-50 rounded-xl p-3 border border-blue-200">
                  <div>
                    <p className="text-xs text-blue-600 uppercase font-semibold">Base Imponible</p>
                    <p className="text-sm font-bold text-blue-800 mt-0.5">{fmtS(verModal.base_imponible)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 uppercase font-semibold">IGV 18%</p>
                    <p className="text-sm font-bold text-blue-800 mt-0.5">{fmtS(verModal.igv)}</p>
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium">Categoría</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <CategoriaBadge categoria={verModal.categoria} />
                  {verModal.categoria === CATEGORIA_PAGOS_TRIBUTARIOS && (
                    <button onClick={() => navigate("/pagos", { state: { tab: "tributarios" } })}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap">
                      Ver en Pagos Tributarios →
                    </button>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium">Descripción</p>
                <p className="text-sm text-gray-800 mt-0.5">{verModal.descripcion || "—"}</p>
              </div>
              <div className="border-t border-gray-100 pt-3 space-y-3">
                {verModal.tipo_comprobante && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase font-medium">Tipo Comprobante</p>
                      <p className="text-sm text-gray-800 mt-0.5">{verModal.tipo_comprobante}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase font-medium">N° Comprobante</p>
                      <p className="text-sm font-mono font-semibold text-gray-800 mt-0.5">{verModal.numero_comprobante || <span className="text-gray-400">—</span>}</p>
                    </div>
                  </div>
                )}
                {(verModal.tipo_documento || verModal.numero_documento) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase font-medium">Tipo Documento</p>
                      <p className="text-sm text-gray-800 mt-0.5">{verModal.tipo_documento || <span className="text-gray-400">—</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase font-medium">N° Documento</p>
                      <p className="text-sm font-mono font-semibold text-gray-800 mt-0.5">{verModal.numero_documento || <span className="text-gray-400">—</span>}</p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Proveedor</p>
                  <p className="text-sm text-gray-800 mt-0.5">{verModal.proveedor || <span className="text-gray-400">—</span>}</p>
                </div>
                {(verModal.tiene_comprobante || ["Recibo Interno", "Factura"].includes(verModal.tipo_comprobante)) && (
                  <button onClick={() => { setVerModal(null); handleImprimirGasto(verModal); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-xl text-sm font-medium hover:bg-purple-100 transition-colors">
                    <HiPrinter className="w-4 h-4" /> Imprimir
                  </button>
                )}

                {/* Información de Auditoría */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Información de Auditoría</p>
                  <div className="space-y-1 text-sm text-gray-600">
                    <p>👤 Creado por: <span className="font-medium text-gray-800">{verModal.creado_por || "—"}</span></p>
                    <p>📅 Fecha creación: <span className="font-medium text-gray-800">{verModal.creado_en || "—"}</span></p>
                    <p>📥 Método de creación: <span className="font-medium text-gray-800">{verModal.metodo_creacion || "Manual"}</span></p>
                    {verModal.modificado_por && (
                      <>
                        <p>👤 Modificado por: <span className="font-medium text-gray-800">{verModal.modificado_por}</span></p>
                        <p>📅 Última modificación: <span className="font-medium text-gray-800">{verModal.modificado_en}</span></p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setVerModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cerrar
              </button>
              <button onClick={() => { setVerModal(null); abrirEditar(verModal); }}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
                Editar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Registrar Pago ════════════════════════════════════════════ */}
      {pagoModal && (
        <ModalRegistrarPagoGasto
          gasto={pagoModal}
          onClose={() => setPagoModal(null)}
          onSuccess={async () => { cargarCpp(); cargarCppResumen(); }}
        />
      )}

      {/* ══ Modal: Detalle + Historial de Pagos ══════════════════════════════ */}
      {detalleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Historial de Pagos</h2>
                <p className="text-sm text-gray-500 mt-0.5 truncate max-w-[320px]">{detalleModal.proveedor || detalleModal.descripcion}</p>
              </div>
              <button onClick={() => setDetalleModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase font-medium">Monto Total</p>
                  <p className="text-sm font-bold text-gray-800 mt-1">{fmtS(detalleModal.monto)}</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs text-blue-600 uppercase font-medium">Saldo Pend.</p>
                  <p className="text-sm font-bold text-blue-700 mt-1">{fmtS(detalleModal.saldo_pendiente)}</p>
                </div>
                <div className="rounded-xl p-3 border">
                  <p className="text-xs text-gray-500 uppercase font-medium">Estado</p>
                  <div className="mt-1"><EstadoPagoBadge estado={detalleModal.estado_pago} /></div>
                </div>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pagos registrados</h3>
                {loadingHistorial ? (
                  <p className="text-sm text-gray-400 text-center py-4">Cargando…</p>
                ) : historialPagos.length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <HiCurrencyDollar className="w-8 h-8 mx-auto mb-1 opacity-30" />
                    <p className="text-sm">Sin pagos registrados</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historialPagos.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{fmtS(p.monto_pagado)}</p>
                          <p className="text-xs text-gray-500">{fmtFecha(p.fecha_pago)} · {p.metodo_pago}</p>
                          {p.banco && <p className="text-xs text-gray-400">{p.banco}{p.numero_cuenta ? ` — ${p.numero_cuenta}` : ""}{p.numero_cheque ? ` — Cheque ${p.numero_cheque}` : ""}</p>}
                          {p.redondeo_tipo && (
                            <p className={`text-xs font-medium mt-0.5 ${p.redondeo_tipo === "ganancia" ? "text-green-600" : "text-orange-600"}`}>
                              📊 Redondeo {p.redondeo_tipo === "ganancia" ? "ganancia" : "pérdida"}: {p.redondeo_tipo === "ganancia" ? "+" : "-"}{fmtS(p.redondeo_monto)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button onClick={() => abrirEditarPago(p)} title="Editar pago"
                            className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                            <HiPencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => setConfirmarEliminarPago(p.id)} disabled={deletingPagoId === p.id} title="Eliminar pago"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                            <HiTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {detalleModal.estado_pago !== "Pagado" && (
                <button onClick={() => { setDetalleModal(null); abrirPago(detalleModal); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors">
                  <HiCurrencyDollar className="w-4 h-4" /> Registrar Pago
                </button>
              )}
            </div>
            <div className="px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setDetalleModal(null)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Editar Pago ════════════════════════════════════════════════ */}
      {editPagoModal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Editar Pago</h2>
                <p className="text-sm text-gray-500 mt-0.5">Pago #{editPagoModal.id}</p>
              </div>
              <button onClick={() => setEditPagoModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Monto Pagado (S/) <span className="text-red-500">*</span></label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                  <input type="number" step="0.01" min="0.01" value={editPagoForm.monto_pagado} placeholder="0.00"
                    onChange={e => setEditPagoForm(f => ({ ...f, monto_pagado: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Pago <span className="text-red-500">*</span></label>
                <input type="date" value={editPagoForm.fecha_pago}
                  onChange={e => setEditPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Método de Pago</label>
                <select value={editPagoForm.metodo_pago}
                  onChange={e => setEditPagoForm(f => ({ ...f, metodo_pago: e.target.value, banco: "", numero_cuenta: "", numero_cheque: "" }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <CamposMetodoPagoGasto form={editPagoForm} setForm={setEditPagoForm} cuentasBancarias={cuentasBancarias} />
              {editPagoError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {editPagoError}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setEditPagoModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleEditarPago} disabled={savingEditPago}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingEditPago ? "Guardando…" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Eliminar seleccionadas (CPP) ═════════════════════════════════ */}
      {confirmDelMasivoCpp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deletingMasivoCpp && setConfirmDelMasivoCpp(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiExclamationCircle className="text-red-500 text-xl" />
              </div>
              <p className="font-semibold text-gray-800">Eliminar gastos seleccionados</p>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              ¿Eliminar {cppSeleccionados.length} gasto{cppSeleccionados.length !== 1 ? "s" : ""} seleccionado{cppSeleccionados.length !== 1 ? "s" : ""}?
              Esta acción es irreversible.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelMasivoCpp(false)} disabled={deletingMasivoCpp}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleEliminarMasivoCpp} disabled={deletingMasivoCpp}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deletingMasivoCpp ? "Eliminando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Exportar CPP ═══════════════════════════════════════════════ */}
      {cppExportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Exportar Cuentas por Pagar</h2>
                <p className="text-sm text-gray-500 mt-0.5">Reporte en Excel</p>
              </div>
              <button onClick={() => setCppExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Desde</label>
                  <input type="date" value={cppExportForm.desde}
                    onChange={e => setCppExportForm(f => ({ ...f, desde: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Hasta</label>
                  <input type="date" value={cppExportForm.hasta}
                    onChange={e => setCppExportForm(f => ({ ...f, hasta: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Proveedor</label>
                <input type="text" value={cppExportForm.proveedor} placeholder="Filtrar por proveedor"
                  onChange={e => setCppExportForm(f => ({ ...f, proveedor: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Estado</label>
                <select value={cppExportForm.estado}
                  onChange={e => setCppExportForm(f => ({ ...f, estado: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos los estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Pago Parcial">Pago Parcial</option>
                  <option value="Pagado">Pagado</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Categoría</label>
                  <select value={cppExportForm.categoria}
                    onChange={e => setCppExportForm(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Todas</option>
                    {todasCategoriasDinamicas.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Área</label>
                  <select value={cppExportForm.area}
                    onChange={e => setCppExportForm(f => ({ ...f, area: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Todas</option>
                    {todasAreasDinamicas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              {cppExportError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {cppExportError}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setCppExportModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleExportarCpp} disabled={exportandoCpp}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                <HiDownload className="w-4 h-4" />
                {exportandoCpp ? "Generando…" : "Exportar a Excel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Exportar ═══════════════════════════════════════════════════ */}
      {exportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Exportar Gastos</h2>
                <p className="text-sm text-gray-500 mt-0.5">Reporte en Excel</p>
              </div>
              <button onClick={() => setExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Desde</label>
                  <input type="date" value={exportForm.desde}
                    onChange={e => setExportForm(f => ({ ...f, desde: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Hasta</label>
                  <input type="date" value={exportForm.hasta}
                    onChange={e => setExportForm(f => ({ ...f, hasta: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Categoría</label>
                <select value={exportForm.categoria}
                  onChange={e => setExportForm(f => ({ ...f, categoria: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todas las categorías</option>
                  {todasCategoriasDinamicas.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Área</label>
                <select value={exportForm.area}
                  onChange={e => setExportForm(f => ({ ...f, area: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todas las áreas</option>
                  {todasAreasDinamicas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Comprobante</label>
                <p className="text-xs text-gray-400 mt-0.5 mb-2">Sin selección = exporta todos</p>
                <div className="space-y-2">
                  {TIPOS_COMPROBANTE.map(tipo => {
                    const checked = exportForm.tipos_comprobante.includes(tipo);
                    return (
                      <label key={tipo} className="flex items-center gap-3 cursor-pointer select-none group">
                        <input type="checkbox" checked={checked}
                          onChange={() => setExportForm(f => ({
                            ...f,
                            tipos_comprobante: checked
                              ? f.tipos_comprobante.filter(t => t !== tipo)
                              : [...f.tipos_comprobante, tipo],
                          }))}
                          className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700 group-hover:text-gray-900">{tipo}</span>
                      </label>
                    );
                  })}
                </div>
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

      {/* ══ Importar factura PDF de proveedor ═════════════════════════════════ */}
      {elegirImportacion && (
        <ModalElegirImportacion
          onClose={() => setElegirImportacion(false)}
          onElegirIndividual={() => { setElegirImportacion(false); setImportarPdf(true); }}
          onElegirMasiva={() => { setElegirImportacion(false); setCargaMasiva(true); }}
        />
      )}

      {importarPdf && (
        <ModalImportarPdfGasto
          onClose={() => setImportarPdf(false)}
          onImported={() => { setImportarPdf(false); cargarCpp(); cargarCppResumen(); cargarResumen(); }}
        />
      )}

      {cargaMasiva && (
        <CargaMasivaGasto
          onClose={() => setCargaMasiva(false)}
          onImportado={() => { setCargaMasiva(false); cargarCpp(); cargarCppResumen(); cargarResumen(); }}
        />
      )}

      <ConfirmDialog
        open={!!confirmarEliminarGasto}
        title="Eliminar gasto"
        message="¿Eliminar este gasto? Esta acción no se puede deshacer."
        danger
        confirmLabel={deletingId === confirmarEliminarGasto ? "Eliminando…" : "Eliminar"}
        onConfirm={handleEliminar}
        onCancel={() => setConfirmarEliminarGasto(null)}
      />
      <ConfirmDialog
        open={!!confirmarEliminarPago}
        title="Eliminar pago"
        message="¿Eliminar este pago?"
        danger
        confirmLabel={deletingPagoId === confirmarEliminarPago ? "Eliminando…" : "Eliminar"}
        onConfirm={handleEliminarPago}
        onCancel={() => setConfirmarEliminarPago(null)}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
