import React, { useEffect, useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import KPICard from "../components/KPICard";
import TopClientes from "../components/TopClientes";
import ProyectosEjecucion from "../components/ProyectosEjecucion";
import IndicadoresKPI from "../components/IndicadoresKPI";
import VentasEvolucionChart from "../charts/VentasEvolucionChart";
import FlujoCajaChart from "../charts/FlujoCajaChart";
import CobranzaDonutChart from "../charts/CobranzaDonutChart";
import GastosDonutChart from "../charts/GastosDonutChart";
import {
  HiCurrencyDollar, HiTrendingUp, HiCreditCard,
  HiCollection, HiCash,
} from "react-icons/hi";
import {
  getKpis, getVentasEvolucion, getFlujoCaja, getTopClientes,
  getCobranzaEstado, getGastosCategoria, getProyectosEjecucion, getIndicadoresKpi,
} from "../api/dashboardApi";

// Fallback data por si el backend no está corriendo
const FALLBACK = {
  kpis: {
    ventas_mes: 150000, ventas_variacion: 18.5,
    utilidad_estimada: 60000, utilidad_variacion: 20.3,
    gastos_mes: 90000, gastos_variacion: -8.7,
    cuentas_cobrar: 35000, cobrar_variacion: 15.2,
    flujo_caja: 25000,
  },
  ventas: {
    mensual: [
      { periodo: "Ene", monto: 95000 }, { periodo: "Feb", monto: 108000 },
      { periodo: "Mar", monto: 118000 }, { periodo: "Abr", monto: 128000 },
      { periodo: "May", monto: 142000 }, { periodo: "Jun", monto: 150000 },
    ],
    semanal: [
      { periodo: "Sem 1", monto: 32000 }, { periodo: "Sem 2", monto: 36000 },
      { periodo: "Sem 3", monto: 40000 }, { periodo: "Sem 4", monto: 42000 },
    ],
    diario: [
      { periodo: "06/06", monto: 8500 }, { periodo: "07/06", monto: 6200 },
      { periodo: "08/06", monto: 9100 }, { periodo: "09/06", monto: 7800 },
      { periodo: "10/06", monto: 10500 }, { periodo: "11/06", monto: 9800 },
      { periodo: "12/06", monto: 5200 },
    ],
  },
  flujo: [
    { mes: "Jun", anio: 2026, ingresos: 165000, egresos: 92000, saldo: 73000 },
    { mes: "Jul", anio: 2026, ingresos: 172000, egresos: 95000, saldo: 77000 },
    { mes: "Ago", anio: 2026, ingresos: 180000, egresos: 98000, saldo: 82000 },
    { mes: "Sep", anio: 2026, ingresos: 185000, egresos: 100000, saldo: 85000 },
    { mes: "Oct", anio: 2026, ingresos: 192000, egresos: 103000, saldo: 89000 },
    { mes: "Nov", anio: 2026, ingresos: 198000, egresos: 106000, saldo: 92000 },
  ],
  topClientes: [
    { nombre: "Los Portales SA",                 ventas: 45000, porcentaje: 30.0 },
    { nombre: "Constructora Cosapi SAC",          ventas: 38000, porcentaje: 25.3 },
    { nombre: "Hospital SJL (JE Const.)",         ventas: 30000, porcentaje: 20.0 },
    { nombre: "Inmobiliaria Paz Centenario SAC",  ventas: 25000, porcentaje: 16.7 },
    { nombre: "Menorca Inversiones SAC",          ventas: 12000, porcentaje: 8.0 },
  ],
  cobranza: {
    al_dia:    { monto: 132000, cantidad: 5, porcentaje: 56.2 },
    por_vencer:{ monto: 55500,  cantidad: 3, porcentaje: 23.6 },
    vencida:   { monto: 47000,  cantidad: 2, porcentaje: 20.2 },
  },
  gastos: [
    { categoria: "Personal",        monto: 39600, porcentaje: 44 },
    { categoria: "Administrativos", monto: 19800, porcentaje: 22 },
    { categoria: "Operativos",      monto: 18000, porcentaje: 20 },
    { categoria: "Ventas",          monto: 12600, porcentaje: 14 },
  ],
  proyectos: [
    { nombre: "Torre Residencial Miraflores – Inst. Eléctricas", cliente: "Los Portales SA",        presupuesto: 450000, ejecutado: 337500, avance_fisico: 75, avance_financiero: 75, estado: "activo" },
    { nombre: "Centro Empresarial San Isidro – Inst. Eléctricas", cliente: "Constructora Cosapi SAC",presupuesto: 620000, ejecutado: 372000, avance_fisico: 60, avance_financiero: 60, estado: "activo" },
    { nombre: "Residencial La Molina – Inst. Sanitarias",         cliente: "Paz Centenario SAC",    presupuesto: 280000, ejecutado: 126000, avance_fisico: 45, avance_financiero: 45, estado: "activo" },
    { nombre: "Hospital SJL – Sistema de Gas Centralizado",       cliente: "JE Construcciones SAC", presupuesto: 380000, ejecutado: 114000, avance_fisico: 30, avance_financiero: 30, estado: "activo" },
  ],
  indicadores: {
    rentabilidad_neta: 20.5, liquidez_corriente: 1.35,
    rotacion_cartera: 25, cumplimiento_ventas: 85.0, productividad_personal: 12500,
  },
};

function useFetch(fetchFn, fallback) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await fetchFn();
      setData(result);
    } catch {
      setError(true);
      setData(fallback);
    }
  }, [fetchFn, fallback]);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

export default function Dashboard() {
  // { periodo, desde, hasta } — actualizado por el Header cada vez que el
  // usuario cambia Hoy/Semana/Mes/Año o navega el selector de mes.
  const [rango, setRango] = useState(null);
  const rangoParams = rango
    ? {
        desde: rango.desde, hasta: rango.hasta,
        cliente_id: rango.cliente_id, tipo_servicio: rango.tipo_servicio,
      }
    : {};

  const fetchKpis        = useCallback(() => getKpis(rangoParams),            [rango]);
  const fetchVentas      = useCallback(() => getVentasEvolucion(rangoParams), [rango]);
  const fetchTopClientes = useCallback(() => getTopClientes(rangoParams),     [rango]);
  const fetchCobranza    = useCallback(() => getCobranzaEstado(rangoParams),  [rango]);
  const fetchGastosCat   = useCallback(() => getGastosCategoria(rangoParams), [rango]);
  const fetchIndicadores = useCallback(() => getIndicadoresKpi(rangoParams),  [rango]);

  const { data: kpis }       = useFetch(fetchKpis,                FALLBACK.kpis);
  const { data: ventas }     = useFetch(fetchVentas,              FALLBACK.ventas);
  const { data: flujo }      = useFetch(getFlujoCaja,            FALLBACK.flujo);
  const { data: topC }       = useFetch(fetchTopClientes,         FALLBACK.topClientes);
  const { data: cobranza }   = useFetch(fetchCobranza,            FALLBACK.cobranza);
  const { data: gastosCat }  = useFetch(fetchGastosCat,          FALLBACK.gastos);
  const { data: proyectos }  = useFetch(getProyectosEjecucion,   FALLBACK.proyectos);
  const { data: indicadores} = useFetch(fetchIndicadores,        FALLBACK.indicadores);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onFilterChange={setRango} />

        <main className="flex-1 overflow-y-auto bg-gray-50 p-6 space-y-6">

          {/* ── KPI Cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <KPICard
              title="Ventas del Mes"
              value={kpis?.ventas_mes}
              variacion={kpis?.ventas_variacion}
              icon={HiCurrencyDollar}
              color="blue"
              subtitle="vs. mes anterior"
            />
            <KPICard
              title="Utilidad Estimada"
              value={kpis?.utilidad_estimada}
              variacion={kpis?.utilidad_variacion}
              icon={HiTrendingUp}
              color="green"
              subtitle="margen ~40%"
            />
            <KPICard
              title="Gastos del Mes"
              value={kpis?.gastos_mes}
              variacion={kpis?.gastos_variacion}
              icon={HiCreditCard}
              color="orange"
              subtitle="vs. mes anterior"
            />
            <KPICard
              title="Cuentas por Cobrar"
              value={kpis?.cuentas_cobrar}
              variacion={kpis?.cobrar_variacion}
              icon={HiCollection}
              color="purple"
              subtitle="facturas pendientes"
            />
            <KPICard
              title="Flujo de Caja"
              value={kpis?.flujo_caja}
              icon={HiCash}
              color="blue"
              subtitle="saldo proyectado"
            />
          </div>

          {/* ── Fila central: Gráficos + Top Clientes ──────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 h-[250px] md:h-[320px]">
              <VentasEvolucionChart data={ventas} />
            </div>
            <div className="lg:col-span-1 h-[250px] md:h-[320px]">
              <FlujoCajaChart data={flujo} />
            </div>
            <div className="lg:col-span-1 h-[250px] md:h-[320px]">
              <TopClientes data={topC} />
            </div>
          </div>

          {/* ── Fila inferior: Donut × 2 + Proyectos ───────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="h-[250px] md:h-[340px]">
              <CobranzaDonutChart data={cobranza} />
            </div>
            <div className="h-[250px] md:h-[340px]">
              <GastosDonutChart data={gastosCat} />
            </div>
            <div className="h-[250px] md:h-[340px]">
              <ProyectosEjecucion data={proyectos} />
            </div>
          </div>

          {/* ── Indicadores Financieros ─────────────────────────── */}
          <IndicadoresKPI data={indicadores} />

        </main>
      </div>
    </div>
  );
}
