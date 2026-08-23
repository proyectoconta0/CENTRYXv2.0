import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { HiSearch, HiX } from "react-icons/hi";
import { buscarGlobal } from "../api/busquedaApi";

const LARGO_MINIMO = 3;

const GRUPOS = [
  { key: "clientes",     label: "Clientes",     ruta: (id) => `/clientes/${id}` },
  { key: "comprobantes", label: "Comprobantes", ruta: (id) => `/ventas?ver=${id}` },
  { key: "gastos",       label: "Gastos",       ruta: (id) => `/gastos?ver=${id}` },
  { key: "proveedores",  label: "Proveedores",  ruta: (id) => `/proveedores?ver=${id}` },
];

export default function BuscadorGlobal() {
  const navigate = useNavigate();
  const [abierto, setAbierto]     = useState(false);
  const [termino, setTermino]     = useState("");
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando]   = useState(false);
  const contenedorRef = useRef(null);
  const inputRef      = useRef(null);

  const buscar = useCallback((q) => {
    if (q.trim().length < LARGO_MINIMO) {
      setResultados(null);
      return;
    }
    setBuscando(true);
    buscarGlobal(q.trim())
      .then(setResultados)
      .catch(() => setResultados(null))
      .finally(() => setBuscando(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => buscar(termino), 300);
    return () => clearTimeout(t);
  }, [termino, buscar]);

  useEffect(() => {
    if (abierto) inputRef.current?.focus();
  }, [abierto]);

  const cerrar = () => {
    setAbierto(false);
    setTermino("");
    setResultados(null);
  };

  useEffect(() => {
    function onClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) cerrar();
    }
    function onEsc(e) {
      if (e.key === "Escape") cerrar();
    }
    if (abierto) {
      document.addEventListener("mousedown", onClickFuera);
      document.addEventListener("keydown", onEsc);
    }
    return () => {
      document.removeEventListener("mousedown", onClickFuera);
      document.removeEventListener("keydown", onEsc);
    };
  }, [abierto]);

  const irARegistro = (grupoKey, id) => {
    const grupo = GRUPOS.find(g => g.key === grupoKey);
    if (grupo) navigate(grupo.ruta(id));
    cerrar();
  };

  const hayResultados = resultados && GRUPOS.some(g => (resultados[g.key] || []).length > 0);
  const mostrarPanel = abierto && termino.trim().length >= LARGO_MINIMO;

  return (
    <div ref={contenedorRef} className="relative">
      <div className={`flex items-center transition-all duration-200 ${abierto ? "w-64" : "w-9"} overflow-hidden`}>
        <button
          onClick={() => setAbierto(v => !v)}
          className="flex-shrink-0 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Buscar"
        >
          <HiSearch className="text-xl" />
        </button>
        {abierto && (
          <input
            ref={inputRef}
            value={termino}
            onChange={e => setTermino(e.target.value)}
            placeholder="Buscar clientes, comprobantes, gastos..."
            className="w-full ml-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
          />
        )}
      </div>

      {mostrarPanel && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-96 max-h-[28rem] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg">
          {buscando && (
            <p className="text-sm text-gray-400 text-center py-6">Buscando...</p>
          )}
          {!buscando && !hayResultados && (
            <p className="text-sm text-gray-400 text-center py-6">Sin resultados para "{termino}"</p>
          )}
          {!buscando && hayResultados && GRUPOS.map(({ key, label }) => {
            const items = resultados[key] || [];
            if (items.length === 0) return null;
            return (
              <div key={key} className="border-b border-gray-100 last:border-b-0">
                <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  {label} ({items.length})
                </p>
                <ul>
                  {items.map(item => (
                    <li key={item.id}>
                      <button
                        onClick={() => irARegistro(key, item.id)}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors flex flex-col"
                      >
                        <span className="text-sm text-gray-800 font-medium truncate">{item.titulo}</span>
                        {item.subtitulo && (
                          <span className="text-xs text-gray-400 truncate">{item.subtitulo}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
