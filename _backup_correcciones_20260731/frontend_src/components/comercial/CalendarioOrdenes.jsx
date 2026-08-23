import React, { useState, useEffect, useMemo } from "react";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi";
import { getCalendarioOrdenes } from "../../api/comercialApi";
import { ESTADO_BAR } from "./ordenesCommon";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function toISODate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function CalendarioOrdenes({ onVerOrden }) {
  const hoy = new Date();
  const [mes, setMes]   = useState(hoy.getMonth());   // 0-11
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCalendarioOrdenes(mes + 1, anio)
      .then(r => setOrdenes(r.data || []))
      .catch(() => setOrdenes([]))
      .finally(() => setLoading(false));
  }, [mes, anio]);

  const irMesAnterior  = () => { if (mes === 0) { setMes(11); setAnio(a => a - 1); } else setMes(m => m - 1); };
  const irMesSiguiente = () => { if (mes === 11) { setMes(0); setAnio(a => a + 1); } else setMes(m => m + 1); };
  const irHoy = () => { setMes(hoy.getMonth()); setAnio(hoy.getFullYear()); };

  const celdas = useMemo(() => {
    const primerDia = new Date(anio, mes, 1);
    // Lunes=0 ... Domingo=6
    const offset = (primerDia.getDay() + 6) % 7;
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();

    const lista = [];
    for (let i = 0; i < offset; i++) lista.push(null);
    for (let d = 1; d <= diasEnMes; d++) lista.push(d);
    while (lista.length % 7 !== 0) lista.push(null);
    return lista;
  }, [mes, anio]);

  const ordenesDelDia = (d) => {
    if (!d) return [];
    const iso = toISODate(anio, mes, d);
    return ordenes.filter(o => {
      const ini = o.fecha_inicio;
      const fin = o.fecha_fin_estimada || o.fecha_inicio;
      return ini && iso >= ini && iso <= fin;
    });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      {/* Navegación */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-bold text-gray-800">{MESES[mes]} {anio}</h3>
        <div className="flex items-center gap-2">
          <button onClick={irHoy} className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
            Hoy
          </button>
          <button onClick={irMesAnterior} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <HiChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={irMesSiguiente} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <HiChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" /> Pendiente</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> En Proceso</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Completada</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /> Cancelada</span>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando calendario...</div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {DIAS.map(d => (
            <div key={d} className="text-xs font-semibold text-gray-400 uppercase text-center pb-1">{d}</div>
          ))}
          {celdas.map((d, i) => {
            const ords = ordenesDelDia(d);
            const esHoy = d && toISODate(anio, mes, d) === toISODate(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
            return (
              <div key={i}
                className={`min-h-[92px] rounded-lg border p-1.5 ${d ? "border-gray-100 bg-gray-50" : "border-transparent"} ${esHoy ? "ring-2 ring-blue-400" : ""}`}>
                {d && (
                  <>
                    <p className={`text-xs font-semibold mb-1 ${esHoy ? "text-blue-600" : "text-gray-500"}`}>{d}</p>
                    <div className="space-y-1">
                      {ords.slice(0, 3).map(o => (
                        <button key={o.id} onClick={() => onVerOrden(o.id)} title={`${o.numero_orden} · ${o.cliente_nombre || "—"}`}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium text-white truncate hover:opacity-80 transition-opacity ${ESTADO_BAR[o.estado] || "bg-gray-400"}`}>
                          {o.numero_orden}
                        </button>
                      ))}
                      {ords.length > 3 && (
                        <p className="text-[10px] text-gray-400 pl-1">+{ords.length - 3} más</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
