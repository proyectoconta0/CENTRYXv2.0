import React, { useState } from "react";
import { HiChevronDown, HiChevronRight, HiCheckCircle } from "react-icons/hi";

const FILTROS = [
  { key: "todos",            label: "Todos"            },
  { key: "conciliados",      label: "Conciliados"      },
  { key: "solo_banco",       label: "Solo en Banco"    },
  { key: "solo_sistema",     label: "Solo en Sistema"  },
  { key: "gastos_bancarios", label: "Gastos Bancarios" },
];

function fmtFecha(s) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function fmtS(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const s = `S/ ${abs.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : s;
}

function estadoMov(m) {
  if (m.conciliado)        return "conciliado";
  if (m.es_gasto_bancario) return "gasto_bancario";
  if (m.origen === "banco") return "solo_banco";
  return "solo_sistema";
}

const ROW_BG = {
  conciliado:     "bg-green-50/50",
  gasto_bancario: "bg-orange-50/50",
  solo_banco:     "bg-yellow-50/50",
  solo_sistema:   "bg-red-50/50",
};

const BADGE_STYLE = {
  conciliado:     "bg-green-100 text-green-700",
  gasto_bancario: "bg-orange-100 text-orange-700",
  solo_banco:     "bg-yellow-100 text-yellow-800",
  solo_sistema:   "bg-red-100 text-red-700",
};

const BADGE_LABEL = {
  conciliado:     "✅ Conciliado",
  gasto_bancario: "🏦 Gasto Bancario",
  solo_banco:     "⚠️ Solo en Banco",
  solo_sistema:   "❌ Solo en Sistema",
};

export default function TablaMovimientos({
  movimientos,
  onToggle,
  onDesconciliar,
  onRegistrarGB,
  onRegistrarTodosGB,
  loadingGB,
  gbMsg,
  onClearGbMsg,
}) {
  const [filtro, setFiltro]       = useState("todos");
  const [expandedId, setExpandedId] = useState(null);

  // Ocultar movimientos del sistema ya conciliados — se muestran solo en el detalle expandible
  const visibles = movimientos.filter(m => !(m.conciliado && m.origen === "sistema"));

  const movGastosBancarios = movimientos.filter(m => m.es_gasto_bancario && !m.conciliado);

  const counts = {
    todos:            visibles.length,
    conciliados:      visibles.filter(m =>  m.conciliado).length,
    solo_banco:       visibles.filter(m => !m.conciliado && m.origen === "banco" && !m.es_gasto_bancario).length,
    solo_sistema:     visibles.filter(m => !m.conciliado && m.origen === "sistema").length,
    gastos_bancarios: movGastosBancarios.length,
  };

  const filtrados = visibles.filter(m => {
    const st = estadoMov(m);
    if (filtro === "todos")            return true;
    if (filtro === "conciliados")      return st === "conciliado";
    if (filtro === "solo_banco")       return st === "solo_banco";
    if (filtro === "solo_sistema")     return st === "solo_sistema";
    if (filtro === "gastos_bancarios") return st === "gasto_bancario";
    return true;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Movimientos</h3>
          {movGastosBancarios.length > 0 && (
            <button
              onClick={onRegistrarTodosGB}
              disabled={loadingGB}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {loadingGB ? "Registrando…" : `Registrar ${movGastosBancarios.length} Gastos Bancarios`}
            </button>
          )}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map(f => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                filtro === f.key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label} <span className="opacity-70">({counts[f.key]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mensaje GB */}
      {gbMsg && (
        <div className={`flex items-center gap-2 px-5 py-3 border-b text-sm ${
          gbMsg.tipo === "ok"
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          <span className="flex-1">{gbMsg.texto}</span>
          <button onClick={onClearGbMsg} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-6 px-3 py-2.5" />
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Fecha</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Descripción</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Monto</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Tipo</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Estado</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-400 text-sm">
                  Sin movimientos
                </td>
              </tr>
            ) : filtrados.map(m => {
              const st = estadoMov(m);
              const expanded = expandedId === m.id;
              return (
                <React.Fragment key={m.id}>
                  <tr
                    className={`cursor-pointer hover:brightness-95 transition-colors ${ROW_BG[st]}`}
                    onClick={() => setExpandedId(prev => prev === m.id ? null : m.id)}
                  >
                    <td className="px-3 py-2.5 text-gray-400">
                      {expanded
                        ? <HiChevronDown className="w-3.5 h-3.5 mx-auto" />
                        : <HiChevronRight className="w-3.5 h-3.5 mx-auto" />}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                      {fmtFecha(m.fecha)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[260px] truncate">
                      {m.descripcion || "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${
                      m.tipo === "ingreso" ? "text-green-700" : "text-red-600"
                    }`}>
                      {fmtS(m.monto)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        m.tipo === "ingreso" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>{m.tipo}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${BADGE_STYLE[st]}`}>
                        {BADGE_LABEL[st]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                      {/* Gasto bancario → Registrar GB */}
                      {st === "gasto_bancario" && (
                        <button
                          onClick={() => onRegistrarGB(m.id)}
                          className="text-[10px] px-2 py-1 rounded-lg font-medium bg-orange-600 text-white hover:bg-orange-700 whitespace-nowrap"
                        >
                          Registrar GB
                        </button>
                      )}
                      {/* Solo banco (no bancario) → Ignorar */}
                      {st === "solo_banco" && (
                        <button
                          onClick={() => onToggle(m.id)}
                          className="text-[10px] px-2 py-1 rounded-lg font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 whitespace-nowrap"
                        >
                          Ignorar
                        </button>
                      )}
                      {/* Solo sistema → Ignorar */}
                      {st === "solo_sistema" && (
                        <button
                          onClick={() => onToggle(m.id)}
                          className="text-[10px] px-2 py-1 rounded-lg font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 whitespace-nowrap"
                        >
                          Ignorar
                        </button>
                      )}
                      {/* Conciliado → Desconciliar */}
                      {st === "conciliado" && (
                        <button
                          onClick={() => onDesconciliar(m.id)}
                          className="text-[10px] px-2 py-1 rounded-lg font-medium bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700 whitespace-nowrap transition-colors"
                        >
                          Desconciliar
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Fila expandible — detalle del documento vinculado */}
                  {expanded && (
                    <tr>
                      <td colSpan={7} className="px-8 py-3 bg-white border-b border-gray-100">
                        {m.documento_sistema ? (
                          <div className="flex flex-wrap gap-6 text-xs">
                            <div>
                              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Tipo Documento</p>
                              <p className="text-gray-800 font-medium mt-0.5">{m.documento_sistema.tipo_documento}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">N° Documento</p>
                              <p className="text-gray-800 font-medium mt-0.5 font-mono">{m.documento_sistema.numero_documento || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Cliente / Proveedor</p>
                              <p className="text-gray-800 font-medium mt-0.5">{m.documento_sistema.cliente_proveedor || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Categoría / Módulo</p>
                              <p className="text-gray-800 font-medium mt-0.5">{m.documento_sistema.categoria || m.documento_sistema.modulo_origen || "—"}</p>
                            </div>
                            {st === "conciliado" && (
                              <div className="flex items-center gap-1 text-green-700 font-semibold text-xs">
                                <HiCheckCircle className="w-4 h-4" /> Conciliado automáticamente
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 italic">
                            {st === "conciliado"
                              ? "Conciliado — sin documento del sistema vinculado"
                              : m.origen === "banco"
                                ? "Sin par en el sistema para este período"
                                : "Registro del sistema sin movimiento bancario correspondiente"}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
