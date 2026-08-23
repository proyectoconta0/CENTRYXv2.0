import React, { useState, useRef, useEffect } from "react";
import {
  HiX, HiOutlineArchive, HiCheckCircle, HiExclamation,
  HiXCircle, HiPencil,
} from "react-icons/hi";
import { importarComprobanteZip, confirmarImportacionZip } from "../../api/comercialApi";

const TIPOS_DOC = ["Factura", "Boleta de Venta", "Nota de Crédito", "Nota de Débito"];
const TIPOS_SERVICIO = [
  "Alquiler de andamios", "Venta de andamios", "Reparación de andamios",
  "Venta de piezas", "Capacitación", "Transporte", "Montaje", "Otros",
];
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const IGV_RATE = 0.18;
const round2 = (n) => Math.round(n * 100) / 100;

const INPUT_CLS =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-shadow " +
  "focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ESTADO_INFO = {
  listo:     { label: "Listo",     emoji: "✅", cls: "bg-green-100 text-green-700" },
  revisar:   { label: "Revisar",   emoji: "⚠️", cls: "bg-amber-100 text-amber-700" },
  no_valido: { label: "No válido", emoji: "❌", cls: "bg-red-100 text-red-700" },
  duplicado: { label: "Duplicado", emoji: "🔄", cls: "bg-gray-200 text-gray-600" },
};

function FilaEditModal({ fila, onSave, onClose }) {
  const [datos, setDatos] = useState({ ...fila });
  const set = (campo, val) => setDatos(d => ({ ...d, [campo]: val }));

  const handleBase = (val) => {
    set("base_imponible", val);
    const base = parseFloat(val);
    if (!isNaN(base)) {
      const igv = round2(base * IGV_RATE);
      set("igv", igv);
      set("precio_venta", round2(base + igv));
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Completar datos — {fila.archivo}</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <HiX className="text-lg" />
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tipo Documento</label>
            <select value={datos.tipo_documento || TIPOS_DOC[0]} onChange={e => set("tipo_documento", e.target.value)} className={INPUT_CLS}>
              {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">N° Documento</label>
            <input type="text" value={datos.numero_documento || ""} onChange={e => set("numero_documento", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Fecha Emisión</label>
            <input type="date" value={datos.fecha_emision || ""} onChange={e => set("fecha_emision", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">RUC Cliente</label>
            <input type="text" value={datos.ruc_cliente || ""} onChange={e => set("ruc_cliente", e.target.value)} className={INPUT_CLS} maxLength={11} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Razón Social</label>
            <input type="text" value={datos.razon_social || ""} onChange={e => set("razon_social", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tipo de Servicio</label>
            <select value={datos.tipo_servicio || TIPOS_SERVICIO[0]} onChange={e => set("tipo_servicio", e.target.value)} className={INPUT_CLS}>
              {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-600 mb-1 block">Descripción</label>
            <input type="text" value={datos.descripcion || ""} onChange={e => set("descripcion", e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Base Imponible</label>
            <input type="number" step="0.01" value={datos.base_imponible ?? ""} onChange={e => handleBase(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Total</label>
            <input type="number" step="0.01" value={datos.precio_venta ?? ""} onChange={e => set("precio_venta", e.target.value)} className={INPUT_CLS} />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button
            onClick={() => onSave(datos)}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CargaMasiva({ onClose, onImportado }) {
  const [step, setStep]         = useState("upload"); // upload | procesando | resultados | final
  const [dragOver, setDragOver] = useState(false);
  const [error, setError]       = useState("");
  const fileRef = useRef();

  const [filas, setFilas]       = useState([]);
  const [progreso, setProgreso] = useState(0);
  const progresoTimer = useRef(null);

  const [editando, setEditando]     = useState(null); // índice de fila
  const [registrando, setRegistrando] = useState(false);
  const [resumenFinal, setResumenFinal] = useState(null);

  useEffect(() => () => clearInterval(progresoTimer.current), []);

  const validarArchivo = (f) => {
    if (!f.name.toLowerCase().endsWith(".zip")) return "Solo se aceptan archivos ZIP";
    if (f.size > MAX_ZIP_BYTES) return "El archivo supera el tamaño máximo de 50 MB";
    return "";
  };

  const procesarZip = async (f) => {
    const err = validarArchivo(f);
    if (err) { setError(err); return; }
    setError("");
    setStep("procesando");
    setProgreso(5);
    progresoTimer.current = setInterval(() => {
      setProgreso(p => (p < 90 ? p + Math.random() * 10 : p));
    }, 400);

    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await importarComprobanteZip(fd);
      clearInterval(progresoTimer.current);
      setProgreso(100);
      const conFilas = (r.resultados || []).map(res => ({
        ...res,
        tipo_servicio: TIPOS_SERVICIO[0],
        seleccionado: res.estado === "listo" || res.estado === "revisar",
      }));
      setTimeout(() => { setFilas(conFilas); setStep("resultados"); }, 300);
    } catch (err) {
      clearInterval(progresoTimer.current);
      setError(err.response?.data?.detail || "No se pudo procesar el ZIP");
      setStep("upload");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) procesarZip(f);
  };

  const toggleFila = (i) => setFilas(fs => fs.map((f, idx) => (idx === i ? { ...f, seleccionado: !f.seleccionado } : f)));
  const todosMarcados = filas.length > 0 && filas.every(f => f.seleccionado);
  const toggleTodos = () => setFilas(fs => fs.map(f => ({ ...f, seleccionado: !todosMarcados })));

  const guardarEdicion = (datosEditados) => {
    setFilas(fs => fs.map((f, idx) => (idx === editando ? { ...f, ...datosEditados, estado: "revisar" } : f)));
    setEditando(null);
  };

  const seleccionadas = filas.filter(f => f.seleccionado);

  const handleImportar = async () => {
    setRegistrando(true);
    setError("");
    try {
      const comprobantes = seleccionadas.map(f => ({
        tipo_documento:        f.tipo_documento || TIPOS_DOC[0],
        numero_documento:      f.numero_documento,
        documento_relacionado: f.documento_relacionado || null,
        ruc_cliente:           f.ruc_cliente,
        razon_social_cliente:  f.razon_social,
        tipo_servicio:         f.tipo_servicio || TIPOS_SERVICIO[0],
        descripcion:           f.descripcion || null,
        base_imponible:        f.base_imponible != null ? parseFloat(f.base_imponible) : null,
        moneda:                f.moneda || "PEN",
        fecha:                 f.fecha_emision,
        fecha_vencimiento:     f.fecha_vencimiento || null,
        // Referencia al PDF original (extraído y guardado en staging por el
        // backend en importar-zip) para que confirmar lo adjunte al
        // comprobante recién creado — ver _crear_comprobante en comprobantes.py.
        archivo_temp:          f.archivo_temp || null,
        archivo_nombre:        f.archivo || null,
      }));
      const r = await confirmarImportacionZip(comprobantes);

      const corregidas = seleccionadas.filter((f, i) => f.estado === "revisar" && r.resultados[i]?.exito).length;
      const noEnviadas = filas.length - seleccionadas.length;
      const fallidasEnvio = seleccionadas.length - r.exitosos;

      setResumenFinal({
        total:        filas.length,
        exitosos:     r.exitosos,
        limpias:      r.exitosos - corregidas,
        corregidas,
        noImportados: noEnviadas + fallidasEnvio,
      });
      setStep("final");
    } catch (err) {
      setError(err.response?.data?.detail || "Error al importar los comprobantes");
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={step === "procesando" ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">Carga Masiva de Comprobantes</h2>
          {step !== "procesando" && (
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <HiX className="text-lg" />
            </button>
          )}
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {step === "upload" && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-14 px-6 cursor-pointer transition-colors ${
                  dragOver ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                }`}
              >
                <HiOutlineArchive className="text-4xl text-gray-300" />
                <p className="text-sm font-medium text-gray-600">Arrastra tu archivo ZIP aquí o haz clic para seleccionar</p>
                <p className="text-xs text-gray-400">Solo archivos .zip con PDFs adentro — máx. 50 MB, hasta 100 PDFs</p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                  className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Seleccionar archivo ZIP
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && procesarZip(e.target.files[0])}
                />
              </div>
              {error && (
                <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                  {error}
                </div>
              )}
            </>
          )}

          {step === "procesando" && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <p className="text-sm font-medium text-gray-600">Procesando archivos del ZIP...</p>
              <div className="w-full max-w-md h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.round(progreso))}%` }}
                />
              </div>
              <p className="text-xs text-gray-400">{Math.min(100, Math.round(progreso))}%</p>
            </div>
          )}

          {step === "resultados" && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-center">
                      <input type="checkbox" checked={todosMarcados} onChange={toggleTodos} />
                    </th>
                    <th className="px-3 py-2 text-left">Archivo</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-left">N° Doc</th>
                    <th className="px-3 py-2 text-left">Cliente</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filas.map((f, i) => {
                    const info = ESTADO_INFO[f.estado] || ESTADO_INFO.no_valido;
                    return (
                      <tr
                        key={i}
                        className={`hover:bg-gray-50 transition-colors ${f.estado === "revisar" ? "cursor-pointer" : ""}`}
                        onClick={() => f.estado === "revisar" && setEditando(i)}
                      >
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={f.seleccionado} onChange={() => toggleFila(i)} />
                        </td>
                        <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate" title={f.archivo}>{f.archivo}</td>
                        <td className="px-3 py-2 text-gray-600">{f.tipo_documento || "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{f.numero_documento || "—"}</td>
                        <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={f.razon_social}>{f.razon_social || "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(f.precio_venta)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${info.cls}`}>
                            {info.emoji} {info.label}
                            {f.estado === "revisar" && <HiPencil className="text-xs ml-0.5" />}
                          </span>
                          {f.estado === "no_valido" && f.error && (
                            <p className="mt-1 text-xs text-red-600 max-w-[220px]" title={f.error}>{f.error}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {error && (
                <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                  {error}
                </div>
              )}
            </div>
          )}

          {step === "final" && resumenFinal && (
            <div className="py-6 space-y-4">
              <p className="text-base font-semibold text-gray-800">
                Se importaron {resumenFinal.exitosos} de {resumenFinal.total} comprobantes exitosamente
              </p>
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2 text-green-700"><HiCheckCircle className="text-lg" /> {resumenFinal.limpias} registrados correctamente</p>
                <p className="flex items-center gap-2 text-amber-700"><HiExclamation className="text-lg" /> {resumenFinal.corregidas} requirieron corrección manual</p>
                <p className="flex items-center gap-2 text-red-700"><HiXCircle className="text-lg" /> {resumenFinal.noImportados} no importados (no válidos)</p>
              </div>
            </div>
          )}
        </div>

        {step === "resultados" && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button onClick={onClose} disabled={registrando} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleImportar}
              disabled={registrando || seleccionadas.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <HiCheckCircle className="text-base" />
              {registrando ? "Importando..." : `Importar seleccionados (${seleccionadas.length})`}
            </button>
          </div>
        )}

        {step === "final" && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={() => { onImportado(); }}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>

      {editando !== null && (
        <FilaEditModal fila={filas[editando]} onSave={guardarEdicion} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}
