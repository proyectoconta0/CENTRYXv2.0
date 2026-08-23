import React, { useState, useEffect } from "react";
import { getAlertas, updateAlertas } from "../../api/configuracionApi";

const GRUPOS = [
  { key: "cobranza",   titulo: "Cobranza" },
  { key: "gastos",     titulo: "Gastos" },
  { key: "flujo_caja", titulo: "Flujo de Caja" },
];

function FilaAlerta({ alerta, onChange }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <input
        type="checkbox" checked={alerta.activa}
        onChange={e => onChange({ ...alerta, activa: e.target.checked })}
        className="mt-1 w-4 h-4 accent-blue-600"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700">{alerta.label}</p>
        <p className="text-xs text-gray-400">{alerta.descripcion}</p>
      </div>
      {alerta.unidad && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {alerta.unidad === "monto" && <span className="text-sm text-gray-500">S/</span>}
          <input
            type="number" value={alerta.valor_umbral ?? ""} disabled={!alerta.activa}
            onChange={e => onChange({ ...alerta, valor_umbral: e.target.value === "" ? null : Number(e.target.value) })}
            className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-50"
          />
          {alerta.unidad === "dias" && <span className="text-sm text-gray-500">días</span>}
        </div>
      )}
    </div>
  );
}

export default function AlertasTab() {
  const [alertas, setAlertas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getAlertas().then(r => setAlertas(r.data || [])).finally(() => setLoading(false));
  }, []);

  function actualizar(actualizada) {
    setAlertas(as => as.map(a => a.tipo_alerta === actualizada.tipo_alerta ? actualizada : a));
  }

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      const payload = alertas.map(a => ({ tipo_alerta: a.tipo_alerta, activa: a.activa, valor_umbral: a.valor_umbral }));
      const r = await updateAlertas(payload);
      setAlertas(r.data || []);
      setMsg({ tipo: "ok", texto: "Alertas guardadas correctamente" });
    } catch {
      setMsg({ tipo: "error", texto: "No se pudieron guardar las alertas" });
    } finally {
      setGuardando(false);
    }
  }

  if (loading) return <p className="text-center text-sm text-gray-400 py-16">Cargando...</p>;

  return (
    <div className="max-w-2xl">
      {GRUPOS.map(g => {
        const items = alertas.filter(a => a.grupo === g.key);
        if (items.length === 0) return null;
        return (
          <div key={g.key} className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">{g.titulo}</h3>
            <div className="bg-white rounded-xl border border-gray-100 px-4">
              {items.map(a => <FilaAlerta key={a.tipo_alerta} alerta={a} onChange={actualizar} />)}
            </div>
          </div>
        );
      })}

      {msg && <p className={`text-sm mb-3 ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>}

      <button onClick={guardar} disabled={guardando}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60">
        {guardando ? "Guardando..." : "Guardar alertas"}
      </button>
    </div>
  );
}
