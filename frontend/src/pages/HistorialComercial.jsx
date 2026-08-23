import React, { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import IngresosPorServicioChart from "../charts/IngresosPorServicioChart";
import { getHistorialPorServicio, getResumenComercial, getClientes, getCotizaciones } from "../api/comercialApi";
import { HiTrendingUp, HiUsers, HiCurrencyDollar, HiChartBar } from "react-icons/hi";

function fmtK(n) { return `S/ ${(n||0).toLocaleString("es-PE")}`; }

export default function HistorialComercial() {
  const [historial, setHistorial] = useState({ data:[], servicio_top:null });
  const [resumen, setResumen]     = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [h, r] = await Promise.all([getHistorialPorServicio(), getResumenComercial()]);
        setHistorial(h); setResumen(r);
      } catch { }
      finally { setLoading(false); }
    })();
  }, []);

  const data = historial.data || [];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6 space-y-5">

          <div>
            <h1 className="text-xl font-semibold text-gray-800">Historial Comercial</h1>
            <p className="text-sm text-gray-500 mt-0.5">Ingresos por tipo de servicio — andamios</p>
          </div>

          {/* Tarjetas resumen */}
          {resumen && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label:"Servicio Top",        val: historial.servicio_top || "—",         icon: HiChartBar,      color:"blue" },
                { label:"Cliente Top",          val: resumen.cliente_top || "—",            icon: HiUsers,         color:"green" },
                { label:"Ticket Promedio",       val: fmtK(resumen.ticket_promedio),         icon: HiCurrencyDollar, color:"purple" },
                { label:"Clientes Activos",      val: resumen.total_clientes_activos,        icon: HiTrendingUp,    color:"orange" },
              ].map(({ label, val, icon: Icon, color }) => {
                const cmap = { blue:"bg-blue-50 text-blue-600", green:"bg-green-50 text-green-600", purple:"bg-purple-50 text-purple-600", orange:"bg-orange-50 text-orange-600" };
                return (
                  <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className={`inline-flex p-2 rounded-lg mb-3 ${cmap[color]}`}><Icon className="text-lg" /></div>
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className="text-base font-bold text-gray-800 leading-tight">{val}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Gráfico + tabla */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Gráfico barras horizontales */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Ingresos por Tipo de Servicio</h3>
              {loading ? (
                <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Cargando...</div>
              ) : (
                <div style={{ height: 300 }}>
                  <IngresosPorServicioChart data={data} />
                </div>
              )}
            </div>

            {/* Tabla detalle */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Resumen por Servicio</h3>
              {loading ? (
                <div className="text-center py-10 text-gray-400 text-sm">Cargando...</div>
              ) : (
                <div className="space-y-3">
                  {data.map((d, i) => {
                    const colors = ["bg-blue-500","bg-green-500","bg-amber-500","bg-indigo-500","bg-pink-500","bg-teal-500","bg-orange-500"];
                    return (
                      <div key={d.tipo_servicio}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm text-gray-700 font-medium">{d.tipo_servicio}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-800">{fmtK(d.monto)}</span>
                            <span className="text-xs text-gray-400 w-8 text-right">{d.porcentaje}%</span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={`h-2 rounded-full ${colors[i % colors.length]}`} style={{ width:`${d.porcentaje}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Tabla ticket promedio por servicio */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Análisis por Tipo de Servicio</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["Tipo de Servicio","Total Ingresos","% del Total","Posición"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={4} className="py-8 text-center text-gray-400 text-sm">Cargando...</td></tr>
                ) : data.map((d, i) => (
                  <tr key={d.tipo_servicio} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-700">{d.tipo_servicio}</td>
                    <td className="px-5 py-3 font-bold text-gray-800">{fmtK(d.monto)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-gray-100 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-blue-500" style={{ width:`${d.porcentaje}%` }} />
                        </div>
                        <span className="text-gray-600 text-xs">{d.porcentaje}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${i===0 ? "bg-yellow-100 text-yellow-700" : i===1 ? "bg-gray-100 text-gray-600" : i===2 ? "bg-orange-100 text-orange-700" : "bg-gray-50 text-gray-400"}`}>
                        #{i+1}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
