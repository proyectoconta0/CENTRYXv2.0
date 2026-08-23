import React, { useState, useEffect } from "react";
import DetalleModal from "./DetalleModal";
import {
  getDetalleVentas, getDetalleGastos, getDetalleGanaste,
  getDetalleTeDeben, getDetalleEnBanco, getDetalleDebesPagar,
} from "../../api/comercialApi";

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function mesAnioLabel(periodo) {
  const hoy = new Date();
  return periodo === "año" ? `Año ${hoy.getFullYear()}` : `${MESES_ES[hoy.getMonth()]} ${hoy.getFullYear()}`;
}

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(`${d}T00:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ESTADO_COBRO_COLOR = {
  "Pendiente":    "bg-blue-100 text-blue-700",
  "Pago Parcial": "bg-yellow-100 text-yellow-700",
  "Pagada":       "bg-green-100 text-green-700",
};
function BadgeEstadoCobro({ estado }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ESTADO_COBRO_COLOR[estado] || "bg-gray-100 text-gray-600"}`}>
      {estado || "—"}
    </span>
  );
}

function BadgeVencimiento({ vencido, dias }) {
  if (!vencido) return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Por vencer</span>;
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      Vencido {dias}d
    </span>
  );
}

function BadgeMovimiento({ tipo }) {
  const esIngreso = tipo === "ingreso";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${esIngreso ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {esIngreso ? "Ingreso" : "Egreso"}
    </span>
  );
}

function TablaVacia({ children }) {
  return <p className="text-center text-sm text-gray-400 py-10">{children}</p>;
}

function Cargando() {
  return <p className="text-center text-sm text-gray-400 py-10">Cargando detalle...</p>;
}

// ── Contenidos por tipo de tarjeta ────────────────────────────────────────────

function TablaVentas({ filas }) {
  if (filas.length === 0) return <TablaVacia>No hay ventas registradas en este período.</TablaVacia>;
  const total = filas.reduce((s, f) => s + f.monto, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
            <th className="py-2 pr-3">Fecha</th>
            <th className="py-2 pr-3">N° Comprobante</th>
            <th className="py-2 pr-3">Cliente</th>
            <th className="py-2 pr-3 text-right">Monto</th>
            <th className="py-2 pr-3">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha)}</td>
              <td className="py-2 pr-3 font-mono text-xs text-gray-600">{f.numero_comprobante}</td>
              <td className="py-2 pr-3 text-gray-700">{f.cliente}</td>
              <td className="py-2 pr-3 text-right font-medium text-gray-800">{fmtS(f.monto)}</td>
              <td className="py-2 pr-3"><BadgeEstadoCobro estado={f.estado_cobranza} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-100 font-bold text-gray-800">
            <td className="py-2 pr-3" colSpan={3}>Total</td>
            <td className="py-2 pr-3 text-right">{fmtS(total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TablaGastos({ filas }) {
  if (filas.length === 0) return <TablaVacia>No hay gastos registrados en este período.</TablaVacia>;
  const total = filas.reduce((s, f) => s + f.monto, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
            <th className="py-2 pr-3">Fecha</th>
            <th className="py-2 pr-3">Comprobante</th>
            <th className="py-2 pr-3">Proveedor</th>
            <th className="py-2 pr-3 text-right">Monto</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha)}</td>
              <td className="py-2 pr-3 font-mono text-xs text-gray-600">{f.numero_comprobante}</td>
              <td className="py-2 pr-3 text-gray-700">{f.proveedor}</td>
              <td className="py-2 pr-3 text-right font-medium text-gray-800">{fmtS(f.monto)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-100 font-bold text-gray-800">
            <td className="py-2 pr-3" colSpan={3}>Total</td>
            <td className="py-2 pr-3 text-right">{fmtS(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ResumenGanaste({ data }) {
  if (!data) return <TablaVacia>Sin datos suficientes.</TablaVacia>;
  const esPositivo = data.utilidad >= 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between py-2 border-b border-gray-100">
        <span className="text-sm text-gray-600">Total vendido</span>
        <span className="text-sm font-semibold text-gray-800">{fmtS(data.ventas_total)}</span>
      </div>
      <div className="flex items-center justify-between py-2 border-b border-gray-100">
        <span className="text-sm text-gray-600">Total gastado</span>
        <span className="text-sm font-semibold text-gray-800">{fmtS(data.gastos_total)}</span>
      </div>
      <div className="flex items-center justify-between py-3 bg-gray-50 rounded-xl px-3">
        <span className="text-sm font-bold text-gray-700">Utilidad neta</span>
        <span className={`text-lg font-extrabold ${esPositivo ? "text-green-600" : "text-red-600"}`}>{fmtS(data.utilidad)}</span>
      </div>
      {data.margen_pct != null && (
        <p className="text-xs text-gray-400 text-center">Margen: {data.margen_pct.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de lo vendido</p>
      )}
    </div>
  );
}

function TablaTeDeben({ filas }) {
  if (filas.length === 0) return <TablaVacia>No tienes facturas pendientes de cobro.</TablaVacia>;
  const total = filas.reduce((s, f) => s + f.monto, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
            <th className="py-2 pr-3">Fecha Emisión</th>
            <th className="py-2 pr-3">Cliente</th>
            <th className="py-2 pr-3 text-right">Monto</th>
            <th className="py-2 pr-3">Vencimiento</th>
            <th className="py-2 pr-3">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha)}</td>
              <td className="py-2 pr-3 text-gray-700">{f.cliente}</td>
              <td className="py-2 pr-3 text-right font-medium text-gray-800">{fmtS(f.monto)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha_vencimiento)}</td>
              <td className="py-2 pr-3"><BadgeVencimiento vencido={f.vencida} dias={f.dias_vencido} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-100 font-bold text-gray-800">
            <td className="py-2 pr-3" colSpan={2}>Total</td>
            <td className="py-2 pr-3 text-right">{fmtS(total)}</td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TablaEnBanco({ filas }) {
  if (filas.length === 0) return <TablaVacia>Sin movimientos recientes.</TablaVacia>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
            <th className="py-2 pr-3">Fecha</th>
            <th className="py-2 pr-3">Tipo</th>
            <th className="py-2 pr-3">Concepto</th>
            <th className="py-2 pr-3 text-right">Monto</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha)}</td>
              <td className="py-2 pr-3"><BadgeMovimiento tipo={f.tipo} /></td>
              <td className="py-2 pr-3 text-gray-700">{f.concepto}</td>
              <td className={`py-2 pr-3 text-right font-medium ${f.tipo === "ingreso" ? "text-green-600" : "text-red-600"}`}>
                {f.tipo === "ingreso" ? "+" : "-"}{fmtS(f.monto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaDebesPagar({ filas }) {
  if (filas.length === 0) return <TablaVacia>No tienes gastos pendientes de pago.</TablaVacia>;
  const total = filas.reduce((s, f) => s + f.monto, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
            <th className="py-2 pr-3">Fecha</th>
            <th className="py-2 pr-3">Proveedor</th>
            <th className="py-2 pr-3 text-right">Monto</th>
            <th className="py-2 pr-3">Vencimiento</th>
            <th className="py-2 pr-3">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha)}</td>
              <td className="py-2 pr-3 text-gray-700">{f.proveedor}</td>
              <td className="py-2 pr-3 text-right font-medium text-gray-800">{fmtS(f.monto)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtFecha(f.fecha_vencimiento)}</td>
              <td className="py-2 pr-3"><BadgeVencimiento vencido={f.vencido} dias={f.dias_vencido} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-100 font-bold text-gray-800">
            <td className="py-2 pr-3" colSpan={2}>Total</td>
            <td className="py-2 pr-3 text-right">{fmtS(total)}</td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const CONFIG = {
  vendiste:    { titulo: p => `Detalle de Ventas — ${mesAnioLabel(p)}`,   fetch: getDetalleVentas },
  gastaste:    { titulo: p => `Detalle de Gastos — ${mesAnioLabel(p)}`,   fetch: getDetalleGastos },
  ganaste:     { titulo: p => `Detalle de Utilidad — ${mesAnioLabel(p)}`, fetch: getDetalleGanaste },
  te_deben:    { titulo: () => "Detalle de Cuentas por Cobrar",           fetch: getDetalleTeDeben, subtitulo: "Facturas y boletas pendientes de cobro" },
  en_banco:    { titulo: () => "Últimos Movimientos de Banco",           fetch: getDetalleEnBanco, subtitulo: "Cobros y pagos más recientes" },
  debes_pagar: { titulo: () => "Detalle de Cuentas por Pagar",           fetch: getDetalleDebesPagar, subtitulo: "Gastos pendientes de pago a proveedores" },
};

/**
 * Modal de detalle al hacer clic en una tarjeta KPI del Módulo 9 - Vista Simple.
 * tipo: "vendiste" | "gastaste" | "ganaste" | "te_deben" | "en_banco" | "debes_pagar"
 */
export default function DetalleTarjetaModal({ tipo, periodo, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const cfg = CONFIG[tipo];

  useEffect(() => {
    setLoading(true);
    cfg.fetch(periodo)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, periodo]);

  if (!cfg) return null;

  return (
    <DetalleModal titulo={cfg.titulo(periodo)} subtitulo={cfg.subtitulo} onClose={onClose}>
      {loading ? <Cargando /> : (
        <>
          {tipo === "vendiste" && <TablaVentas filas={data?.data || []} />}
          {tipo === "gastaste" && <TablaGastos filas={data?.data || []} />}
          {tipo === "ganaste" && <ResumenGanaste data={data} />}
          {tipo === "te_deben" && <TablaTeDeben filas={data?.data || []} />}
          {tipo === "en_banco" && <TablaEnBanco filas={data?.data || []} />}
          {tipo === "debes_pagar" && <TablaDebesPagar filas={data?.data || []} />}
        </>
      )}
    </DetalleModal>
  );
}
