import React, { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FormNuevaOrden from "../components/comercial/FormNuevaOrden";
import FichaOrden from "../components/comercial/FichaOrden";
import CalendarioOrdenes from "../components/comercial/CalendarioOrdenes";
import { TIPOS_SERVICIO, ESTADOS, ESTADO_COLOR, ProgressBar, fmtS, fmtFecha } from "../components/comercial/ordenesCommon";
import {
  getOrdenes, deleteOrden, getResumenKpisOrdenes, exportarOrdenes,
} from "../api/comercialApi";
import {
  HiPlus, HiSearch, HiEye, HiPencil, HiTrash, HiDownload,
  HiX, HiExclamationCircle, HiClipboardList,
} from "react-icons/hi";

const PER_PAGE = 20;

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

export default function OrdenesServicio() {
  const [activeTab, setActiveTab] = useState("lista"); // lista | calendario

  const [ordenes, setOrdenes] = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch]             = useState("");
  const [filterTipo, setFilterTipo]     = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [filterDesde, setFilterDesde]   = useState("");
  const [filterHasta, setFilterHasta]   = useState("");
  const [activeKPI, setActiveKPI]       = useState("");

  const [kpis, setKpis] = useState(null);

  const [formModal, setFormModal]   = useState(null); // null | "nuevo" | orden obj
  const [verOrdenId, setVerOrdenId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [deleting, setDeleting]     = useState(false);

  const [exportModal, setExportModal] = useState(false);
  const [exportForm, setExportForm]   = useState({ desde: "", hasta: "", tipo_servicio: "", estado: "" });
  const [exportando, setExportando]   = useState(false);
  const [exportError, setExportError] = useState("");

  const cargar = useCallback(() => {
    setLoading(true);
    getOrdenes({
      search, tipo_servicio: filterTipo, estado: filterEstado,
      fecha_desde: filterDesde || undefined, fecha_hasta: filterHasta || undefined,
      page, per_page: PER_PAGE,
    })
      .then(r => { setOrdenes(r.data || []); setTotal(r.total || 0); })
      .catch(() => { setOrdenes([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [search, filterTipo, filterEstado, filterDesde, filterHasta, page]);

  const cargarKpis = useCallback(() => {
    getResumenKpisOrdenes().then(setKpis).catch(() => {});
  }, []);

  useEffect(() => { if (activeTab === "lista") cargar(); }, [cargar, activeTab]);
  useEffect(() => { cargarKpis(); }, [cargarKpis]);

  const totalPages = Math.ceil(total / PER_PAGE);
  const hayFiltros = search || filterTipo || filterEstado || filterDesde || filterHasta;

  const limpiarFiltros = () => {
    setSearch(""); setFilterTipo(""); setFilterEstado("");
    setFilterDesde(""); setFilterHasta(""); setActiveKPI(""); setPage(1);
  };

  const kpiClick = (estado, kpiKey) => {
    setActiveKPI(kpiKey);
    setFilterEstado(estado);
    setFilterDesde(""); setFilterHasta("");
    setPage(1);
    setActiveTab("lista");
  };

  const abrirNuevo  = () => setFormModal("nuevo");
  const abrirEditar = (o) => setFormModal(o);
  const cerrarForm  = () => setFormModal(null);

  const handleEliminar = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      await deleteOrden(confirmDel.id);
      setConfirmDel(null);
      cargar(); cargarKpis();
    } catch {
      // noop
    } finally {
      setDeleting(false);
    }
  };

  const handleExportar = async () => {
    setExportando(true); setExportError("");
    try {
      const params = {};
      if (exportForm.desde)         params.fecha_desde   = exportForm.desde;
      if (exportForm.hasta)         params.fecha_hasta   = exportForm.hasta;
      if (exportForm.tipo_servicio) params.tipo_servicio = exportForm.tipo_servicio;
      if (exportForm.estado)        params.estado        = exportForm.estado;
      const blob  = await exportarOrdenes(params);
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const url   = window.URL.createObjectURL(new Blob([blob]));
      const a     = document.createElement("a");
      a.href = url; a.setAttribute("download", `Ordenes_Servicio_${fecha}.xlsx`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      setExportModal(false);
    } catch {
      setExportError("No se pudo generar el archivo. Intente nuevamente.");
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Órdenes de Servicio" />
        <main className="flex-1 overflow-y-auto p-6">

          {/* Encabezado */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Órdenes de Servicio</h1>
              <p className="text-sm text-gray-500 mt-0.5">Seguimiento de trabajos de andamios en obra</p>
            </div>
            <button onClick={abrirNuevo}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
              <HiPlus className="w-4 h-4" /> Nueva Orden
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KPICard
              label="📋 Pendientes"
              value={kpis ? `${kpis.pendientes.cantidad} órdenes` : "…"}
              sub={kpis ? fmtS(kpis.pendientes.monto) : ""}
              colorBorder="border-gray-400" colorText="text-gray-700" colorRing="ring-gray-400"
              isActive={activeKPI === "pendientes"}
              onClick={() => kpiClick("Pendiente", "pendientes")}
            />
            <KPICard
              label="🔄 En Proceso"
              value={kpis ? `${kpis.en_proceso.cantidad} órdenes` : "…"}
              sub={kpis ? fmtS(kpis.en_proceso.monto) : ""}
              colorBorder="border-blue-500" colorText="text-blue-700" colorRing="ring-blue-500"
              isActive={activeKPI === "en_proceso"}
              onClick={() => kpiClick("En Proceso", "en_proceso")}
            />
            <KPICard
              label="✅ Completadas mes actual"
              value={kpis ? `${kpis.completadas_mes.cantidad}` : "…"}
              sub={kpis ? fmtS(kpis.completadas_mes.monto) : ""}
              colorBorder="border-green-500" colorText="text-green-700" colorRing="ring-green-500"
              isActive={activeKPI === "completadas"}
              onClick={() => kpiClick("Completada", "completadas")}
            />
            <KPICard
              label="❌ Canceladas"
              value={kpis ? `${kpis.canceladas.cantidad} órdenes` : "…"}
              colorBorder="border-red-500" colorText="text-red-700" colorRing="ring-red-500"
              isActive={activeKPI === "canceladas"}
              onClick={() => kpiClick("Cancelada", "canceladas")}
            />
          </div>

          {/* Tabs + Exportar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
              {[
                { key: "lista",      label: "Lista de Órdenes" },
                { key: "calendario", label: "Calendario" },
              ].map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => { setExportModal(true); setExportError(""); }}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors">
              <HiDownload className="w-4 h-4" /> Exportar
            </button>
          </div>

          {activeTab === "lista" ? (
            <>
              {/* Filtros */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                  <label className="text-xs text-gray-500">Buscar</label>
                  <div className="relative">
                    <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                      placeholder="N° orden o cliente..."
                      className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Tipo de Servicio</label>
                  <select value={filterTipo} onChange={e => { setFilterTipo(e.target.value); setPage(1); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">Todos</option>
                    {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Estado</label>
                  <select value={filterEstado} onChange={e => { setFilterEstado(e.target.value); setActiveKPI(""); setPage(1); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">Todos</option>
                    {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Desde</label>
                  <input type="date" value={filterDesde}
                    onChange={e => { setFilterDesde(e.target.value); setPage(1); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Hasta</label>
                  <input type="date" value={filterHasta}
                    onChange={e => { setFilterHasta(e.target.value); setPage(1); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                {hayFiltros && (
                  <button onClick={limpiarFiltros}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                    <HiX className="text-base" /> Limpiar
                  </button>
                )}
              </div>

              {/* Tabla */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                  <div className="text-center py-16 text-gray-400 text-sm">Cargando órdenes...</div>
                ) : ordenes.length === 0 ? (
                  <div className="text-center py-16">
                    <HiClipboardList className="text-5xl mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium text-gray-500">
                      {hayFiltros ? "Sin resultados para los filtros aplicados" : "No hay órdenes de servicio registradas"}
                    </p>
                    {!hayFiltros && (
                      <button onClick={abrirNuevo}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                        <HiPlus /> Crear primera orden
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" style={{ minWidth: 1200 }}>
                        <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">N° Orden</th>
                            <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                            <th className="px-4 py-3 text-left font-semibold">Tipo de Servicio</th>
                            <th className="px-4 py-3 text-left font-semibold">Dirección Obra</th>
                            <th className="px-4 py-3 text-left font-semibold">Fecha Inicio</th>
                            <th className="px-4 py-3 text-left font-semibold">Fecha Fin Est.</th>
                            <th className="px-4 py-3 text-right font-semibold">Presupuesto</th>
                            <th className="px-4 py-3 text-left font-semibold">Avance</th>
                            <th className="px-4 py-3 text-left font-semibold">Estado</th>
                            <th className="px-4 py-3 text-center font-semibold">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {ordenes.map(o => (
                            <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700 whitespace-nowrap">{o.numero_orden}</td>
                              <td className="px-4 py-3 text-gray-800 max-w-[160px] truncate" title={o.cliente_nombre}>{o.cliente_nombre || "—"}</td>
                              <td className="px-4 py-3 text-gray-600 max-w-[150px] truncate" title={o.tipo_servicio}>{o.tipo_servicio}</td>
                              <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate" title={o.direccion_obra}>{o.direccion_obra || "—"}</td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtFecha(o.fecha_inicio)}</td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtFecha(o.fecha_fin_estimada)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                                {fmtS(o.presupuesto_soles)}
                                {o.moneda === "USD" && (
                                  <p className="text-xs font-normal text-orange-600 mt-0.5">
                                    (US$ {Number(o.presupuesto).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3"><ProgressBar value={o.avance_porcentaje} estado={o.estado} /></td>
                              <td className="px-4 py-3">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${ESTADO_COLOR[o.estado] || "bg-gray-100 text-gray-600"}`}>
                                  {o.estado}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => setVerOrdenId(o.id)} title="Ver"
                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <HiEye className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => abrirEditar(o)} title="Editar"
                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <HiPencil className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => setConfirmDel(o)} title="Eliminar"
                                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                    <HiTrash className="w-4 h-4" />
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
            </>
          ) : (
            <CalendarioOrdenes onVerOrden={id => setVerOrdenId(id)} />
          )}

        </main>
      </div>

      {formModal && (
        <FormNuevaOrden
          mode={formModal === "nuevo" ? "create" : "edit"}
          orden={formModal === "nuevo" ? null : formModal}
          onClose={cerrarForm}
          onSaved={() => { cerrarForm(); cargar(); cargarKpis(); }}
        />
      )}

      {verOrdenId && (
        <FichaOrden
          ordenId={verOrdenId}
          onClose={() => setVerOrdenId(null)}
          onEditar={(o) => { setVerOrdenId(null); abrirEditar(o); }}
          onChanged={() => { cargar(); cargarKpis(); }}
        />
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
                <p className="font-semibold text-gray-800">Eliminar orden de servicio</p>
                <p className="text-sm font-mono text-gray-500">{confirmDel.numero_orden}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Se eliminará la orden de <strong>{confirmDel.cliente_nombre || "cliente sin asignar"}</strong>.
              Los gastos asociados quedarán sin orden vinculada. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleEliminar} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Exportar Reporte</h2>
                <p className="text-sm text-gray-500 mt-0.5">Órdenes de Servicio</p>
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
                <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Servicio</label>
                <select value={exportForm.tipo_servicio}
                  onChange={e => setExportForm(f => ({ ...f, tipo_servicio: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos</option>
                  {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Estado</label>
                <select value={exportForm.estado}
                  onChange={e => setExportForm(f => ({ ...f, estado: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos</option>
                  {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              {exportError && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{exportError}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setExportModal(false)} disabled={exportando}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleExportar} disabled={exportando}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                <HiDownload className="w-4 h-4" /> {exportando ? "Generando..." : "Exportar a Excel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
