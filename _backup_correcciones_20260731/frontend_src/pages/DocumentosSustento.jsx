import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import { getClientes, getTodosDocumentos, eliminarDocumento, actualizarEstadoDocumento, getDocumentoBlob } from "../api/comercialApi";
import {
  HiDocumentText, HiEye, HiDownload, HiTrash,
  HiFilter, HiX, HiExclamationCircle, HiUser,
} from "react-icons/hi";

const TIPOS_DOC = [
  "Factura", "Boleta", "Contrato", "Acta de Conformidad",
  "RUC", "Orden de Servicio", "Garantía", "Otro",
];

const TIPO_COLOR = {
  "Factura":             "bg-yellow-100 text-yellow-700",
  "Boleta":              "bg-emerald-100 text-emerald-700",
  "Contrato":            "bg-blue-100 text-blue-700",
  "Acta de Conformidad": "bg-green-100 text-green-700",
  "RUC":                 "bg-purple-100 text-purple-700",
  "Orden de Servicio":   "bg-orange-100 text-orange-700",
  "Garantía":            "bg-indigo-100 text-indigo-700",
  "Otro":                "bg-gray-100 text-gray-600",
};

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DocumentosSustento() {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState([]);
  const [docs, setDocs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [confirmDel, setConfirmDel] = useState(null);

  // filtros
  const [fCliente, setFCliente]     = useState("");
  const [fTipo, setFTipo]           = useState("");
  const [fEstado, setFEstado]       = useState("");
  const [fFechaDesde, setFDesde]    = useState("");
  const [fFechaHasta, setFHasta]    = useState("");
  const hayFiltros = fCliente || fTipo || fEstado || fFechaDesde || fFechaHasta;

  useEffect(() => {
    getClientes({ per_page: 200 })
      .then(r => setClientes(r.data || []))
      .catch(() => {});
  }, []);

  const cargar = async () => {
    setLoading(true);
    const params = {};
    if (fCliente) params.cliente_id = fCliente;
    if (fTipo) params.tipo = fTipo;
    if (fEstado) params.estado = fEstado;
    if (fFechaDesde) params.fecha_desde = fFechaDesde;
    if (fFechaHasta) params.fecha_hasta = fFechaHasta;
    try { setDocs(await getTodosDocumentos(params)); }
    catch { setDocs([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, [fCliente, fTipo, fEstado, fFechaDesde, fFechaHasta]);

  const limpiarFiltros = () => {
    setFCliente(""); setFTipo(""); setFEstado(""); setFDesde(""); setFHasta("");
  };

  const handleEliminar = async () => {
    if (!confirmDel) return;
    try {
      await eliminarDocumento(confirmDel.cliente_id, confirmDel.id);
      await cargar();
    } catch { alert("Error al eliminar"); }
    finally { setConfirmDel(null); }
  };

  const toggleEstado = async (doc) => {
    const nuevo = doc.estado === "Activo" ? "Inactivo" : "Activo";
    try { await actualizarEstadoDocumento(doc.cliente_id, doc.id, nuevo); await cargar(); }
    catch { alert("Error al cambiar estado"); }
  };

  // El router de /clientes exige login (dependencies=_mod("clientes") en
  // main.py), así que el documento no puede abrirse con una URL directa vía
  // <a href>/window.open (no lleva el token) — se descarga como blob vía
  // axios (mismo patrón que DocumentosCliente.jsx).
  const verDocumento = async (doc) => {
    // La pestaña se abre ANTES del await para no disparar el bloqueador de
    // pop-ups del navegador (solo permite window.open síncrono al clic).
    const ventana = window.open("", "_blank");
    try {
      const blob = await getDocumentoBlob(doc.cliente_id, doc.id);
      const url = window.URL.createObjectURL(blob);
      if (ventana) ventana.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      if (ventana) ventana.close();
      alert("No se pudo abrir el documento");
    }
  };

  const descargarDocumento = async (doc) => {
    try {
      const blob = await getDocumentoBlob(doc.cliente_id, doc.id, true);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.nombre || "documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo descargar el documento");
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6 space-y-5">

          {/* Título */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-800">Documentos de Sustento</h1>
              <p className="text-sm text-gray-500 mt-0.5">Todos los documentos de todos los clientes</p>
            </div>
            <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full font-medium">
              {docs.length} documento{docs.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Barra de filtros */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex flex-wrap items-end gap-3">
              <HiFilter className="text-gray-400 text-lg self-center" />

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Cliente</label>
                <select
                  value={fCliente}
                  onChange={e => setFCliente(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]"
                >
                  <option value="">Todos los clientes</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Tipo de documento</label>
                <select
                  value={fTipo}
                  onChange={e => setFTipo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Todos los tipos</option>
                  {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Estado</label>
                <select
                  value={fEstado}
                  onChange={e => setFEstado(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Todos</option>
                  <option value="Activo">Activo</option>
                  <option value="Inactivo">Inactivo</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Desde</label>
                <input
                  type="date"
                  value={fFechaDesde}
                  onChange={e => setFDesde(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Hasta</label>
                <input
                  type="date"
                  value={fFechaHasta}
                  onChange={e => setFHasta(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {hayFiltros && (
                <button
                  onClick={limpiarFiltros}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors self-end"
                >
                  <HiX className="text-base" /> Limpiar filtros
                </button>
              )}
            </div>
          </div>

          {/* Tabla de documentos */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Cargando documentos...</div>
            ) : docs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <HiDocumentText className="text-5xl mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">Sin documentos</p>
                <p className="text-xs mt-1">{hayFiltros ? "Prueba cambiando los filtros" : "No hay documentos registrados"}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold">Documento</th>
                      <th className="px-5 py-3 text-left font-semibold">Cliente</th>
                      <th className="px-5 py-3 text-left font-semibold">Tipo</th>
                      <th className="px-5 py-3 text-left font-semibold">Compra asociada</th>
                      <th className="px-5 py-3 text-left font-semibold">Fecha</th>
                      <th className="px-5 py-3 text-left font-semibold">Estado</th>
                      <th className="px-5 py-3 text-left font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {docs.map(doc => (
                      <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                              <HiDocumentText className="text-blue-500" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-700 truncate max-w-[150px]">{doc.nombre}</p>
                              <p className="text-xs text-gray-400">{fmtSize(doc.tamano)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => navigate(`/clientes/${doc.cliente_id}`)}
                            className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 transition-colors text-xs font-medium"
                          >
                            <HiUser className="text-sm" />
                            {doc.cliente_nombre}
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[doc.tipo] || TIPO_COLOR["Otro"]}`}>
                            {doc.tipo}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500">
                          {doc.venta_info ? (
                            <span className="inline-flex flex-col">
                              <span className="font-medium text-gray-700">{doc.venta_info.tipo_servicio}</span>
                              <span>{fmtFecha(doc.venta_info.fecha)} · S/ {Number(doc.venta_info.monto)?.toLocaleString("es-PE")}</span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500">{fmtFecha(doc.fecha_carga)}</td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => toggleEstado(doc)}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${
                              doc.estado === "Activo"
                                ? "bg-green-100 text-green-700 hover:bg-green-200"
                                : "bg-red-100 text-red-600 hover:bg-red-200"
                            }`}
                            title="Clic para cambiar estado"
                          >
                            {doc.estado}
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => verDocumento(doc)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Ver"
                            >
                              <HiEye className="text-base" />
                            </button>
                            <button
                              onClick={() => descargarDocumento(doc)}
                              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Descargar"
                            >
                              <HiDownload className="text-base" />
                            </button>
                            <button
                              onClick={() => setConfirmDel(doc)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Eliminar"
                            >
                              <HiTrash className="text-base" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Confirm delete */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiExclamationCircle className="text-red-500 text-xl" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">Eliminar documento</p>
                <p className="text-sm text-gray-500 truncate max-w-[220px]">{confirmDel.nombre}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={handleEliminar} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
