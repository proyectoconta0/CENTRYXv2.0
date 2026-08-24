import React, { useState, useEffect } from "react";
import { HiDownload, HiClipboardList, HiLockClosed, HiExclamationCircle } from "react-icons/hi";
import { getEmpresa, updateEmpresa, exportarData, resetearOnboarding } from "../../api/configuracionApi";
import LogAuditoria from "./LogAuditoria";
import Toast from "../Toast";

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function SistemaTab() {
  const [tiempoSesion, setTiempoSesion] = useState(8);
  const [guardandoSesion, setGuardandoSesion] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [confirmReset, setConfirmReset] = useState(0); // 0=inicial, 1=primera confirmación
  const [reseteando, setReseteando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [mostrarLog, setMostrarLog] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    getEmpresa().then(e => setTiempoSesion(e.tiempo_sesion_horas || 8)).catch(() => {});
  }, []);

  async function handleExportar() {
    setExportando(true);
    try {
      const blob = await exportarData();
      downloadBlob(blob, `Backup_Centryx_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      setToast({ message: "No se pudo generar el backup", type: "error" });
    } finally {
      setExportando(false);
    }
  }

  async function handleGuardarSesion() {
    setGuardandoSesion(true);
    setMsg(null);
    try {
      await updateEmpresa({ tiempo_sesion_horas: Number(tiempoSesion) || 8 });
      setMsg({ tipo: "ok", texto: "Tiempo de sesión actualizado" });
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo actualizar" });
    } finally {
      setGuardandoSesion(false);
    }
  }

  async function handleResetear() {
    if (confirmReset === 0) { setConfirmReset(1); return; }
    setReseteando(true);
    try {
      await resetearOnboarding();
      setConfirmReset(2);
      window.dispatchEvent(new Event("onboarding-reset"));
      window.location.href = "/onboarding";
    } catch {
      setToast({ message: "No se pudo resetear el onboarding", type: "error" });
    } finally {
      setReseteando(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">

      {/* Datos */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Datos</h3>
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Exportar toda la data</p>
              <p className="text-xs text-gray-400">Backup completo de clientes, ventas, gastos, proveedores y usuarios en Excel</p>
            </div>
            <button onClick={handleExportar} disabled={exportando}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 flex-shrink-0">
              <HiDownload /> {exportando ? "Generando..." : "Exportar"}
            </button>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-gray-50">
            <div>
              <p className="text-sm font-medium text-gray-700">Ver log de actividad</p>
              <p className="text-xs text-gray-400">Historial de acciones de usuarios (auditoría)</p>
            </div>
            <button onClick={() => setMostrarLog(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex-shrink-0">
              <HiClipboardList /> {mostrarLog ? "Ocultar log" : "Ver log"}
            </button>
          </div>
        </div>
      </div>

      {/* Log de Actividad */}
      {mostrarLog && (
        <div>
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Log de Actividad</h3>
          <LogAuditoria onClose={() => setMostrarLog(false)} />
        </div>
      )}

      {/* Sesión */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Sesión</h3>
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Tiempo de sesión (horas)</p>
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="72" value={tiempoSesion} onChange={e => setTiempoSesion(e.target.value)}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={handleGuardarSesion} disabled={guardandoSesion}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-60">
                {guardandoSesion ? "..." : "Guardar"}
              </button>
            </div>
          </div>
          {msg && <p className={`text-xs ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>}
          <div className="flex items-center justify-between pt-3 border-t border-gray-50">
            <div>
              <p className="text-sm font-medium text-gray-700">Cerrar todas las sesiones activas</p>
              <p className="text-xs text-gray-400">Requiere revocación de tokens — próximamente</p>
            </div>
            <button disabled title="Próximamente"
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed flex-shrink-0">
              <HiLockClosed /> Cerrar sesiones
            </button>
          </div>
        </div>
      </div>

      {/* Peligroso */}
      <div>
        <h3 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3">Zona de Peligro</h3>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-red-800">Resetear Onboarding</p>
              <p className="text-xs text-red-500">Vuelve a mostrar el wizard de bienvenida en el próximo ingreso.</p>
            </div>
            {confirmReset === 2 ? (
              <span className="text-sm font-medium text-green-700">✅ Onboarding reseteado</span>
            ) : confirmReset === 1 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-700 flex items-center gap-1"><HiExclamationCircle /> ¿Confirmas?</span>
                <button onClick={() => setConfirmReset(0)} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg">Cancelar</button>
                <button onClick={handleResetear} disabled={reseteando} className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">
                  {reseteando ? "..." : "Sí, resetear"}
                </button>
              </div>
            ) : (
              <button onClick={handleResetear} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg flex-shrink-0">
                Resetear Onboarding
              </button>
            )}
          </div>
        </div>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
