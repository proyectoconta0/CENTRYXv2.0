import React, { useCallback, useEffect, useState } from "react";
import { HiDownload, HiX } from "react-icons/hi";
import { getAuditoria, exportarAuditoria } from "../../api/auditoriaApi";
import Toast from "../Toast";

const MODULO_LABEL = {
  auth:        "Autenticación",
  ventas:      "Ventas",
  cobranza:    "Cobranza",
  gastos:      "Gastos",
  flujo_caja:  "Flujo de Caja",
  clientes:    "Clientes",
  proveedores: "Proveedores",
};

const PER_PAGE = 100;

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function LogAuditoria({ onClose }) {
  const [data, setData]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");

  const [usuarios, setUsuarios] = useState([]);
  const [modulos, setModulos]   = useState([]);

  const [fUsuario, setFUsuario] = useState("");
  const [fModulo,  setFModulo]  = useState("");
  const [fDesde,   setFDesde]   = useState("");
  const [fHasta,   setFHasta]   = useState("");

  const [exportando, setExportando] = useState(false);
  const [toast, setToast] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { page, per_page: PER_PAGE };
      if (fUsuario) params.usuario_id = fUsuario;
      if (fModulo)  params.modulo     = fModulo;
      if (fDesde)   params.desde      = fDesde;
      if (fHasta)   params.hasta      = fHasta;
      const r = await getAuditoria(params);
      setData(r.data || []);
      setTotal(r.total || 0);
      setUsuarios(r.usuarios_disponibles || []);
      setModulos(r.modulos_disponibles || []);
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo cargar el log de auditoría.");
      setData([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, fUsuario, fModulo, fDesde, fHasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const limpiarFiltros = () => {
    setFUsuario(""); setFModulo(""); setFDesde(""); setFHasta(""); setPage(1);
  };
  const hayFiltros = fUsuario || fModulo || fDesde || fHasta;
  const totalPages = Math.ceil(total / PER_PAGE);

  const handleExportar = async () => {
    setExportando(true);
    try {
      const params = {};
      if (fUsuario) params.usuario_id = fUsuario;
      if (fModulo)  params.modulo     = fModulo;
      if (fDesde)   params.desde      = fDesde;
      if (fHasta)   params.hasta      = fHasta;
      const blob = await exportarAuditoria(params);
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      downloadBlob(blob, `Log_Auditoria_${fecha}.xlsx`);
    } catch {
      setToast({ message: "No se pudo exportar el log de auditoría.", type: "error" });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">Log de Actividad</p>
          <p className="text-xs text-gray-400">
            {total} registro{total !== 1 ? "s" : ""} — solo lectura, últimos {PER_PAGE} por página
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportar} disabled={exportando}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-60">
            <HiDownload className="w-3.5 h-3.5" /> {exportando ? "Generando…" : "Exportar a Excel"}
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
              <HiX className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Usuario</label>
          <select value={fUsuario} onChange={e => { setFUsuario(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">Todos</option>
            {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Módulo</label>
          <select value={fModulo} onChange={e => { setFModulo(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">Todos</option>
            {modulos.map(m => <option key={m} value={m}>{MODULO_LABEL[m] || m}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Desde</label>
          <input type="date" value={fDesde} onChange={e => { setFDesde(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Hasta</label>
          <input type="date" value={fHasta} onChange={e => { setFHasta(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="text-xs text-gray-500 hover:text-gray-700 pb-1.5">
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Tabla */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Fecha/Hora</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Usuario</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Módulo</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Acción</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Descripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">Cargando…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">Sin registros de actividad</td></tr>
              ) : data.map(log => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{log.fecha_hora || "—"}</td>
                  <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap">{log.usuario_nombre}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{MODULO_LABEL[log.modulo] || log.modulo}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{log.accion}</td>
                  <td className="px-3 py-2 text-gray-600">{log.descripcion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
            <span>{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de {total}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Anterior</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        )}
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
