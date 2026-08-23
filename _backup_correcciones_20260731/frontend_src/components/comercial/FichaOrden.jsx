import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  HiX, HiClipboardList, HiPencil, HiPlus, HiLocationMarker, HiCalendar,
} from "react-icons/hi";
import { getOrden, getGastosDeOrden } from "../../api/comercialApi";
import { ESTADO_COLOR, ProgressBar, fmtS, fmtFecha } from "./ordenesCommon";

const ESTADO_COBRO_COLOR = {
  "Pagada":       "bg-green-100 text-green-700",
  "Pago Parcial": "bg-yellow-100 text-yellow-700",
  "Pendiente":    "bg-orange-100 text-orange-700",
};

function Field({ label, value, mono, span }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-sm ${mono ? "font-mono font-semibold text-blue-700" : "text-gray-800"}`}>{value || "—"}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-xs font-semibold text-gray-500 uppercase mb-3 tracking-wide">{children}</p>;
}

export default function FichaOrden({ ordenId, onClose, onEditar, onChanged }) {
  const navigate = useNavigate();
  const [orden, setOrden] = useState(null);
  const [gastos, setGastos] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    Promise.all([getOrden(ordenId), getGastosDeOrden(ordenId)])
      .then(([o, g]) => { if (vivo) { setOrden(o); setGastos(g); } })
      .catch(() => {})
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [ordenId]);

  const irARegistrarGasto = () => {
    navigate(`/gastos?orden_id=${ordenId}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <HiClipboardList className="text-blue-600 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800 font-mono">{orden?.numero_orden || "…"}</h2>
              {orden && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[orden.estado] || "bg-gray-100 text-gray-600"}`}>
                  {orden.estado}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {orden && (
              <button onClick={() => onEditar(orden)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                <HiPencil className="w-4 h-4" /> Editar
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <HiX className="text-lg" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-8 py-6 space-y-6">
          {loading || !orden ? (
            <div className="text-center py-16 text-gray-400 text-sm">Cargando ficha de la orden...</div>
          ) : (
            <>
              {/* Sección 1 — Información General */}
              <div>
                <SectionTitle>Información General</SectionTitle>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 bg-gray-50 rounded-xl p-5 border border-gray-100">
                  <Field label="N° Orden" value={orden.numero_orden} mono />
                  <Field label="Cliente" value={orden.cliente_nombre} />
                  <Field label="RUC" value={orden.cliente_ruc} mono />
                  <Field label="Tipo de Servicio" value={orden.tipo_servicio} />
                  <Field label="Dirección de Obra" value={orden.direccion_obra} span />
                  <Field label="Distrito" value={orden.distrito} />
                  <Field label="Estado" value={orden.estado} />
                  <div className="col-span-2 grid grid-cols-3 gap-4 pt-2 border-t border-gray-200 mt-1">
                    <div className="flex items-start gap-2">
                      <HiCalendar className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400 font-medium">Fecha Inicio</p>
                        <p className="text-sm text-gray-800">{fmtFecha(orden.fecha_inicio)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <HiCalendar className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400 font-medium">Fecha Fin Estimada</p>
                        <p className="text-sm text-gray-800">{fmtFecha(orden.fecha_fin_estimada)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <HiCalendar className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400 font-medium">Fecha Fin Real</p>
                        <p className="text-sm text-gray-800">{fmtFecha(orden.fecha_fin_real)}</p>
                      </div>
                    </div>
                  </div>
                  {orden.direccion_obra && (
                    <div className="col-span-2 flex items-center gap-1.5 text-xs text-gray-400">
                      <HiLocationMarker className="flex-shrink-0" />
                      <span>{orden.direccion_obra}{orden.distrito ? `, ${orden.distrito}` : ""}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Sección 2 — Financiero */}
              <div>
                <SectionTitle>Financiero</SectionTitle>
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Presupuesto</span>
                    <span className="font-semibold text-gray-800">
                      {fmtS(orden.presupuesto_soles)}
                      {orden.moneda === "USD" && (
                        <span className="text-xs font-normal text-orange-600 ml-2">
                          (US$ {Number(orden.presupuesto).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Costo Real Ejecutado</span>
                    <span className="font-semibold text-gray-800">{fmtS(orden.costo_real)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                    <span className="font-semibold text-gray-800">Variación</span>
                    <span className={`text-lg font-bold ${orden.variacion < 0 ? "text-red-600" : "text-green-700"}`}>
                      {orden.variacion < 0 ? "-" : ""}{fmtS(Math.abs(orden.variacion))}
                    </span>
                  </div>
                  {orden.comprobante && (
                    <div className="pt-3 border-t border-gray-200 flex items-center justify-between text-sm">
                      <div>
                        <span className="text-gray-600">Comprobante vinculado: </span>
                        <span className="font-mono font-semibold text-blue-700">{orden.comprobante.numero_documento}</span>
                      </div>
                      {orden.comprobante.estado_cobranza && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COBRO_COLOR[orden.comprobante.estado_cobranza] || "bg-gray-100 text-gray-600"}`}>
                          {orden.comprobante.estado_cobranza}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Sección 3 — Avance */}
              <div>
                <SectionTitle>Avance</SectionTitle>
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                  <ProgressBar value={orden.avance_porcentaje} estado={orden.estado} big />
                  {orden.observaciones && (
                    <p className="text-sm text-gray-600 mt-4 pt-4 border-t border-gray-200">{orden.observaciones}</p>
                  )}
                </div>
              </div>

              {/* Sección 4 — Gastos asociados */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <SectionTitle>Gastos Asociados</SectionTitle>
                  <button onClick={irARegistrarGasto}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <HiPlus className="w-3.5 h-3.5" /> Registrar Gasto
                  </button>
                </div>
                <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                  {!gastos || gastos.data.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Sin gastos registrados para esta orden</p>
                  ) : (
                    <>
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-100">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold">Fecha</th>
                            <th className="px-4 py-2 text-left font-semibold">Categoría</th>
                            <th className="px-4 py-2 text-left font-semibold">Proveedor</th>
                            <th className="px-4 py-2 text-right font-semibold">Monto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {gastos.data.map(g => (
                            <tr key={g.id}>
                              <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtFecha(g.fecha)}</td>
                              <td className="px-4 py-2 text-gray-700">{g.categoria}</td>
                              <td className="px-4 py-2 text-gray-600">{g.proveedor || "—"}</td>
                              <td className="px-4 py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(g.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-between items-center px-4 py-3 bg-gray-100 border-t border-gray-200">
                        <span className="text-sm font-semibold text-gray-700">Total Gastado</span>
                        <span className="text-sm font-bold text-gray-900">{fmtS(gastos.total_gastado)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end px-8 py-5 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
