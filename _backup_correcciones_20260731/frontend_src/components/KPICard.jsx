import React from "react";
import { HiTrendingUp, HiTrendingDown } from "react-icons/hi";

function formatSoles(n) {
  return `S/ ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function KPICard({ title, value, variacion, icon: Icon, color = "blue", subtitle }) {
  const sube = variacion >= 0;
  const colorMap = {
    blue:   { bg: "bg-blue-50",   icon: "text-blue-500",   ring: "bg-blue-100" },
    green:  { bg: "bg-green-50",  icon: "text-green-500",  ring: "bg-green-100" },
    red:    { bg: "bg-red-50",    icon: "text-red-500",    ring: "bg-red-100" },
    orange: { bg: "bg-orange-50", icon: "text-orange-500", ring: "bg-orange-100" },
    purple: { bg: "bg-purple-50", icon: "text-purple-500", ring: "bg-purple-100" },
  };
  const c = colorMap[color] ?? colorMap.blue;

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${c.ring}`}>
          <Icon className={`text-xl ${c.icon}`} />
        </div>
        {variacion !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
            sube ? "text-green-600 bg-green-50" : "text-red-500 bg-red-50"
          }`}>
            {sube ? <HiTrendingUp className="text-sm" /> : <HiTrendingDown className="text-sm" />}
            {Math.abs(variacion)}%
          </div>
        )}
      </div>
      <p className="text-gray-500 text-xs font-medium mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{formatSoles(value)}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}
