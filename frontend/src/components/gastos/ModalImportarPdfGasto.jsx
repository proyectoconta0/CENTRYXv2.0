import React, { useState, useRef } from "react";
import { HiX, HiUpload, HiDocumentText, HiExclamation, HiCheckCircle } from "react-icons/hi";
import { importarGastoPdf, createGasto, consultarRuc, subirComprobanteGasto } from "../../api/comercialApi";

const TIPOS_COMPROBANTE_IMPORT = ["Factura", "Boleta de Venta", "Recibo por Honorarios"];
const TIPOS_DOCUMENTO = ["RUC", "DNI", "Carnet de Extranjería"];
const CATEGORIAS_OPERATIVAS = [
  "Alquiler de oficina", "Alquiler de almacén", "Mano de obra",
  "Transporte", "Suministros", "Materia prima", "Alquiler de andamios",
  "Servicios básicos", "Seguros", "Gastos administrativos", "Gastos de ventas",
  "Gastos Bancarios", "Otros",
];
const AREAS = ["Administrativa", "Operativa", "Ventas", "Activos"];

const MAX_BYTES = 10 * 1024 * 1024;

const INPUT_CLS =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition-shadow " +
  "focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const INPUT_WARN_CLS =
  "w-full border-2 border-amber-300 bg-amber-50 rounded-lg px-3 py-2 text-sm transition-shadow " +
  "focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100";

function Label({ children }) {
  return <label className="text-xs font-medium text-gray-600 mb-1 block">{children}</label>;
}

function Campo({ label, noDetectado, children }) {
  return (
    <div>
      <Label>{label} {noDetectado && <span className="text-amber-600">· verificar</span>}</Label>
      {children}
    </div>
  );
}

function fmtS(n) {
  if (n == null || isNaN(n)) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ModalImportarPdfGasto({ onClose, onImported }) {
  const [step, setStep]         = useState("upload"); // upload | preview
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile]         = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError]       = useState("");
  const fileRef = useRef();

  const [datos, setDatos]               = useState(null);
  const [noDetectados, setNoDetectados] = useState([]);
  const [confianza, setConfianza]       = useState(1);
  const [avisoDuplicado, setAvisoDuplicado] = useState("");

  const [rucMsg, setRucMsg]           = useState("");
  const [buscandoRuc, setBuscandoRuc] = useState(false);
  const rucTimer = useRef(null);

  const [registrando, setRegistrando] = useState(false);
  const [errorForm, setErrorForm]     = useState("");

  const set = (campo, val) => setDatos(d => ({ ...d, [campo]: val }));

  const validarArchivo = (f) => {
    if (!f) return "";
    if (!f.name.toLowerCase().endsWith(".pdf")) return "Solo se aceptan archivos PDF";
    if (f.size > MAX_BYTES) return "El archivo supera el tamaño máximo de 10 MB";
    return "";
  };

  const procesarArchivo = async (f) => {
    const err = validarArchivo(f);
    if (err) { setError(err); return; }
    setError("");
    setFile(f);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await importarGastoPdf(fd);
      setDatos({
        tipo_comprobante:   r.tipo_comprobante || TIPOS_COMPROBANTE_IMPORT[0],
        numero_comprobante: r.numero_comprobante || "",
        fecha:              r.fecha || "",
        fecha_vencimiento:  r.fecha_vencimiento || "",
        tipo_documento:     r.tipo_documento || "RUC",
        numero_documento:   r.numero_documento || "",
        proveedor:          r.proveedor || "",
        categoria:          "",
        area:               "Operativa",
        descripcion:        r.descripcion || "",
        monto:              r.monto != null ? String(r.monto) : "",
        // Retención IR (8%, Recibo por Honorarios): opcional, la decide el
        // usuario — no viene marcada por defecto aunque el PDF detecte monto.
        aplicar_retencion_ir: false,
      });
      setNoDetectados(r.campos_no_detectados || []);
      setConfianza(r.confianza != null ? r.confianza : 1);
      setAvisoDuplicado(r.ya_registrado ? r.mensaje_duplicado : "");
      if (r.numero_documento) buscarPorRuc(r.numero_documento);
      setStep("preview");
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo procesar el PDF");
    } finally {
      setSubiendo(false);
    }
  };

  const buscarPorRuc = async (ruc) => {
    setRucMsg("");
    if (!ruc || ruc.length !== 11 || !/^\d{11}$/.test(ruc)) return;
    setBuscandoRuc(true);
    setRucMsg("Buscando...");
    try {
      const data = await consultarRuc(ruc);
      if (data?.razon_social) {
        set("proveedor", data.razon_social);
        setRucMsg("Proveedor encontrado en SUNAT");
      } else {
        setRucMsg("RUC no encontrado — verifique el nombre manualmente");
      }
    } catch {
      setRucMsg("RUC no encontrado — verifique el nombre manualmente");
    } finally {
      setBuscandoRuc(false);
    }
  };

  const handleRucChange = (val) => {
    set("numero_documento", val);
    clearTimeout(rucTimer.current);
    rucTimer.current = setTimeout(() => buscarPorRuc(val), 600);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) procesarArchivo(f);
  };

  const montoNum      = parseFloat(datos?.monto);
  const aplicaIgv      = datos?.tipo_comprobante === "Factura" || datos?.tipo_comprobante === "Boleta de Venta";
  const baseCalc       = aplicaIgv && !isNaN(montoNum) && montoNum > 0 ? Math.round(montoNum / 1.18 * 100) / 100 : null;
  const igvCalc        = baseCalc != null ? Math.round((montoNum - baseCalc) * 100) / 100 : null;
  const esHonorarios   = datos?.tipo_comprobante === "Recibo por Honorarios";
  const montoValidoRh  = !isNaN(montoNum) && montoNum > 0;
  // Retención de renta de 4ta categoría: opcional — solo se calcula si el
  // usuario la activa (checkbox) Y el recibo supera S/ 1,500 (regla SUNAT).
  const superaUmbralRh = montoValidoRh && montoNum > 1500;
  const retencionCalc  = esHonorarios && montoValidoRh
    ? (datos?.aplicar_retencion_ir && superaUmbralRh ? Math.round(montoNum * 0.08 * 100) / 100 : 0)
    : null;
  const totalNetoCalc  = retencionCalc != null ? Math.round((montoNum - retencionCalc) * 100) / 100 : null;

  const handleRegistrar = async () => {
    setErrorForm("");
    if (!datos.numero_comprobante.trim()) { setErrorForm("El N° de comprobante es obligatorio"); return; }
    if (!datos.numero_documento.trim())   { setErrorForm("El RUC/documento del proveedor es obligatorio"); return; }
    if (!datos.proveedor.trim())          { setErrorForm("El nombre del proveedor es obligatorio"); return; }
    if (!datos.fecha)                     { setErrorForm("La fecha es obligatoria"); return; }
    if (!datos.categoria)                 { setErrorForm("Seleccione una categoría"); return; }
    if (!datos.area)                      { setErrorForm("Seleccione un área"); return; }
    if (isNaN(montoNum) || montoNum <= 0) { setErrorForm("El monto debe ser un número mayor a 0"); return; }

    setRegistrando(true);
    try {
      const gasto = await createGasto({
        fecha:              datos.fecha,
        categoria:          datos.categoria,
        descripcion:        datos.descripcion.trim(),
        monto:              montoNum,
        area:               datos.area,
        tipo_comprobante:   datos.tipo_comprobante,
        numero_comprobante: datos.numero_comprobante.trim(),
        proveedor:          datos.proveedor.trim(),
        tipo_documento:     datos.tipo_documento,
        numero_documento:   datos.numero_documento.trim(),
        fecha_vencimiento:  datos.fecha_vencimiento || null,
        moneda:             "PEN",
        metodo_creacion:    "Importación PDF",
      });
      // Se conserva el PDF original del proveedor para poder imprimirlo/verlo
      // tal cual (sin regenerar un documento) — si falla, el gasto ya quedó
      // registrado igual, así que no se bloquea el flujo por esto.
      if (file) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          await subirComprobanteGasto(gasto.id, fd);
        } catch { /* el gasto ya se registró; el adjunto es best-effort */ }
      }
      onImported();
    } catch (err) {
      setErrorForm(err.response?.data?.detail || "Error al registrar el gasto");
    } finally {
      setRegistrando(false);
    }
  };

  const esNoDetectado = (campo) => noDetectados.includes(campo);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Importar Factura PDF de Proveedor</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <HiX className="text-lg" />
          </button>
        </div>

        <div className="p-6">
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
                <HiUpload className="text-4xl text-gray-300" />
                <p className="text-sm font-medium text-gray-600">
                  {subiendo ? "Procesando PDF..." : "Arrastra la factura PDF aquí o haz clic para seleccionar"}
                </p>
                <p className="text-xs text-gray-400">Solo archivos .pdf — máx. 10 MB</p>
                <button
                  type="button"
                  disabled={subiendo}
                  onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                  className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Seleccionar archivo
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  disabled={subiendo}
                  onChange={(e) => e.target.files?.[0] && procesarArchivo(e.target.files[0])}
                />
              </div>
              {file && !subiendo && !error && (
                <p className="text-xs text-gray-500 mt-3 flex items-center gap-1.5">
                  <HiDocumentText className="text-gray-400" /> {file.name}
                </p>
              )}
              {error && (
                <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                  {error}
                </div>
              )}
            </>
          )}

          {step === "preview" && datos && (
            <>
              {confianza < 0.7 && (
                <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg flex items-start gap-2">
                  <HiExclamation className="text-lg flex-shrink-0 mt-0.5" />
                  <span>No se pudieron detectar todos los datos con seguridad ({Math.round(confianza * 100)}% de confianza). Revisa los campos marcados antes de confirmar.</span>
                </div>
              )}
              {avisoDuplicado && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start gap-2">
                  <HiExclamation className="text-lg flex-shrink-0 mt-0.5" />
                  <span>{avisoDuplicado}</span>
                </div>
              )}

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Datos detectados del PDF</p>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <Campo label="Tipo Comprobante" noDetectado={esNoDetectado("tipo_comprobante")}>
                  <select
                    value={datos.tipo_comprobante}
                    onChange={e => set("tipo_comprobante", e.target.value)}
                    className={esNoDetectado("tipo_comprobante") ? INPUT_WARN_CLS : INPUT_CLS}
                  >
                    {TIPOS_COMPROBANTE_IMPORT.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo label="N° Comprobante" noDetectado={esNoDetectado("numero_comprobante")}>
                  <input
                    type="text"
                    value={datos.numero_comprobante}
                    onChange={e => set("numero_comprobante", e.target.value)}
                    className={esNoDetectado("numero_comprobante") ? INPUT_WARN_CLS : INPUT_CLS}
                    placeholder="F001-00003365"
                  />
                </Campo>
                <Campo label="Fecha Emisión" noDetectado={esNoDetectado("fecha")}>
                  <input
                    type="date"
                    value={datos.fecha}
                    onChange={e => set("fecha", e.target.value)}
                    className={esNoDetectado("fecha") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
                <Campo label="Fecha Vencim.">
                  <input
                    type="date"
                    value={datos.fecha_vencimiento}
                    onChange={e => set("fecha_vencimiento", e.target.value)}
                    className={INPUT_CLS}
                  />
                </Campo>
                <Campo label="Tipo de Documento">
                  <select
                    value={datos.tipo_documento}
                    onChange={e => set("tipo_documento", e.target.value)}
                    className={INPUT_CLS}
                  >
                    {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo label="RUC / Documento Proveedor" noDetectado={esNoDetectado("numero_documento")}>
                  <input
                    type="text"
                    value={datos.numero_documento}
                    onChange={e => handleRucChange(e.target.value)}
                    className={esNoDetectado("numero_documento") ? INPUT_WARN_CLS : INPUT_CLS}
                    placeholder="20613672088"
                    maxLength={11}
                  />
                  {(buscandoRuc || rucMsg) && (
                    <p className="text-xs text-gray-400 mt-1">{buscandoRuc ? "Buscando..." : rucMsg}</p>
                  )}
                </Campo>
                <Campo label="Proveedor" noDetectado={esNoDetectado("proveedor")}>
                  <input
                    type="text"
                    value={datos.proveedor}
                    onChange={e => set("proveedor", e.target.value)}
                    className={esNoDetectado("proveedor") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
                <Campo label="Área" noDetectado>
                  <select
                    value={datos.area}
                    onChange={e => set("area", e.target.value)}
                    className={INPUT_WARN_CLS}
                  >
                    {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Campo>
                <Campo label="Categoría" noDetectado>
                  <select
                    value={datos.categoria}
                    onChange={e => set("categoria", e.target.value)}
                    className={INPUT_WARN_CLS}
                  >
                    <option value="">Seleccionar…</option>
                    {CATEGORIAS_OPERATIVAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Campo>
                <Campo label="Descripción">
                  <input
                    type="text"
                    value={datos.descripcion}
                    onChange={e => set("descripcion", e.target.value)}
                    className={INPUT_CLS}
                  />
                </Campo>
                <Campo label="Monto Total (S/)" noDetectado={esNoDetectado("monto")}>
                  <input
                    type="number" step="0.01"
                    value={datos.monto}
                    onChange={e => set("monto", e.target.value)}
                    className={esNoDetectado("monto") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
              </div>

              {aplicaIgv && (
                <div className="grid grid-cols-2 gap-4 mb-4 bg-blue-50 rounded-xl p-3 border border-blue-200">
                  <div>
                    <p className="text-xs font-semibold text-blue-700 uppercase">Base Imponible (S/)</p>
                    <p className="mt-1.5 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-semibold text-blue-800">{fmtS(baseCalc)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-700 uppercase">IGV 18% (S/)</p>
                    <p className="mt-1.5 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-semibold text-blue-800">{fmtS(igvCalc)}</p>
                  </div>
                </div>
              )}

              {esHonorarios && (
                <div className="mb-4 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={!!datos?.aplicar_retencion_ir}
                      onChange={e => set("aplicar_retencion_ir", e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-gray-700">Aplicar Retención IR (8%)</span>
                  </label>

                  {datos?.aplicar_retencion_ir && montoValidoRh && !superaUmbralRh && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Retención no aplica (monto ≤ S/ 1,500)
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-4 bg-amber-50 rounded-xl p-3 border border-amber-200">
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase">Retención IR (8%)</p>
                      <p className="mt-1.5 px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-semibold text-amber-800">{fmtS(retencionCalc)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase">Total Neto Recibido (S/)</p>
                      <p className="mt-1.5 px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-semibold text-amber-800">{fmtS(totalNetoCalc)}</p>
                    </div>
                  </div>
                </div>
              )}

              {errorForm && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                  {errorForm}
                </div>
              )}
            </>
          )}
        </div>

        {step === "preview" && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              disabled={registrando}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleRegistrar}
              disabled={registrando}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <HiCheckCircle className="text-base" />
              {registrando ? "Registrando..." : "Registrar Gasto"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
