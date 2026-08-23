import React, { useState, useEffect, useCallback } from "react";
import { HiX, HiOfficeBuilding, HiPencil } from "react-icons/hi";
import {
  getProveedor, getHistorialComprasProveedor, getCuentasPorPagarProveedor,
} from "../../api/comercialApi";
import {
  ESTADO_COLOR, SEMAFORO_COLOR, SEMAFORO_LABEL, fmtS, fmtFecha,
} from "./proveedoresCommon";

function Field({ label, value, mono, span }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-sm ${mono ? "font-mono font-semibold text-blue-700" : "text-gray-800"}`}>{value || "—"}</p>
    </div>
  );
}

const TABS = [
  { key: "datos",     label: "Datos Generales" },
  { key: "historial", label: "Historial de Compras" },
  { key: "cxp",        label: "Cuentas por Pagar" },
];

export default function FichaProveedor({ proveedorId, onClose, onEditar }) {
  const [activeTab, setActiveTab] = useState("datos");
  const [proveedor, setProveedor] = useState(null);
  const [loading, setLoading]     = useState(true);

  const [historial, setHistorial] = useState(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");

  const [cxp, setCxp] = useState(null);
  const [loadingCxp, setLoadingCxp] = useState(false);

  useEffect(() => {
    setLoading(true);
    getProveedor(proveedorId).then(setProveedor).catch(() => {}).finally(() => setLoading(false));
  }, [proveedorId]);

  const cargarHistorial = useCallback(() => {
    setLoadingHist(true);
    getHistorialComprasProveedor(proveedorId, {
      fecha_desde: histDesde || undefined, fecha_hasta: histHasta || undefined,
    })
      .then(setHistorial)
      .catch(() => setHistorial({ total_comprado: 0, data: [] }))
      .finally(() => setLoadingHist(false));
  }, [proveedorId, histDesde, histHasta]);

  useEffect(() => {
    if (activeTab === "historial" && !historial) cargarHistorial();
  }, [activeTab, historial, cargarHistorial]);

  useEffect(() => {
    if (activeTab === "cxp" && !cxp) {
      setLoadingCxp(true);
      getCuentasPorPagarProveedor(proveedorId)
        .then(setCxp)
        .catch(() => setCxp({ total_deuda: 0, data: [] }))
        .finally(() => setLoadingCxp(false));
    }
  }, [activeTab, cxp, proveedorId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <HiOfficeBuilding className="text-blue-600 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">{proveedor?.razon_social || "…"}</h2>
              {proveedor && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[proveedor.estado] || "bg-gray-100 text-gray-600"}`}>
                  {proveedor.estado}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {proveedor && (
              <button onClick={() => onEditar(proveedor)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                <HiPencil className="w-4 h-4" /> Editar
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <HiX className="text-lg" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-8 pt-4 border-b border-gray-100 flex-shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-8 py-6">
          {loading || !proveedor ? (
            <div className="text-center py-16 text-gray-400 text-sm">Cargando ficha del proveedor...</div>
          ) : activeTab === "datos" ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <Field label={proveedor.tipo_documento || "Documento"} value={proveedor.numero_documento} mono />
                <Field label="Razón Social / Nombre" value={proveedor.razon_social} />
                <Field label="Dirección" value={proveedor.direccion} span />
                <Field label="Distrito" value={proveedor.distrito} />
                <Field label="Teléfono" value={proveedor.telefono} />
                <Field label="Email" value={proveedor.email} />
                <Field label="Contacto Principal" value={proveedor.contacto_principal} />
                <Field label="Cargo del Contacto" value={proveedor.cargo_contacto} />
                <Field label="Fecha de Registro" value={fmtFecha(proveedor.created_at)} />
                <Field label="Estado" value={proveedor.estado} />
                {proveedor.observaciones && <Field label="Observaciones" value={proveedor.observaciones} span />}
              </div>

              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-1">Total Comprado Histórico</p>
                  <p className="text-xl font-bold text-gray-800">{fmtS(proveedor.total_comprado)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-1">Deuda Pendiente Actual</p>
                  <p className={`text-xl font-bold ${proveedor.deuda_pendiente > 0 ? "text-red-600" : "text-gray-800"}`}>
                    {fmtS(proveedor.deuda_pendiente)}
                  </p>
                </div>
              </div>

              {/* Información de Auditoría */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Información de Auditoría</p>
                <div className="space-y-1 text-sm text-gray-600">
                  <p>👤 Creado por: <span className="font-medium text-gray-800">{proveedor.creado_por || "—"}</span></p>
                  <p>📅 Fecha creación: <span className="font-medium text-gray-800">{proveedor.creado_en || "—"}</span></p>
                  <p>📥 Método de creación: <span className="font-medium text-gray-800">{proveedor.metodo_creacion || "Manual"}</span></p>
                  {proveedor.modificado_por && (
                    <>
                      <p>👤 Modificado por: <span className="font-medium text-gray-800">{proveedor.modificado_por}</span></p>
                      <p>📅 Última modificación: <span className="font-medium text-gray-800">{proveedor.modificado_en}</span></p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "historial" ? (
            <div>
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Desde</label>
                  <input type="date" value={histDesde} onChange={e => setHistDesde(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Hasta</label>
                  <input type="date" value={histHasta} onChange={e => setHistHasta(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <button onClick={cargarHistorial}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                  Filtrar
                </button>
              </div>

              {loadingHist || !historial ? (
                <p className="text-sm text-gray-400 text-center py-10">Cargando historial...</p>
              ) : historial.data.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">Sin compras registradas en el período</p>
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Fecha</th>
                        <th className="px-4 py-2 text-left font-semibold">Categoría</th>
                        <th className="px-4 py-2 text-left font-semibold">Descripción</th>
                        <th className="px-4 py-2 text-left font-semibold">Tipo/N° Comprobante</th>
                        <th className="px-4 py-2 text-right font-semibold">Monto</th>
                        <th className="px-4 py-2 text-left font-semibold">Estado Pago</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {historial.data.map(h => (
                        <tr key={h.id}>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtFecha(h.fecha)}</td>
                          <td className="px-4 py-2 text-gray-700">{h.categoria}</td>
                          <td className="px-4 py-2 text-gray-600 max-w-[220px] truncate" title={h.descripcion}>{h.descripcion || "—"}</td>
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                            {h.tipo_comprobante || "—"}{h.numero_comprobante ? ` · ${h.numero_comprobante}` : ""}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(h.monto)}</td>
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{h.estado_pago}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-between items-center px-4 py-3 bg-gray-100 border-t border-gray-200">
                    <span className="text-sm font-semibold text-gray-700">Total Comprado en el Período</span>
                    <span className="text-sm font-bold text-gray-900">{fmtS(historial.total_comprado)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {loadingCxp || !cxp ? (
                <p className="text-sm text-gray-400 text-center py-10">Cargando cuentas por pagar...</p>
              ) : cxp.data.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">Sin deuda pendiente con este proveedor</p>
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Fecha</th>
                        <th className="px-4 py-2 text-left font-semibold">N° Comprobante</th>
                        <th className="px-4 py-2 text-right font-semibold">Monto</th>
                        <th className="px-4 py-2 text-right font-semibold">Saldo Pendiente</th>
                        <th className="px-4 py-2 text-left font-semibold">Vencimiento</th>
                        <th className="px-4 py-2 text-left font-semibold">Semáforo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {cxp.data.map(c => (
                        <tr key={c.id}>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtFecha(c.fecha)}</td>
                          <td className="px-4 py-2 font-mono text-gray-700 whitespace-nowrap">{c.numero_comprobante || "—"}</td>
                          <td className="px-4 py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.monto)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-red-600 whitespace-nowrap">{fmtS(c.saldo_pendiente)}</td>
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(c.fecha_vencimiento)}</td>
                          <td className="px-4 py-2">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${SEMAFORO_COLOR[c.semaforo] || "bg-gray-100 text-gray-500"}`}>
                              {SEMAFORO_LABEL[c.semaforo] || c.semaforo}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-between items-center px-4 py-3 bg-gray-100 border-t border-gray-200">
                    <span className="text-sm font-semibold text-gray-700">Total Deuda Pendiente</span>
                    <span className="text-sm font-bold text-red-600">{fmtS(cxp.total_deuda)}</span>
                  </div>
                </div>
              )}
            </div>
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
