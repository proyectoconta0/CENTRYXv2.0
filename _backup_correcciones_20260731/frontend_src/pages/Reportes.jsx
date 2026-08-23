import React, { useCallback, useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import PanelReporte from "../components/reportes/PanelReporte";
import HistorialReportes from "../components/reportes/HistorialReportes";
import { getHistorialReportes } from "../api/reportesApi";

const REPORTES = [
  { key: "general",     icono: "📊", titulo: "Reporte General",       descripcion: "Resumen completo del negocio" },
  { key: "ventas",      icono: "💰", titulo: "Reporte de Ventas",     descripcion: "Comprobantes emitidos" },
  { key: "gastos",      icono: "💸", titulo: "Reporte de Gastos",     descripcion: "Todos los gastos del período" },
  { key: "cobranza",    icono: "📋", titulo: "Reporte de Cobranza",   descripcion: "Cuentas por cobrar y pagos" },
  { key: "flujo_caja",  icono: "🏦", titulo: "Reporte Flujo de Caja", descripcion: "Movimientos bancarios" },
  { key: "proveedores", icono: "🤝", titulo: "Reporte de Proveedores",descripcion: "Compras y deudas por proveedor" },
];

export default function Reportes() {
  const [reporteActivo, setReporteActivo] = useState(null);
  const [historial, setHistorial]         = useState([]);
  const [loadingHist, setLoadingHist]     = useState(true);

  const cargarHistorial = useCallback(() => {
    setLoadingHist(true);
    getHistorialReportes()
      .then(r => setHistorial(r.data || []))
      .catch(() => setHistorial([]))
      .finally(() => setLoadingHist(false));
  }, []);

  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Reportes" />
        <main className="flex-1 overflow-y-auto p-6">

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Reportes</h1>
            <p className="text-sm text-gray-500 mt-0.5">Genera y descarga reportes de tu negocio en Excel o PDF</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 mb-8">
            {REPORTES.map(r => (
              <button
                key={r.key}
                onClick={() => setReporteActivo(r)}
                className="text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-2 cursor-pointer transition-shadow hover:shadow-md hover:border-gray-200"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-3xl leading-none">{r.icono}</span>
                  <p className="text-sm font-bold text-gray-800">{r.titulo.toUpperCase()}</p>
                </div>
                <p className="text-sm text-gray-500 leading-snug">{r.descripcion}</p>
              </button>
            ))}
          </div>

          <HistorialReportes historial={historial} loading={loadingHist} />

        </main>
      </div>

      {reporteActivo && (
        <PanelReporte
          reporte={reporteActivo}
          onClose={() => setReporteActivo(null)}
          onGenerado={cargarHistorial}
        />
      )}
    </div>
  );
}
