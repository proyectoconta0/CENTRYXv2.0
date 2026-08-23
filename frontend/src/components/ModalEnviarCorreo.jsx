import React, { useState, useEffect } from "react";
import { HiMail, HiX, HiPaperClip, HiCheckCircle, HiXCircle, HiExclamation } from "react-icons/hi";
import { enviarComprobantePorCorreo } from "../api/comercialApi";
import { getEmpresa } from "../api/configuracionApi";

export default function ModalEnviarCorreo({ visible, onClose, comprobante, onEnviado }) {
  const [estado, setEstado]     = useState("form"); // 'form' | 'sending' | 'success' | 'error'
  const [correo, setCorreo]     = useState("");
  const [resultado, setResultado] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [nombreEmpresa, setNombreEmpresa] = useState("");

  useEffect(() => {
    if (visible) {
      setEstado("form");
      setCorreo(comprobante?.cliente_email || "");
      setResultado(null);
      setErrorMsg("");
      getEmpresa().then(e => setNombreEmpresa(e?.nombre_empresa || "")).catch(() => {});
    }
  }, [visible, comprobante]);

  if (!visible || !comprobante) return null;

  const numeroDoc      = comprobante.numero_documento || "—";
  const asunto          = `Comprobante de pago ${numeroDoc} – ${nombreEmpresa}`;
  const tieneAdjuntoOriginal = !!comprobante.tiene_comprobante;
  const nombreAdjunto = tieneAdjuntoOriginal
    ? (comprobante.comprobante_nombre || `${numeroDoc.replace(/\s+/g, "_").replace(/\//g, "-")}.pdf`)
    : `${numeroDoc.replace(/\s+/g, "_").replace(/\//g, "-")}.pdf`;

  const enviar = async () => {
    setEstado("sending");
    try {
      const res = await enviarComprobantePorCorreo(comprobante.id, correo);
      setResultado(res);
      setEstado("success");
      onEnviado?.(res);
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || "Ocurrió un error inesperado al enviar el correo");
      setEstado("error");
    }
  };

  const cerrar = () => {
    if (estado === "sending") return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={cerrar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <HiMail className="text-blue-600 text-lg" />
            </div>
            <h2 className="text-base font-semibold text-gray-800">Enviar comprobante</h2>
          </div>
          {estado !== "sending" && (
            <button onClick={cerrar} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <HiX className="text-lg" />
            </button>
          )}
        </div>

        {/* Contenido */}
        <div className="px-6 py-6">
          {estado === "form" && (
            <div className="space-y-5">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Asunto</p>
                  <p className="text-sm text-gray-600">{asunto}</p>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {tieneAdjuntoOriginal ? (
                    <>
                      <HiPaperClip className="text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-600 font-mono">Se adjuntará: {nombreAdjunto}</span>
                    </>
                  ) : (
                    <>
                      <HiExclamation className="text-amber-500 flex-shrink-0" />
                      <span className="text-sm text-amber-600">Este comprobante no tiene PDF adjunto. Se enviará un comprobante generado automáticamente.</span>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">Correo del cliente</label>
                <input
                  type="email"
                  required
                  value={correo}
                  onChange={e => setCorreo(e.target.value)}
                  placeholder="cliente@empresa.com"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm transition-shadow focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={cerrar} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={enviar}
                  disabled={!correo.trim()}
                  className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60"
                >
                  Enviar
                </button>
              </div>
            </div>
          )}

          {estado === "sending" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <span className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-sm text-gray-600 font-medium">Enviando...</p>
            </div>
          )}

          {estado === "success" && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <HiCheckCircle className="text-green-500 text-6xl" />
              <p className="text-base font-semibold text-gray-800 mt-2">Enviado correctamente</p>
              <p className="text-sm text-gray-600">Entregado a {resultado?.enviado_a}</p>
              <p className="text-xs text-gray-400">{resultado?.fecha_envio}</p>
              <button
                onClick={onClose}
                className="mt-5 px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Cerrar
              </button>
            </div>
          )}

          {estado === "error" && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <HiXCircle className="text-red-500 text-6xl" />
              <p className="text-base font-semibold text-gray-800 mt-2">No se pudo enviar el correo</p>
              <p className="text-sm text-gray-600">{errorMsg}</p>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setEstado("form")}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200">
                  Reintentar
                </button>
                <button onClick={onClose}
                  className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
