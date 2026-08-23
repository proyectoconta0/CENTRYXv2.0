import React, { useState, useRef } from "react";
import { HiDownload, HiUpload, HiTrash, HiExclamationCircle, HiCheckCircle } from "react-icons/hi";
import { exportarBackup, importarBackup, limpiarRegistros } from "../../api/configuracionApi";
import Toast from "../Toast";

const TEXTO_CONFIRMACION = "ELIMINAR_TODO";

// Etiquetas legibles para las claves del "resumen" que devuelve
// POST /backup/importar (ver backend/app/routers/configuracion.py).
const LABEL_RESUMEN = {
  clientes:       "Clientes",
  proveedores:    "Proveedores",
  ventas:         "Ventas",
  gastos:         "Gastos",
  pagos_cobranza: "Pagos de Cobranza",
  pagos_gastos:   "Pagos de Gastos",
  prestamos:      "Préstamos",
  cuotas_prestamo: "Cuotas de Préstamo",
  garantias:      "Garantías",
  flujo_caja:     "Flujo de Caja",
};

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Modal de confirmación con texto escrito — a diferencia de ConfirmDialog
// (genérico, botones Confirmar/Cancelar), esta acción requiere que el
// usuario escriba "ELIMINAR_TODO" para habilitar el botón, no solo un click.
function ModalConfirmarEliminar({ onConfirm, onCancel, eliminando }) {
  const [texto, setTexto] = useState("");
  const habilitado = texto === TEXTO_CONFIRMACION;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <HiExclamationCircle className="text-xl" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-800">⚠️ ¿Estás seguro?</h3>
            <p className="text-sm text-gray-500 mt-1">
              Esta acción eliminará TODOS los registros (ventas, cobros, gastos, clientes, proveedores,
              préstamos, garantías y flujo de caja). Esta acción es <strong>IRREVERSIBLE</strong>.
            </p>
          </div>
        </div>
        <label className="text-xs font-semibold text-gray-700 uppercase">
          Escribe {TEXTO_CONFIRMACION} para confirmar
        </label>
        <input type="text" value={texto} onChange={e => setTexto(e.target.value)} autoFocus
          placeholder={TEXTO_CONFIRMACION}
          className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500" />
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} disabled={eliminando}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={() => onConfirm(texto)} disabled={!habilitado || eliminando}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {eliminando ? "Eliminando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalResultadoImportacion({ resumen, onClose }) {
  const entradas = Object.entries(resumen || {});
  const total = entradas.reduce((acc, [, n]) => acc + (n || 0), 0);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <HiCheckCircle className="text-2xl text-green-600" />
          <h3 className="text-base font-bold text-gray-800">Backup importado exitosamente</h3>
        </div>
        {total === 0 ? (
          <p className="text-sm text-gray-500">No se importó ningún registro nuevo — todo lo del archivo ya existía en el sistema.</p>
        ) : (
          <div className="space-y-1.5">
            {entradas.map(([clave, cantidad]) => (
              <div key={clave} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{LABEL_RESUMEN[clave] || clave}</span>
                <span className="font-semibold text-gray-800">{cantidad} registros</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose}
          className="w-full mt-5 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
          Cerrar
        </button>
      </div>
    </div>
  );
}

export default function BackupTab() {
  const fileInputRef = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultadoImportacion, setResultadoImportacion] = useState(null); // resumen | null
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [toast, setToast] = useState(null);

  async function handleExportar() {
    setExportando(true);
    try {
      const blob = await exportarBackup();
      const fecha = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(0, 14);
      downloadBlob(blob, `centryx_backup_${fecha}.json`);
    } catch {
      setToast({ message: "No se pudo generar el backup", type: "error" });
    } finally {
      setExportando(false);
    }
  }

  function handleSeleccionarArchivo(e) {
    const f = e.target.files[0];
    if (f) setArchivo(f);
  }

  async function handleImportar() {
    if (!archivo) return;
    setImportando(true);
    try {
      const r = await importarBackup(archivo);
      setResultadoImportacion(r.resumen || {});
      setArchivo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const detalle = err?.response?.data?.detail;
      setToast({ message: detalle || "No se pudo importar el backup", type: "error" });
    } finally {
      setImportando(false);
    }
  }

  async function handleEliminarTodo(textoConfirmacion) {
    setEliminando(true);
    try {
      await limpiarRegistros(textoConfirmacion);
      setConfirmarEliminar(false);
      setToast({ message: "Todos los registros fueron eliminados correctamente", type: "success" });
    } catch (err) {
      const detalle = err?.response?.data?.detail;
      setToast({ message: detalle || "No se pudo completar la eliminación", type: "error" });
    } finally {
      setEliminando(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">

      <div>
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">💾 Gestión de Backup</h3>

        {/* Exportar */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm font-medium text-gray-700">📤 Exportar Backup</p>
          <p className="text-xs text-gray-400 mt-0.5">Descarga todos tus registros en un archivo JSON seguro.</p>
          <p className="text-xs text-gray-400 mt-1">
            Incluye: Ventas, Cobros, Gastos, Clientes, Proveedores, Préstamos, Garantías y Flujo de Caja
          </p>
          <button onClick={handleExportar} disabled={exportando}
            className="flex items-center gap-2 mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-60">
            <HiDownload /> {exportando ? "Generando…" : "Descargar Backup"}
          </button>
        </div>
      </div>

      {/* Importar */}
      <div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm font-medium text-gray-700">📂 Importar Backup</p>
          <p className="text-xs text-gray-400 mt-0.5">Restaura tus registros desde un archivo de backup anterior.</p>
          <p className="text-xs text-amber-600 mt-1">
            ⚠️ Solo se importan registros nuevos, no se sobrescriben los existentes.
          </p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <input ref={fileInputRef} type="file" accept=".json,application/json"
              onChange={handleSeleccionarArchivo}
              className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 file:text-sm file:font-medium hover:file:bg-gray-200" />
            <button onClick={handleImportar} disabled={!archivo || importando}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
              <HiUpload /> {importando ? "Importando…" : "Importar Backup"}
            </button>
          </div>
        </div>
      </div>

      {/* Zona de Peligro */}
      <div>
        <h3 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3">Zona de Peligro</h3>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800">🗑️ Eliminar Todos los Registros</p>
          <p className="text-xs text-red-500 mt-0.5">⚠️ Esta acción es IRREVERSIBLE</p>
          <p className="text-xs text-red-500 mt-1">
            Elimina todos los registros del sistema (ventas, cobros, gastos, clientes, proveedores, préstamos,
            garantías y flujo de caja). NO elimina usuarios ni configuración.
          </p>
          <button onClick={() => setConfirmarEliminar(true)}
            className="flex items-center gap-2 mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg">
            <HiTrash /> Eliminar Todos los Registros
          </button>
        </div>
      </div>

      {confirmarEliminar && (
        <ModalConfirmarEliminar
          eliminando={eliminando}
          onConfirm={handleEliminarTodo}
          onCancel={() => setConfirmarEliminar(false)}
        />
      )}

      {resultadoImportacion && (
        <ModalResultadoImportacion
          resumen={resultadoImportacion}
          onClose={() => setResultadoImportacion(null)}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
