import React, { useEffect, useState } from "react";
import { HiX, HiDownload, HiExclamationCircle } from "react-icons/hi";
import { generarReporte } from "../../api/reportesApi";
import { getCuentasBancarias } from "../../api/comercialApi";

const PERIODOS = [
  { key: "mes",           label: "Este mes" },
  { key: "mes_anterior",  label: "Mes anterior" },
  { key: "trimestre",     label: "Este trimestre" },
  { key: "año",           label: "Este año" },
  { key: "personalizado", label: "Personalizado" },
];

const CATEGORIAS_GASTO = [
  "Alquiler de oficina", "Alquiler de almacén", "Mano de obra",
  "Transporte", "Suministros", "Materia prima", "Alquiler de andamios",
  "Servicios básicos", "Seguros", "Gastos administrativos", "Gastos de ventas",
  "Gastos Bancarios", "Maquinaria y Equipos", "Vehículos",
  "Mobiliario y Equipo de Oficina", "Mejoras a Local", "Otros Activos", "Otros",
];
const AREAS_GASTO             = ["Administrativa", "Operativa", "Ventas", "Activos"];
const TIPOS_COMPROBANTE_GASTO = ["Factura", "Recibo de Servicios Públicos", "Recibo Interno", "Gastos Bancarios", "Anticipo de Proveedor"];
const TIPOS_DOC_VENTA         = ["Factura", "Boleta de Venta", "Nota de Crédito", "Nota de Débito", "Anticipo de Cliente"];
const ESTADOS_COBRANZA        = ["Al día", "Vencido", "Pagado"];
const ESTADOS_PAGO            = ["Pendiente", "Pago Parcial", "Pagado"];

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function PanelReporte({ reporte, onClose, onGenerado }) {
  const [periodo, setPeriodo]   = useState("mes");
  const [desde, setDesde]       = useState("");
  const [hasta, setHasta]       = useState("");
  const [formato, setFormato]   = useState("xlsx");
  const [filtros, setFiltros]   = useState({});
  const [cuentas, setCuentas]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (reporte.key === "flujo_caja") {
      getCuentasBancarias().then(setCuentas).catch(() => setCuentas([]));
    }
  }, [reporte.key]);

  function setFiltro(campo, valor) {
    setFiltros(f => ({ ...f, [campo]: valor }));
  }

  async function handleGenerar() {
    if (periodo === "personalizado" && (!desde || !hasta)) {
      setError("Selecciona las fechas Desde y Hasta.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const params = { periodo, formato };
      if (periodo === "personalizado") { params.desde = desde; params.hasta = hasta; }
      Object.entries(filtros).forEach(([k, v]) => { if (v) params[k] = v; });

      const blob = await generarReporte(reporte.key, params);
      const ext = formato === "pdf" ? "pdf" : "xlsx";
      downloadBlob(blob, `Reporte_${reporte.titulo.replace(/\s+/g, "_")}_${hoyISO()}.${ext}`);
      onGenerado?.();
      onClose();
    } catch (e) {
      setError("No se pudo generar el reporte. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none">{reporte.icono}</span>
            <div>
              <h2 className="text-base font-bold text-gray-800">{reporte.titulo}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{reporte.descripcion}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0">
            <HiX className="text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Período */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Período</p>
            <div className="grid grid-cols-2 gap-2">
              {PERIODOS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPeriodo(p.key)}
                  className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    periodo === p.key
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {periodo === "personalizado" && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Desde</label>
                  <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Hasta</label>
                  <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
            )}
          </div>

          {/* Formato */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Formato de salida</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setFormato("xlsx")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  formato === "xlsx" ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                📊 Excel (.xlsx)
              </button>
              <button
                onClick={() => setFormato("pdf")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  formato === "pdf" ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                📄 PDF
              </button>
            </div>
          </div>

          {/* Filtros específicos */}
          {reporte.key !== "general" && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Filtros</p>
              <div className="space-y-3">

                {reporte.key === "ventas" && (
                  <>
                    <Campo label="Cliente">
                      <input type="text" placeholder="Buscar por cliente..." value={filtros.cliente || ""}
                        onChange={e => setFiltro("cliente", e.target.value)} className={inputCls} />
                    </Campo>
                    <Campo label="Tipo de Servicio">
                      <input type="text" placeholder="Ej. Alquiler de andamios" value={filtros.tipo_servicio || ""}
                        onChange={e => setFiltro("tipo_servicio", e.target.value)} className={inputCls} />
                    </Campo>
                    <Campo label="Tipo de Comprobante">
                      <select value={filtros.tipo_documento || ""} onChange={e => setFiltro("tipo_documento", e.target.value)} className={inputCls}>
                        <option value="">Todos</option>
                        {TIPOS_DOC_VENTA.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Campo>
                  </>
                )}

                {reporte.key === "gastos" && (
                  <>
                    <Campo label="Categoría">
                      <select value={filtros.categoria || ""} onChange={e => setFiltro("categoria", e.target.value)} className={inputCls}>
                        <option value="">Todas</option>
                        {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Área">
                      <select value={filtros.area || ""} onChange={e => setFiltro("area", e.target.value)} className={inputCls}>
                        <option value="">Todas</option>
                        {AREAS_GASTO.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Tipo de Comprobante">
                      <select value={filtros.tipo_comprobante || ""} onChange={e => setFiltro("tipo_comprobante", e.target.value)} className={inputCls}>
                        <option value="">Todos</option>
                        {TIPOS_COMPROBANTE_GASTO.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Proveedor">
                      <input type="text" placeholder="Buscar por proveedor..." value={filtros.proveedor || ""}
                        onChange={e => setFiltro("proveedor", e.target.value)} className={inputCls} />
                    </Campo>
                  </>
                )}

                {reporte.key === "cobranza" && (
                  <>
                    <Campo label="Cliente">
                      <input type="text" placeholder="Buscar por cliente..." value={filtros.cliente || ""}
                        onChange={e => setFiltro("cliente", e.target.value)} className={inputCls} />
                    </Campo>
                    <Campo label="Estado">
                      <select value={filtros.estado || ""} onChange={e => setFiltro("estado", e.target.value)} className={inputCls}>
                        <option value="">Todos</option>
                        {ESTADOS_COBRANZA.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </Campo>
                  </>
                )}

                {reporte.key === "flujo_caja" && (
                  <Campo label="Cuenta Bancaria">
                    <select value={filtros.cuenta_bancaria_id || ""} onChange={e => setFiltro("cuenta_bancaria_id", e.target.value)} className={inputCls}>
                      <option value="">Todas</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.banco} — {c.numero_cuenta}</option>)}
                    </select>
                  </Campo>
                )}

                {reporte.key === "proveedores" && (
                  <>
                    <Campo label="Proveedor">
                      <input type="text" placeholder="Buscar por proveedor..." value={filtros.proveedor || ""}
                        onChange={e => setFiltro("proveedor", e.target.value)} className={inputCls} />
                    </Campo>
                    <Campo label="Estado de Pago">
                      <select value={filtros.estado_pago || ""} onChange={e => setFiltro("estado_pago", e.target.value)} className={inputCls}>
                        <option value="">Todos</option>
                        {ESTADOS_PAGO.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </Campo>
                  </>
                )}

              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Botón generar */}
        <div className="p-5 border-t border-gray-100">
          <button
            onClick={handleGenerar}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors disabled:opacity-60"
          >
            <HiDownload className="w-5 h-5" />
            {loading ? "Generando..." : "Generar y Descargar"}
          </button>
        </div>
      </div>
    </>
  );
}

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
