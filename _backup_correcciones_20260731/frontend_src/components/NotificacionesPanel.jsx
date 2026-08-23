import React from "react";
import { useNavigate } from "react-router-dom";
import { HiExclamationCircle, HiClock, HiCreditCard, HiX } from "react-icons/hi";

const ICONO = {
  vencida:           { Icon: HiExclamationCircle, color: "text-red-500" },
  por_vencer:        { Icon: HiClock,             color: "text-amber-500" },
  gasto_por_vencer:  { Icon: HiCreditCard,         color: "text-orange-500" },
};

const RUTA_MODULO = { cobranza: "/cobranza", gastos: "/gastos" };

export default function NotificacionesPanel({ open, onClose, alertas, loading }) {
  const navigate = useNavigate();

  if (!open) return null;

  const irA = (alerta) => {
    onClose();
    navigate(RUTA_MODULO[alerta.modulo] || "/");
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-2 z-50 w-96 max-h-[28rem] flex flex-col bg-white border border-gray-200 rounded-xl shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-800">Notificaciones</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <HiX />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Cargando alertas…</p>
          ) : alertas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">✅ Todo al día, no tienes alertas pendientes</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {alertas.map((a, i) => {
                const { Icon, color } = ICONO[a.tipo] || { Icon: HiExclamationCircle, color: "text-gray-400" };
                return (
                  <li key={`${a.modulo}-${a.referencia_id}-${i}`}>
                    <button
                      onClick={() => irA(a)}
                      className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <Icon className={`text-lg flex-shrink-0 mt-0.5 ${color}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{a.titulo}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{a.descripcion}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {alertas.length > 0 && (
          <button
            onClick={() => { onClose(); navigate("/indicadores"); }}
            className="flex-shrink-0 w-full text-center text-sm font-medium text-blue-600 hover:bg-blue-50 px-4 py-3 border-t border-gray-100 transition-colors"
          >
            Ver todas
          </button>
        )}
      </div>
    </>
  );
}
