import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FormCliente from "../components/comercial/FormCliente";
import { getClientes, deleteCliente } from "../api/comercialApi";
import { HiPlus, HiSearch, HiChevronLeft, HiChevronRight, HiPencil, HiEye, HiTrash } from "react-icons/hi";

function fmtMonto(n) {
  return `S/ ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Clientes() {
  const navigate = useNavigate();
  const [data, setData]       = useState({ total:0, data:[], page:1, per_page:10 });
  const [search, setSearch]   = useState("");
  const [estado, setEstado]   = useState("todos");
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCliente, setEditCliente] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setData(await getClientes({ search, estado, page, per_page: 10 })); }
    catch { setData({ total:0, data:[], page:1, per_page:10 }); }
    finally { setLoading(false); }
  }, [search, estado, page]);

  useEffect(() => { cargar(); }, [cargar]);

  const totalPags = Math.ceil(data.total / 10) || 1;

  const handleSaved = () => { setShowForm(false); setEditCliente(null); cargar(); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteCliente(deleteTarget.id);
      setDeleteTarget(null);
      cargar();
    } catch (err) {
      setDeleteError(err?.response?.data?.detail || "No se pudo eliminar el cliente.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">

          {/* Título + botón */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-semibold text-gray-800">Clientes</h1>
              <p className="text-sm text-gray-500 mt-0.5">{data.total} clientes registrados</p>
            </div>
            <button onClick={() => { setEditCliente(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              <HiPlus className="text-base" /> Nuevo Cliente
            </button>
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-48">
              <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar por razón social, RUC, contacto..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex gap-2">
              {["todos","activo","inactivo"].map(s => (
                <button key={s} onClick={() => { setEstado(s); setPage(1); }}
                  className={`px-3 py-2 text-xs font-medium rounded-lg capitalize transition-colors ${
                    estado===s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>{s==="todos"?"Todos":s==="activo"?"Activos":"Inactivos"}</button>
              ))}
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 720 }}>
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Razón Social</th>
                  <th className="gp-col-mobile-hide px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">RUC</th>
                  <th className="gp-col-mobile-hide px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contacto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Vendido</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">Cargando...</td></tr>
                ) : data.data.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">Sin resultados</td></tr>
                ) : data.data.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/clientes/${c.id}`)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 leading-tight">{c.razon_social}</div>
                      {c.distrito && <div className="text-xs text-gray-400 mt-0.5">{c.distrito}</div>}
                    </td>
                    <td className="gp-col-mobile-hide px-4 py-3 text-gray-600 font-mono text-xs">{c.ruc}</td>
                    <td className="gp-col-mobile-hide px-4 py-3 text-gray-600">{c.contacto || "—"}</td>
                    <td className="px-4 py-3 font-semibold text-gray-700">{fmtMonto(c.total_comprado)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {c.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => navigate(`/clientes/${c.id}`)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Ver ficha">
                          <HiEye className="text-base" />
                        </button>
                        <button onClick={() => { setEditCliente(c); setShowForm(true); }}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Editar">
                          <HiPencil className="text-base" />
                        </button>
                        <button onClick={() => { setDeleteError(""); setDeleteTarget(c); }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
                          <HiTrash className="text-base" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Paginación */}
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Mostrando {((page-1)*10)+1}–{Math.min(page*10, data.total)} de {data.total}
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded-lg hover:bg-gray-100 transition-colors">
                  <HiChevronLeft />
                </button>
                {Array.from({length: Math.min(5, totalPags)}, (_, i) => i+1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-7 h-7 text-xs rounded-lg font-medium transition-colors ${page===p ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPags, p+1))} disabled={page===totalPags}
                  className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded-lg hover:bg-gray-100 transition-colors">
                  <HiChevronRight />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {showForm && (
        <FormCliente cliente={editCliente} onClose={() => { setShowForm(false); setEditCliente(null); }} onSaved={handleSaved} />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-2">¿Eliminar este cliente?</h2>
            <div className="text-sm text-gray-600 mb-3">
              <div className="font-medium text-gray-800">{deleteTarget.razon_social}</div>
              <div className="text-xs text-gray-500 font-mono">RUC: {deleteTarget.ruc}</div>
            </div>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
              ⚠️ Si tiene comprobantes registrados no podrá eliminarse.
            </p>
            {deleteError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDeleteTarget(null); setDeleteError(""); }} disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                <HiTrash className="text-base" /> {deleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
