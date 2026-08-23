import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getComprobanteImprimir } from "../api/comercialApi";
import { imprimirComprobante } from "../components/comercial/PlantillaComprobante";

// Ruta directa /imprimir/comprobante/:id — permite abrir la impresión de un
// comprobante en una pestaña propia (ej. desde el listado de Ventas) sin
// pasar por el modal de detalle. Reutiliza el mismo endpoint y la misma
// función de impresión que ya usa FormComprobante.jsx.
export default function ImprimirComprobante() {
  const { id } = useParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    let activo = true;
    getComprobanteImprimir(id)
      .then(async (data) => {
        if (!activo) return;
        // enVentanaActual: true — esta pestaña ya fue abierta con window.open
        // desde un clic en Ventas.jsx, así que se imprime reemplazando su
        // propio documento en vez de abrir otra ventana (esa segunda llamada
        // a window.open, hecha aquí dentro de un useEffect sin gesto de
        // usuario, es lo que el navegador bloqueaba como popup).
        await imprimirComprobante(data, { enVentanaActual: true });
      })
      .catch(() => { if (activo) setError(true); });
    return () => { activo = false; };
  }, [id]);

  return (
    <div className="flex h-screen items-center justify-center text-center px-6">
      <div>
        {!error && (
          <p className="text-gray-500 text-sm">Preparando comprobante para imprimir...</p>
        )}
        {error && (
          <p className="text-red-600 text-sm">No se pudo cargar el comprobante para imprimir.</p>
        )}
      </div>
    </div>
  );
}
