import React from "react";
import {
  HiTrendingUp, HiScale, HiRefresh, HiCheckCircle, HiUserGroup,
} from "react-icons/hi";

const INDICADORES = [
  {
    key: "rentabilidad_neta",
    label: "Rentabilidad Neta",
    icon: HiTrendingUp,
    color: "green",
    suffix: "%",
    desc: "Margen neto del mes",
  },
  {
    key: "liquidez_corriente",
    label: "Liquidez Corriente",
    icon: HiScale,
    color: "blue",
    suffix: "x",
    desc: "Activo / Pasivo corriente",
  },
  {
    key: "rotacion_cartera",
    label: "Rotación de Cartera",
    icon: HiRefresh,
    color: "orange",
    suffix: " días",
    desc: "Días promedio de cobro",
  },
  {
    key: "cumplimiento_ventas",
    label: "Cumplimiento Ventas",
    icon: HiCheckCircle,
    color: "purple",
    suffix: "%",
    desc: "Vs. meta del período",
  },
  {
    key: "productividad_personal",
    label: "Productividad Personal",
    icon: HiUserGroup,
    color: "indigo",
    suffix: "",
    prefix: "S/ ",
    desc: "Ventas por empleado",
  },
];

const COLOR_MAP = {
  green:  { bg: "bg-green-50",  text: "text-green-600",  bar: "bg-green-500" },
  blue:   { bg: "bg-blue-50",   text: "text-blue-600",   bar: "bg-blue-500" },
  orange: { bg: "bg-orange-50", text: "text-orange-600", bar: "bg-orange-500" },
  purple: { bg: "bg-purple-50", text: "text-purple-600", bar: "bg-purple-500" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-600", bar: "bg-indigo-500" },
};

export default function IndicadoresKPI({ data }) {
  if (!data) return null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Indicadores Financieros Clave</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {INDICADORES.map(({ key, label, icon: Icon, color, suffix, prefix, desc }) => {
          const c = COLOR_MAP[color];
          const val = data[key] ?? 0;
          const esMonto = prefix === "S/ ";
          const valFmt = typeof val === "number"
            ? val.toLocaleString("es-PE", esMonto
                ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                : undefined)
            : val;
          const display = `${prefix ?? ""}${valFmt}${suffix}`;
          return (
            <div key={key} className={`${c.bg} rounded-xl p-4 text-center`}>
              <div className={`flex justify-center mb-2`}>
                <Icon className={`text-2xl ${c.text}`} />
              </div>
              <p className={`text-2xl font-bold ${c.text}`}>{display}</p>
              <p className="text-xs font-semibold text-gray-700 mt-1">{label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
