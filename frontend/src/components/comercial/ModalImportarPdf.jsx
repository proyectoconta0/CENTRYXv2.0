import React, { useState, useRef } from "react";
import { HiX, HiUpload, HiDocumentText, HiExclamation, HiCheckCircle } from "react-icons/hi";
import { importarComprobantePdf, createComprobante, subirComprobante, getClientes, consultarRuc } from "../../api/comercialApi";

const TIPOS_DOC = ["Factura", "Boleta de Venta", "Nota de Crédito", "Nota de Débito"];

const OPCIONES_NOTA_CREDITO = [
  { valor: "anulacion_simple",  titulo: "Anulación sin cobro previo",       subtitulo: "Solo anula la factura, sin movimiento bancario." },
  { valor: "devolucion_cobro",  titulo: "Devolución de cobro realizado",    subtitulo: "Se devuelve el dinero cobrado al cliente." },
  { valor: "descuento_parcial", titulo: "Descuento sobre factura cobrada",  subtitulo: "Descuento parcial: se devuelve solo la diferencia." },
];

const TIPOS_SERVICIO = [
  "Alquiler de andamios", "Venta de andamios", "Reparación de andamios",
  "Venta de piezas", "Capacitación", "Transporte", "Montaje", "Otros",
];

const MAX_BYTES = 10 * 1024 * 1024;

const IGV_RATE = 0.18;
const round2 = (n) => Math.round(n * 100) / 100;

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

export default function ModalImportarPdf({ onClose, onImported }) {
  const [step, setStep]         = useState("upload"); // upload | preview
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile]         = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError]       = useState("");
  const fileRef = useRef();

  const [datos, setDatos]           = useState(null);
  const [noDetectados, setNoDetectados] = useState([]);
  const [confianza, setConfianza]   = useState(1);
  const [avisoDuplicado, setAvisoDuplicado] = useState("");

  const [clienteId, setClienteId]   = useState(null);
  const [rucMsg, setRucMsg]         = useState("");
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
      const r = await importarComprobantePdf(fd);
      setDatos({
        tipo_documento:        r.tipo_documento || TIPOS_DOC[0],
        numero_documento:      r.numero_documento || "",
        documento_relacionado: r.documento_relacionado || "",
        tipo_nota_credito:     "",
        fecha_emision:         r.fecha_emision || "",
        fecha_vencimiento:     r.fecha_vencimiento || "",
        ruc_cliente:           r.ruc_cliente || "",
        razon_social:          r.razon_social || "",
        tipo_servicio:         TIPOS_SERVICIO[0],
        descripcion:           r.descripcion || "",
        base_imponible:        r.base_imponible != null ? String(r.base_imponible) : "",
        igv:                   r.igv != null ? String(r.igv) : "",
        precio_venta:          r.precio_venta != null ? String(r.precio_venta) : "",
      });
      setNoDetectados(r.campos_no_detectados || []);
      setConfianza(r.confianza != null ? r.confianza : 1);
      setAvisoDuplicado(r.ya_registrado ? r.mensaje_duplicado : "");
      if (r.ruc_cliente) buscarPorRuc(r.ruc_cliente);
      setStep("preview");
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo procesar el PDF");
    } finally {
      setSubiendo(false);
    }
  };

  const buscarPorRuc = async (ruc) => {
    setClienteId(null);
    setRucMsg("");
    if (!ruc || ruc.length < 8) return;
    setBuscandoRuc(true);
    try {
      const res   = await getClientes({ search: ruc, per_page: 10 });
      const match = (res.data || []).find(c => c.ruc === ruc);
      if (match) {
        setClienteId(match.id);
        set("razon_social", match.razon_social);
        setRucMsg("Cliente existente — se usará su registro");
        return;
      }
      if (ruc.length === 11) {
        setRucMsg("Buscando en SUNAT...");
        try {
          const data = await consultarRuc(ruc);
          if (data?.razon_social) {
            set("razon_social", data.razon_social);
            setRucMsg("Razón social obtenida de SUNAT");
          } else {
            setRucMsg("RUC nuevo — se creará un cliente automáticamente");
          }
        } catch {
          setRucMsg("RUC nuevo — se creará un cliente automáticamente");
        }
      }
    } catch {
      setRucMsg("");
    } finally {
      setBuscandoRuc(false);
    }
  };

  const handleRucChange = (val) => {
    set("ruc_cliente", val);
    clearTimeout(rucTimer.current);
    rucTimer.current = setTimeout(() => buscarPorRuc(val), 600);
  };

  const handleBaseChange = (val) => {
    set("base_imponible", val);
    const base = parseFloat(val);
    if (!isNaN(base)) {
      const igv = round2(base * IGV_RATE);
      set("igv", String(igv));
      set("precio_venta", String(round2(base + igv)));
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) procesarArchivo(f);
  };

  const handleRegistrar = async () => {
    setErrorForm("");
    if (!datos.numero_documento.trim())  { setErrorForm("El N° de documento es obligatorio"); return; }
    if (!datos.ruc_cliente.trim())       { setErrorForm("El RUC del cliente es obligatorio"); return; }
    if (!datos.razon_social.trim())      { setErrorForm("La Razón Social es obligatoria"); return; }
    if (!datos.fecha_emision)            { setErrorForm("La fecha de emisión es obligatoria"); return; }
    if (datos.tipo_documento === "Nota de Crédito" && !datos.tipo_nota_credito) {
      setErrorForm("Selecciona el tipo de Nota de Crédito"); return;
    }
    const base = parseFloat(datos.base_imponible);
    if (isNaN(base))                     { setErrorForm("La base imponible debe ser un número válido"); return; }

    setRegistrando(true);
    try {
      const r = await createComprobante({
        tipo_documento:        datos.tipo_documento,
        numero_documento:      datos.numero_documento.trim(),
        documento_relacionado: datos.documento_relacionado?.trim() || null,
        tipo_nota_credito:     datos.tipo_documento === "Nota de Crédito" ? datos.tipo_nota_credito : null,
        ruc_cliente:           datos.ruc_cliente.trim(),
        razon_social_cliente:  datos.razon_social.trim(),
        cliente_id:            clienteId,
        tipo_servicio:         datos.tipo_servicio,
        descripcion:           datos.descripcion.trim() || null,
        base_imponible:        base,
        moneda:                "PEN",
        fecha:                 datos.fecha_emision,
        fecha_vencimiento:     datos.fecha_vencimiento || null,
        metodo_creacion:       "Importación PDF",
      });
      // Se conserva el PDF original de SUNAT para poder adjuntarlo tal cual al
      // enviar el comprobante por correo (sin regenerar una plantilla) — si
      // falla, el comprobante ya quedó registrado igual, así que no se
      // bloquea el flujo por esto.
      if (file) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          await subirComprobante(r.id, fd);
        } catch { /* el comprobante ya se registró; el adjunto es best-effort */ }
      }
      onImported();
    } catch (err) {
      setErrorForm(err.response?.data?.detail || "Error al registrar el comprobante");
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
          <h2 className="text-base font-semibold text-gray-800">Importar PDF de Factura SUNAT</h2>
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
                  {subiendo ? "Procesando PDF..." : "Arrastra tu PDF aquí o haz clic para seleccionar"}
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
                <Campo label="Tipo Documento" noDetectado={esNoDetectado("tipo_documento")}>
                  <select
                    value={datos.tipo_documento}
                    onChange={e => set("tipo_documento", e.target.value)}
                    className={esNoDetectado("tipo_documento") ? INPUT_WARN_CLS : INPUT_CLS}
                  >
                    {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo label="N° Documento" noDetectado={esNoDetectado("numero_documento")}>
                  <input
                    type="text"
                    value={datos.numero_documento}
                    onChange={e => set("numero_documento", e.target.value)}
                    className={esNoDetectado("numero_documento") ? INPUT_WARN_CLS : INPUT_CLS}
                    placeholder="F001-00003365"
                  />
                </Campo>
                {datos.tipo_documento === "Nota de Crédito" && (
                  <Campo label="Documento Relacionado">
                    <input
                      type="text"
                      value={datos.documento_relacionado}
                      onChange={e => set("documento_relacionado", e.target.value)}
                      className={INPUT_CLS}
                      placeholder="F001-00023 (factura que anula)"
                    />
                  </Campo>
                )}
              </div>

              {datos.tipo_documento === "Nota de Crédito" && (
                <div className="mb-4">
                  <Label>¿Qué tipo de Nota de Crédito es?</Label>
                  <div className="space-y-2">
                    {OPCIONES_NOTA_CREDITO.map(op => (
                      <button
                        key={op.valor}
                        type="button"
                        onClick={() => set("tipo_nota_credito", op.valor)}
                        className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                          datos.tipo_nota_credito === op.valor
                            ? "bg-red-50 border-red-500"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-800">{op.titulo}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{op.subtitulo}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-4">
                <Campo label="Fecha Emisión" noDetectado={esNoDetectado("fecha_emision")}>
                  <input
                    type="date"
                    value={datos.fecha_emision}
                    onChange={e => set("fecha_emision", e.target.value)}
                    className={esNoDetectado("fecha_emision") ? INPUT_WARN_CLS : INPUT_CLS}
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
                <Campo label="RUC Cliente" noDetectado={esNoDetectado("ruc_cliente")}>
                  <input
                    type="text"
                    value={datos.ruc_cliente}
                    onChange={e => handleRucChange(e.target.value)}
                    className={esNoDetectado("ruc_cliente") ? INPUT_WARN_CLS : INPUT_CLS}
                    placeholder="20613672088"
                    maxLength={11}
                  />
                  {(buscandoRuc || rucMsg) && (
                    <p className="text-xs text-gray-400 mt-1">{buscandoRuc ? "Buscando..." : rucMsg}</p>
                  )}
                </Campo>
                <Campo label="Razón Social" noDetectado={esNoDetectado("razon_social")}>
                  <input
                    type="text"
                    value={datos.razon_social}
                    onChange={e => set("razon_social", e.target.value)}
                    className={esNoDetectado("razon_social") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
                <Campo label="Tipo de Servicio">
                  <select
                    value={datos.tipo_servicio}
                    onChange={e => set("tipo_servicio", e.target.value)}
                    className={INPUT_WARN_CLS}
                  >
                    {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo label="Descripción" noDetectado={esNoDetectado("descripcion")}>
                  <input
                    type="text"
                    value={datos.descripcion}
                    onChange={e => set("descripcion", e.target.value)}
                    className={esNoDetectado("descripcion") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
                <Campo label="Base Imponible" noDetectado={esNoDetectado("base_imponible")}>
                  <input
                    type="number" step="0.01"
                    value={datos.base_imponible}
                    onChange={e => handleBaseChange(e.target.value)}
                    className={esNoDetectado("base_imponible") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
                <Campo label="IGV 18%" noDetectado={esNoDetectado("igv")}>
                  <input
                    type="number" step="0.01"
                    value={datos.igv}
                    onChange={e => set("igv", e.target.value)}
                    className={esNoDetectado("igv") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
                <Campo label="Total" noDetectado={esNoDetectado("precio_venta")}>
                  <input
                    type="number" step="0.01"
                    value={datos.precio_venta}
                    onChange={e => set("precio_venta", e.target.value)}
                    className={esNoDetectado("precio_venta") ? INPUT_WARN_CLS : INPUT_CLS}
                  />
                </Campo>
              </div>

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
              {registrando ? "Registrando..." : "Registrar Comprobante"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
