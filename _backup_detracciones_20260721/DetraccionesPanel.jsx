import React, { useState, useEffect, useCallback } from "react";
import { HiDownload, HiCheckCircle, HiExclamationCircle } from "react-icons/hi";
import {
  getDetraccionesPendientes, generarTxtDetracciones,
  marcarDetraccionVentaPagada, marcarDetraccionGastoDepositada,
} from "../../api/comercialApi";

const MESES_LARGOS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFecha(d) {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

function TipoBadge({ tipo }) {
  const cls = tipo === "Venta" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{tipo}</span>;
}

function SemaforoDetraccion({ valor }) {
  const c = { verde: "bg-green-500", amarillo: "bg-yellow-400", rojo: "bg-red-500" };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${c[valor] || "bg-gray-300"}`} title={valor} />;
}

export default function DetraccionesPanel() {
  const [lista,   setLista]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterMes,  setFilterMes]  = useState("");
  const [filterAnio, setFilterAnio] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [generando, setGenerando] = useState(false);
  const [marcandoId, setMarcandoId] = useState(null);
  const [marcandoMasivo, setMarcandoMasivo] = useState(false);
  const [error, setError] = useState("");
  const [info,  setInfo]  = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterMes)  params.periodo_mes  = filterMes;
      if (filterAnio) params.periodo_anio = filterAnio;
      const r = await getDetraccionesPendientes(params);
      setLista(r.data || []);
      setSelected(new Set());
    } catch { setLista([]); }
    finally { setLoading(false); }
  }, [filterMes, filterAnio]);

  useEffect(() => { cargar(); }, [cargar]);

  const toggleUno = (id) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleTodos = () => {
    setSelected(s => s.size === lista.length ? new Set() : new Set(lista.map(f => f.id)));
  };

  const totalSeleccionado = lista
    .filter(f => selected.has(f.id))
    .reduce((acc, f) => acc + (f.monto_detraccion || 0), 0);

  const handleGenerarTxt = async () => {
    // El archivo del Banco de la Nación (Caso 1: adquiriente) solo aplica a
    // detracciones de Compras (Gastos) — las de Venta quedan excluidas.
    const idsCompra = lista.filter(f => selected.has(f.id) && f.tipo === "Compra").map(f => f.id);
    const huboVentasExcluidas = lista.some(f => selected.has(f.id) && f.tipo === "Venta");
    if (idsCompra.length === 0) {
      setError("El TXT del Banco de la Nación solo aplica a detracciones de Compras (Gastos) — seleccione al menos una.");
      return;
    }
    setGenerando(true); setError(""); setInfo("");
    try {
      const res   = await generarTxtDetracciones({ ids: idsCompra.join(",") });
      const cd    = res.headers?.["content-disposition"] || "";
      const match = cd.match(/filename=([^;]+)/i);
      const hoy   = new Date();
      const fname = match ? match[1].trim() : `Detracciones_${MESES_LARGOS[hoy.getMonth()]}_${hoy.getFullYear()}.txt`;
      const url   = window.URL.createObjectURL(new Blob([res.data]));
      const a     = document.createElement("a");
      a.href = url;
      a.setAttribute("download", fname);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      if (huboVentasExcluidas) {
        setInfo("Las detracciones de tipo Venta seleccionadas no se incluyeron — el archivo del Banco de la Nación solo aplica a Compras.");
      }
      cargar();
    } catch {
      setError("No se pudo generar el archivo TXT.");
    } finally {
      setGenerando(false);
    }
  };

  const marcarUna = async (fila) => {
    setMarcandoId(fila.id);
    try {
      if (fila.tipo === "Venta") await marcarDetraccionVentaPagada(fila.id.slice(1));
      else                        await marcarDetraccionGastoDepositada(fila.id.slice(1));
      cargar();
    } catch {
      alert("No se pudo marcar la detracción.");
    } finally {
      setMarcandoId(null);
    }
  };

  const marcarSeleccionadas = async () => {
    if (selected.size === 0) return;
    setMarcandoMasivo(true);
    try {
      const filas = lista.filter(f => selected.has(f.id));
      await Promise.all(filas.map(f =>
        f.tipo === "Venta" ? marcarDetraccionVentaPagada(f.id.slice(1)) : marcarDetraccionGastoDepositada(f.id.slice(1))
      ));
      cargar();
    } catch {
      alert("No se pudieron marcar todas las detracciones seleccionadas.");
    } finally {
      setMarcandoMasivo(false);
    }
  };

  return (
    <div>
      {/* Filtros + acciones */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <select value={filterMes} onChange={e => setFilterMes(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos los meses</option>
          {MESES_LARGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={filterAnio} placeholder="Año"
          onChange={e => setFilterAnio(e.target.value)}
          className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {(filterMes || filterAnio) && (
          <button onClick={() => { setFilterMes(""); setFilterAnio(""); }}
            className="text-sm text-gray-500 hover:text-gray-700">Limpiar</button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {selected.size > 0 && (
            <span className="text-sm text-gray-600">
              {selected.size} seleccionadas · <span className="font-semibold text-gray-800">{fmtS(totalSeleccionado)}</span>
            </span>
          )}
          <button onClick={marcarSeleccionadas} disabled={selected.size === 0 || marcandoMasivo}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <HiCheckCircle className="w-4 h-4" /> {marcandoMasivo ? "Marcando…" : "Marcar como depositada"}
          </button>
          <button onClick={handleGenerarTxt} disabled={selected.size === 0 || generando}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors">
            <HiDownload className="w-4 h-4" /> {generando ? "Generando…" : "Generar TXT Banco de la Nación"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
          <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {info && (
        <div className="mb-4 flex items-start gap-2 text-blue-700 bg-blue-50 px-3 py-2.5 rounded-lg text-sm">
          <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {info}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-3 text-center w-10">
                  <input type="checkbox" checked={lista.length > 0 && selected.size === lista.length}
                    onChange={toggleTodos}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-8"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">RUC / Proveedor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Concepto</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Base</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Tasa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Monto Det.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
              ) : lista.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400 text-sm">No hay detracciones pendientes de depositar</td></tr>
              ) : lista.map(f => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 text-center">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleUno(f.id)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-3 py-3 text-center"><SemaforoDetraccion valor={f.semaforo} /></td>
                  <td className="px-4 py-3"><TipoBadge tipo={f.tipo} /></td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(f.fecha)}</td>
                  <td className="px-4 py-3 max-w-[180px]">
                    <p className="text-xs font-mono text-gray-500">{f.ruc || "—"}</p>
                    <p className="text-sm text-gray-700 truncate" title={f.nombre}>{f.nombre || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate" title={f.concepto}>{f.concepto || "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{fmtS(f.base)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{f.tasa}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(f.monto_detraccion)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs font-medium ${f.semaforo === "rojo" ? "text-red-600" : f.semaforo === "amarillo" ? "text-yellow-600" : "text-gray-600"}`}>
                      {f.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center">
                      <button onClick={() => marcarUna(f)} disabled={marcandoId === f.id}
                        className="px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
                        {marcandoId === f.id ? "…" : f.tipo === "Venta" ? "Marcar pagada" : "Marcar depositada"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
