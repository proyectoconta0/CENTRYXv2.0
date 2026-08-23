import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FormComprobante from "../components/comercial/FormComprobante";
import ModalImportarPdf from "../components/comercial/ModalImportarPdf";
import ModalElegirImportacion from "../components/comercial/ModalElegirImportacion";
import CargaMasiva from "../components/comercial/CargaMasiva";
import { getComprobantes, getComprobante, deleteComprobante, eliminarComprobantesMasivo, exportarComprobantes, getClientes } from "../api/comercialApi";
import { imprimirComprobanteVenta } from "../components/comercial/PlantillaComprobante";
import {
  HiPlus, HiSearch, HiEye, HiPencil, HiTrash, HiPrinter,
  HiExclamationCircle, HiX, HiFilter, HiDocumentText, HiDownload,
} from "react-icons/hi";

const TIPOS_DOC = ["Factura", "Boleta de Venta", "Nota de Crédito", "Nota de Débito", "Anticipo de Cliente", "Recibo Interno"];

const TIPO_COLOR = {
  "Factura":            "bg-blue-100 text-blue-700",
  "Boleta de Venta":    "bg-green-100 text-green-700",
  "Nota de Crédito":    "bg-red-100 text-red-700",
  "Nota de Débito":     "bg-orange-100 text-orange-700",
  "Anticipo de Cliente":"bg-purple-100 text-purple-700",
  "Recibo Interno":     "bg-gray-200 text-gray-700",
};

const TIPO_LABEL = {
  "Factura":            "Factura",
  "Boleta de Venta":    "Boleta",
  "Nota de Crédito":    "N. Crédito",
  "Nota de Débito":     "N. Débito",
  "Anticipo de Cliente":"Anticipo Cliente",
  "Recibo Interno":     "Recibo Interno",
};

function DetraccionBadge({ c }) {
  if (!c.tiene_detraccion) return <span className="text-gray-300">—</span>;
  if (c.detraccion_pagada) {
    return (
      <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap bg-green-100 text-green-700">
        DET ✓
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap bg-red-100 text-red-700">
      DET
    </span>
  );
}

function fmtFecha(d) {
  // Ancla a mediodía local antes de formatear: "YYYY-MM-DD" (fecha pura,
  // sin hora) parsea como medianoche UTC, y en timezones detrás de UTC
  // (ej. Lima, UTC-5) toLocaleDateString la muestra un día antes.
  if (!d) return "—";
  return new Date(`${String(d).split("T")[0]}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtS(n) {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-S/ ${abs}` : `S/ ${abs}`;
}

const PER_PAGE = 20;

// Columnas ocultables de la tabla de Ventas (selector "⚙ Columnas").
// "Acciones" no está acá porque siempre es visible (forzada en el render).
const VENTAS_COLUMNAS = [
  { id: "tipo",           label: "Tipo" },
  { id: "numero",         label: "N° Documento" },
  { id: "cliente",        label: "Cliente" },
  { id: "tipo_servicio",  label: "Tipo de Servicio" },
  { id: "base_imponible", label: "Base Imponible" },
  { id: "igv",            label: "IGV" },
  { id: "precio_venta",   label: "Precio Venta" },
  { id: "detraccion",     label: "Detracción" },
  { id: "fecha_emision",  label: "Fecha Emisión" },
  { id: "vencimiento",    label: "F. Vencimiento" },
];
const VENTAS_COLUMNAS_DEFAULT = Object.fromEntries(VENTAS_COLUMNAS.map(c => [c.id, true]));
const VENTAS_COLUMNAS_STORAGE_KEY = "ventas_columnas_visibles";
const VENTAS_COLUMNAS_MIN_VISIBLES = 3;

export default function Ventas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [comprobantes, setComprobantes] = useState([]);
  const [total, setTotal]               = useState(0);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [fTipo, setFTipo]               = useState("");
  const [fDesde, setFDesde]             = useState("");
  const [fHasta, setFHasta]             = useState("");
  const [page, setPage]                 = useState(1);

  const [formMode, setFormMode]         = useState(null);
  const [selected, setSelected]         = useState(null);
  const [elegirImportacion, setElegirImportacion] = useState(false);
  const [importarPdf, setImportarPdf]   = useState(false);
  const [cargaMasiva, setCargaMasiva]   = useState(false);
  const [confirmDel, setConfirmDel]     = useState(null);
  const [deleting, setDeleting]         = useState(false);
  const [seleccionados, setSeleccionados] = useState([]);
  const [confirmDelMasivo, setConfirmDelMasivo] = useState(false);
  const [deletingMasivo, setDeletingMasivo]     = useState(false);

  // ── Ventas: selector de columnas visibles ("⚙ Columnas") ─────────────────
  const [ventasColumnas, setVentasColumnas] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(VENTAS_COLUMNAS_STORAGE_KEY));
      return guardado ? { ...VENTAS_COLUMNAS_DEFAULT, ...guardado } : { ...VENTAS_COLUMNAS_DEFAULT };
    } catch { return { ...VENTAS_COLUMNAS_DEFAULT }; }
  });
  const [ventasColumnasMenuAbierto, setVentasColumnasMenuAbierto] = useState(false);
  const ventasColumnasMenuRef = useRef(null);

  useEffect(() => {
    if (!ventasColumnasMenuAbierto) return;
    const handleClickFuera = (e) => {
      if (ventasColumnasMenuRef.current && !ventasColumnasMenuRef.current.contains(e.target)) {
        setVentasColumnasMenuAbierto(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [ventasColumnasMenuAbierto]);

  const toggleVentasColumna = (id) => {
    setVentasColumnas(cols => {
      const visibles = Object.values(cols).filter(Boolean).length;
      if (cols[id] && visibles <= VENTAS_COLUMNAS_MIN_VISIBLES) return cols; // no bajar de 3 visibles
      const next = { ...cols, [id]: !cols[id] };
      localStorage.setItem(VENTAS_COLUMNAS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const restablecerVentasColumnas = () => {
    const next = { ...VENTAS_COLUMNAS_DEFAULT };
    setVentasColumnas(next);
    localStorage.setItem(VENTAS_COLUMNAS_STORAGE_KEY, JSON.stringify(next));
  };

  const [exportModal,     setExportModal]     = useState(false);
  const [exportDesde,     setExportDesde]     = useState("");
  const [exportHasta,     setExportHasta]     = useState("");
  const [exportClienteId, setExportClienteId] = useState("");
  const [exportTipo,      setExportTipo]      = useState("");
  const [exportClientes,  setExportClientes]  = useState([]);
  const [exportando,      setExportando]      = useState(false);
  const [exportError,     setExportError]     = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, per_page: PER_PAGE };
      if (search)  params.search         = search;
      if (fTipo)   params.tipo_documento = fTipo;
      if (fDesde)  params.fecha_desde    = fDesde;
      if (fHasta)  params.fecha_hasta    = fHasta;
      const res = await getComprobantes(params);
      setComprobantes(res.data  || []);
      setTotal(res.total        || 0);
      setSeleccionados([]);
    } catch {
      setComprobantes([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, fTipo, fDesde, fHasta, page]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirCrear  = () => { setSelected(null); setFormMode("create"); };
  const abrirVer    = (c) => { setSelected(c);   setFormMode("view"); };
  const abrirEditar = (c) => { setSelected(c);   setFormMode("edit"); };
  const cerrarForm  = () => { setFormMode(null); setSelected(null); };

  // Deep-link desde el Buscador Global: /ventas?ver=X → abre el detalle del comprobante X
  useEffect(() => {
    const verId = searchParams.get("ver");
    if (verId) {
      getComprobante(verId).then(abrirVer).catch(() => {});
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirConfirmDel = async (c) => {
    let facturaVinculada = null;
    if (c.tipo_documento === "Nota de Crédito" && c.comprobante_relacionado_id) {
      try {
        const f = await getComprobante(c.comprobante_relacionado_id);
        if (f?.estado === "Anulada") facturaVinculada = f;
      } catch { /* si falla la búsqueda, se muestra el diálogo genérico */ }
    }
    setConfirmDel({ comprobante: c, facturaVinculada });
  };

  const handleEliminar = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      await deleteComprobante(confirmDel.comprobante.id);
      setConfirmDel(null);
      cargar();
    } catch (err) {
      alert(err.response?.data?.detail || "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  };

  const toggleSeleccionado = (id) => {
    setSeleccionados(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };
  const todosSeleccionados = comprobantes.length > 0 && comprobantes.every(c => seleccionados.includes(c.id));
  const toggleTodos = () => {
    setSeleccionados(todosSeleccionados ? [] : comprobantes.map(c => c.id));
  };

  const handleEliminarMasivo = async () => {
    setDeletingMasivo(true);
    try {
      await eliminarComprobantesMasivo(seleccionados);
      setConfirmDelMasivo(false);
      cargar();
    } catch (err) {
      alert(err.response?.data?.detail || "Error al eliminar los comprobantes seleccionados");
    } finally {
      setDeletingMasivo(false);
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
      if (exportDesde)     params.fecha_desde    = exportDesde;
      if (exportHasta)     params.fecha_hasta    = exportHasta;
      if (exportClienteId) params.cliente_id     = exportClienteId;
      if (exportTipo)      params.tipo_documento = exportTipo;

      const blob = await exportarComprobantes(params);
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const url  = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href  = url;
      link.setAttribute("download", `Reporte_Comprobantes_${fecha}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportModal(false);
    } catch {
      setExportError("Error al generar el reporte. Intente nuevamente.");
    } finally {
      setExportando(false);
    }
  };

  const limpiar = () => { setSearch(""); setFTipo(""); setFDesde(""); setFHasta(""); setPage(1); };
  const hayFiltros  = search || fTipo || fDesde || fHasta;
  const totalPages  = Math.ceil(total / PER_PAGE);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6 space-y-5">

          {/* Título */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-800">Registro de Comprobantes</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {total} comprobante{total !== 1 ? "s" : ""} registrado{total !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {seleccionados.length > 0 && (
                <button
                  onClick={() => setConfirmDelMasivo(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                >
                  🗑️ Eliminar seleccionadas ({seleccionados.length})
                </button>
              )}
              <button
                onClick={abrirExportModal}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                <HiDownload className="text-base" />
                Exportar
              </button>
              <button
                onClick={abrirCrear}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                <HiPlus className="text-base" /> Nuevo Comprobante
              </button>
              <button
                onClick={() => setElegirImportacion(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                📥 Importar PDF
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex flex-wrap items-end gap-3">
              <HiFilter className="text-gray-400 text-lg self-center" />

              <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                <label className="text-xs text-gray-500">Buscar</label>
                <div className="relative">
                  <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    placeholder="N° documento o cliente..."
                    className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Tipo</label>
                <select
                  value={fTipo}
                  onChange={e => { setFTipo(e.target.value); setPage(1); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Todos</option>
                  {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Desde</label>
                <input type="date" value={fDesde}
                  onChange={e => { setFDesde(e.target.value); setPage(1); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Hasta</label>
                <input type="date" value={fHasta}
                  onChange={e => { setFHasta(e.target.value); setPage(1); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {hayFiltros && (
                <button onClick={limpiar}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors self-end">
                  <HiX className="text-base" /> Limpiar
                </button>
              )}

              <div className="relative ml-auto" ref={ventasColumnasMenuRef}>
                <button onClick={() => setVentasColumnasMenuAbierto(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap">
                  ⚙ Columnas
                </button>
                {ventasColumnasMenuAbierto && (
                  <div className="absolute right-0 mt-1.5 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-2">
                    <div className="max-h-72 overflow-y-auto px-1">
                      {VENTAS_COLUMNAS.map(c => (
                        <label key={c.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
                          <input type="checkbox" checked={ventasColumnas[c.id]} onChange={() => toggleVentasColumna(c.id)}
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
                      <button onClick={restablecerVentasColumnas}
                        className="w-full text-left text-sm text-blue-600 hover:text-blue-700 py-1">
                        Restablecer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="text-center py-16 text-gray-400 text-sm">Cargando comprobantes...</div>
            ) : comprobantes.length === 0 ? (
              <div className="text-center py-16">
                <HiDocumentText className="text-5xl mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">
                  {hayFiltros ? "Sin resultados para los filtros aplicados" : "No hay comprobantes registrados"}
                </p>
                {!hayFiltros && (
                  <button onClick={abrirCrear}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                    <HiPlus /> Registrar primer comprobante
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 1100 }}>
                    <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-center">
                          <input type="checkbox" checked={todosSeleccionados} onChange={toggleTodos}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        </th>
                        {ventasColumnas.tipo           && <th className="px-4 py-3 text-left font-semibold">Tipo</th>}
                        {ventasColumnas.numero         && <th className="px-4 py-3 text-left font-semibold">N° Documento</th>}
                        {ventasColumnas.cliente         && <th className="px-4 py-3 text-left font-semibold">Cliente</th>}
                        {ventasColumnas.tipo_servicio   && <th className="px-4 py-3 text-left font-semibold">Tipo de Servicio</th>}
                        {ventasColumnas.base_imponible  && <th className="px-4 py-3 text-right font-semibold">Base Imponible</th>}
                        {ventasColumnas.igv             && <th className="px-4 py-3 text-right font-semibold">IGV</th>}
                        {ventasColumnas.precio_venta    && <th className="px-4 py-3 text-right font-semibold">Precio Venta</th>}
                        {ventasColumnas.detraccion      && <th className="px-4 py-3 text-center font-semibold">Detracción</th>}
                        {ventasColumnas.fecha_emision   && <th className="px-4 py-3 text-left font-semibold">Fecha Emisión</th>}
                        {ventasColumnas.vencimiento     && <th className="px-4 py-3 text-left font-semibold">F. Vencimiento</th>}
                        <th className="px-4 py-3 text-center font-semibold">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {comprobantes.map(c => (
                        <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${c.estado === "Anulada" ? "opacity-60" : ""}`}>
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={seleccionados.includes(c.id)} onChange={() => toggleSeleccionado(c.id)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          </td>
                          {ventasColumnas.tipo && (
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${TIPO_COLOR[c.tipo_documento] || "bg-gray-100 text-gray-600"}`}>
                                {TIPO_LABEL[c.tipo_documento] || c.tipo_documento}
                              </span>
                              {c.estado === "Anulada" && (
                                <span className="ml-1.5 text-xs px-2 py-1 rounded-full font-medium bg-gray-200 text-gray-500 line-through whitespace-nowrap">
                                  Anulada
                                </span>
                              )}
                            </td>
                          )}
                          {ventasColumnas.numero && (
                            <td className={`px-4 py-3 font-mono text-xs font-semibold whitespace-nowrap ${c.estado === "Anulada" ? "line-through text-gray-400" : "text-blue-700"}`}>
                              {c.numero_documento || "—"}
                            </td>
                          )}
                          {ventasColumnas.cliente && (
                            <td className="px-4 py-3 text-gray-800 max-w-[160px] truncate" title={c.cliente_nombre}>
                              {c.cliente_nombre}
                            </td>
                          )}
                          {ventasColumnas.tipo_servicio && (
                            <td className="px-4 py-3 text-gray-600 max-w-[140px] truncate" title={c.tipo_servicio}>
                              {c.tipo_servicio}
                            </td>
                          )}
                          {ventasColumnas.base_imponible && (
                            <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                              {fmtS(c.base_imponible)}
                            </td>
                          )}
                          {ventasColumnas.igv && (
                            <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                              {fmtS(c.igv)}
                            </td>
                          )}
                          {ventasColumnas.precio_venta && (
                            <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                              {fmtS(c.precio_venta)}
                              {c.moneda === "USD" && (
                                <p className="text-xs font-normal text-orange-600 mt-0.5">
                                  (US$ {(c.monto_original ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                </p>
                              )}
                            </td>
                          )}
                          {ventasColumnas.detraccion && (
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              <DetraccionBadge c={c} />
                            </td>
                          )}
                          {ventasColumnas.fecha_emision && (
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {fmtFecha(c.fecha)}
                            </td>
                          )}
                          {ventasColumnas.vencimiento && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              {c.fecha_vencimiento
                                ? <span className="text-gray-600">{fmtFecha(c.fecha_vencimiento)}</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => abrirVer(c)}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Ver">
                                <HiEye className="text-base" />
                              </button>
                              {c.estado === "Anulada" ? (
                                <button disabled
                                  className="p-1.5 text-gray-300 cursor-not-allowed rounded-lg" title="No se puede editar un comprobante anulado">
                                  <HiPencil className="text-base" />
                                </button>
                              ) : (
                                <button onClick={() => abrirEditar(c)}
                                  className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Editar">
                                  <HiPencil className="text-base" />
                                </button>
                              )}
                              {c.estado !== "Anulada" && (
                                <button
                                  onClick={() => imprimirComprobanteVenta(c).catch(() => alert("No se pudo abrir el comprobante para imprimir"))}
                                  className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="Imprimir">
                                  <HiPrinter className="text-base" />
                                </button>
                              )}
                              <button onClick={() => abrirConfirmDel(c)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
                                <HiTrash className="text-base" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
                    <span>Mostrando {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de {total}</span>
                    <div className="flex gap-2">
                      <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                        className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
                        Anterior
                      </button>
                      <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                        className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {formMode && (
        <FormComprobante
          mode={formMode}
          comprobante={selected}
          onClose={cerrarForm}
          onSaved={() => { cerrarForm(); cargar(); }}
        />
      )}

      {elegirImportacion && (
        <ModalElegirImportacion
          onClose={() => setElegirImportacion(false)}
          onElegirIndividual={() => { setElegirImportacion(false); setImportarPdf(true); }}
          onElegirMasiva={() => { setElegirImportacion(false); setCargaMasiva(true); }}
        />
      )}

      {importarPdf && (
        <ModalImportarPdf
          onClose={() => setImportarPdf(false)}
          onImported={() => { setImportarPdf(false); cargar(); }}
        />
      )}

      {cargaMasiva && (
        <CargaMasiva
          onClose={() => setCargaMasiva(false)}
          onImportado={() => { setCargaMasiva(false); cargar(); }}
        />
      )}

      {exportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Exportar Reporte</h2>
                <p className="text-sm text-gray-500 mt-0.5">Registro de Comprobantes</p>
              </div>
              <button onClick={() => setExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
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

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Documento</label>
                <select value={exportTipo} onChange={e => setExportTipo(e.target.value)}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos</option>
                  {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
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

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deleting && setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiExclamationCircle className="text-red-500 text-xl" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">
                  {confirmDel.facturaVinculada ? "Eliminar Nota de Crédito" : "Eliminar comprobante"}
                </p>
                <p className="text-sm font-mono text-gray-500">{confirmDel.comprobante.numero_documento}</p>
              </div>
            </div>
            {confirmDel.facturaVinculada ? (
              <div className="text-sm text-gray-600 mb-5 space-y-1.5">
                <p>Al eliminar esta Nota de Crédito:</p>
                <p>✓ Se eliminará la NC <strong>{confirmDel.comprobante.numero_documento}</strong></p>
                <p>
                  ✓ La factura <strong>{confirmDel.facturaVinculada.numero_documento}</strong> volverá
                  a estar activa y pendiente de cobro
                </p>
                <p>¿Deseas continuar?</p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 mb-5">
                Se eliminará el comprobante de <strong>{confirmDel.comprobante.cliente_nombre}</strong> por{" "}
                <strong>{fmtS(confirmDel.comprobante.precio_venta)}</strong>. Esta acción no se puede deshacer.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleEliminar} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deleting
                  ? "Eliminando..."
                  : confirmDel.facturaVinculada ? "Eliminar y Reactivar Factura" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelMasivo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deletingMasivo && setConfirmDelMasivo(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiExclamationCircle className="text-red-500 text-xl" />
              </div>
              <p className="font-semibold text-gray-800">Eliminar comprobantes seleccionados</p>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              ¿Eliminar {seleccionados.length} comprobante{seleccionados.length !== 1 ? "s" : ""} seleccionado{seleccionados.length !== 1 ? "s" : ""}?
              Esta acción es irreversible.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelMasivo(false)} disabled={deletingMasivo}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleEliminarMasivo} disabled={deletingMasivo}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deletingMasivo ? "Eliminando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
