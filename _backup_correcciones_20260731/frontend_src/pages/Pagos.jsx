import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import {
  getGasto, updatePagoGasto, deletePagoGasto, getCuentasBancarias,
  getGastoImprimir, getComprobanteGastoBlob,
  getPagosTributarios, getResumenPagosTributarios, exportarPagosTributarios,
  getPagosGastos, revertirPagoLoteDetraccion, eliminarOrdenPago,
  eliminarDevolucionGarantia, registrarPagoGasto, createGasto,
} from "../api/comercialApi";
import ModalDetalleLoteDetraccion from "../components/gastos/ModalDetalleLoteDetraccion";
import ModalCrearOrdenPago from "../components/gastos/ModalCrearOrdenPago";
import ModalDetalleOrdenPago from "../components/gastos/ModalDetalleOrdenPago";
import DetraccionesPanel from "../components/gastos/DetraccionesPanel";
import CamposMetodoPagoGasto from "../components/gastos/CamposMetodoPagoGasto";
import { imprimirComprobante } from "../components/comercial/PlantillaComprobante";
import {
  HiSearch, HiPlus, HiEye, HiPencil, HiTrash, HiDownload,
  HiX, HiExclamationCircle, HiCheckCircle, HiCurrencyDollar, HiPrinter,
} from "react-icons/hi";

// ─── Constantes ───────────────────────────────────────────────────────────────
// Mismo valor que CATEGORIA_PAGOS_TRIBUTARIOS en Gastos.jsx — los pagos
// tributarios se registran como Gasto (categoria="Pagos Tributarios") desde
// acá, y como cualquier otro gasto también aparecen en Cuentas por Pagar
// (Gastos.jsx), donde se muestran con el badge gris "Tributario".
const CATEGORIA_PAGOS_TRIBUTARIOS = "Pagos Tributarios";

const PER_PAGE = 20;
const METODOS_PAGO = ["Efectivo", "Transferencia", "Depósito", "Cheque", "Yape o Plin"];

const CONCEPTOS_TRIBUTARIOS = [
  "IGV Mensual",
  "Impuesto a la Renta",
  "ESSALUD",
  "ONP",
  "Renta de Cuarta Categoría",
  "Renta de Quinta Categoría",
  "Otros Tributos SUNAT",
];
const METODOS_PAGO_TRIBUTARIO = ["Transferencia", "Depósito", "Efectivo"];
const MESES_LARGOS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const TRIB_FORM_DEFAULT = {
  concepto:      CONCEPTOS_TRIBUTARIOS[0],
  periodo_mes:   String(new Date().getMonth() + 1),
  periodo_anio:  String(new Date().getFullYear()),
  monto:         "",
  fecha_limite:  "",
  observaciones: "",
};

// IGV Mensual / Impuesto a la Renta: la fecha límite sugerida es el día 12
// del mes siguiente al período. Los demás conceptos no tienen regla fija.
const CONCEPTOS_CON_SUGERENCIA_FECHA = ["IGV Mensual", "Impuesto a la Renta"];
function sugerirFechaLimite(concepto, mes, anio) {
  if (!CONCEPTOS_CON_SUGERENCIA_FECHA.includes(concepto) || !mes || !anio) return "";
  let m = parseInt(mes, 10) + 1;
  let a = parseInt(anio, 10);
  if (m > 12) { m = 1; a += 1; }
  return `${a}-${String(m).padStart(2, "0")}-12`;
}

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

function SemaforoTributario({ valor }) {
  if (valor === "pagado")    return <HiCheckCircle className="w-5 h-5 text-green-500" title="Pagado" />;
  if (valor === "sin_fecha") return <span className="inline-block w-3 h-3 rounded-full bg-gray-300" title="Sin fecha límite" />;
  const c = { verde: "bg-green-500", amarillo: "bg-yellow-400", rojo: "bg-red-500" };
  const t = { verde: "Vence en más de 7 días", amarillo: "Vence en 4-7 días", rojo: "Vence en menos de 3 días" };
  return <span className={`inline-block w-3 h-3 rounded-full ${c[valor] || "bg-gray-300"}`} title={t[valor] || valor} />;
}

function EstadoTributarioBadge({ estado }) {
  const m = {
    "Pendiente":    "bg-red-100 text-red-700",
    "Pago Parcial": "bg-red-100 text-red-700",
    "Pagado":       "bg-green-100 text-green-700",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${m[estado] || "bg-gray-100 text-gray-600"}`}>
      {estado || "—"}
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function Pagos() {
  const navigate = useNavigate();
  const [imprimiendoId, setImprimiendoId] = useState(null);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("lista_pagos");

  // ── Modal Ver Gasto (desde "Ver gasto" en una fila de Lista de Pagos) ──────
  const [verModal, setVerModal] = useState(null);

  // ── Cuentas bancarias (compartidas con Cobranza/Gastos) ────────────────────
  const [cuentasBancarias, setCuentasBancarias] = useState([]);

  // ── Lista de Pagos ─────────────────────────────────────────────────────────
  const [pagosList,        setPagosList]        = useState([]);
  const [pagosTotal,       setPagosTotal]       = useState(0);
  const [loadingPagos,     setLoadingPagos]     = useState(false);
  const [pagosPage,        setPagosPage]        = useState(1);
  const [pagosFiltroTick,  setPagosFiltroTick]  = useState(0); // incrementa al presionar "Filtrar"/"Limpiar"
  const [filterPagoDesde,  setFilterPagoDesde]  = useState("");
  const [filterPagoHasta,  setFilterPagoHasta]  = useState("");
  const [filterPagoBanco,  setFilterPagoBanco]  = useState("");
  const [filterPagoCuenta, setFilterPagoCuenta] = useState("");
  const [filterPagoMetodo, setFilterPagoMetodo] = useState("");

  // ── Lista de Pagos: editar / eliminar un pago individual ────────────────────
  const [editPagoModal,  setEditPagoModal]  = useState(null);
  const [editPagoForm,   setEditPagoForm]   = useState({ monto_pagado: "", fecha_pago: hoy(), metodo_pago: "Efectivo", banco: "", numero_cuenta: "", numero_cheque: "" });
  const [editPagoError,  setEditPagoError]  = useState("");
  const [savingEditPago, setSavingEditPago] = useState(false);
  const [deletingPagoId, setDeletingPagoId] = useState(null);

  // ── Lista de Pagos: detalle de lote de detracciones (mismo modal que
  // Detracciones a Depositar → Ver Detalle, ver ModalDetalleLoteDetraccion) ──
  const [loteDetalleIdPagos, setLoteDetalleIdPagos] = useState(null);
  const [revirtiendoLoteId,  setRevirtiendoLoteId]  = useState(null);

  // ── Lista de Pagos: Órdenes de Pago ─────────────────────────────────────────
  const [crearOrdenPagoModal, setCrearOrdenPagoModal] = useState(false);
  const [ordenDetalleId,      setOrdenDetalleId]      = useState(null);
  const [eliminandoOrdenId,   setEliminandoOrdenId]   = useState(null);

  // ── Lista de Pagos: cuota de préstamo ────────────────────────────────────
  const [eliminandoCuotaPagoId, setEliminandoCuotaPagoId] = useState(null);

  // ── Lista de Pagos: devolución de garantía ───────────────────────────────
  const [eliminandoDevolucionId, setEliminandoDevolucionId] = useState(null);

  // ── Pagos Tributarios ──────────────────────────────────────────────────────
  const [tribSubTab,         setTribSubTab]          = useState("tributos"); // "tributos" | "detracciones"
  const [tribList,           setTribList]           = useState([]);
  const [tribTotal,          setTribTotal]           = useState(0);
  const [tribResumen,        setTribResumen]         = useState(null);
  const [loadingTrib,        setLoadingTrib]         = useState(false);
  const [filterTribConcepto, setFilterTribConcepto]  = useState("");
  const [filterTribEstado,   setFilterTribEstado]    = useState("");
  const [searchTrib,         setSearchTrib]          = useState("");
  const [tribPage,           setTribPage]            = useState(1);

  // ── Modal Nuevo Pago Tributario ─────────────────────────────────────────────
  const [tribFormModal, setTribFormModal] = useState(false);
  const [tribForm,      setTribForm]      = useState(TRIB_FORM_DEFAULT);
  const [tribFormError, setTribFormError] = useState("");
  const [savingTrib,    setSavingTrib]    = useState(false);

  // ── Modal Registrar Pago Tributario ─────────────────────────────────────────
  const [tribPagoModal,   setTribPagoModal]   = useState(null);
  const [tribPagoForm,    setTribPagoForm]    = useState({ fecha_pago: hoy(), metodo_pago: "Transferencia", numero_operacion: "", banco: "", numero_cuenta: "" });
  const [tribPagoError,   setTribPagoError]   = useState("");
  const [savingTribPago,  setSavingTribPago]  = useState(false);

  // ── Modal Ver Pago Tributario ────────────────────────────────────────────────
  const [tribVerModal, setTribVerModal] = useState(null);

  // ── Modal Exportar Pagos Tributarios ─────────────────────────────────────────
  const [tribExportModal, setTribExportModal] = useState(false);
  const [tribExportForm,  setTribExportForm]  = useState({ periodo_mes: "", periodo_anio: "", concepto: "", estado: "" });
  const [exportandoTrib,  setExportandoTrib]  = useState(false);
  const [tribExportError, setTribExportError] = useState("");

  // ── carga de datos ─────────────────────────────────────────────────────────

  const cargarTrib = useCallback(async () => {
    setLoadingTrib(true);
    try {
      const params = { page: tribPage, per_page: PER_PAGE };
      if (searchTrib)         params.search   = searchTrib;
      if (filterTribConcepto) params.concepto = filterTribConcepto;
      if (filterTribEstado)   params.estado   = filterTribEstado;
      const r = await getPagosTributarios(params);
      setTribList(r.data || []);
      setTribTotal(r.total || 0);
    } catch { setTribList([]); setTribTotal(0); }
    finally { setLoadingTrib(false); }
  }, [tribPage, searchTrib, filterTribConcepto, filterTribEstado]);

  const cargarTribResumen = useCallback(async () => {
    try { setTribResumen(await getResumenPagosTributarios()); }
    catch { setTribResumen(null); }
  }, []);

  const cargarPagos = useCallback(async () => {
    setLoadingPagos(true);
    try {
      const params = { page: pagosPage, per_page: PER_PAGE };
      if (filterPagoDesde)  params.desde         = filterPagoDesde;
      if (filterPagoHasta)  params.hasta         = filterPagoHasta;
      if (filterPagoBanco)  params.banco         = filterPagoBanco;
      if (filterPagoCuenta) params.numero_cuenta = filterPagoCuenta;
      if (filterPagoMetodo) params.metodo_pago   = filterPagoMetodo;
      const r = await getPagosGastos(params);
      setPagosList(r.data || []);
      setPagosTotal(r.total || 0);
    } catch { setPagosList([]); setPagosTotal(0); }
    finally { setLoadingPagos(false); }
  }, [pagosPage, filterPagoDesde, filterPagoHasta, filterPagoBanco, filterPagoCuenta, filterPagoMetodo]);

  useEffect(() => {
    if (activeTab === "pagos_tributarios") { cargarTrib(); cargarTribResumen(); }
    if (activeTab === "lista_pagos")      cargarPagos();
  }, [activeTab, cargarTrib, cargarTribResumen, cargarPagos]); // eslint-disable-line
  useEffect(() => {
    if (activeTab === "lista_pagos") cargarPagos();
  }, [pagosPage, pagosFiltroTick]); // eslint-disable-line
  useEffect(() => {
    if (activeTab === "pagos_tributarios") cargarTrib();
  }, [tribPage, searchTrib, filterTribConcepto, filterTribEstado]); // eslint-disable-line

  useEffect(() => {
    getCuentasBancarias().then(r => setCuentasBancarias(r || [])).catch(() => {});
  }, []);

  // ── Lista de Pagos: editar / eliminar un pago individual ────────────────────

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
      cargarPagos();
    } catch (err) { setEditPagoError(parsearError(err)); }
    finally { setSavingEditPago(false); }
  };

  const handleEliminarPago = async (pagoId) => {
    if (!window.confirm("¿Eliminar este pago?")) return;
    setDeletingPagoId(pagoId);
    try {
      await deletePagoGasto(pagoId);
      cargarPagos();
    } catch (err) { alert(parsearError(err)); }
    finally { setDeletingPagoId(null); }
  };

  // ── Lista de Pagos: fila de lote de detracciones ────────────────────────────

  const handleEliminarPagoLote = async (row) => {
    if (!window.confirm(
      `Al eliminar este pago:\n` +
      ` ✓ Se eliminará el registro ${row.numero_comprobante}\n` +
      ` ✓ Las ${row.cantidad_facturas ?? ""} detracciones de este lote volverán a aparecer como pendientes de depósito\n\n` +
      `¿Deseas continuar?`
    )) return;
    setRevirtiendoLoteId(row.lote_id);
    try {
      await revertirPagoLoteDetraccion(row.lote_id);
      cargarPagos();
    } catch { alert("No se pudo eliminar el pago del lote."); }
    finally { setRevirtiendoLoteId(null); }
  };

  const handleEliminarOrdenPago = async (row) => {
    if (!window.confirm(
      `Al eliminar esta Orden de Pago ${row.numero_comprobante}:\n` +
      ` ✓ Se revertirán los pagos de ${row.cantidad_facturas ?? ""} factura${row.cantidad_facturas === 1 ? "" : "s"}\n` +
      ` ✓ Los saldos pendientes volverán a su estado anterior\n\n` +
      `¿Deseas continuar?`
    )) return;
    setEliminandoOrdenId(row.orden_id);
    try {
      await eliminarOrdenPago(row.orden_id);
      cargarPagos();
    } catch { alert("No se pudo eliminar la orden de pago."); }
    finally { setEliminandoOrdenId(null); }
  };

  // ── Lista de Pagos: fila de cuota de préstamo ────────────────────────────────
  const handleEliminarPagoCuota = async (row) => {
    if (!window.confirm(
      `⚠️ Al eliminar este pago:\n` +
      ` - La cuota volverá a PENDIENTE\n` +
      ` - El saldo del préstamo se restaurará\n` +
      ` - Los gastos de interés/seguro se eliminarán\n\n` +
      `¿Confirmar?`
    )) return;
    setEliminandoCuotaPagoId(row.id);
    try {
      await deletePagoGasto(row.id);
      cargarPagos();
    } catch (err) { alert(parsearError(err)); }
    finally { setEliminandoCuotaPagoId(null); }
  };

  // ── Lista de Pagos: fila de devolución de garantía ───────────────────────────
  const handleEliminarPagoDevolucion = async (row) => {
    if (!window.confirm(
      `⚠️ Este pago corresponde a una devolución de garantía.\n` +
      `Al eliminarlo:\n` +
      ` - La devolución se revertirá\n` +
      ` - El monto pendiente de la garantía se restaurará\n\n` +
      `¿Confirmar eliminación?`
    )) return;
    setEliminandoDevolucionId(row.id);
    try {
      await eliminarDevolucionGarantia(row.id);
      cargarPagos();
    } catch (err) { alert(parsearError(err)); }
    finally { setEliminandoDevolucionId(null); }
  };

  const pagosTotalPages = Math.ceil(pagosTotal / PER_PAGE);

  // ── Pagos Tributarios handlers ─────────────────────────────────────────────

  const abrirNuevoTrib = () => {
    setTribForm(TRIB_FORM_DEFAULT);
    setTribFormError("");
    setTribFormModal(true);
  };

  const handleGuardarTrib = async () => {
    const monto = parseFloat(tribForm.monto);
    if (!tribForm.concepto)         { setTribFormError("Seleccione un concepto."); return; }
    if (isNaN(monto) || monto <= 0) { setTribFormError("Ingrese un monto válido."); return; }
    if (!tribForm.fecha_limite)     { setTribFormError("La fecha límite de pago es obligatoria."); return; }
    setSavingTrib(true); setTribFormError("");
    try {
      const payload = {
        fecha:              hoy(),
        categoria:          CATEGORIA_PAGOS_TRIBUTARIOS,
        descripcion:        tribForm.concepto,
        monto,
        area:               "Administrativa",
        fecha_vencimiento:  tribForm.fecha_limite,
        periodo_mes:        tribForm.periodo_mes  ? parseInt(tribForm.periodo_mes, 10)  : null,
        periodo_anio:       tribForm.periodo_anio ? parseInt(tribForm.periodo_anio, 10) : null,
        observaciones:      tribForm.observaciones || null,
        moneda:             "PEN",
      };
      await createGasto(payload);
      setTribFormModal(false);
      cargarTrib(); cargarTribResumen();
    } catch (err) { setTribFormError(parsearError(err)); }
    finally { setSavingTrib(false); }
  };

  const abrirPagoTrib = (g) => {
    setTribPagoModal(g);
    setTribPagoForm({ fecha_pago: hoy(), metodo_pago: "Transferencia", numero_operacion: "", banco: "", numero_cuenta: "" });
    setTribPagoError("");
  };

  const handleRegistrarPagoTrib = async () => {
    if (!tribPagoForm.fecha_pago) { setTribPagoError("La fecha de pago es obligatoria."); return; }
    setSavingTribPago(true); setTribPagoError("");
    try {
      await registrarPagoGasto(tribPagoModal.id, {
        monto_pagado:     tribPagoModal.monto,
        fecha_pago:       tribPagoForm.fecha_pago,
        metodo_pago:      tribPagoForm.metodo_pago,
        banco:            tribPagoForm.banco || null,
        numero_cuenta:    tribPagoForm.numero_cuenta || null,
        numero_operacion: tribPagoForm.numero_operacion || null,
      });
      setTribPagoModal(null);
      cargarTrib(); cargarTribResumen();
    } catch (err) { setTribPagoError(parsearError(err)); }
    finally { setSavingTribPago(false); }
  };

  const handleExportarTrib = async () => {
    setExportandoTrib(true); setTribExportError("");
    try {
      const params = {};
      if (tribExportForm.periodo_mes)  params.periodo_mes  = tribExportForm.periodo_mes;
      if (tribExportForm.periodo_anio) params.periodo_anio = tribExportForm.periodo_anio;
      if (tribExportForm.concepto)     params.concepto     = tribExportForm.concepto;
      if (tribExportForm.estado)       params.estado       = tribExportForm.estado;
      const blob = await exportarPagosTributarios(params);
      const url  = window.URL.createObjectURL(new Blob([blob]));
      const a    = document.createElement("a");
      a.href = url;
      a.setAttribute("download", `Pagos_Tributarios_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.xlsx`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      setTribExportModal(false);
    } catch (err) { setTribExportError(parsearError(err)); }
    finally { setExportandoTrib(false); }
  };

  const tribTotalPages = Math.ceil(tribTotal / PER_PAGE);

  // ── imprimir (Recibo Interno / Factura de gasto) — usado desde el modal
  // "Ver gasto" abierto desde una fila de Lista de Pagos ─────────────────────

  const handleImprimirGasto = async (g) => {
    if (g.tiene_comprobante) {
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
        alert("No se pudo abrir el comprobante original");
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
      alert("No se pudo cargar el comprobante para imprimir");
    } finally {
      setImprimiendoId(null);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Pagos" />

        <main className="flex-1 overflow-y-auto p-6">

          {/* Encabezado */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Pagos</h1>
              <p className="text-sm text-gray-500 mt-0.5">Pagos a proveedores y obligaciones tributarias</p>
            </div>
            <div className="flex items-center gap-3">
              {activeTab === "pagos_tributarios" && tribSubTab === "tributos" && (
                <button onClick={abrirNuevoTrib}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
                  <HiPlus className="w-4 h-4" /> Nuevo Pago Tributario
                </button>
              )}
            </div>
          </div>

          {/* ── KPI Cards (Pagos Tributarios → Tributos SUNAT) ────────────────── */}
          {activeTab === "pagos_tributarios" && tribSubTab === "tributos" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <KPICard
                label="Total Pagado a SUNAT este mes"
                value={tribResumen ? fmtS(tribResumen.pagado_mes) : "…"}
                sub={`${new Date().toLocaleString("es-PE",{month:"long",year:"numeric"})}`}
                colorBorder="border-red-500" colorText="text-red-700" colorRing="ring-red-500"
              />
              <KPICard
                label="Pendiente de Pagar"
                value={tribResumen ? fmtS(tribResumen.pendiente) : "…"}
                sub="Saldo por pagar"
                colorBorder="border-yellow-400" colorText="text-yellow-600" colorRing="ring-yellow-400"
              />
              <KPICard
                label="Pagado este año"
                value={tribResumen ? fmtS(tribResumen.pagado_anio) : "…"}
                sub={`Año ${new Date().getFullYear()}`}
                colorBorder="border-blue-500" colorText="text-blue-700" colorRing="ring-blue-500"
              />
            </div>
          )}

          {/* ── Tabs + Exportar ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
              {[
                { key: "lista_pagos",       label: "Lista de Pagos" },
                { key: "pagos_tributarios", label: "Pagos Tributarios" },
              ].map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {activeTab === "pagos_tributarios" && tribSubTab === "tributos" && (
              <button onClick={() => { setTribExportModal(true); setTribExportError(""); }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors">
                <HiDownload className="w-4 h-4" /> Exportar
              </button>
            )}
          </div>

          {/* ══ Tab: Lista de Pagos ══════════════════════════════════════════ */}
          {activeTab === "lista_pagos" && (
            <>
              {/* Filtros */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Desde</label>
                  <input type="date" value={filterPagoDesde} onChange={e => setFilterPagoDesde(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <label className="text-xs font-semibold text-gray-600 uppercase">Hasta</label>
                  <input type="date" value={filterPagoHasta} onChange={e => setFilterPagoHasta(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <select value={filterPagoBanco}
                  onChange={e => { setFilterPagoBanco(e.target.value); setFilterPagoCuenta(""); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todos los bancos</option>
                  {[...new Set(cuentasBancarias.map(c => c.banco))].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <select value={filterPagoCuenta} onChange={e => setFilterPagoCuenta(e.target.value)}
                  disabled={!filterPagoBanco}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400">
                  <option value="">Todas las cuentas</option>
                  {cuentasBancarias.filter(c => c.banco === filterPagoBanco).map(c => (
                    <option key={c.id} value={c.numero_cuenta}>{c.numero_cuenta}{c.tipo_cuenta ? ` (${c.tipo_cuenta})` : ""}</option>
                  ))}
                </select>
                <select value={filterPagoMetodo} onChange={e => setFilterPagoMetodo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todos</option>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia">Transferencia</option>
                  <option value="Cheque">Cheque</option>
                </select>
                <button onClick={() => { setPagosPage(1); setPagosFiltroTick(t => t + 1); }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                  🔍 Filtrar
                </button>
                <button onClick={() => {
                    setFilterPagoDesde(""); setFilterPagoHasta(""); setFilterPagoBanco("");
                    setFilterPagoCuenta(""); setFilterPagoMetodo("");
                    setPagosPage(1); setPagosFiltroTick(t => t + 1);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                  🗑️ Limpiar
                </button>
                <button onClick={() => setCrearOrdenPagoModal(true)}
                  className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors whitespace-nowrap">
                  ➕ Crear Orden de Pago
                </button>
              </div>

              {/* Tabla */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fecha Pago</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">N° Comprobante</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Proveedor</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Descripción</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Monto Total</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Banco</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">N° Cuenta</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Método Pago</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingPagos ? (
                        <tr><td colSpan={9} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : pagosList.length === 0 ? (
                        <tr><td colSpan={9} className="text-center py-12 text-gray-400 text-sm">No hay pagos para los filtros seleccionados</td></tr>
                      ) : pagosList.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(p.fecha_pago)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.numero_comprobante || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 max-w-[160px]">
                            <p className="text-sm text-gray-700 truncate" title={p.proveedor}>{p.proveedor || <span className="text-gray-300">—</span>}</p>
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <p className="text-gray-800 truncate" title={p.descripcion}>{p.descripcion || "—"}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(p.monto_pagado)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{p.banco || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{p.numero_cuenta || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{p.metodo_pago || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              {p.tipo === "lote_detraccion" ? (
                                <>
                                  <button onClick={() => setLoteDetalleIdPagos(p.lote_id)} title="Ver Detalle"
                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <HiEye className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleEliminarPagoLote(p)} disabled={revirtiendoLoteId === p.lote_id} title="Eliminar"
                                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                    <HiTrash className="w-4 h-4" />
                                  </button>
                                </>
                              ) : p.tipo === "orden_pago" ? (
                                <>
                                  <button onClick={() => setOrdenDetalleId(p.orden_id)} title="Ver Detalle"
                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <HiEye className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleEliminarOrdenPago(p)} disabled={eliminandoOrdenId === p.orden_id} title="Eliminar"
                                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                    <HiTrash className="w-4 h-4" />
                                  </button>
                                </>
                              ) : p.tipo === "devolucion_garantia" ? (
                                <button onClick={() => handleEliminarPagoDevolucion(p)} disabled={eliminandoDevolucionId === p.id} title="Eliminar"
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                  <HiTrash className="w-4 h-4" />
                                </button>
                              ) : p.tipo === "cuota_prestamo" ? (
                                <button onClick={() => handleEliminarPagoCuota(p)} disabled={eliminandoCuotaPagoId === p.id} title="Eliminar"
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                  <HiTrash className="w-4 h-4" />
                                </button>
                              ) : (
                                <>
                                  <button onClick={() => getGasto(p.gasto_id).then(setVerModal).catch(() => {})} title="Ver gasto"
                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <HiEye className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => abrirEditarPago(p)} title="Editar pago"
                                    className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                                    <HiPencil className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleEliminarPago(p.id)} disabled={deletingPagoId === p.id} title="Eliminar pago"
                                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                    <HiTrash className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pagosTotalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm text-gray-500">{(pagosPage-1)*PER_PAGE+1}–{Math.min(pagosPage*PER_PAGE,pagosTotal)} de {pagosTotal}</span>
                    <div className="flex gap-2">
                      <button disabled={pagosPage===1} onClick={() => setPagosPage(p=>p-1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Anterior</button>
                      <button disabled={pagosPage===pagosTotalPages} onClick={() => setPagosPage(p=>p+1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══ Tab: Pagos Tributarios ═══════════════════════════════════════ */}
          {activeTab === "pagos_tributarios" && (
            <>
              {/* Sub-pestañas: Tributos SUNAT / Detracciones por Depositar */}
              <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit mb-4">
                {[
                  { key: "tributos",     label: "Tributos SUNAT" },
                  { key: "detracciones", label: "Detracciones por Depositar" },
                ].map(t => (
                  <button key={t.key} onClick={() => setTribSubTab(t.key)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${tribSubTab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {tribSubTab === "detracciones" && <DetraccionesPanel />}
              </>
          )}
          {activeTab === "pagos_tributarios" && tribSubTab === "tributos" && (
            <>
              {/* Filtros */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[180px]">
                  <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Buscar concepto, observaciones…" value={searchTrib}
                    onChange={e => { setSearchTrib(e.target.value); setTribPage(1); }}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <select value={filterTribConcepto} onChange={e => { setFilterTribConcepto(e.target.value); setTribPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todos los conceptos</option>
                  {CONCEPTOS_TRIBUTARIOS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterTribEstado} onChange={e => { setFilterTribEstado(e.target.value); setTribPage(1); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todos los estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Pagado">Pagado</option>
                </select>
                {(searchTrib || filterTribConcepto || filterTribEstado) && (
                  <button onClick={() => { setSearchTrib(""); setFilterTribConcepto(""); setFilterTribEstado(""); setTribPage(1); }}
                    className="text-sm text-gray-500 hover:text-gray-700">Limpiar</button>
                )}
              </div>

              {/* Tabla */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-10"></th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Concepto</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Período</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Monto</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fecha Límite</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingTrib ? (
                        <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : tribList.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">No hay pagos tributarios para los filtros seleccionados</td></tr>
                      ) : tribList.map(g => (
                        <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 text-center">
                            <SemaforoTributario valor={g.semaforo} />
                          </td>
                          <td className="px-4 py-3 text-gray-800 font-medium whitespace-nowrap">{g.concepto}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{g.periodo_label || "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(g.monto)}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {g.fecha_limite ? fmtFecha(g.fecha_limite) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3"><EstadoTributarioBadge estado={g.estado} /></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center">
                              {g.estado !== "Pagado" ? (
                                <button onClick={() => abrirPagoTrib(g)}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                                  <HiCurrencyDollar className="w-4 h-4" /> Registrar Pago
                                </button>
                              ) : (
                                <button onClick={() => setTribVerModal(g)}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                                  <HiEye className="w-4 h-4" /> Ver
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {tribTotalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm text-gray-500">{(tribPage-1)*PER_PAGE+1}–{Math.min(tribPage*PER_PAGE,tribTotal)} de {tribTotal}</span>
                    <div className="flex gap-2">
                      <button disabled={tribPage===1} onClick={() => setTribPage(p=>p-1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Anterior</button>
                      <button disabled={tribPage===tribTotalPages} onClick={() => setTribPage(p=>p+1)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

        </main>
      </div>

      {/* ══ Modal: Ver Gasto (solo lectura — editar redirige a Gastos) ═══════ */}
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
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setVerModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cerrar
              </button>
              <button onClick={() => navigate(`/gastos?ver=${verModal.id}`)}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
                Editar en Gastos
              </button>
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
                <label className="text-xs font-semibold text-gray-700 uppercase">Monto Pagado (S/) *</label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                  <input type="number" step="0.01" min="0.01" value={editPagoForm.monto_pagado} placeholder="0.00"
                    onChange={e => setEditPagoForm(f => ({ ...f, monto_pagado: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Pago *</label>
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

      {/* ══ Modal: Detalle de Lote de Detracciones — mismo componente que usa
           Detracciones a Depositar → Ver Detalle (ModalDetalleLoteDetraccion) ═ */}
      {loteDetalleIdPagos && (
        <ModalDetalleLoteDetraccion
          loteId={loteDetalleIdPagos}
          onClose={() => setLoteDetalleIdPagos(null)}
          onChange={cargarPagos}
        />
      )}

      {/* ══ Modal: Crear Orden de Pago ══════════════════════════════════════ */}
      {crearOrdenPagoModal && (
        <ModalCrearOrdenPago
          cuentasBancarias={cuentasBancarias}
          onClose={() => setCrearOrdenPagoModal(false)}
          onSuccess={cargarPagos}
        />
      )}

      {/* ══ Modal: Detalle de Orden de Pago ═════════════════════════════════ */}
      {ordenDetalleId && (
        <ModalDetalleOrdenPago
          ordenId={ordenDetalleId}
          onClose={() => setOrdenDetalleId(null)}
          onChange={cargarPagos}
        />
      )}

      {/* ══ Modal: Nuevo Pago Tributario ══════════════════════════════════════ */}
      {tribFormModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Nuevo Pago Tributario</h2>
                <p className="text-sm text-gray-500 mt-0.5">Registrar obligación SUNAT</p>
              </div>
              <button onClick={() => setTribFormModal(false)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Concepto *</label>
                <select value={tribForm.concepto}
                  onChange={e => {
                    const concepto = e.target.value;
                    setTribForm(f => ({
                      ...f, concepto,
                      fecha_limite: f.fecha_limite || sugerirFechaLimite(concepto, f.periodo_mes, f.periodo_anio),
                    }));
                  }}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CONCEPTOS_TRIBUTARIOS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Mes del Período</label>
                  <select value={tribForm.periodo_mes}
                    onChange={e => {
                      const periodo_mes = e.target.value;
                      setTribForm(f => ({
                        ...f, periodo_mes,
                        fecha_limite: f.fecha_limite || sugerirFechaLimite(f.concepto, periodo_mes, f.periodo_anio),
                      }));
                    }}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {MESES_LARGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Año del Período</label>
                  <input type="number" value={tribForm.periodo_anio}
                    onChange={e => {
                      const periodo_anio = e.target.value;
                      setTribForm(f => ({
                        ...f, periodo_anio,
                        fecha_limite: f.fecha_limite || sugerirFechaLimite(f.concepto, f.periodo_mes, periodo_anio),
                      }));
                    }}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Monto (S/) *</label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                  <input type="number" step="0.01" min="0.01" value={tribForm.monto} placeholder="0.00"
                    onChange={e => setTribForm(f => ({ ...f, monto: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha Límite de Pago *</label>
                <input type="date" value={tribForm.fecha_limite}
                  onChange={e => setTribForm(f => ({ ...f, fecha_limite: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Observaciones</label>
                <textarea value={tribForm.observaciones} rows={2} placeholder="Opcional"
                  onChange={e => setTribForm(f => ({ ...f, observaciones: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              {tribFormError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {tribFormError}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setTribFormModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleGuardarTrib} disabled={savingTrib}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingTrib ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Registrar Pago Tributario ══════════════════════════════════ */}
      {tribPagoModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Registrar Pago</h2>
                <p className="text-sm text-gray-500 mt-0.5">{tribPagoModal.concepto} — {tribPagoModal.periodo_label || "—"}</p>
              </div>
              <button onClick={() => setTribPagoModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm text-blue-800">
                Monto a pagar: <span className="font-bold">{fmtS(tribPagoModal.monto)}</span>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Pago *</label>
                <input type="date" value={tribPagoForm.fecha_pago}
                  onChange={e => setTribPagoForm(f => ({ ...f, fecha_pago: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Método de Pago</label>
                <select value={tribPagoForm.metodo_pago}
                  onChange={e => setTribPagoForm(f => ({ ...f, metodo_pago: e.target.value, banco: "", numero_cuenta: "" }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {METODOS_PAGO_TRIBUTARIO.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <CamposMetodoPagoGasto form={tribPagoForm} setForm={setTribPagoForm} cuentasBancarias={cuentasBancarias} />
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">N° de Operación</label>
                <input type="text" value={tribPagoForm.numero_operacion} placeholder="Opcional"
                  onChange={e => setTribPagoForm(f => ({ ...f, numero_operacion: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {tribPagoError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {tribPagoError}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setTribPagoModal(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleRegistrarPagoTrib} disabled={savingTribPago}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                {savingTribPago ? "Guardando…" : "Registrar Pago"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Ver Pago Tributario ═══════════════════════════════════════ */}
      {tribVerModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">{tribVerModal.concepto}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{tribVerModal.periodo_label || "—"}</p>
              </div>
              <button onClick={() => setTribVerModal(null)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase font-medium">Monto</p>
                  <p className="text-sm font-bold text-gray-800 mt-1">{fmtS(tribVerModal.monto)}</p>
                </div>
                <div className="rounded-xl p-3 border">
                  <p className="text-xs text-gray-500 uppercase font-medium">Estado</p>
                  <div className="mt-1"><EstadoTributarioBadge estado={tribVerModal.estado} /></div>
                </div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs text-green-700 uppercase font-semibold">Detalle del Pago</p>
                <p className="text-sm text-gray-700">Fecha de pago: <span className="font-medium">{tribVerModal.fecha_pago ? fmtFecha(tribVerModal.fecha_pago) : "—"}</span></p>
                <p className="text-sm text-gray-700">Método: <span className="font-medium">{tribVerModal.metodo_pago || "—"}</span></p>
                <p className="text-sm text-gray-700">N° operación: <span className="font-medium">{tribVerModal.numero_operacion || "—"}</span></p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium">Fecha Límite</p>
                <p className="text-sm text-gray-700 mt-0.5">{tribVerModal.fecha_limite ? fmtFecha(tribVerModal.fecha_limite) : "—"}</p>
              </div>
              {tribVerModal.observaciones && (
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Observaciones</p>
                  <p className="text-sm text-gray-700 mt-0.5">{tribVerModal.observaciones}</p>
                </div>
              )}
            </div>
            <div className="px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setTribVerModal(null)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Exportar Pagos Tributarios ═════════════════════════════════ */}
      {tribExportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Exportar Pagos Tributarios</h2>
                <p className="text-sm text-gray-500 mt-0.5">Reporte en Excel</p>
              </div>
              <button onClick={() => setTribExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Mes</label>
                  <select value={tribExportForm.periodo_mes}
                    onChange={e => setTribExportForm(f => ({ ...f, periodo_mes: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Todos</option>
                    {MESES_LARGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 uppercase">Año</label>
                  <input type="number" value={tribExportForm.periodo_anio} placeholder="Todos"
                    onChange={e => setTribExportForm(f => ({ ...f, periodo_anio: e.target.value }))}
                    className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Concepto</label>
                <select value={tribExportForm.concepto}
                  onChange={e => setTribExportForm(f => ({ ...f, concepto: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos los conceptos</option>
                  {CONCEPTOS_TRIBUTARIOS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Estado</label>
                <select value={tribExportForm.estado}
                  onChange={e => setTribExportForm(f => ({ ...f, estado: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos los estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Pagado">Pagado</option>
                </select>
              </div>
              {tribExportError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {tribExportError}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setTribExportModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleExportarTrib} disabled={exportandoTrib}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                <HiDownload className="w-4 h-4" />
                {exportandoTrib ? "Generando…" : "Exportar a Excel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
