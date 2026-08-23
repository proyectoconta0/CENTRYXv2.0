import React from "react";
import { HiExclamation } from "react-icons/hi";

// Modal de confirmación genérico, reutilizable en todo el sistema en vez de
// window.confirm(). Uso:
//   const [confirmar, setConfirmar] = useState(null); // null | dato a confirmar
//   <ConfirmDialog
//     open={!!confirmar}
//     title="Eliminar gasto"
//     message="Esta acción no se puede deshacer."
//     danger
//     confirmLabel="Eliminar"
//     onConfirm={async () => { await accion(confirmar); setConfirmar(null); }}
//     onCancel={() => setConfirmar(null)}
//   />
export default function ConfirmDialog({
  open,
  title = "Confirmar acción",
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start gap-3 mb-5">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              danger ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
            }`}
          >
            <HiExclamation className="text-xl" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-800">{title}</h3>
            {message && (
              <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{message}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
