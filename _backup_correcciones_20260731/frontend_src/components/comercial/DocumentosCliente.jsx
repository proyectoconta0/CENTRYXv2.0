import React, { useState, useEffect, useRef } from "react";
import {
  HiDocumentText, HiUpload, HiTrash, HiEye, HiDownload,
  HiExclamationCircle, HiFilter, HiX,
} from "react-icons/hi";
import {
  getClientes, getDocumentos, subirDocumento, eliminarDocumento,
  actualizarEstadoDocumento, getDocumentoBlob,
  eliminarComprobante, getComprobanteBlob,
} from "../../api/comercialApi";

const TIPOS_DOC = [
  "Factura", "Boleta", "Contrato", "Acta de Conformidad",
  "RUC", "Orden de Servicio", "Garantía", "Otro",
];

const TIPOS_FILTRO = [
  "Factura", "Boleta", "Contrato", "Acta de Conformidad",
  "RUC", "Orden de Servicio", "Garantía", "Comprobante", "Otro",
];

const TIPO_COLOR = {
  "Factura":             "bg-yellow-100 text-yellow-700",
  "Boleta":              "bg-emerald-100 text-emerald-700",
  "Contrato":            "bg-blue-100 text-blue-700",
  "Acta de Conformidad": "bg-green-100 text-green-700",
  "RUC":                 "bg-purple-100 text-purple-700",
  "Orden de Servicio":   "bg-orange-100 text-orange-700",
  "Garantía":            "bg-indigo-100 text-indigo-700",
  "Comprobante":         "bg-teal-100 text-teal-700",
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

export default function DocumentosCliente({ clienteId, historial = [] }) {
  const [docs, setDocs]           = useState([]);
  const [clientes, setClientes]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [tipo, setTipo]           = useState("Contrato");
  const [ventaId, setVentaId]     = useState("");
  const [confirmDel, setConfirmDel] = useState(null); // almacena doc completo
  const fileRef = useRef();

  // filtros
  const [fCliente, setFCliente]   = useState(clienteId);
  const [fTipo, setFTipo]         = useState("");
  const [fEstado, setFEstado]     = useState("");
  const [fFechaDesde, setFDesde]  = useState("");
  const [fFechaHasta, setFHasta]  = useState("");
  const hayFiltros = String(fCliente) !== String(clienteId) || fTipo || fEstado || fFechaDesde || fFechaHasta;

  // cuando cambia la ficha (navegación entre clientes), resetear
  useEffect(() => {
    setFCliente(clienteId);
  }, [clienteId]);

  // cargar lista de clientes para el selector
  useEffect(() => {
    getClientes({ per_page: 200 })
      .then(r => setClientes(r.data || []))
      .catch(() => {});
  }, []);

  const cargar = async () => {
    setLoading(true);
    const params = {};
    if (fTipo) params.tipo = fTipo;
    if (fEstado) params.estado = fEstado;
    if (fFechaDesde) params.fecha_desde = fFechaDesde;
    if (fFechaHasta) params.fecha_hasta = fFechaHasta;
    try { setDocs(await getDocumentos(fCliente, params)); }
    catch { setDocs([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, [fCliente, fTipo, fEstado, fFechaDesde, fFechaHasta]);

  const limpiarFiltros = () => {
    setFCliente(clienteId);
    setFTipo(""); setFEstado(""); setFDesde(""); setFHasta("");
  };

  // ── Upload ──────────────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("Archivo mayor a 10 MB"); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tipo", tipo);
    if (ventaId) fd.append("venta_id", ventaId);
    setUploading(true);
    try {
      await subirDocumento(clienteId, fd); // siempre al cliente actual
      setVentaId("");
      // si el filtro está en el cliente actual, recargar
      if (String(fCliente) === String(clienteId)) await cargar();
    } catch (err) {
      alert(err.response?.data?.detail || "Error al subir");
    } finally {
      setUploading(false);
      fileRef.current.value = "";
    }
  };

  // ── Eliminar ─────────────────────────────────────────────────────────────
  const handleEliminar = async () => {
    if (!confirmDel) return;
    try {
      if (confirmDel.tipo_item === "comprobante") {
        await eliminarComprobante(confirmDel.venta_id);
      } else {
        await eliminarDocumento(fCliente, confirmDel.id);
      }
      await cargar();
    } catch { alert("Error al eliminar"); }
    finally { setConfirmDel(null); }
  };

  // ── Toggle estado (solo documentos, no comprobantes) ─────────────────────
  const toggleEstado = async (doc) => {
    const nuevo = doc.estado === "Activo" ? "Inactivo" : "Activo";
    try { await actualizarEstadoDocumento(fCliente, doc.id, nuevo); await cargar(); }
    catch { alert("Error al cambiar estado"); }
  };

  // ── Ver / descargar según tipo de item ──────────────────────────────────────
  // Tanto /ventas como /clientes exigen login a nivel de router, así que el
  // archivo no puede abrirse con una URL directa vía <a href>/window.open (no
  // llevan el token) — se descarga como blob vía axios (mismo patrón que
  // imprimirComprobanteVenta en PlantillaComprobante.jsx).
  const verDocumento = async (doc) => {
    // La pestaña se abre ANTES del await para no disparar el bloqueador de
    // pop-ups del navegador (solo permite window.open síncrono al clic).
    const ventana = window.open("", "_blank");
    try {
      const blob = doc.tipo_item === "comprobante"
        ? await getComprobanteBlob(doc.venta_id)
        : await getDocumentoBlob(fCliente, doc.id);
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
      const blob = doc.tipo_item === "comprobante"
        ? await getComprobanteBlob(doc.venta_id, true)
        : await getDocumentoBlob(fCliente, doc.id, true);
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

  const viendo_otro_cliente = String(fCliente) !== String(clienteId);

  return (
    <div className="space-y-4">

      {/* ── Área de subida (solo si el filtro está en el cliente actual) ── */}
      {!viendo_otro_cliente && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 bg-gray-50">
          <p className="text-sm font-medium text-gray-700 mb-3">Subir documento</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Tipo</label>
              <select
                value={tipo}
                onChange={e => setTipo(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {historial.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Compra asociada (opcional)</label>
                <select
                  value={ventaId}
                  onChange={e => setVentaId(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[260px]"
                >
                  <option value="">— Sin compra asociada —</option>
                  {historial.map(h => (
                    <option key={h.id} value={h.id}>
                      {fmtFecha(h.fecha)} · {h.tipo_servicio} · S/ {h.monto?.toLocaleString("es-PE")}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors self-end ${
              uploading ? "bg-blue-400 text-white cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}>
              <HiUpload className="text-base" />
              {uploading ? "Subiendo..." : "Seleccionar archivo"}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx"
              />
            </label>
            <p className="text-xs text-gray-400 self-end pb-2">PDF, Word, imágenes — máx. 10 MB</p>
          </div>
        </div>
      )}

      {/* ── Barra de filtros ── */}
      <div className="flex flex-wrap items-end gap-3 bg-gray-50 border border-gray-100 rounded-xl p-4">
        <HiFilter className="text-gray-400 text-lg self-center" />

        {/* 1. Filtro cliente — primer lugar */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Cliente</label>
          <select
            value={fCliente}
            onChange={e => setFCliente(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[180px] max-w-[220px]"
          >
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.razon_social}</option>
            ))}
          </select>
        </div>

        {/* 2. Tipo */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Tipo</label>
          <select
            value={fTipo}
            onChange={e => setFTipo(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Todos los tipos</option>
            {TIPOS_FILTRO.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* 3. Estado */}
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

        {/* 4. Fechas */}
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

      {/* nota al ver otro cliente */}
      {viendo_otro_cliente && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Mostrando documentos de otro cliente. Para subir documentos, vuelve al cliente original.
        </p>
      )}

      {/* ── Tabla ── */}
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Cargando documentos...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <HiDocumentText className="text-4xl mx-auto mb-2 opacity-40" />
          <p className="text-sm">{hayFiltros ? "Sin resultados para los filtros aplicados" : "Sin documentos cargados"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="text-xs text-gray-500 uppercase border-b border-gray-100">
              <tr>
                <th className="pb-3 text-left font-semibold">Documento</th>
                <th className="pb-3 text-left font-semibold">Tipo</th>
                <th className="pb-3 text-left font-semibold">Compra asociada</th>
                <th className="pb-3 text-left font-semibold">Fecha</th>
                <th className="pb-3 text-left font-semibold">Estado</th>
                <th className="pb-3 text-left font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {docs.map((doc, i) => (
                <tr key={doc.tipo_item === "comprobante" ? `comp_${doc.venta_id}` : doc.id} className="hover:bg-gray-50">
                  {/* Documento */}
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <HiDocumentText className="text-blue-500" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 truncate max-w-[160px]" title={doc.nombre}>
                          {doc.nombre}
                        </p>
                        {doc.tamano > 0 && <p className="text-xs text-gray-400">{fmtSize(doc.tamano)}</p>}
                      </div>
                    </div>
                  </td>

                  {/* Tipo */}
                  <td className="py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[doc.tipo] || TIPO_COLOR["Otro"]}`}>
                      {doc.tipo}
                    </span>
                  </td>

                  {/* Compra asociada */}
                  <td className="py-3 text-xs text-gray-500 max-w-[180px]">
                    {doc.venta_info ? (
                      <span className="inline-flex flex-col">
                        <span className="font-medium text-gray-700">{doc.venta_info.tipo_servicio}</span>
                        <span className="truncate max-w-[170px]">
                          {doc.venta_info.descripcion ? `${doc.venta_info.descripcion} · ` : ""}
                          S/ {Number(doc.venta_info.monto)?.toLocaleString("es-PE")}
                        </span>
                      </span>
                    ) : "—"}
                  </td>

                  {/* Fecha */}
                  <td className="py-3 text-xs text-gray-500 whitespace-nowrap">{fmtFecha(doc.fecha_carga)}</td>

                  {/* Estado */}
                  <td className="py-3">
                    {doc.tipo_item === "comprobante" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
                        Activo
                      </span>
                    ) : (
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
                    )}
                  </td>

                  {/* Acciones */}
                  <td className="py-3">
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
