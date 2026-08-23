import React, { useState } from "react";
import { HiDownload, HiClipboardList } from "react-icons/hi";
import { redescargarReporte } from "../../api/reportesApi";

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(`${d}T00:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

const FORMATO_BADGE = {
  xlsx: "bg-green-100 text-green-700",
  pdf:  "bg-red-100 text-red-700",
};

export default function HistorialReportes({ historial, loading }) {
  const [descargandoId, setDescargandoId] = useState(null);

  async function handleDescargar(reg) {
    setDescargandoId(reg.id);
    try {
      const blob = await redescargarReporte(reg.id);
      downloadBlob(blob, reg.archivo_nombre);
    } catch {
      alert("No se pudo descargar el reporte.");
    } finally {
      setDescargandoId(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">Últimos Reportes Generados</h3>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">Cargando historial...</p>
      ) : historial.length === 0 ? (
        <div className="text-center py-10">
          <HiClipboardList className="text-4xl mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">Aún no has generado ningún reporte.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Período</th>
                <th className="py-2 pr-3">Formato</th>
                <th className="py-2 pr-3 text-right">Descargar</th>
              </tr>
            </thead>
            <tbody>
              {historial.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(r.created_at)}</td>
                  <td className="py-2 pr-3 text-gray-700 font-medium">{r.tipo_label}</td>
                  <td className="py-2 pr-3 text-gray-600">{r.periodo_label}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full uppercase ${FORMATO_BADGE[r.formato] || "bg-gray-100 text-gray-600"}`}>
                      {r.formato}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      onClick={() => handleDescargar(r)}
                      disabled={descargandoId === r.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-60"
                    >
                      <HiDownload className="w-3.5 h-3.5" />
                      {descargandoId === r.id ? "Descargando..." : "Volver a descargar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
