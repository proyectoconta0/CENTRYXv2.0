import React, { useState, useEffect } from "react";
import { HiExclamationCircle, HiPlus, HiX } from "react-icons/hi";
import { getDocumentosConfig, updateDocumentosConfig, crearDocumentoConfig } from "../../api/configuracionApi";

function NuevoDocumentoModal({ onClose, onCreated }) {
  const [tipo, setTipo]     = useState("");
  const [prefijo, setPrefijo] = useState("");
  const [numero, setNumero]   = useState(1);
  const [error, setError]     = useState("");
  const [guardando, setGuardando] = useState(false);

  const ejemplo = `${prefijo || ""}${String(numero || 1).padStart(5, "0")}`;

  async function guardar() {
    setError("");
    if (!tipo.trim())    { setError("El tipo de documento es obligatorio"); return; }
    if (!prefijo.trim()) { setError("El prefijo es obligatorio"); return; }
    setGuardando(true);
    try {
      const r = await crearDocumentoConfig({
        tipo_documento: tipo.trim(),
        prefijo: prefijo.trim(),
        proximo_numero: Number(numero) || 1,
      });
      onCreated(r.data || []);
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo crear el documento");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Nuevo Documento</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <HiX className="text-lg" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tipo <span className="text-red-500">*</span></label>
            <input value={tipo} onChange={e => setTipo(e.target.value)} placeholder="Recibo por Honorarios"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Prefijo <span className="text-red-500">*</span></label>
              <input value={prefijo} onChange={e => setPrefijo(e.target.value)} placeholder="RH-"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Próximo N°</label>
              <input type="number" min="1" value={numero} onChange={e => setNumero(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500" />
            </div>
          </div>
          <p className="text-xs text-gray-500">Ejemplo: <span className="font-mono">{ejemplo}</span></p>
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} disabled={guardando} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentosTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);

  useEffect(() => {
    getDocumentosConfig().then(r => setRows(r.data || [])).finally(() => setLoading(false));
  }, []);

  function set(tipo, campo, valor) {
    setRows(rs => rs.map(r => {
      if (r.tipo_documento !== tipo) return r;
      const actualizado = { ...r, [campo]: valor };
      const numero = String(actualizado.proximo_numero || 1).padStart(5, "0");
      actualizado.ejemplo = `${actualizado.prefijo || ""}${numero}`;
      return actualizado;
    }));
  }

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      const payload = rows.map(r => ({
        tipo_documento: r.tipo_documento,
        prefijo: r.prefijo,
        proximo_numero: Number(r.proximo_numero) || 1,
      }));
      const r = await updateDocumentosConfig(payload);
      setRows(r.data || []);
      setMsg({ tipo: "ok", texto: "Configuración guardada correctamente" });
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo guardar la configuración" });
    } finally {
      setGuardando(false);
    }
  }

  if (loading) return <p className="text-center text-sm text-gray-400 py-16">Cargando...</p>;

  return (
    <div className="max-w-3xl">
      <div className="flex justify-end mb-3">
        <button onClick={() => setMostrarNuevo(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-xl">
          <HiPlus className="text-base" /> Nuevo Documento
        </button>
      </div>

      <div className="overflow-x-auto bg-white rounded-xl border border-gray-100 mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
              <th className="py-3 px-4">Tipo</th>
              <th className="py-3 px-4">Prefijo</th>
              <th className="py-3 px-4">Próximo N°</th>
              <th className="py-3 px-4">Ejemplo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.tipo_documento} className="border-b border-gray-50">
                <td className="py-2.5 px-4 text-gray-700 font-medium">{r.label}</td>
                <td className="py-2.5 px-4">
                  <input value={r.prefijo} onChange={e => set(r.tipo_documento, "prefijo", e.target.value)}
                    className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </td>
                <td className="py-2.5 px-4">
                  <input type="number" min="1" value={r.proximo_numero} onChange={e => set(r.tipo_documento, "proximo_numero", e.target.value)}
                    className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </td>
                <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{r.ejemplo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5 text-sm text-yellow-800 mb-4">
        <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Cambiar estos valores puede afectar la numeración de tus documentos.</span>
      </div>

      {msg && <p className={`text-sm mb-3 ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>}

      <button onClick={guardar} disabled={guardando}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60">
        {guardando ? "Guardando..." : "Guardar configuración"}
      </button>

      {mostrarNuevo && (
        <NuevoDocumentoModal
          onClose={() => setMostrarNuevo(false)}
          onCreated={(data) => { setRows(data); setMostrarNuevo(false); }}
        />
      )}
    </div>
  );
}
