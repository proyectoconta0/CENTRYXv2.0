import React, { useState, useEffect, useMemo, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import TarjetaKPI from "../components/indicadores/TarjetaKPI";
import TarjetaSimple from "../components/indicadores/TarjetaSimple";
import SeccionAlertas from "../components/indicadores/SeccionAlertas";
import GraficoEvolucion from "../components/indicadores/GraficoEvolucion";
import GraficoBarrasComparativo from "../components/indicadores/GraficoBarrasComparativo";
import GaugeIndicador from "../components/indicadores/GaugeIndicador";
import DetalleTarjetaModal from "../components/indicadores/DetalleTarjetaModal";
import {
  getIndicadoresResumen,
  getIndicadoresRentabilidad, getIndicadoresLiquidez, getIndicadoresCobranza,
  getIndicadoresGastos, getIndicadoresVentas, getIndicadoresEvolucion,
  getIndicadoresSaludGeneral, exportarIndicadores,
} from "../api/comercialApi";
import { HiDownload, HiExclamationCircle } from "react-icons/hi";

// ── Helpers de formato compartidos ────────────────────────────────────────────

function fmtS(n) {
  if (n == null) return null;
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(n) {
  if (n == null) return null;
  return `${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function fmtRatio(n) {
  if (n == null) return null;
  return `${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}
function fmtDias(n) {
  if (n == null) return null;
  return `${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} días`;
}
function fmtNum(n) {
  if (n == null) return null;
  return Number(n).toLocaleString("es-PE", { maximumFractionDigits: 0 });
}

// ══════════════════════════════════════════════════════════════════════════
// VISTA SIMPLE — pensada para un gerente sin conocimientos financieros
// ══════════════════════════════════════════════════════════════════════════

const BANNER_SIMPLE_STYLE = {
  verde:    { bg: "bg-green-50",  border: "border-green-300",  text: "text-green-800" },
  amarillo: { bg: "bg-yellow-50", border: "border-yellow-300", text: "text-yellow-800" },
  rojo:     { bg: "bg-red-50",    border: "border-red-300",    text: "text-red-800" },
};

function piePeriodo(kpi) {
  if (!kpi || kpi.direccion == null) return null;
  if (kpi.direccion === "igual") return { texto: "→ Igual que el período anterior", tipo: "neutral" };
  const flecha = kpi.direccion === "sube" ? "↑" : "↓";
  const palabra = kpi.direccion === "sube" ? "Más" : "Menos";
  const emoji = kpi.es_bueno ? "✅" : "⚠️";
  return { texto: `${flecha} ${palabra} que el período anterior ${emoji}`, tipo: kpi.es_bueno ? "verde" : "amarillo" };
}

function VistaSimple() {
  const [periodo, setPeriodo] = useState("mes");
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // "vendiste" | "gastaste" | "ganaste" | "te_deben" | "en_banco" | "debes_pagar" | null

  useEffect(() => {
    setLoading(true);
    getIndicadoresResumen(periodo)
      .then(setResumen)
      .catch(() => setResumen(null))
      .finally(() => setLoading(false));
  }, [periodo]);

  const periodoTxt = periodo === "año" ? "ESTE AÑO" : "ESTE MES";
  const bannerStyle = resumen ? (BANNER_SIMPLE_STYLE[resumen.estado_banner] || BANNER_SIMPLE_STYLE.verde) : BANNER_SIMPLE_STYLE.verde;

  return (
    <div>
      {/* Selector de período simple */}
      <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit mb-6">
        {[{ key: "mes", label: "Este mes" }, { key: "año", label: "Este año" }].map(p => (
          <button key={p.key} onClick={() => setPeriodo(p.key)}
            className={`px-5 py-2 text-sm font-semibold rounded-md transition-all ${periodo === p.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Banner de estado */}
      <div className={`rounded-2xl border p-6 mb-6 text-center ${bannerStyle.bg} ${bannerStyle.border}`}>
        <p className={`text-xl sm:text-2xl font-extrabold ${bannerStyle.text}`}>
          {loading ? "Calculando..." : resumen?.mensaje_banner || "Sin datos suficientes"}
        </p>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 text-sm py-16">Cargando tu resumen...</p>
      ) : !resumen ? (
        <p className="text-center text-gray-400 text-sm py-16">No se pudo cargar la información.</p>
      ) : (
        <>
          {/* Las 6 tarjetas principales */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mb-6">
            <TarjetaSimple
              icono="💰" titulo={`Vendiste ${periodoTxt}`}
              valor={fmtS(resumen.vendiste.valor)}
              descripcion="Lo que cobraste por tus servicios en este período."
              pie={piePeriodo(resumen.vendiste)}
              onClick={() => setModal("vendiste")}
            />
            <TarjetaSimple
              icono="💸" titulo={`Gastaste ${periodoTxt}`}
              valor={fmtS(resumen.gastaste.valor)}
              descripcion="Lo que pagaste en gastos en este período."
              pie={piePeriodo(resumen.gastaste)}
              onClick={() => setModal("gastaste")}
            />
            <TarjetaSimple
              icono="🎉" titulo={`Te Ganaste ${periodoTxt}`}
              valor={fmtS(resumen.ganaste.valor)}
              colorValor={resumen.ganaste.es_positivo ? "verde" : "rojo"}
              descripcion="Lo que te queda después de pagar todos tus gastos."
              pie={resumen.ganaste.es_positivo
                ? { texto: "🎉 ¡Estás ganando!", tipo: "verde" }
                : { texto: "⚠️ Estás perdiendo dinero este período", tipo: "rojo" }}
              onClick={() => setModal("ganaste")}
            />
            <TarjetaSimple
              icono="📋" titulo="Te Deben"
              valor={fmtS(resumen.te_deben.valor)}
              descripcion="Facturas que tus clientes aún no te han pagado."
              pie={resumen.te_deben.facturas_vencidas > 0
                ? { texto: `🟡 Tienes ${resumen.te_deben.facturas_vencidas} factura${resumen.te_deben.facturas_vencidas === 1 ? "" : "s"} vencida${resumen.te_deben.facturas_vencidas === 1 ? "" : "s"}`, tipo: "amarillo" }
                : { texto: "✅ No tienes facturas vencidas", tipo: "verde" }}
              onClick={() => setModal("te_deben")}
            />
            <TarjetaSimple
              icono="🏦" titulo="Tienes en el Banco"
              valor={fmtS(resumen.en_banco.valor)}
              colorValor={resumen.en_banco.suficiente ? "verde" : "rojo"}
              descripcion="El dinero disponible en tus cuentas."
              pie={resumen.en_banco.suficiente
                ? { texto: "✅ Te alcanza para tus gastos del mes", tipo: "verde" }
                : { texto: "⚠️ Menos que tus gastos mensuales", tipo: "rojo" }}
              onClick={() => setModal("en_banco")}
            />
            <TarjetaSimple
              icono="🧾" titulo="Debes Pagar"
              valor={fmtS(resumen.debes_pagar.valor)}
              descripcion="Gastos que tienes pendientes de pagar a tus proveedores."
              pie={resumen.debes_pagar.pagos_vencidos > 0
                ? { texto: `🔴 ${resumen.debes_pagar.pagos_vencidos} pago${resumen.debes_pagar.pagos_vencidos === 1 ? "" : "s"} vencido${resumen.debes_pagar.pagos_vencidos === 1 ? "" : "s"}`, tipo: "rojo" }
                : { texto: "✅ Estás al día", tipo: "verde" }}
              onClick={() => setModal("debes_pagar")}
            />
          </div>

          {/* Alertas */}
          <div className="mb-6">
            <SeccionAlertas alertas={resumen.alertas} />
          </div>

          {/* Consejo del período */}
          {resumen.consejo && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center">
              <p className="text-sm sm:text-base font-medium text-blue-800">{resumen.consejo}</p>
            </div>
          )}
        </>
      )}

      {modal && (
        <DetalleTarjetaModal tipo={modal} periodo={periodo} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VISTA AVANZADA — KPIs técnicos (rentabilidad, liquidez, cobranza, etc.)
// ══════════════════════════════════════════════════════════════════════════

const PERIODOS_AVANZADA = [
  { key: "mes",       label: "Mes Actual" },
  { key: "trimestre", label: "Trimestre" },
  { key: "anio",      label: "Año" },
];

const BANNER_STYLE = {
  verde:      { bg: "bg-green-50",  border: "border-green-300",  text: "text-green-800",  icon: "🟢" },
  amarillo:   { bg: "bg-yellow-50", border: "border-yellow-300", text: "text-yellow-800",  icon: "🟡" },
  rojo:       { bg: "bg-red-50",    border: "border-red-300",    text: "text-red-800",     icon: "🔴" },
  sin_datos:  { bg: "bg-gray-50",   border: "border-gray-300",   text: "text-gray-600",    icon: "⚪" },
};

function calcularRango(periodo) {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth();
  let desde;
  if (periodo === "mes") desde = new Date(y, m, 1);
  else if (periodo === "trimestre") desde = new Date(y, Math.floor(m / 3) * 3, 1);
  else desde = new Date(y, 0, 1);
  const fmt = d => d.toISOString().split("T")[0];
  return { desde: fmt(desde), hasta: fmt(hoy) };
}

function VistaAvanzada() {
  const [periodo, setPeriodo] = useState("mes");
  const { desde, hasta } = useMemo(() => calcularRango(periodo), [periodo]);

  const [rentabilidad, setRentabilidad] = useState(null);
  const [liquidez, setLiquidez]         = useState(null);
  const [cobranza, setCobranza]         = useState(null);
  const [gastos, setGastos]             = useState(null);
  const [ventas, setVentas]             = useState(null);
  const [salud, setSalud]               = useState(null);
  const [evolucion, setEvolucion]       = useState([]);
  const [loading, setLoading]           = useState(true);

  const [exportando, setExportando] = useState(false);
  const [exportError, setExportError] = useState("");

  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([
      getIndicadoresRentabilidad({ desde, hasta }),
      getIndicadoresLiquidez({ desde, hasta }),
      getIndicadoresCobranza({ desde, hasta }),
      getIndicadoresGastos({ desde, hasta }),
      getIndicadoresVentas({ desde, hasta }),
      getIndicadoresSaludGeneral({ desde, hasta }),
    ])
      .then(([rent, liq, cob, gas, ven, sal]) => {
        setRentabilidad(rent); setLiquidez(liq); setCobranza(cob);
        setGastos(gas); setVentas(ven); setSalud(sal);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { getIndicadoresEvolucion(6).then(r => setEvolucion(r.data || [])).catch(() => {}); }, []);

  const handleExportar = async () => {
    setExportando(true); setExportError("");
    try {
      const blob = await exportarIndicadores({ desde, hasta });
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url; a.setAttribute("download", `Indicadores_KPI_${fecha}.xlsx`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setExportError("No se pudo generar el archivo. Intente nuevamente.");
    } finally {
      setExportando(false);
    }
  };

  const bannerStyle = salud ? (BANNER_STYLE[salud.estado] || BANNER_STYLE.sin_datos) : BANNER_STYLE.sin_datos;

  return (
    <div>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1">
          {PERIODOS_AVANZADA.map(p => (
            <button key={p.key} onClick={() => setPeriodo(p.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${periodo === p.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={handleExportar} disabled={exportando}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 shadow-sm transition-colors disabled:opacity-60">
          <HiDownload className="w-4 h-4" /> {exportando ? "Generando..." : "Exportar Reporte KPI"}
        </button>
      </div>

      {exportError && (
        <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm mb-4">
          <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{exportError}</span>
        </div>
      )}

      {/* Banner de salud general */}
      <div className={`rounded-xl border p-5 mb-6 ${bannerStyle.bg} ${bannerStyle.border}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">{bannerStyle.icon}</span>
          <h2 className={`text-lg font-bold ${bannerStyle.text}`}>
            {loading ? "Calculando..." : salud?.titulo || "SIN DATOS SUFICIENTES"}
          </h2>
        </div>
        {!loading && salud?.alertas?.length > 0 && (
          <ul className="space-y-1 mt-2">
            {salud.alertas.map((a, i) => (
              <li key={i} className={`text-sm ${bannerStyle.text}`}>{a}</li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Rentabilidad ── */}
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Rentabilidad</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <TarjetaKPI titulo="Rentabilidad Neta" valor={fmtPct(rentabilidad?.rentabilidad_neta?.valor)}
          semaforo={rentabilidad?.rentabilidad_neta?.semaforo} variacionPct={rentabilidad?.rentabilidad_neta?.variacion_pct} />
        <TarjetaKPI titulo="Margen Bruto" valor={fmtPct(rentabilidad?.margen_bruto?.valor)}
          semaforo={rentabilidad?.margen_bruto?.semaforo} variacionPct={rentabilidad?.margen_bruto?.variacion_pct} />
        <TarjetaKPI titulo="Utilidad del Período" valor={fmtS(rentabilidad?.utilidad_periodo?.valor)}
          semaforo={rentabilidad?.utilidad_periodo?.semaforo} variacionPct={rentabilidad?.utilidad_periodo?.variacion_pct} />
      </div>

      {/* ── Liquidez ── */}
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Liquidez</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <TarjetaKPI titulo="Liquidez Corriente" valor={fmtRatio(liquidez?.liquidez_corriente?.valor)}
          semaforo={liquidez?.liquidez_corriente?.semaforo} sub="Activos / Pasivos corrientes" />
        <TarjetaKPI titulo="Días de Caja" valor={fmtDias(liquidez?.dias_caja?.valor)}
          semaforo={liquidez?.dias_caja?.semaforo} sub="Saldo bancario / gasto diario" />
        <TarjetaKPI titulo="Capital de Trabajo" valor={fmtS(liquidez?.capital_trabajo?.valor)}
          semaforo={liquidez?.capital_trabajo?.semaforo} sub="Activos - Pasivos corrientes" />
      </div>

      {/* ── Cobranza ── */}
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Cobranza</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <TarjetaKPI titulo="Rotación de Cartera" valor={fmtDias(cobranza?.rotacion_cartera_dias?.valor)}
          semaforo={cobranza?.rotacion_cartera_dias?.semaforo} invertido />
        <TarjetaKPI titulo="% Cartera Vencida" valor={fmtPct(cobranza?.cartera_vencida_pct?.valor)}
          semaforo={cobranza?.cartera_vencida_pct?.semaforo} invertido />
        <TarjetaKPI titulo="Índice de Cobranza" valor={fmtPct(cobranza?.indice_cobranza_pct?.valor)}
          semaforo={cobranza?.indice_cobranza_pct?.semaforo} variacionPct={cobranza?.indice_cobranza_pct?.variacion_pct} />
      </div>

      {/* ── Gastos ── */}
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Gastos</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <TarjetaKPI titulo="% Gastos sobre Ventas" valor={fmtPct(gastos?.gastos_sobre_ventas_pct?.valor)}
          semaforo={gastos?.gastos_sobre_ventas_pct?.semaforo} invertido />
        <TarjetaKPI titulo="Gasto Promedio Diario" valor={fmtS(gastos?.gasto_promedio_diario?.valor)}
          variacionPct={gastos?.gasto_promedio_diario?.variacion_pct} invertido />
        <TarjetaKPI titulo="Mayor Categoría de Gasto"
          valor={gastos?.mayor_categoria?.categoria || null}
          sub={gastos?.mayor_categoria ? `${fmtS(gastos.mayor_categoria.monto)} · ${gastos.mayor_categoria.porcentaje}% del total` : null} />
      </div>

      {/* ── Ventas ── */}
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Ventas</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <TarjetaKPI titulo="Ticket Promedio" valor={fmtS(ventas?.ticket_promedio?.valor)}
          variacionPct={ventas?.ticket_promedio?.variacion_pct} />
        <TarjetaKPI titulo="Clientes Activos" valor={fmtNum(ventas?.clientes_activos?.valor)}
          variacionPct={ventas?.clientes_activos?.variacion_pct} />
        <TarjetaKPI titulo="Venta por Cliente" valor={fmtS(ventas?.venta_por_cliente?.valor)}
          variacionPct={ventas?.venta_por_cliente?.variacion_pct} />
      </div>

      {/* ── Gráficos ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Evolución de KPIs (últimos 6 meses)</h3>
          {evolucion.length > 0 ? <GraficoEvolucion data={evolucion} /> : <p className="text-sm text-gray-400 text-center py-16">Sin datos suficientes</p>}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Ventas vs Gastos vs Utilidad</h3>
          {evolucion.length > 0 ? <GraficoBarrasComparativo data={evolucion} /> : <p className="text-sm text-gray-400 text-center py-16">Sin datos suficientes</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-700 mb-4">Medidores</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <GaugeIndicador
            titulo="Rentabilidad Neta"
            valor={rentabilidad?.rentabilidad_neta?.valor ?? null}
            min={0} max={100} sufijo="%"
            zonas={[{ desde: 0, hasta: 10, color: "rojo" }, { desde: 10, hasta: 20, color: "amarillo" }, { desde: 20, hasta: 100, color: "verde" }]}
          />
          <GaugeIndicador
            titulo="Liquidez Corriente"
            valor={liquidez?.liquidez_corriente?.valor ?? null}
            min={0} max={3} sufijo="x"
            zonas={[{ desde: 0, hasta: 1.0, color: "rojo" }, { desde: 1.0, hasta: 1.5, color: "amarillo" }, { desde: 1.5, hasta: 3, color: "verde" }]}
          />
          <GaugeIndicador
            titulo="Índice de Cobranza"
            valor={cobranza?.indice_cobranza_pct?.valor ?? null}
            min={0} max={100} sufijo="%"
            zonas={[{ desde: 0, hasta: 70, color: "rojo" }, { desde: 70, hasta: 90, color: "amarillo" }, { desde: 90, hasta: 100, color: "verde" }]}
          />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Página principal — Sidebar/Header + tabs
// ══════════════════════════════════════════════════════════════════════════

export default function Indicadores() {
  const [tab, setTab] = useState("simple"); // "simple" | "avanzada"

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Indicadores" />
        <main className="flex-1 overflow-y-auto p-6">

          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Indicadores</h1>
              <p className="text-sm text-gray-500 mt-0.5">Cómo va tu negocio, en simple</p>
            </div>
            <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1">
              {[{ key: "simple", label: "Vista Simple" }, { key: "avanzada", label: "Vista Avanzada" }].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${tab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === "simple" ? <VistaSimple /> : <VistaAvanzada />}

        </main>
      </div>
    </div>
  );
}
