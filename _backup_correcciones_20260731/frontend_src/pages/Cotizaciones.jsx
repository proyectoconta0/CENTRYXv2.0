import React, { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FormCotizacion from "../components/comercial/FormCotizacion";
import {
  getCotizaciones, getClientes, deleteCotizacion,
  convertirVenta, getResumenComercial,
} from "../api/comercialApi";
import {
  HiPlus, HiExclamationCircle, HiClock, HiCheckCircle,
  HiXCircle, HiPencil, HiTrash, HiArrowRight, HiRefresh,
} from "react-icons/hi";

const ESTADO_CFG = {
  borrador:  { label:"Borrador",  cls:"bg-gray-100 text-gray-600" },
  enviada:   { label:"Enviada",   cls:"bg-blue-100 text-blue-700" },
  aprobada:  { label:"Aprobada",  cls:"bg-green-100 text-green-700" },
  rechazada: { label:"Rechazada", cls:"bg-red-100 text-red-600" },
};

function fmtFecha(d) { return d ? new Date(d).toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"}) : "—"; }
function fmtK(n) { return `S/ ${(n||0).toLocaleString("es-PE")}`; }

export default function Cotizaciones() {
  const [cotizaciones, setCotizaciones] = useState([]);
  const [clientes, setClientes]         = useState([]);
  const [resumen, setResumen]           = useState(null);
  const [filterEstado, setFilterEstado] = useState("todos");
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [editCot, setEditCot]           = useState(null);
  const [confirmDel, setConfirmDel]     = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [cots, cls, res] = await Promise.all([
        getCotizaciones({ estado: filterEstado }),
        getClientes({ per_page: 100 }),
        getResumenComercial(),
      ]);
      setCotizaciones(cots);
      setClientes(cls.data || []);
      setResumen(res);
    } catch { setCotizaciones([]); }
    finally { setLoading(false); }
  }, [filterEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleDelete = async (id) => {
    try { await deleteCotizacion(id); await cargar(); }
    catch { alert("Error al eliminar"); }
    finally { setConfirmDel(null); }
  };

  const handleConvertir = async (id) => {
    try { await convertirVenta(id); await cargar(); alert("Cotización convertida a venta exitosamente"); }
    catch (err) { alert(err.response?.data?.detail || "Error al convertir"); }
  };

  const porVencer = resumen?.por_vencer_detalle || [];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6 space-y-4">

          {/* Banner resumen */}
          {resumen && (
            <div className="bg-blue-600 text-white rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-blue-200 text-xs font-medium mb-1">COTIZACIONES PENDIENTES</p>
                <p className="text-2xl font-bold">{resumen.cotizaciones_pendientes} cotizaciones por <span className="text-blue-200">{fmtK(resumen.monto_cotizaciones_pendientes)}</span></p>
              </div>
              <div className="text-right">
                <p className="text-blue-200 text-xs mb-1">Ticket promedio</p>
                <p className="text-lg font-semibold">{fmtK(resumen.ticket_promedio)}</p>
              </div>
            </div>
          )}

          {/* Alertas por vencer */}
          {porVencer.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <HiClock className="text-amber-500 text-lg flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 mb-1.5">Cotizaciones por vencer en los próximos 7 días</p>
                  <div className="flex flex-wrap gap-2">
                    {porVencer.map(a => (
                      <span key={a.numero} className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 text-xs font-medium px-3 py-1 rounded-full">
                        <HiExclamationCircle className="text-amber-600" />
                        {a.numero} — {a.dias} día{a.dias !== 1 ? "s" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filtros + botón */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1">
              {["todos","borrador","enviada","aprobada","rechazada"].map(e => (
                <button key={e} onClick={() => setFilterEstado(e)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                    filterEstado===e ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}>
                  {e==="todos" ? "Todas" : ESTADO_CFG[e]?.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={cargar} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <HiRefresh />
              </button>
              <button onClick={() => { setEditCot(null); setShowForm(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                <HiPlus /> Nueva Cotización
              </button>
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["N° Cotización","Cliente","Tipo de Servicio","Monto","Emisión","Vencimiento","Estado","Acciones"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">Cargando...</td></tr>
                ) : cotizaciones.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">Sin cotizaciones</td></tr>
                ) : cotizaciones.map(cot => {
                  const ec = ESTADO_CFG[cot.estado] || { label: cot.estado, cls:"bg-gray-100 text-gray-600" };
                  const proche = cot.dias_para_vencer >= 0 && cot.dias_para_vencer <= 7;
                  return (
                    <tr key={cot.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-600">{cot.numero}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate">{cot.cliente_nombre}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{cot.tipo_servicio}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">{fmtK(cot.monto)}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtFecha(cot.fecha_emision)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={proche && cot.estado !== "rechazada" ? "text-amber-600 font-semibold" : "text-gray-500"}>
                          {fmtFecha(cot.fecha_vencimiento)}
                          {proche && cot.estado !== "rechazada" && <span className="ml-1 text-xs">({cot.dias_para_vencer}d)</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${ec.cls}`}>{ec.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {cot.estado === "aprobada" && !cot.venta_comercial_id && (
                            <button onClick={() => handleConvertir(cot.id)} title="Convertir a Venta"
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors whitespace-nowrap">
                              <HiArrowRight className="text-xs" /> Convertir
                            </button>
                          )}
                          {cot.venta_comercial_id && (
                            <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><HiCheckCircle />Vendida</span>
                          )}
                          <button onClick={() => { setEditCot(cot); setShowForm(true); }}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                            <HiPencil className="text-base" />
                          </button>
                          <button onClick={() => setConfirmDel(cot.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <HiTrash className="text-base" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>
      </div>

      {showForm && (
        <FormCotizacion cotizacion={editCot} clientes={clientes}
          onClose={() => { setShowForm(false); setEditCot(null); }}
          onSaved={() => { setShowForm(false); setEditCot(null); cargar(); }} />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center"><HiXCircle className="text-red-500 text-xl" /></div>
              <div><p className="font-semibold text-gray-800">Eliminar cotización</p><p className="text-sm text-gray-500">Esta acción no se puede deshacer.</p></div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={() => handleDelete(confirmDel)} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
