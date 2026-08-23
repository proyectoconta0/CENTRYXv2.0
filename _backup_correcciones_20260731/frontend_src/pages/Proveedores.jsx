import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FormNuevoProveedor from "../components/comercial/FormNuevoProveedor";
import FichaProveedor from "../components/comercial/FichaProveedor";
import { TIPOS_DOCUMENTO, ESTADOS, ESTADO_COLOR, fmtS } from "../components/comercial/proveedoresCommon";
import {
  getProveedores, deleteProveedor, getResumenKpisProveedores, exportarProveedores,
} from "../api/comercialApi";
import {
  HiPlus, HiSearch, HiEye, HiPencil, HiTrash, HiDownload,
  HiX, HiExclamationCircle, HiOfficeBuilding,
} from "react-icons/hi";

const PER_PAGE = 20;

function KPICard({ label, value, sub, colorBorder, colorText }) {
  return (
    <div className={`bg-white rounded-xl border-l-4 p-4 shadow-sm ${colorBorder}`}>
      <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 ${colorText}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

export default function Proveedores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [proveedores, setProveedores] = useState([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(true);

  const [search, setSearch]           = useState("");
  const [filterEstado, setFilterEstado]   = useState("");
  const [filterTipoDoc, setFilterTipoDoc] = useState("");

  const [kpis, setKpis] = useState(null);

  const [formModal, setFormModal]   = useState(null); // null | "nuevo" | proveedor obj
  const [verId, setVerId]           = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [deleting, setDeleting]     = useState(false);

  const [exportModal, setExportModal] = useState(false);
  const [exportForm, setExportForm]   = useState({ estado: "", tipo_documento: "" });
  const [exportando, setExportando]   = useState(false);
  const [exportError, setExportError] = useState("");

  const cargar = useCallback(() => {
    setLoading(true);
    getProveedores({ search, estado: filterEstado, tipo_documento: filterTipoDoc, page, per_page: PER_PAGE })
      .then(r => { setProveedores(r.data || []); setTotal(r.total || 0); })
      .catch(() => { setProveedores([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [search, filterEstado, filterTipoDoc, page]);

  const cargarKpis = useCallback(() => {
    getResumenKpisProveedores().then(setKpis).catch(() => {});
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarKpis(); }, [cargarKpis]);

  // Deep-link desde el Buscador Global: /proveedores?ver=X → abre el detalle del proveedor X
  useEffect(() => {
    const ver = searchParams.get("ver");
    if (ver) {
      setVerId(Number(ver));
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / PER_PAGE);
  const hayFiltros = search || filterEstado || filterTipoDoc;

  const limpiarFiltros = () => {
    setSearch(""); setFilterEstado(""); setFilterTipoDoc(""); setPage(1);
  };

  const abrirNuevo  = () => setFormModal("nuevo");
  const abrirEditar = (p) => setFormModal(p);
  const cerrarForm  = () => setFormModal(null);

  const handleEliminar = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      await deleteProveedor(confirmDel.id);
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
      if (exportForm.estado)         params.estado         = exportForm.estado;
      if (exportForm.tipo_documento) params.tipo_documento = exportForm.tipo_documento;
      const blob  = await exportarProveedores(params);
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const url   = window.URL.createObjectURL(new Blob([blob]));
      const a     = document.createElement("a");
      a.href = url; a.setAttribute("download", `Proveedores_${fecha}.xlsx`);
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
        <Header title="Proveedores" />
        <main className="flex-1 overflow-y-auto p-6">

          {/* Encabezado */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Proveedores</h1>
              <p className="text-sm text-gray-500 mt-0.5">Directorio y cuentas por pagar de proveedores</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { setExportModal(true); setExportError(""); }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors">
                <HiDownload className="w-4 h-4" /> Exportar
              </button>
              <button onClick={abrirNuevo}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
                <HiPlus className="w-4 h-4" /> Nuevo Proveedor
              </button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KPICard
              label="Proveedores Activos"
              value={kpis ? kpis.total_proveedores_activos : "…"}
              colorBorder="border-blue-500" colorText="text-blue-700"
            />
            <KPICard
              label="Total Comprado este Mes"
              value={kpis ? fmtS(kpis.total_comprado_mes) : "…"}
              colorBorder="border-green-500" colorText="text-green-700"
            />
            <KPICard
              label="Total por Pagar"
              value={kpis ? fmtS(kpis.total_por_pagar) : "…"}
              colorBorder="border-red-500" colorText="text-red-700"
            />
            <KPICard
              label="Proveedores con Deuda Vencida"
              value={kpis ? kpis.proveedores_con_deuda_vencida : "…"}
              colorBorder="border-yellow-400" colorText="text-yellow-600"
            />
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <label className="text-xs text-gray-500">Buscar</label>
              <div className="relative">
                <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder="RUC o razón social..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Estado</label>
              <select value={filterEstado} onChange={e => { setFilterEstado(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Todos</option>
                {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Tipo de Documento</label>
              <select value={filterTipoDoc} onChange={e => { setFilterTipoDoc(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">Todos</option>
                {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
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
              <div className="text-center py-16 text-gray-400 text-sm">Cargando proveedores...</div>
            ) : proveedores.length === 0 ? (
              <div className="text-center py-16">
                <HiOfficeBuilding className="text-5xl mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">
                  {hayFiltros ? "Sin resultados para los filtros aplicados" : "No hay proveedores registrados"}
                </p>
                {!hayFiltros && (
                  <button onClick={abrirNuevo}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                    <HiPlus /> Registrar primer proveedor
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 1100 }}>
                    <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="gp-col-mobile-hide px-4 py-3 text-left font-semibold">RUC/Doc</th>
                        <th className="px-4 py-3 text-left font-semibold">Proveedor</th>
                        <th className="gp-col-mobile-hide px-4 py-3 text-left font-semibold">Tipo Doc</th>
                        <th className="px-4 py-3 text-left font-semibold">Contacto</th>
                        <th className="px-4 py-3 text-right font-semibold">Total Comprado</th>
                        <th className="px-4 py-3 text-right font-semibold">Deuda Pendiente</th>
                        <th className="px-4 py-3 text-left font-semibold">Estado</th>
                        <th className="px-4 py-3 text-center font-semibold">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {proveedores.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          <td className="gp-col-mobile-hide px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{p.numero_documento}</td>
                          <td className="px-4 py-3 text-gray-800 max-w-[220px] truncate" title={p.razon_social}>{p.razon_social}</td>
                          <td className="gp-col-mobile-hide px-4 py-3 text-gray-500 whitespace-nowrap">{p.tipo_documento || "—"}</td>
                          <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate" title={p.contacto_principal}>{p.contacto_principal || "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtS(p.total_comprado)}</td>
                          <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${p.deuda_pendiente > 0 ? "text-red-600" : "text-gray-400"}`}>
                            {fmtS(p.deuda_pendiente)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${ESTADO_COLOR[p.estado] || "bg-gray-100 text-gray-600"}`}>
                              {p.estado}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setVerId(p.id)} title="Ver ficha"
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <HiEye className="w-4 h-4" />
                              </button>
                              <button onClick={() => abrirEditar(p)} title="Editar"
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <HiPencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirmDel(p)} title="Eliminar"
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

        </main>
      </div>

      {formModal && (
        <FormNuevoProveedor
          mode={formModal === "nuevo" ? "create" : "edit"}
          proveedor={formModal === "nuevo" ? null : formModal}
          onClose={cerrarForm}
          onSaved={() => { cerrarForm(); cargar(); cargarKpis(); }}
        />
      )}

      {verId && (
        <FichaProveedor
          proveedorId={verId}
          onClose={() => setVerId(null)}
          onEditar={(p) => { setVerId(null); abrirEditar(p); }}
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
                <p className="font-semibold text-gray-800">Eliminar proveedor</p>
                <p className="text-sm font-mono text-gray-500">{confirmDel.numero_documento}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Se eliminará a <strong>{confirmDel.razon_social}</strong>. Los gastos asociados quedarán sin proveedor vinculado.
              Esta acción no se puede deshacer.
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
                <p className="text-sm text-gray-500 mt-0.5">Proveedores</p>
              </div>
              <button onClick={() => setExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Estado</label>
                <select value={exportForm.estado}
                  onChange={e => setExportForm(f => ({ ...f, estado: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos</option>
                  {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Documento</label>
                <select value={exportForm.tipo_documento}
                  onChange={e => setExportForm(f => ({ ...f, tipo_documento: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Todos</option>
                  {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
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
