import React from "react";
import { HiCheck } from "react-icons/hi";

const PASOS = [
  { n: 1, label: "Configurar" },
  { n: 2, label: "Importar"  },
  { n: 3, label: "Revisar"   },
];

export default function PasoStepper({ paso }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-6 py-4">
      <div className="flex items-center">
        {PASOS.map((p, i) => (
          <React.Fragment key={p.n}>
            <div className="flex flex-col items-center" style={{ minWidth: 72 }}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                paso > p.n
                  ? "bg-green-500 text-white"
                  : paso === p.n
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-400"
              }`}>
                {paso > p.n ? <HiCheck className="w-4 h-4" /> : p.n}
              </div>
              <span className={`text-xs mt-1.5 font-medium text-center ${
                paso === p.n
                  ? "text-blue-700"
                  : paso > p.n
                    ? "text-green-700"
                    : "text-gray-400"
              }`}>{p.label}</span>
            </div>
            {i < PASOS.length - 1 && (
              <div className={`flex-1 h-0.5 mb-5 mx-1 transition-colors ${
                paso > p.n ? "bg-green-400" : "bg-gray-200"
              }`} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
