import React, { useEffect } from "react";

const ESTILOS = {
  error: "bg-red-600",
  success: "bg-green-600",
  info: "bg-gray-800",
};

// Aviso flotante genérico, reutilizable en todo el sistema en vez de
// alert(). Uso:
//   const [toast, setToast] = useState(null); // null | { message, type }
//   <Toast toast={toast} onClose={() => setToast(null)} />
//   ...
//   setToast({ message: "El logo no debe superar 2 MB", type: "error" });
export default function Toast({ toast, onClose, duracionMs = 4000 }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, duracionMs);
    return () => clearTimeout(t);
  }, [toast, onClose, duracionMs]);

  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-6 right-6 z-[200] ${ESTILOS[toast.type] || ESTILOS.info} text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg max-w-sm flex items-start gap-3`}
    >
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose} className="text-white/70 hover:text-white leading-none">✕</button>
    </div>
  );
}
