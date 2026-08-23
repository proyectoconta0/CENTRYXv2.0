import React, { useState, useEffect, useRef } from "react";
import {
  HiX, HiDocumentText, HiUpload, HiEye, HiDownload,
  HiTrash, HiExclamationCircle,
} from "react-icons/hi";
import {
  getDocumentos, subirDocumento, eliminarDocumento, getDocumentoBlob,
} from "../../api/comercialApi";
import Toast from "../Toast";

const TIPOS_DOC = [
  "Factura", "Boleta", "Contrato", "Orden de Servicio",
  "Acta de Conformidad", "Garantía", "Otro",
];

const TIPO_COLOR = {
  "Factura":             "bg-yellow-100 text-yellow-700",
  "Boleta":              "bg-emerald-100 text-emerald-700",
  "Contrato":            "bg-blue-100 text-blue-700",
  "Orden de Servicio":   "bg-orange-100 text-orange-700",
  "Acta de Conformidad": "bg-green-100 text-green-700",
  "Garantía":            "bg-indigo-100 text-indigo-700",
  "Otro":                "bg-gray-100 text-gray-600",
};

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SustentoModal({ clienteId, venta, onClose }) {
  const [docs, setDocs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [tipo, setTipo]           = useState("Factura");
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState(null);
  const fileRef = useRef();

  const cargar = async () => {
    setLoading(true);
    try {
      const all = await getDocumentos(clienteId, { venta_id: venta.id });
      setDocs(all.filter(d => d.tipo_item !== "comprobante"));
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [venta.id]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setToast({ message: "Archivo mayor a 10 MB", type: "error" }); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tipo", tipo);
    fd.append("venta_id", venta.id);
    setUploading(true);
    try {
      await subirDocumento(clienteId, fd);
      await cargar();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Error al subir", type: "error" });
    } finally {
      setUploading(false);
      fileRef.current.value = "";
    }
  };

  const handleEliminar = async () => {
    if (!confirmDel) return;
    try {
      await eliminarDocumento(clienteId, confirmDel.id);
      await cargar();
    } catch {
      setToast({ message: "Error al eliminar", type: "error" });
    } finally {
      setConfirmDel(null);
    }
  };

  // El router de /clientes exige login (dependencies=_mod("clientes") en
  // main.py), así que el documento no puede abrirse con una URL directa vía
  // <a href>/window.open (no lleva el token) — se descarga como blob vía
  // axios.
  const verDocumento = async (doc) => {
    // La pestaña se abre ANTES del await para no disparar el bloqueador de
    // pop-ups del navegador (solo permite window.open síncrono al clic).
    const ventana = window.open("", "_blank");
    try {
      const blob = await getDocumentoBlob(clienteId, doc.id);
      const url = window.URL.createObjectURL(blob);
      if (ventana) ventana.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      if (ventana) ventana.close();
      setToast({ message: "No se pudo abrir el documento", type: "error" });
    }
  };

  const descargarDocumento = async (doc) => {
    try {
      const blob = await getDocumentoBlob(clienteId, doc.id, true);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.nombre || "documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setToast({ message: "No se pudo descargar el documento", type: "error" });
    }
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel lateral derecho */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-50 bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Documentos de Sustento</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {venta.tipo_servicio} · {fmtFecha(venta.fecha)} · S/ {venta.monto?.toLocaleString("es-PE")}
            </p>
            {venta.numero_factura && (
              <p className="text-xs text-gray-400 font-mono mt-0.5">N° {venta.numero_factura}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <HiX className="text-lg" />
          </button>
        </div>

        {/* Área de subida */}
        <div className="p-5 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-medium text-gray-600 mb-2">Subir documento</p>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-500">Tipo</label>
              <select
                value={tipo}
                onChange={e => setTipo(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
              >
                {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors flex-shrink-0 ${
              uploading
                ? "bg-green-400 text-white cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}>
              <HiUpload className="text-base" />
              {uploading ? "Subiendo..." : "Subir documento"}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx"
              />
            </label>
          </div>
          <p className="text-xs text-gray-400 mt-2">PDF, Word, imágenes — máx. 10 MB</p>
        </div>

        {/* Lista de documentos */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Cargando documentos...</div>
          ) : docs.length === 0 ? (
            <div className="text-center py-14">
              <HiDocumentText className="text-5xl mx-auto mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">Sin documentos de sustento</p>
              <p className="text-xs text-gray-400 mt-1 mb-4">
                Usa el botón de arriba para subir el primer documento
              </p>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
                <HiUpload className="text-base" />
                Subir primer documento
                <input
                  type="file"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors border border-gray-100"
                >
                  <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <HiDocumentText className="text-blue-500 text-lg" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate" title={doc.nombre}>
                      {doc.nombre}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TIPO_COLOR[doc.tipo] || TIPO_COLOR["Otro"]}`}>
                        {doc.tipo}
                      </span>
                      <span className="text-xs text-gray-400">{fmtFecha(doc.fecha_carga)}</span>
                      {doc.tamano > 0 && (
                        <span className="text-xs text-gray-400">{fmtSize(doc.tamano)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmar eliminación */}
      {confirmDel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiExclamationCircle className="text-red-500 text-xl" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">Eliminar documento</p>
                <p className="text-sm text-gray-500 truncate max-w-[210px]">{confirmDel.nombre}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDel(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminar}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
