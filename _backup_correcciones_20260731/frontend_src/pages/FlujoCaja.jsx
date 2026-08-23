import React, { useState, useEffect, useRef } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import PasoStepper      from "../components/conciliacion/PasoStepper";
import TablaMovimientos from "../components/conciliacion/TablaMovimientos";
import ResumenSticky    from "../components/conciliacion/ResumenSticky";
import {
  HiTrendingUp, HiCurrencyDollar, HiChartBar, HiDownload,
  HiX, HiChevronDown, HiChevronRight, HiCheckCircle,
  HiExclamationCircle, HiRefresh, HiUpload, HiEye, HiTrash,
  HiPlus, HiPencil,
} from "react-icons/hi";
import {
  getFlujoCajaKpis, getFlujoCajaProyectado, exportarFlujoCaja,
  getConciliacionCuentas, getHistorialConciliaciones,
  descargarPlantillaConciliacion,
  importarEstadoCuenta, importarEstadoCuentaPdf, confirmarConciliacion,
  getMovimientosConciliacion, toggleConciliado, desconciliarMovimiento,
  registrarEnSistema, guardarConciliacion, exportarConciliacion,
  exportarConciliados, registrarGastosBancariosBulk, registrarGastoBancarioIndividual,
  eliminarConciliacion,
  getCuentasBancarias, createCuentaBancaria, updateCuentaBancaria, deleteCuentaBancaria,
} from "../api/comercialApi";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

// ── Constantes ────────────────────────────────────────────────────────────────

const BANCOS   = ["BCP", "Interbank", "BBVA", "Scotiabank", "Otro"];
const FORMATOS = [
  { value: "excel", label: "Excel / CSV (recomendado)" },
  { value: "pdf",   label: "PDF con texto seleccionable" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtS(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const s   = `S/ ${abs.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : s;
}

function fmtK(n) {
  if (n == null) return "S/ 0";
  const abs = Math.abs(n);
  const s   = abs >= 1000 ? `S/ ${(abs / 1000).toFixed(1)}K` : `S/ ${abs.toFixed(0)}`;
  return n < 0 ? `-${s}` : s;
}

function fmtFecha(s) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const a   = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Componente KPI ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }) {
  const colors = {
    blue:   "bg-blue-50  border-blue-200  text-blue-700",
    green:  "bg-green-50 border-green-200 text-green-700",
    red:    "bg-red-50   border-red-200   text-red-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
  };
  const vals = {
    blue:   "text-blue-800",
    green:  "text-green-800",
    red:    "text-red-800",
    purple: "text-purple-800",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${colors[color].split(" ")[2]}`}>{label}</p>
      <p className={`text-2xl font-bold mt-1 ${vals[color]}`}>{value}</p>
      {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
    </div>
  );
}

// ── Badge estado conciliación ─────────────────────────────────────────────────

function EstadoBadge({ estado }) {
  const m = {
    "Conciliado":       "bg-green-100 text-green-800",
    "Con diferencias":  "bg-yellow-100 text-yellow-800",
    "En proceso":       "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m[estado] || "bg-gray-100 text-gray-700"}`}>
      {estado === "Conciliado" && "✅ "}
      {estado === "Con diferencias" && "⚠️ "}
      {estado === "En proceso" && "🔄 "}
      {estado}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export default function FlujoCaja() {
  const [activeTab, setActiveTab] = useState("proyectado");

  // ── Tab 1: Proyectado ──────────────────────────────────────────────────────
  const [periodo, setPeriodo]           = useState(6);
  const [kpis, setKpis]                 = useState(null);
  const [flujoData, setFlujoData]       = useState([]);
  const [loadingFlujo, setLoadingFlujo] = useState(false);
  const [expandedMes, setExpandedMes]   = useState(null);
  const [exportModal, setExportModal]   = useState(false);
  const [filterDesde, setFilterDesde]   = useState("");
  const [filterHasta, setFilterHasta]   = useState("");

  // ── Tab 2: Conciliación ────────────────────────────────────────────────────
  const [cuentas, setCuentas]                     = useState([]);
  const [cuentaId, setCuentaId]                   = useState("");
  const [historial, setHistorial]                 = useState([]);
  const [pasoActivo, setPasoActivo]               = useState(1); // 1 | 2 | 3
  const [importForm, setImportForm]               = useState({
    periodo_desde: "", periodo_hasta: "",
  });
  const [importArchivo, setImportArchivo]         = useState(null);
  const [formatoImport, setFormatoImport]         = useState("excel"); // "excel" | "pdf"
  const [pdfArchivo, setPdfArchivo]               = useState(null);
  const [pdfBanco, setPdfBanco]                   = useState("BCP");
  const [loadingImportPdf, setLoadingImportPdf]   = useState(false);
  const pdfInputRef                               = useRef(null);
  const [previewConc, setPreviewConc]             = useState(null);
  const [concActiva, setConcActiva]               = useState(null);
  const [movimientos, setMovimientos]             = useState([]);
  const [loadingImport, setLoadingImport]         = useState(false);
  const [loadingConfirm, setLoadingConfirm]       = useState(false);
  const [concError, setConcError]                 = useState(null);
  const [gbMsg, setGbMsg]                         = useState(null);
  const [guardarMsg, setGuardarMsg]               = useState(null);
  const [loadingGuardar, setLoadingGuardar]       = useState(false);
  const [loadingGB, setLoadingGB]                 = useState(false);
  const [deletingConc, setDeletingConc]           = useState(null); // objeto conciliación a eliminar
  const [loadingDelete, setLoadingDelete]         = useState(false);
  const fileInputRef                              = useRef(null);

  // ── Tab 3: Cuentas Bancarias ───────────────────────────────────────────────
  const [cuentasBanc, setCuentasBanc]                         = useState([]);
  const [loadingCuentasBanc, setLoadingCuentasBanc]           = useState(false);
  const [cuentaBancModal, setCuentaBancModal]                 = useState(null); // null | "nuevo" | cuenta
  const [cuentaBancForm, setCuentaBancForm]                   = useState({ banco: "", numero_cuenta: "", tipo_cuenta: "" });
  const [cuentaBancError, setCuentaBancError]                 = useState("");
  const [savingCuentaBanc, setSavingCuentaBanc]               = useState(false);
  const [deletingCuentaBanc, setDeletingCuentaBanc]           = useState(null);
  const [loadingDeleteCuentaBanc, setLoadingDeleteCuentaBanc] = useState(false);

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadKpis();
    loadFlujo();
  }, []);

  useEffect(() => { loadFlujo(); }, [periodo]);

  useEffect(() => {
    if (activeTab === "conciliacion") {
      loadCuentas();
      loadHistorial();
    }
    if (activeTab === "cuentas") {
      loadCuentasBanc();
    }
  }, [activeTab]);

  async function loadKpis() {
    try { setKpis(await getFlujoCajaKpis()); } catch {}
  }
  async function loadFlujo() {
    setLoadingFlujo(true);
    try { setFlujoData(await getFlujoCajaProyectado(periodo)); }
    catch {}
    finally { setLoadingFlujo(false); }
  }
  async function loadCuentas() {
    try { setCuentas(await getConciliacionCuentas()); } catch {}
  }
  async function loadHistorial() {
    try { setHistorial(await getHistorialConciliaciones()); } catch {}
  }
  async function loadMovimientos(id) {
    try {
      const movs = await getMovimientosConciliacion(id);
      setMovimientos(movs);
    } catch {}
  }

  // ── Cuentas Bancarias ──────────────────────────────────────────────────────
  async function loadCuentasBanc() {
    setLoadingCuentasBanc(true);
    try { setCuentasBanc(await getCuentasBancarias() || []); }
    catch { setCuentasBanc([]); }
    finally { setLoadingCuentasBanc(false); }
  }

  function abrirNuevaCuentaBanc() {
    setCuentaBancForm({ banco: "", numero_cuenta: "", tipo_cuenta: "" });
    setCuentaBancError("");
    setCuentaBancModal("nuevo");
  }

  function abrirEditarCuentaBanc(c) {
    setCuentaBancForm({ banco: c.banco, numero_cuenta: c.numero_cuenta, tipo_cuenta: c.tipo_cuenta || "" });
    setCuentaBancError("");
    setCuentaBancModal(c);
  }

  async function handleGuardarCuentaBanc() {
    if (!cuentaBancForm.banco.trim())         { setCuentaBancError("El banco es requerido."); return; }
    if (!cuentaBancForm.numero_cuenta.trim()) { setCuentaBancError("El número de cuenta es requerido."); return; }
    setSavingCuentaBanc(true);
    setCuentaBancError("");
    try {
      const payload = {
        banco:         cuentaBancForm.banco.trim(),
        numero_cuenta: cuentaBancForm.numero_cuenta.trim(),
        tipo_cuenta:   cuentaBancForm.tipo_cuenta || null,
      };
      if (cuentaBancModal === "nuevo") await createCuentaBancaria(payload);
      else                             await updateCuentaBancaria(cuentaBancModal.id, payload);
      setCuentaBancModal(null);
      await loadCuentasBanc();
      await loadCuentas(); // refresca el selector usado en Conciliación
    } catch (e) {
      setCuentaBancError(e?.response?.data?.detail || "Error al guardar la cuenta.");
    } finally {
      setSavingCuentaBanc(false);
    }
  }

  async function handleEliminarCuentaBanc() {
    if (!deletingCuentaBanc) return;
    setLoadingDeleteCuentaBanc(true);
    try {
      await deleteCuentaBancaria(deletingCuentaBanc.id);
      setDeletingCuentaBanc(null);
      await loadCuentasBanc();
      await loadCuentas();
    } catch {
    } finally {
      setLoadingDeleteCuentaBanc(false);
    }
  }

  // ── Exportar flujo ─────────────────────────────────────────────────────────
  async function handleExportarFlujo() {
    try {
      const blob = await exportarFlujoCaja();
      downloadBlob(blob, "flujo_caja.xlsx");
      setExportModal(false);
    } catch {}
  }

  // ── Importar estado de cuenta ──────────────────────────────────────────────
  async function handleImportar() {
    if (!importArchivo || !importForm.periodo_desde || !importForm.periodo_hasta) {
      setConcError("Completa el período y selecciona un archivo.");
      return;
    }
    setLoadingImport(true);
    setConcError(null);
    try {
      const fd = new FormData();
      fd.append("archivo", importArchivo);
      fd.append("periodo_desde", importForm.periodo_desde);
      fd.append("periodo_hasta", importForm.periodo_hasta);
      if (cuentaId) fd.append("cuenta_bancaria_id", cuentaId);
      const result = await importarEstadoCuenta(fd);
      setPreviewConc(result);
    } catch (e) {
      setConcError(e?.response?.data?.detail || "Error al procesar el archivo.");
    } finally {
      setLoadingImport(false);
    }
  }

  async function handleImportarPdf() {
    if (!pdfArchivo) {
      setConcError("Selecciona el PDF del estado de cuenta.");
      return;
    }
    setLoadingImportPdf(true);
    setConcError(null);
    try {
      const fd = new FormData();
      fd.append("archivo", pdfArchivo);
      fd.append("banco", pdfBanco);
      if (cuentaId) fd.append("cuenta_bancaria_id", cuentaId);
      const result = await importarEstadoCuentaPdf(fd);
      setPreviewConc(result);
    } catch (e) {
      setConcError(e?.response?.data?.detail || "Error al procesar el PDF.");
    } finally {
      setLoadingImportPdf(false);
    }
  }

  async function handleDescargarPlantilla() {
    try {
      const blob = await descargarPlantillaConciliacion();
      downloadBlob(blob, "Plantilla_Estado_Cuenta.xlsx");
    } catch {}
  }

  async function handleConfirmar() {
    if (!previewConc) return;
    setLoadingConfirm(true);
    setConcError(null);
    try {
      const result = await confirmarConciliacion(previewConc.id);
      setConcActiva(result);
      await loadMovimientos(result.id);
      await loadHistorial();
      setPasoActivo(3);
      setPreviewConc(null);
      setImportArchivo(null);
    } catch (e) {
      setConcError(e?.response?.data?.detail || "Error al confirmar.");
    } finally {
      setLoadingConfirm(false);
    }
  }

  async function handleToggleConciliado(movId) {
    if (!concActiva) return;
    try {
      const updated = await toggleConciliado(concActiva.id, movId);
      setMovimientos(prev => prev.map(m => m.id === movId ? updated : m));
    } catch {}
  }

  async function handleDesconciliar(movId) {
    if (!concActiva) return;
    if (!window.confirm("¿Desconciliar este movimiento?")) return;
    try {
      await desconciliarMovimiento(movId);
      await loadMovimientos(concActiva.id);
    } catch {}
  }

  async function handleRegistrarEnSistema(movId) {
    if (!concActiva) return;
    try {
      await registrarEnSistema(concActiva.id, movId);
      await loadMovimientos(concActiva.id);
    } catch {}
  }

  async function handleGuardar() {
    if (!concActiva) return;

    const pendientes = movimientos.filter(m => m.origen === "banco" && !m.conciliado).length;
    if (pendientes > 0) {
      const continuar = window.confirm(
        `Tienes ${pendientes} movimiento${pendientes !== 1 ? "s" : ""} pendiente${pendientes !== 1 ? "s" : ""}. ¿Deseas guardar de todas formas?`
      );
      if (!continuar) return;
    }

    setLoadingGuardar(true);
    setGuardarMsg(null);
    try {
      const saved = await guardarConciliacion(concActiva.id);
      setConcActiva(saved);
      await loadHistorial();
      setGuardarMsg({ tipo: "ok", texto: "Conciliación guardada correctamente ✅" });
    } catch (e) {
      setGuardarMsg({ tipo: "error", texto: e?.response?.data?.detail || "No se pudo guardar la conciliación." });
    } finally {
      setLoadingGuardar(false);
    }
  }

  async function handleAbrirHistorial(conc) {
    setConcActiva(conc);
    await loadMovimientos(conc.id);
    setPasoActivo(3);
  }

  async function handleExportarConc(id, e) {
    e.stopPropagation();
    try {
      const blob = await exportarConciliacion(id);
      downloadBlob(blob, `conciliacion_${id}.xlsx`);
    } catch {}
  }

  async function handleExportarConciliados() {
    if (!concActiva) return;
    try {
      const blob = await exportarConciliados(concActiva.id);
      downloadBlob(blob, `conciliados_${concActiva.id}.xlsx`);
    } catch {}
  }

  async function handleRegistrarTodosGB() {
    if (!concActiva) return;
    setLoadingGB(true);
    setGbMsg(null);
    try {
      const res = await registrarGastosBancariosBulk(concActiva.id);
      setGbMsg({ tipo: "ok", texto: res.mensaje });
      await loadMovimientos(concActiva.id);
      await loadHistorial();
    } catch (e) {
      setGbMsg({ tipo: "error", texto: e?.response?.data?.detail || "Error al registrar gastos bancarios." });
    } finally {
      setLoadingGB(false);
    }
  }

  async function handleRegistrarGBIndividual(movId) {
    if (!concActiva) return;
    try {
      const res = await registrarGastoBancarioIndividual(concActiva.id, movId);
      setGbMsg({ tipo: "ok", texto: res.mensaje });
      await loadMovimientos(concActiva.id);
    } catch (e) {
      setGbMsg({ tipo: "error", texto: e?.response?.data?.detail || "Error al registrar." });
    }
  }

  async function handleConfirmarEliminar() {
    if (!deletingConc) return;
    setLoadingDelete(true);
    try {
      await eliminarConciliacion(deletingConc.id);
      if (concActiva?.id === deletingConc.id) {
        setConcActiva(null);
        setMovimientos([]);
        setPasoActivo(1);
        setImportForm({ periodo_desde: "", periodo_hasta: "" });
      }
      await loadHistorial();
      setDeletingConc(null);
    } catch {
    } finally {
      setLoadingDelete(false);
    }
  }

  // ── Datos filtrados por rango de fecha ────────────────────────────────────
  const flujoFiltrado = flujoData.filter(row => {
    const mesDate = new Date(row.anio, row.mes_num - 1, 1);
    if (filterDesde) {
      const [dy, dm] = filterDesde.split("-").map(Number);
      if (mesDate < new Date(dy, dm - 1, 1)) return false;
    }
    if (filterHasta) {
      const [hy, hm] = filterHasta.split("-").map(Number);
      if (mesDate > new Date(hy, hm - 1, 1)) return false;
    }
    return true;
  });

  // ── Alertas flujo proyectado ───────────────────────────────────────────────
  const mesesDeficit = flujoFiltrado.filter(m => m.saldo_acumulado < 0);

  // ── Datos para el gráfico ──────────────────────────────────────────────────
  const chartData = {
    labels: flujoFiltrado.map(d => d.mes),
    datasets: [
      {
        type: "bar",
        label: "Ingresos",
        data: flujoFiltrado.map(d => d.ingresos),
        backgroundColor: "rgba(16,185,129,0.8)",
        borderRadius: 4,
        order: 2,
      },
      {
        type: "bar",
        label: "Egresos",
        data: flujoFiltrado.map(d => d.egresos),
        backgroundColor: "rgba(239,68,68,0.75)",
        borderRadius: 4,
        order: 3,
      },
      {
        type: "line",
        label: "Saldo Acumulado",
        data: flujoFiltrado.map(d => d.saldo_acumulado),
        borderColor: "rgba(99,102,241,1)",
        backgroundColor: "rgba(99,102,241,0.08)",
        borderWidth: 2,
        pointRadius: 3,
        fill: true,
        tension: 0.3,
        order: 1,
        yAxisID: "y",
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } },
      tooltip: { callbacks: { label: ctx => ` S/ ${ctx.parsed.y.toLocaleString("es-PE", { minimumFractionDigits: 2 })}` } },
    },
    scales: {
      y: {
        grid: { color: "rgba(0,0,0,0.04)" },
        ticks: { font: { size: 11 }, callback: v => `S/${(v / 1000).toFixed(0)}K` },
      },
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title="Flujo de Caja" />
        <main className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── Tabs ── */}
          <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
            {[
              { key: "proyectado",   label: "Flujo Proyectado" },
              { key: "conciliacion", label: "Conciliación Bancaria" },
              { key: "cuentas",      label: "Cuentas Bancarias" },
            ].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "bg-blue-600 text-white shadow"
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* TAB 1 — FLUJO PROYECTADO                                        */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {activeTab === "proyectado" && (
            <div className="space-y-5">

              {/* KPIs */}
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <KpiCard label="Saldo Actual"              color="blue"   value={fmtS(kpis?.saldo_actual)}         sub="Total cobrado − pagado" />
                <KpiCard label="Ingresos Proyectados 30d"  color="green"  value={fmtS(kpis?.ingresos_proyectados)}  sub="Facturas por cobrar" />
                <KpiCard label="Egresos Proyectados 30d"   color="red"    value={fmtS(kpis?.egresos_proyectados)}   sub="Gastos por pagar" />
                <KpiCard label="Saldo Proyectado 30d"      color="purple" value={fmtS(kpis?.saldo_proyectado)}      sub="Actual + ingresos − egresos" />
              </div>

              {/* Alertas */}
              {mesesDeficit.length > 0 ? (
                <div className="space-y-2">
                  {mesesDeficit.map(m => (
                    <div key={m.mes} className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                      <HiExclamationCircle className="w-4 h-4 flex-shrink-0" />
                      <span>Déficit proyectado en <strong>{m.mes}</strong>: {fmtS(m.saldo_acumulado)}</span>
                    </div>
                  ))}
                </div>
              ) : flujoFiltrado.length > 0 ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                  <HiCheckCircle className="w-4 h-4" />
                  Flujo de caja saludable en los próximos {periodo} meses
                </div>
              ) : null}

              {/* Filtro de fechas + Gráfico */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">Flujo de Caja Proyectado — Barras + Saldo Acumulado</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Filtro de rango */}
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
                      <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Desde</span>
                      <input type="month" value={filterDesde}
                        onChange={e => setFilterDesde(e.target.value)}
                        className="text-xs border-0 bg-transparent focus:outline-none text-gray-700 w-32" />
                      <span className="text-xs text-gray-400">—</span>
                      <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Hasta</span>
                      <input type="month" value={filterHasta}
                        onChange={e => setFilterHasta(e.target.value)}
                        className="text-xs border-0 bg-transparent focus:outline-none text-gray-700 w-32" />
                      {(filterDesde || filterHasta) && (
                        <button onClick={() => { setFilterDesde(""); setFilterHasta(""); }}
                          className="text-gray-400 hover:text-gray-600 ml-1">
                          <HiX className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                      {[3, 6, 12].map(m => (
                        <button key={m} onClick={() => setPeriodo(m)}
                          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                            periodo === m ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"
                          }`}>{m} meses</button>
                      ))}
                    </div>
                    <button onClick={() => setExportModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                      <HiDownload className="w-3.5 h-3.5" /> Exportar
                    </button>
                  </div>
                </div>
                <div style={{ height: 300 }}>
                  {loadingFlujo
                    ? <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando...</div>
                    : flujoFiltrado.length
                      ? <Chart type="bar" data={chartData} options={chartOptions} />
                      : <div className="h-full flex items-center justify-center text-gray-400 text-sm">Sin datos para el período seleccionado</div>
                  }
                </div>
              </div>

              {/* Tabla expandible por mes */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Detalle de Movimientos Proyectados</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Haz clic en un mes para ver el detalle de ingresos y egresos</p>
                  </div>
                  {flujoFiltrado.length !== flujoData.length && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      Mostrando {flujoFiltrado.length} de {flujoData.length} meses
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mes</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Ingresos</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Egresos</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Saldo Mes</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Saldo Acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {flujoFiltrado.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">Sin datos para el período seleccionado</td></tr>
                    ) : flujoFiltrado.map(row => (
                      <React.Fragment key={row.mes}>
                        <tr
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpandedMes(expandedMes === row.mes ? null : row.mes)}
                        >
                          <td className="px-4 py-3 font-medium text-gray-800 flex items-center gap-2">
                            {expandedMes === row.mes
                              ? <HiChevronDown className="w-3.5 h-3.5 text-gray-400" />
                              : <HiChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                            {row.mes}
                          </td>
                          <td className="px-4 py-3 text-right text-green-700 font-semibold">{fmtS(row.ingresos)}</td>
                          <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmtS(row.egresos)}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${row.saldo_mes >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {fmtS(row.saldo_mes)}
                          </td>
                          <td className={`px-4 py-3 text-right font-bold ${row.saldo_acumulado >= 0 ? "text-indigo-700" : "text-red-700"}`}>
                            {fmtS(row.saldo_acumulado)}
                          </td>
                        </tr>

                        {/* Detalle expandido */}
                        {expandedMes === row.mes && (
                          <tr>
                            <td colSpan={5} className="bg-gray-50 px-6 py-4">
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                {/* Ingresos */}
                                <div>
                                  <p className="text-xs font-semibold text-green-700 uppercase mb-2">
                                    Ingresos ({row.detalle_ingresos.length})
                                  </p>
                                  {row.detalle_ingresos.length === 0 ? (
                                    <p className="text-xs text-gray-400">Sin ingresos proyectados</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-gray-500">
                                          <th className="text-left pb-1">N° Factura</th>
                                          <th className="text-left pb-1">Cliente</th>
                                          <th className="text-right pb-1">Monto</th>
                                          <th className="text-right pb-1">Vence</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200">
                                        {row.detalle_ingresos.map(d => (
                                          <tr key={d.id}>
                                            <td className="py-1 font-mono text-gray-700">{d.numero_factura || "—"}</td>
                                            <td className="py-1 text-gray-600 truncate max-w-[140px]">{d.cliente || "—"}</td>
                                            <td className="py-1 text-right font-semibold text-green-700">{fmtS(d.monto)}</td>
                                            <td className="py-1 text-right text-gray-500">{fmtFecha(d.fecha_vencimiento)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                                {/* Egresos */}
                                <div>
                                  <p className="text-xs font-semibold text-red-600 uppercase mb-2">
                                    Egresos ({row.detalle_egresos.length})
                                  </p>
                                  {row.detalle_egresos.length === 0 ? (
                                    <p className="text-xs text-gray-400">Sin egresos proyectados</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-gray-500">
                                          <th className="text-left pb-1">N° Comprobante</th>
                                          <th className="text-left pb-1">Proveedor</th>
                                          <th className="text-right pb-1">Monto</th>
                                          <th className="text-right pb-1">Vence</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200">
                                        {row.detalle_egresos.map(d => (
                                          <tr key={d.id}>
                                            <td className="py-1 font-mono text-gray-700">{d.numero_comprobante || "—"}</td>
                                            <td className="py-1 text-gray-600 truncate max-w-[140px]">{d.proveedor || d.descripcion || "—"}</td>
                                            <td className="py-1 text-right font-semibold text-red-600">{fmtS(d.monto)}</td>
                                            <td className="py-1 text-right text-gray-500">{fmtFecha(d.fecha_vencimiento)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* TAB 2 — CONCILIACIÓN BANCARIA                                   */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {activeTab === "conciliacion" && (
            <div className="space-y-5 pb-20">

              {/* Stepper */}
              <PasoStepper paso={pasoActivo} />

              {/* ── PASO 1: Configurar ── */}
              {pasoActivo === 1 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">
                    Selecciona la cuenta bancaria y el período a conciliar
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-700 uppercase">Cuenta Bancaria</label>
                      <select value={cuentaId} onChange={e => setCuentaId(e.target.value)}
                        className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Seleccionar cuenta…</option>
                        {cuentas.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.banco} — {c.numero_cuenta} {c.tipo_cuenta ? `(${c.tipo_cuenta})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-700 uppercase">Desde</label>
                      <input type="date" value={importForm.periodo_desde}
                        onChange={e => setImportForm(f => ({ ...f, periodo_desde: e.target.value }))}
                        className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-700 uppercase">Hasta</label>
                      <input type="date" value={importForm.periodo_hasta}
                        onChange={e => setImportForm(f => ({ ...f, periodo_hasta: e.target.value }))}
                        className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>

                  {/* Resumen de la cuenta seleccionada */}
                  {cuentaId && (() => {
                    const cSel = cuentas.find(c => String(c.id) === String(cuentaId));
                    if (!cSel) return null;
                    return (
                      <div className="mt-4 grid grid-cols-3 gap-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div>
                          <p className="text-[11px] font-semibold text-blue-600 uppercase">Banco</p>
                          <p className="text-sm font-semibold text-blue-900 mt-0.5">{cSel.banco}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold text-blue-600 uppercase">N° Cuenta</p>
                          <p className="text-sm font-semibold text-blue-900 mt-0.5">{cSel.numero_cuenta}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold text-blue-600 uppercase">Tipo</p>
                          <p className="text-sm font-semibold text-blue-900 mt-0.5">{cSel.tipo_cuenta || "—"}</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex justify-end mt-5">
                    <button
                      onClick={() => { setConcError(null); setPasoActivo(2); }}
                      className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      Siguiente →
                    </button>
                  </div>
                </div>
              )}

              {/* ── PASO 2: Importar ── */}
              {pasoActivo === 2 && (
                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

                    {/* Formato de importación */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setFormatoImport("excel"); setConcError(null); }}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                          formatoImport === "excel"
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        📊 Importar Excel
                      </button>
                      <button
                        onClick={() => { setFormatoImport("pdf"); setConcError(null); }}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                          formatoImport === "pdf"
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        📄 Importar PDF Estado de Cuenta
                      </button>
                    </div>

                    {formatoImport === "excel" ? (
                      <>
                        {/* Descargar plantilla */}
                        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-green-800">1. Descarga la plantilla</p>
                            <p className="text-xs text-green-700 mt-0.5">Complétala con tus movimientos bancarios y luego súbela</p>
                          </div>
                          <button onClick={handleDescargarPlantilla}
                            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap">
                            <HiDownload className="w-4 h-4" /> Descargar Plantilla
                          </button>
                        </div>

                        {/* Zona de carga */}
                        <div>
                          <p className="text-xs font-semibold text-gray-700 uppercase mb-1.5">2. Sube el archivo completado</p>
                          <div
                            className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setImportArchivo(f); }}
                          >
                            <HiUpload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            {importArchivo
                              ? <p className="text-sm font-semibold text-blue-700">{importArchivo.name}</p>
                              : <>
                                  <p className="text-sm text-gray-500">Arrastra el archivo aquí o haz clic para seleccionar</p>
                                  <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv</p>
                                </>
                            }
                          </div>
                          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                            onChange={e => setImportArchivo(e.target.files[0] || null)} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800">
                          ⚠️ Por ahora solo se soporta BCP, con PDFs de texto seleccionable (no escaneados). El período y el N° de cuenta se detectan automáticamente del PDF.
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-gray-700 uppercase mb-1.5 block">Banco</label>
                          <select value={pdfBanco} onChange={e => setPdfBanco(e.target.value)}
                            className="w-full md:w-64 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="BCP">BCP</option>
                            <option value="BBVA">BBVA (próximamente)</option>
                            <option value="Otro">Otro (próximamente)</option>
                          </select>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-gray-700 uppercase mb-1.5">Sube el PDF del estado de cuenta</p>
                          <div
                            className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
                            onClick={() => pdfInputRef.current?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setPdfArchivo(f); }}
                          >
                            <HiUpload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            {pdfArchivo
                              ? <p className="text-sm font-semibold text-blue-700">{pdfArchivo.name}</p>
                              : <>
                                  <p className="text-sm text-gray-500">Arrastra el PDF aquí o haz clic para seleccionar</p>
                                  <p className="text-xs text-gray-400 mt-1">.pdf</p>
                                </>
                            }
                          </div>
                          <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden"
                            onChange={e => setPdfArchivo(e.target.files[0] || null)} />
                        </div>
                      </>
                    )}

                    {concError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{concError}</div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                      <button onClick={() => {
                        setPasoActivo(1); setPreviewConc(null);
                        setImportArchivo(null); setPdfArchivo(null); setConcError(null);
                      }}
                        className="px-4 py-2.5 border border-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50">
                        ← Volver
                      </button>
                      {formatoImport === "excel" ? (
                        <button onClick={handleImportar} disabled={!importArchivo || loadingImport}
                          className="ml-auto px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40">
                          {loadingImport ? "Procesando…" : "Previsualizar →"}
                        </button>
                      ) : (
                        <button onClick={handleImportarPdf} disabled={!pdfArchivo || loadingImportPdf}
                          className="ml-auto px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40">
                          {loadingImportPdf ? "Extrayendo movimientos…" : "Procesar PDF →"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Preview de movimientos */}
                  {previewConc && (
                    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
                        <HiCheckCircle className="w-4 h-4" />
                        Se detectaron <strong>{previewConc.movimientos_detectados}</strong> movimientos en el archivo
                      </div>
                      <div className="overflow-x-auto border border-gray-200 rounded-xl">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2.5 text-left font-semibold text-gray-500">Fecha</th>
                              <th className="px-3 py-2.5 text-left font-semibold text-gray-500">Descripción</th>
                              <th className="px-3 py-2.5 text-right font-semibold text-gray-500">Monto</th>
                              <th className="px-3 py-2.5 text-center font-semibold text-gray-500">Tipo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {previewConc.movimientos.map(m => (
                              <tr key={m.id}>
                                <td className="px-3 py-2 text-gray-700">{fmtFecha(m.fecha)}</td>
                                <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]">{m.descripcion || "—"}</td>
                                <td className="px-3 py-2 text-right font-semibold">{fmtS(m.monto)}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                    m.tipo === "ingreso" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                  }`}>{m.tipo}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {concError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{concError}</div>
                      )}
                      <div className="flex justify-end">
                        <button onClick={handleConfirmar} disabled={loadingConfirm}
                          className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50">
                          {loadingConfirm ? "Confirmando…" : "✓ Confirmar Importación"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── PASO 3: Revisar ── */}
              {pasoActivo === 3 && concActiva && (
                <div className="space-y-4">

                  {/* Info de la conciliación activa */}
                  <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800">
                        Conciliación #{concActiva.id} — {concActiva.banco}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Período: {fmtFecha(concActiva.periodo_desde)} al {fmtFecha(concActiva.periodo_hasta)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <EstadoBadge estado={concActiva.estado} />
                      <button
                        onClick={() => {
                          setPasoActivo(1);
                          setConcActiva(null);
                          setMovimientos([]);
                          setPreviewConc(null);
                          setImportArchivo(null);
                          setConcError(null);
                          setImportForm({ periodo_desde: "", periodo_hasta: "" });
                        }}
                        className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
                      >
                        + Nueva conciliación
                      </button>
                    </div>
                  </div>

                  {guardarMsg && (
                    <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm ${
                      guardarMsg.tipo === "ok"
                        ? "bg-green-50 border-green-200 text-green-800"
                        : "bg-red-50 border-red-200 text-red-700"
                    }`}>
                      <span className="flex-1">{guardarMsg.texto}</span>
                      <button onClick={() => setGuardarMsg(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                  )}

                  {/* Tabla unificada */}
                  <TablaMovimientos
                    movimientos={movimientos}
                    onToggle={handleToggleConciliado}
                    onDesconciliar={handleDesconciliar}
                    onRegistrarGB={handleRegistrarGBIndividual}
                    onRegistrarTodosGB={handleRegistrarTodosGB}
                    loadingGB={loadingGB}
                    gbMsg={gbMsg}
                    onClearGbMsg={() => setGbMsg(null)}
                  />

                  {/* Barra sticky */}
                  <ResumenSticky
                    concActiva={concActiva}
                    movimientos={movimientos}
                    onGuardar={handleGuardar}
                    guardando={loadingGuardar}
                    onExportar={() => { const fakeE = { stopPropagation: () => {} }; handleExportarConc(concActiva.id, fakeE); }}
                    onExportarConciliados={handleExportarConciliados}
                  />
                </div>
              )}

              {/* ── HISTORIAL ── */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Historial de Conciliaciones</h3>
                  <button onClick={loadHistorial} className="text-gray-400 hover:text-gray-600">
                    <HiRefresh className="w-4 h-4" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Período</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Banco</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Saldo Sistema</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Saldo Banco</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Diferencia</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Estado</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {historial.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">Sin conciliaciones registradas</td></tr>
                      ) : historial.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleAbrirHistorial(c)}>
                          <td className="px-4 py-3 text-gray-500 font-mono">#{c.id}</td>
                          <td className="px-4 py-3 text-gray-700">{fmtFecha(c.periodo_desde)} — {fmtFecha(c.periodo_hasta)}</td>
                          <td className="px-4 py-3 text-gray-700 font-medium">{c.banco}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{fmtS(c.saldo_sistema)}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{fmtS(c.saldo_banco)}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${Math.abs(c.diferencia) < 0.01 ? "text-green-700" : "text-red-600"}`}>
                            {fmtS(c.diferencia)}
                          </td>
                          <td className="px-4 py-3 text-center"><EstadoBadge estado={c.estado} /></td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-center gap-1">
                              <button onClick={() => handleAbrirHistorial(c)} title="Ver"
                                className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg">
                                <HiEye className="w-4 h-4" />
                              </button>
                              <button onClick={e => handleExportarConc(c.id, e)} title="Exportar Excel"
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg">
                                <HiDownload className="w-4 h-4" />
                              </button>
                              <button onClick={() => setDeletingConc(c)} title="Eliminar"
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                                <HiTrash className="w-4 h-4" />
                              </button>
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

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* TAB 3 — CUENTAS BANCARIAS                                     */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === "cuentas" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Cuentas Bancarias</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Disponibles en Cobranza, Gastos y Conciliación Bancaria
                  </p>
                </div>
                <button onClick={abrirNuevaCuentaBanc}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
                  <HiPlus className="w-4 h-4" />
                  Nueva Cuenta Bancaria
                </button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Banco</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">N° Cuenta</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Saldo</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Estado</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loadingCuentasBanc ? (
                      <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">Cargando…</td></tr>
                    ) : cuentasBanc.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">Sin cuentas bancarias registradas</td></tr>
                    ) : cuentasBanc.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800 font-medium">{c.banco}</td>
                        <td className="px-4 py-3 text-gray-700 font-mono">{c.numero_cuenta}</td>
                        <td className="px-4 py-3 text-gray-600">{c.tipo_cuenta || "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-400">—</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            🟢 Activa
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center gap-1">
                            <button onClick={() => abrirEditarCuentaBanc(c)} title="Editar"
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg">
                              <HiPencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => setDeletingCuentaBanc(c)} title="Eliminar"
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                              <HiTrash className="w-4 h-4" />
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

      {/* ── Modal Exportar Flujo ── */}
      {exportModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-800">Exportar Flujo de Caja</h2>
              <button onClick={() => setExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-5">Exporta los próximos 12 meses proyectados a Excel.</p>
            <div className="flex gap-3">
              <button onClick={() => setExportModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleExportarFlujo}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
                Descargar Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmar Eliminación ── */}
      {deletingConc && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <HiTrash className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Eliminar conciliación</h2>
                <p className="text-sm text-gray-500 mt-0.5">Esta acción no se puede deshacer.</p>
              </div>
              <button onClick={() => setDeletingConc(null)} className="ml-auto text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-700 space-y-1">
              <p>¿Estás seguro de eliminar esta conciliación?</p>
              <p className="font-semibold">
                Período: {fmtFecha(deletingConc.periodo_desde)} — {fmtFecha(deletingConc.periodo_hasta)}
              </p>
              <p className="font-semibold">Cuenta: {deletingConc.banco}</p>
              <p className="text-xs text-red-600 mt-1">
                Se eliminarán los movimientos de conciliación asociados. Los pagos registrados en el sistema no se verán afectados.
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setDeletingConc(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleConfirmarEliminar} disabled={loadingDelete}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50">
                {loadingDelete ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nueva / Editar Cuenta Bancaria ── */}
      {cuentaBancModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">
                {cuentaBancModal === "nuevo" ? "Nueva Cuenta Bancaria" : "Editar Cuenta Bancaria"}
              </h2>
              <button onClick={() => setCuentaBancModal(null)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Banco *</label>
                <input type="text" value={cuentaBancForm.banco} placeholder="Ej: BCP, Interbank, BBVA…"
                  onChange={e => setCuentaBancForm(f => ({ ...f, banco: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">N° de Cuenta *</label>
                <input type="text" value={cuentaBancForm.numero_cuenta} placeholder="Ej: 191-123456789-0-12"
                  onChange={e => setCuentaBancForm(f => ({ ...f, numero_cuenta: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Cuenta</label>
                <select value={cuentaBancForm.tipo_cuenta}
                  onChange={e => setCuentaBancForm(f => ({ ...f, tipo_cuenta: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Seleccionar (opcional)</option>
                  <option value="Corriente">Corriente</option>
                  <option value="Ahorros">Ahorros</option>
                </select>
              </div>
              {cuentaBancError && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0" />
                  {cuentaBancError}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setCuentaBancModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleGuardarCuentaBanc} disabled={savingCuentaBanc}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingCuentaBanc ? "Guardando…" : "Guardar Cuenta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmar Eliminación de Cuenta Bancaria ── */}
      {deletingCuentaBanc && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <HiTrash className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Eliminar cuenta bancaria</h2>
                <p className="text-sm text-gray-500 mt-0.5">Esta acción no se puede deshacer.</p>
              </div>
              <button onClick={() => setDeletingCuentaBanc(null)} className="ml-auto text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-700 space-y-1">
              <p>¿Estás seguro de eliminar esta cuenta bancaria?</p>
              <p className="font-semibold">{deletingCuentaBanc.banco} — {deletingCuentaBanc.numero_cuenta}</p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setDeletingCuentaBanc(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleEliminarCuentaBanc} disabled={loadingDeleteCuentaBanc}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50">
                {loadingDeleteCuentaBanc ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
