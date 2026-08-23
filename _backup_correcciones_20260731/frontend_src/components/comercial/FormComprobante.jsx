import React, { useState, useEffect, useRef } from "react";
import { HiX, HiDocumentText, HiSearch, HiCheckCircle, HiPrinter, HiMail } from "react-icons/hi";
import { createComprobante, updateComprobante, getClientes, consultarRuc, getProximoCorrelativoComprobante } from "../../api/comercialApi";
import { imprimirComprobanteVenta } from "./PlantillaComprobante";
import ModalEnviarCorreo from "../ModalEnviarCorreo";
import EliminarCascadaModal from "./EliminarCascadaModal";
import ModalConfirmarAnulacion from "./ModalConfirmarAnulacion";

const TIPOS_DOC = ["Factura", "Boleta de Venta", "Nota de Crédito", "Nota de Débito", "Anticipo de Cliente", "Recibo Interno"];
const NC_ND     = ["Nota de Crédito", "Nota de Débito"];
const ANTICIPO  = "Anticipo de Cliente";
const RECIBO_INTERNO = "Recibo Interno";

const TIPOS_SERVICIO = [
  "Alquiler de andamios", "Venta de andamios", "Reparación de andamios",
  "Venta de piezas", "Capacitación", "Transporte", "Montaje", "Otros",
];

const TIPO_DOC_COLOR = {
  "Factura":         "bg-blue-100 text-blue-700",
  "Boleta de Venta": "bg-green-100 text-green-700",
  "Nota de Crédito": "bg-red-100 text-red-700",
  "Nota de Débito":  "bg-orange-100 text-orange-700",
  [ANTICIPO]:        "bg-purple-100 text-purple-700",
  [RECIBO_INTERNO]:  "bg-gray-200 text-gray-700",
};

const TIPO_DOC_SELECTED = {
  "Factura":         "bg-blue-50 border-blue-500 text-blue-700",
  "Boleta de Venta": "bg-green-50 border-green-500 text-green-700",
  "Nota de Crédito": "bg-red-50 border-red-500 text-red-700",
  "Nota de Débito":  "bg-orange-50 border-orange-500 text-orange-700",
  [ANTICIPO]:        "bg-purple-50 border-purple-500 text-purple-700",
  [RECIBO_INTERNO]:  "bg-gray-100 border-gray-500 text-gray-700",
};

const IGV_RATE = 0.18;
const calcIgv   = (b) => parseFloat((b * IGV_RATE).toFixed(2));
const calcTotal = (b) => parseFloat((b + calcIgv(b)).toFixed(2));
const round2    = (n) => Math.round(n * 100) / 100;

// Convierte un monto a soles según la moneda seleccionada; retorna null si falta el tipo de cambio.
function convertirASoles(valor, moneda, tipoCambio) {
  if (moneda !== "USD") return valor;
  const tc = parseFloat(tipoCambio);
  if (!tc || tc <= 0) return null;
  return round2(valor * tc);
}

function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ── Detracción (solo Facturas) ─────────────────────────────────────────────
const TASAS_DETRACCION = [
  { concepto: "Alquiler de bienes muebles",       tasa: 10 },
  { concepto: "Mantenimiento y reparación",       tasa: 10 },
  { concepto: "Otros servicios empresariales",    tasa: 10 },
  { concepto: "Transporte de bienes",             tasa: 4 },
  { concepto: "Construcción",                     tasa: 4 },
  { concepto: "Contratos de construcción",        tasa: 4 },
  { concepto: "Demás servicios gravados con IGV", tasa: 12 },
  { concepto: "Otro",                             tasa: null },
];

// Fecha límite de depósito: día 5 del mes siguiente a la emisión.
function sugerirFechaLimiteDetraccion(fechaEmision) {
  if (!fechaEmision) return "";
  const [y, m] = fechaEmision.split("-").map(Number);
  let mm = m + 1, yy = y;
  if (mm > 12) { mm = 1; yy += 1; }
  return `${yy}-${String(mm).padStart(2, "0")}-05`;
}

const INPUT_CLS =
  "w-full border border-gray-200 rounded-lg px-4 py-3 text-sm transition-shadow " +
  "focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function fmtFecha(d) {
  // Ancla a mediodía local antes de formatear: "YYYY-MM-DD" (fecha pura,
  // sin hora) parsea como medianoche UTC, y en timezones detrás de UTC
  // (ej. Lima, UTC-5) toLocaleDateString la muestra un día antes.
  if (!d) return "—";
  return new Date(`${String(d).split("T")[0]}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtS(n) {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-S/ ${abs}` : `S/ ${abs}`;
}

function Label({ children }) {
  return <label className="text-xs font-medium text-gray-600 mb-1.5 block">{children}</label>;
}

// Boleta de Venta guarda DNI + Nombres/Apellidos en los mismos campos que
// Factura usa para RUC/Razón Social (ruc_cliente / razon_social_cliente) —
// el backend no tiene columnas propias para esto (ver payload en handleSubmit).
// Al editar una Boleta existente, reconstruye nombres/apellidos a partir del
// nombre completo guardado (primera palabra = nombres, resto = apellidos);
// es una heurística razonable ya que no hay un separador real almacenado.
function splitNombreApellido(nombreCompleto) {
  const partes = (nombreCompleto || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { nombres: "", apellidos: "" };
  if (partes.length === 1) return { nombres: partes[0], apellidos: "" };
  return { nombres: partes[0], apellidos: partes.slice(1).join(" ") };
}

function Section({ n, title, children, last }) {
  return (
    <div className={`py-5 ${last ? "" : "mb-3 border-b border-gray-100"}`}>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 shadow-sm">
          {n}
        </span>
        <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide leading-none">{title}</p>
      </div>
      <div className="pl-10">{children}</div>
    </div>
  );
}

export default function FormComprobante({ mode, comprobante, onClose, onSaved }) {
  const today    = new Date().toISOString().split("T")[0];
  const isView   = mode === "view";
  const isCreate = mode === "create";
  const [imprimiendo, setImprimiendo] = useState(false);
  const [showEnviarCorreo, setShowEnviarCorreo] = useState(false);
  const [envioInfo, setEnvioInfo] = useState(null);
  const [showEliminarCascada, setShowEliminarCascada] = useState(false);
  const [confirmarAnulacion, setConfirmarAnulacion] = useState(null); // { anulacion, notaCreditoId }

  const [form, setForm] = useState({
    tipo_documento:       "Factura",
    numero_documento:     "",
    documento_relacionado:"",
    ruc_cliente:          "",
    razon_social_cliente: "",
    dni:                  "",
    nombres:              "",
    apellidos:            "",
    cliente_id:           "",
    tipo_servicio:        TIPOS_SERVICIO[0],
    descripcion:          "",
    base_imponible:       "",
    igv:                  "",
    precio_venta:         "",
    monto:                "",
    moneda:               "PEN",
    tipo_cambio:          "3.75",
    fecha:                today,
    fecha_vencimiento:    addDays(today, 30),
    tiene_detraccion:        false,
    concepto_detraccion:     TASAS_DETRACCION[0].concepto,
    tasa_detraccion:         String(TASAS_DETRACCION[0].tasa),
    fecha_limite_detraccion: "",
  });

  const [clienteInfo, setClienteInfo]   = useState(null);
  const [buscandoRuc, setBuscandoRuc]   = useState(false);
  const [rucMsg,      setRucMsg]        = useState("");
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState("");
  const [loadingCorrelativo, setLoadingCorrelativo] = useState(false);
  const rucTimer = useRef(null);

  // Cargar datos si es edit/view
  useEffect(() => {
    if (comprobante) {
      const fechaBase = comprobante.fecha || today;
      const moneda    = comprobante.moneda || "PEN";
      const esUSD     = moneda === "USD";
      const montoOrig = comprobante.monto_original;

      // Reconstruye el monto en la moneda original para el campo editable.
      let baseRaw   = comprobante.base_imponible != null ? String(comprobante.base_imponible) : "";
      let precioRaw = comprobante.precio_venta   != null ? String(comprobante.precio_venta)   : "";
      let montoRaw  = comprobante.precio_venta   != null ? String(comprobante.precio_venta)   : "";
      if (esUSD && montoOrig != null) {
        if (comprobante.tipo_documento === ANTICIPO)              montoRaw  = String(montoOrig);
        else if (NC_ND.includes(comprobante.tipo_documento))      baseRaw   = String(round2(montoOrig / (1 + IGV_RATE)));
        else                                                      precioRaw = String(montoOrig);
      }

      const esBoletaEdit = comprobante.tipo_documento === "Boleta de Venta";
      const { nombres: nombresEdit, apellidos: apellidosEdit } = esBoletaEdit
        ? splitNombreApellido(comprobante.razon_social_cliente || comprobante.cliente_nombre)
        : { nombres: "", apellidos: "" };

      setForm({
        tipo_documento:       comprobante.tipo_documento       || "Factura",
        numero_documento:     comprobante.numero_documento     || "",
        documento_relacionado:comprobante.documento_relacionado|| "",
        ruc_cliente:          esBoletaEdit ? "" : (comprobante.ruc_cliente || ""),
        razon_social_cliente: esBoletaEdit ? "" : (comprobante.razon_social_cliente || comprobante.cliente_nombre || ""),
        dni:                  esBoletaEdit ? (comprobante.ruc_cliente || "") : "",
        nombres:              nombresEdit,
        apellidos:            apellidosEdit,
        cliente_id:           comprobante.cliente_id           ? String(comprobante.cliente_id) : "",
        tipo_servicio:        comprobante.tipo_servicio        || TIPOS_SERVICIO[0],
        descripcion:          comprobante.descripcion          || "",
        base_imponible:       baseRaw,
        igv:                  comprobante.igv                  != null ? String(comprobante.igv)            : "",
        precio_venta:         precioRaw,
        monto:                montoRaw,
        moneda,
        tipo_cambio:          comprobante.tipo_cambio          != null ? String(comprobante.tipo_cambio)    : "3.75",
        fecha:                fechaBase,
        fecha_vencimiento:    comprobante.fecha_vencimiento    || addDays(fechaBase, 30),
        tiene_detraccion:        comprobante.tiene_detraccion || false,
        concepto_detraccion:     comprobante.concepto_detraccion || TASAS_DETRACCION[0].concepto,
        tasa_detraccion:         comprobante.tasa_detraccion != null ? String(comprobante.tasa_detraccion) : String(TASAS_DETRACCION[0].tasa),
        fecha_limite_detraccion: comprobante.fecha_limite_detraccion || "",
      });
    }
  }, [comprobante]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  // Autogenerar correlativo AC-XXXXX / RI-XXXXX según el tipo elegido
  useEffect(() => {
    const esAC = form.tipo_documento === ANTICIPO;
    const esRIGen = form.tipo_documento === RECIBO_INTERNO;
    if ((esAC || esRIGen) && !form.numero_documento) {
      setLoadingCorrelativo(true);
      getProximoCorrelativoComprobante(esAC ? "AC" : "RI")
        .then(r => setForm(f => ({ ...f, numero_documento: r.proximo })))
        .catch(() => {})
        .finally(() => setLoadingCorrelativo(false));
    }
  }, [form.tipo_documento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar a Boleta de Venta, descarta cualquier resultado de búsqueda
  // por RUC (cliente_id/clienteInfo) que haya quedado de un tipo anterior —
  // Boleta identifica al cliente por DNI, no por un Cliente del sistema.
  useEffect(() => {
    if (form.tipo_documento === "Boleta de Venta") {
      setClienteInfo(null);
      setRucMsg("");
      set("cliente_id", "");
    }
  }, [form.tipo_documento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buscar cliente por RUC con debounce
  const handleRucChange = (val) => {
    set("ruc_cliente", val);
    setClienteInfo(null);
    setRucMsg("");
    set("cliente_id", "");
    clearTimeout(rucTimer.current);
    if (val.length >= 8) {
      rucTimer.current = setTimeout(() => buscarPorRuc(val), 600);
    }
  };

  const buscarPorRuc = async (ruc) => {
    setBuscandoRuc(true);
    setRucMsg("");
    try {
      // 1. Buscar en clientes del sistema primero
      const res   = await getClientes({ search: ruc, per_page: 10 });
      const match = (res.data || []).find(c => c.ruc === ruc);
      if (match) {
        setClienteInfo(match);
        setForm(f => ({ ...f, cliente_id: String(match.id), razon_social_cliente: match.razon_social }));
        return;
      }

      // 2. Si RUC es de 11 dígitos y no está en el sistema → consultar SUNAT vía backend
      if (ruc.length === 11) {
        setRucMsg("Buscando en SUNAT...");
        try {
          const data = await consultarRuc(ruc);
          if (data?.razon_social) {
            setForm(f => ({ ...f, razon_social_cliente: data.razon_social }));
            setRucMsg(`Razón social obtenida de SUNAT`);
          } else {
            setRucMsg("RUC no encontrado — ingrese la razón social manualmente");
          }
        } catch (err) {
          const detalle = err?.response?.data?.detail || "";
          setRucMsg(detalle.includes("no encontrado")
            ? "RUC no encontrado — ingrese la razón social manualmente"
            : "Error al consultar SUNAT — ingrese la razón social manualmente");
        }
      }
    } catch {
      setRucMsg("Error de conexión — ingrese la razón social manualmente");
    } finally {
      setBuscandoRuc(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.numero_documento.trim())     { setError("El N° de documento es requerido"); return; }
    if (esBoleta) {
      if (!/^\d{8}$/.test(form.dni.trim()))  { setError("El DNI debe tener exactamente 8 dígitos numéricos"); return; }
      if (!form.nombres.trim())              { setError("Los Nombres son requeridos"); return; }
      if (!form.apellidos.trim())            { setError("Los Apellidos son requeridos"); return; }
    } else {
      // Recibo Interno: el RUC/DNI es opcional (puede ser un cobro sin
      // cliente formalmente identificado) — Razón Social sigue siendo
      // obligatoria como identificador mínimo del cliente.
      if (!esRI && !form.ruc_cliente.trim()) { setError("El RUC es requerido"); return; }
      if (esFactura && !/^\d{11}$/.test(form.ruc_cliente.trim())) {
        setError("El RUC debe tener exactamente 11 dígitos numéricos"); return;
      }
      if (!form.razon_social_cliente.trim()) { setError("La Razón Social es requerida"); return; }
    }
    if (!form.fecha)                       { setError("La fecha de emisión es requerida"); return; }
    const esSinIgvSubmit       = form.tipo_documento === ANTICIPO || form.tipo_documento === RECIBO_INTERNO;
    const esFacturaBoletaSubmit = !NC_ND.includes(form.tipo_documento) && !esSinIgvSubmit;
    const esUSD = form.moneda === "USD";
    const tc    = esUSD ? parseFloat(form.tipo_cambio) : 1;
    if (esUSD && (isNaN(tc) || tc <= 0)) { setError("El tipo de cambio debe ser un número válido"); return; }

    let base = null, montoSinIgv = null, montoOriginal = null;
    if (esSinIgvSubmit) {
      const montoRaw = parseFloat(form.monto);
      if (isNaN(montoRaw))                 { setError("El monto debe ser un número válido"); return; }
      montoSinIgv = esUSD ? round2(montoRaw * tc) : montoRaw;
      montoOriginal = esUSD ? montoRaw : null;
    } else if (esFacturaBoletaSubmit) {
      const precioRaw = parseFloat(form.precio_venta);
      if (isNaN(precioRaw))                { setError("El precio de venta debe ser un número válido"); return; }
      const precioSoles = esUSD ? round2(precioRaw * tc) : precioRaw;
      base = round2(precioSoles / (1 + IGV_RATE));
      montoOriginal = esUSD ? precioRaw : null;
    } else {
      const baseRaw = parseFloat(form.base_imponible);
      if (isNaN(baseRaw))                  { setError("La base imponible debe ser un número válido"); return; }
      base = esUSD ? round2(baseRaw * tc) : baseRaw;
      montoOriginal = esUSD ? round2(baseRaw * (1 + IGV_RATE)) : null;
    }

    setSaving(true);
    try {
      const payload = {
        tipo_documento:        form.tipo_documento,
        numero_documento:      form.numero_documento.trim(),
        documento_relacionado: form.documento_relacionado.trim() || null,
        // Boleta identifica al cliente por DNI + Nombres/Apellidos; se guardan
        // en los mismos campos que Factura usa para RUC/Razón Social, ya que
        // el backend no tiene columnas propias para esto (no se modificó).
        ruc_cliente:           esBoleta ? form.dni.trim() : form.ruc_cliente.trim(),
        razon_social_cliente:  esBoleta ? `${form.nombres.trim()} ${form.apellidos.trim()}`.trim() : form.razon_social_cliente.trim(),
        cliente_id:            form.cliente_id ? parseInt(form.cliente_id) : null,
        tipo_servicio:         form.tipo_servicio,
        descripcion:           form.descripcion.trim() || null,
        base_imponible:        esSinIgvSubmit ? null : base,
        monto:                 esSinIgvSubmit ? montoSinIgv : null,
        moneda:                form.moneda,
        tipo_cambio:           esUSD ? tc : null,
        monto_original:        montoOriginal,
        fecha:                 form.fecha,
        fecha_vencimiento:     form.fecha_vencimiento || null,
        tiene_detraccion:        form.tipo_documento === "Factura" && form.tiene_detraccion,
        concepto_detraccion:     form.tipo_documento === "Factura" && form.tiene_detraccion ? form.concepto_detraccion : null,
        tasa_detraccion:         form.tipo_documento === "Factura" && form.tiene_detraccion ? parseFloat(form.tasa_detraccion) : null,
        fecha_limite_detraccion: form.tipo_documento === "Factura" && form.tiene_detraccion ? (form.fecha_limite_detraccion || null) : null,
      };
      let res;
      if (isCreate) res = await createComprobante(payload);
      else          res = await updateComprobante(comprobante.id, payload);
      if (res?.aviso) window.alert(res.aviso);
      if (res?.anulacion_pendiente) {
        setConfirmarAnulacion({ anulacion: res.anulacion_pendiente, notaCreditoId: res.id });
      } else {
        onSaved();
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar el comprobante");
    } finally {
      setSaving(false);
    }
  };

  const handleImprimir = async () => {
    setImprimiendo(true);
    try {
      // Misma lógica que el botón de la tabla en Ventas.jsx: si el
      // comprobante tiene un PDF original importado lo abre tal cual; si no,
      // cae a la plantilla generada por el sistema.
      await imprimirComprobanteVenta(comprobante);
    } catch {
      alert("No se pudo cargar el comprobante para imprimir");
    } finally {
      setImprimiendo(false);
    }
  };

  const titles = { create: "Nuevo Comprobante", edit: "Editar Comprobante", view: "Detalle del Comprobante" };
  const esNcNd     = NC_ND.includes(form.tipo_documento);
  const esAnticipo = form.tipo_documento === ANTICIPO;
  const esRI       = form.tipo_documento === RECIBO_INTERNO;
  const esSinIgv   = esAnticipo || esRI; // sin desglose de Base Imponible / IGV
  const esFactura  = form.tipo_documento === "Factura";
  const esBoleta   = form.tipo_documento === "Boleta de Venta";

  // Numeración de secciones — se calcula según qué secciones están visibles
  // para el tipo de documento actual (Recibo Interno oculta "Tipo de
  // Servicio" y "Fecha de Vencimiento").
  let _sec = 0;
  const nTipo         = ++_sec;
  const nNumero       = ++_sec;
  const nRelacionado  = esNcNd ? ++_sec : null;
  const nCliente      = ++_sec;
  const nServicio     = esRI ? null : ++_sec;
  const nDescripcion  = ++_sec;
  const nMontos       = ++_sec;
  const nFechas       = ++_sec;
  const nDetraccion   = esFactura ? ++_sec : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <HiDocumentText className="text-blue-600 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">{titles[mode]}</h2>
              {comprobante && (
                <span className="flex items-center gap-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_DOC_COLOR[comprobante.tipo_documento] || "bg-gray-100 text-gray-600"}`}>
                    {comprobante.tipo_documento}
                  </span>
                  {comprobante.estado === "Anulada" && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white tracking-wide">
                      ANULADA
                    </span>
                  )}
                  {(envioInfo || comprobante.enviado_email) && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
                      Enviado
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <HiX className="text-lg" />
          </button>
        </div>

        {/* Contenido */}
        <div className="overflow-y-auto flex-1 px-8 py-6">
          {isView ? (
            /* ── Vista detalle ── */
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <ViewField label="Tipo de Documento" value={comprobante.tipo_documento} badge={TIPO_DOC_COLOR[comprobante.tipo_documento]} />
                <ViewField label="N° Documento"       value={comprobante.numero_documento} mono />
                {comprobante.documento_relacionado && (
                  <ViewField label="Doc. Relacionado" value={comprobante.documento_relacionado} mono />
                )}
                <ViewField label="Fecha de Emisión"     value={fmtFecha(comprobante.fecha)} />
                <ViewField label="Fecha de Vencimiento" value={fmtFecha(comprobante.fecha_vencimiento)} />
                <ViewField label={comprobante.tipo_documento === "Boleta de Venta" ? "DNI" : "RUC"} value={comprobante.ruc_cliente} mono />
                <ViewField label={comprobante.tipo_documento === "Boleta de Venta" ? "Nombres y Apellidos" : "Razón Social"} value={comprobante.cliente_nombre} span />
                <ViewField label="Tipo de Servicio"    value={comprobante.tipo_servicio} span />
                {comprobante.descripcion && (
                  <ViewField label="Descripción"       value={comprobante.descripcion} span />
                )}
              </div>

              {/* Montos */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Montos</p>
                {comprobante.tipo_documento !== ANTICIPO && comprobante.tipo_documento !== RECIBO_INTERNO && (
                  <>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Base Imponible</span>
                      <span className="font-medium text-gray-800">{fmtS(comprobante.base_imponible)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">IGV (18%)</span>
                      <span className="text-gray-600">{fmtS(comprobante.igv)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                  <span className="font-semibold text-gray-800">{(comprobante.tipo_documento === ANTICIPO || comprobante.tipo_documento === RECIBO_INTERNO) ? "Monto" : "Precio de Venta"}</span>
                  <div className="text-right">
                    <span className="text-xl font-bold text-blue-700">{fmtS(comprobante.precio_venta)}</span>
                    {comprobante.moneda === "USD" && (
                      <p className="text-xs text-orange-600 font-medium mt-0.5">
                        US$ {(comprobante.monto_original ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · T/C {comprobante.tipo_cambio}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Información de Auditoría */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Información de Auditoría</p>
                <div className="space-y-1 text-sm text-gray-600">
                  <p>👤 Creado por: <span className="font-medium text-gray-800">{comprobante.creado_por || "—"}</span></p>
                  <p>📅 Fecha creación: <span className="font-medium text-gray-800">{comprobante.creado_en || "—"}</span></p>
                  <p>📥 Método de creación: <span className="font-medium text-gray-800">{comprobante.metodo_creacion || "Manual"}</span></p>
                  {comprobante.modificado_por && (
                    <>
                      <p>👤 Modificado por: <span className="font-medium text-gray-800">{comprobante.modificado_por}</span></p>
                      <p>📅 Última modificación: <span className="font-medium text-gray-800">{comprobante.modificado_en}</span></p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center gap-3 pt-1">
                <button onClick={() => setShowEliminarCascada(true)} className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium">
                  🗑 Eliminar proceso completo
                </button>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowEnviarCorreo(true)} className="flex items-center gap-2 px-5 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium">
                    <HiMail className="text-base" /> Enviar comprobante al cliente
                  </button>
                  <button onClick={handleImprimir} disabled={imprimiendo} className="flex items-center gap-2 px-5 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium disabled:opacity-50">
                    <HiPrinter className="text-base" /> {imprimiendo ? "Preparando..." : "Imprimir"}
                  </button>
                  <button onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Formulario ── */
            <form id="comp-form" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-100 mb-5">
                  {error}
                </div>
              )}

              {/* 1. Tipo de documento */}
              <Section n={nTipo} title="Tipo de Documento">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {TIPOS_DOC.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        tipo_documento: t,
                        numero_documento: (t === ANTICIPO || t === RECIBO_INTERNO) ? "" : f.numero_documento,
                      }))}
                      className={`py-3 px-4 rounded-lg text-xs font-medium border-2 transition-all ${
                        form.tipo_documento === t
                          ? `${TIPO_DOC_SELECTED[t]} shadow-sm`
                          : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Section>

              {/* 2. N° de documento */}
              <Section n={nNumero} title="N° de Documento">
                <div>
                  <Label>
                    Número *
                    {esSinIgv && <span className="ml-1 text-purple-600 font-normal normal-case">(auto)</span>}
                  </Label>
                  {esSinIgv ? (
                    <input
                      type="text"
                      value={loadingCorrelativo ? "Generando…" : (form.numero_documento || "Se generará automáticamente")}
                      readOnly
                      className={`${INPUT_CLS} font-mono font-semibold text-purple-700 bg-purple-50 border-purple-300 cursor-not-allowed`}
                    />
                  ) : (
                    <input
                      type="text"
                      value={form.numero_documento}
                      onChange={e => set("numero_documento", e.target.value)}
                      placeholder={
                        form.tipo_documento === "Factura"         ? "F001-00001" :
                        form.tipo_documento === "Boleta de Venta" ? "B001-00001" :
                        form.tipo_documento === "Nota de Crédito" ? "NC-00001"   : "ND-00001"
                      }
                      className={`${INPUT_CLS} font-mono`}
                    />
                  )}
                </div>
              </Section>

              {/* 3. Documento relacionado (solo NC/ND) */}
              {esNcNd && (
                <Section n={nRelacionado} title="Documento Relacionado">
                  <div>
                    <Label>N° de Factura o Boleta relacionada</Label>
                    <input
                      type="text"
                      value={form.documento_relacionado}
                      onChange={e => set("documento_relacionado", e.target.value)}
                      placeholder="F001-00001"
                      className={`${INPUT_CLS} font-mono`}
                    />
                  </div>
                </Section>
              )}

              {/* 4. Cliente */}
              <Section n={nCliente} title="Datos del Cliente">
                {esBoleta ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>DNI *</Label>
                      <input
                        type="text"
                        value={form.dni}
                        onChange={e => set("dni", e.target.value.replace(/\D/g, ""))}
                        placeholder="12345678"
                        maxLength={8}
                        inputMode="numeric"
                        className={`${INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div />
                    <div>
                      <Label>Nombres *</Label>
                      <input
                        type="text"
                        value={form.nombres}
                        onChange={e => set("nombres", e.target.value)}
                        placeholder="Nombres"
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <Label>Apellidos *</Label>
                      <input
                        type="text"
                        value={form.apellidos}
                        onChange={e => set("apellidos", e.target.value)}
                        placeholder="Apellidos"
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>RUC{esRI ? "" : " *"}</Label>
                      <div className="relative">
                        <input
                          type="text"
                          value={form.ruc_cliente}
                          onChange={e => handleRucChange(e.target.value)}
                          placeholder="20100012345"
                          maxLength={11}
                          className={`${INPUT_CLS} font-mono pr-9`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                          {buscandoRuc ? <HiSearch  className="text-gray-400 animate-pulse" /> :
                           clienteInfo ? <HiCheckCircle className="text-green-500" />          : null}
                        </span>
                      </div>
                      {clienteInfo && (
                        <p className="text-xs text-green-600 mt-1.5 font-medium">Cliente encontrado en el sistema</p>
                      )}
                      {!clienteInfo && rucMsg && (
                        <p className={`text-xs mt-1.5 font-medium ${rucMsg.startsWith("Razón") ? "text-blue-600" : rucMsg.startsWith("Buscando") ? "text-gray-400" : "text-amber-600"}`}>
                          {rucMsg}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>Razón Social *</Label>
                      <input
                        type="text"
                        value={form.razon_social_cliente}
                        onChange={e => set("razon_social_cliente", e.target.value)}
                        placeholder="Razón social"
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>
                )}
              </Section>

              {/* Tipo de servicio — Recibo Interno no lo pide (solo Cliente,
                  Descripción, Monto total y Fecha) */}
              {!esRI && (
                <Section n={nServicio} title="Tipo de Servicio">
                  <select
                    value={form.tipo_servicio}
                    onChange={e => set("tipo_servicio", e.target.value)}
                    className={INPUT_CLS}
                  >
                    {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Section>
              )}

              {/* Descripción */}
              <Section n={nDescripcion} title="Descripción">
                <textarea
                  value={form.descripcion}
                  onChange={e => set("descripcion", e.target.value)}
                  placeholder="Detalle del servicio prestado..."
                  rows={2}
                  className={`${INPUT_CLS} resize-none`}
                />
              </Section>

              {/* Montos */}
              <Section n={nMontos} title="Montos">
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-4">
                  {/* Moneda + Tipo de Cambio */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Moneda</Label>
                      <select
                        value={form.moneda}
                        onChange={e => set("moneda", e.target.value)}
                        className={`${INPUT_CLS} bg-white`}
                      >
                        <option value="PEN">🇵🇪 Soles (S/)</option>
                        <option value="USD">🇺🇸 Dólares (US$)</option>
                      </select>
                    </div>
                    {form.moneda === "USD" && (
                      <div>
                        <Label>Tipo de Cambio</Label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">S/</span>
                          <input
                            type="number" step="0.0001" min="0.01"
                            value={form.tipo_cambio}
                            placeholder="3.75"
                            onChange={e => set("tipo_cambio", e.target.value)}
                            className="w-full pl-9 pr-3 py-3 border border-orange-300 rounded-lg text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 bg-orange-50"
                          />
                        </div>
                        <p className="text-xs text-orange-500 mt-1">Tipo de cambio del día</p>
                      </div>
                    )}
                  </div>

                  {(() => {
                    const esUSD = form.moneda === "USD";
                    const monedaLbl = esUSD ? "US$" : "S/";

                    if (esSinIgv) {
                      const raw   = parseFloat(form.monto);
                      const total = !isNaN(raw) ? convertirASoles(raw, form.moneda, form.tipo_cambio) : null;
                      const labelMonto = esRI
                        ? (esUSD ? "Monto Total (US$) *" : "Monto Total (S/) *")
                        : (esUSD ? "Monto (US$) *" : "Monto (S/) *");
                      const hint = esRI
                        ? "Recibo Interno no lleva desglose de Base Imponible ni IGV"
                        : "Los anticipos no llevan desglose de Base Imponible ni IGV";
                      return (
                        <div>
                          <Label>{labelMonto}</Label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-500 text-base font-bold">{monedaLbl}</span>
                            <input
                              type="number"
                              value={form.monto}
                              onChange={e => set("monto", e.target.value)}
                              placeholder="0.00"
                              step="0.01"
                              className="pl-10 pr-4 py-3 border border-purple-200 rounded-lg text-lg w-full bg-white text-purple-700 font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                            />
                          </div>
                          {esUSD && total != null && (
                            <p className="text-xs text-orange-600 mt-1 font-medium">≈ S/ {total.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} soles</p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">{hint}</p>
                        </div>
                      );
                    }

                    if (esNcNd) {
                      const raw       = parseFloat(form.base_imponible);
                      const baseSoles = !isNaN(raw) ? convertirASoles(raw, form.moneda, form.tipo_cambio) : null;
                      const igvSoles  = baseSoles != null ? calcIgv(baseSoles)   : null;
                      const totalSoles= baseSoles != null ? calcTotal(baseSoles) : null;
                      const fmt = n => n != null ? n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
                      return (
                        <>
                          <div>
                            <Label>{esUSD ? "Base Imponible (US$) *" : "Base Imponible (S/) *"}</Label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">{monedaLbl}</span>
                              <input
                                type="number"
                                value={form.base_imponible}
                                onChange={e => set("base_imponible", e.target.value)}
                                placeholder="0.00"
                                step="0.01"
                                className={`${INPUT_CLS} pl-10 bg-white`}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>IGV (18%) — calculado (S/)</Label>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                                <div className="pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm w-full bg-gray-100 text-gray-500 cursor-not-allowed">{fmt(igvSoles)}</div>
                              </div>
                            </div>
                            <div>
                              <Label>Precio de Venta — calculado (S/)</Label>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 text-base font-bold">S/</span>
                                <div className="pl-10 pr-4 py-3 border border-blue-200 rounded-lg text-lg w-full bg-blue-50 text-blue-700 font-bold cursor-not-allowed">{fmt(totalSoles)}</div>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    }

                    // Factura / Boleta de Venta
                    const raw        = parseFloat(form.precio_venta);
                    const totalSoles = !isNaN(raw) ? convertirASoles(raw, form.moneda, form.tipo_cambio) : null;
                    const baseSoles  = totalSoles != null ? round2(totalSoles / (1 + IGV_RATE)) : null;
                    const igvSoles   = baseSoles  != null ? round2(totalSoles - baseSoles)       : null;
                    const fmt = n => n != null ? n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Base Imponible (S/) — calculado</Label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                              <div className="pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm w-full bg-gray-100 text-gray-500 cursor-not-allowed">{fmt(baseSoles)}</div>
                            </div>
                          </div>
                          <div>
                            <Label>IGV 18% (S/) — calculado</Label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                              <div className="pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm w-full bg-gray-100 text-gray-500 cursor-not-allowed">{fmt(igvSoles)}</div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <Label>{esUSD ? "Precio de Venta (US$) *" : "Precio de Venta (S/) *"}</Label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 text-base font-bold">{monedaLbl}</span>
                            <input
                              type="number"
                              value={form.precio_venta}
                              onChange={e => set("precio_venta", e.target.value)}
                              placeholder="0.00"
                              step="0.01"
                              className="pl-10 pr-4 py-3 border border-blue-200 rounded-lg text-lg w-full bg-white text-blue-700 font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                          {esUSD && totalSoles != null && (
                            <p className="text-xs text-orange-600 mt-1 font-medium">≈ S/ {fmt(totalSoles)} soles</p>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </Section>

              {/* Fechas */}
              <Section n={nFechas} title="Fechas" last={!esFactura}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Fecha {esRI ? "*" : "de Emisión *"}</Label>
                    <input
                      type="date"
                      value={form.fecha}
                      onChange={e => {
                        const nueva = e.target.value;
                        setForm(f => ({
                          ...f, fecha: nueva, fecha_vencimiento: addDays(nueva, 30),
                          fecha_limite_detraccion: f.tiene_detraccion ? sugerirFechaLimiteDetraccion(nueva) : f.fecha_limite_detraccion,
                        }));
                      }}
                      className={INPUT_CLS}
                    />
                  </div>
                  {!esRI && (
                    <div>
                      <Label>Fecha de Vencimiento</Label>
                      <input
                        type="date"
                        value={form.fecha_vencimiento}
                        onChange={e => set("fecha_vencimiento", e.target.value)}
                        className={INPUT_CLS}
                      />
                      <p className="text-xs text-gray-400 mt-1">Por defecto: emisión + 30 días</p>
                    </div>
                  )}
                </div>
              </Section>

              {/* Detracción (solo Facturas) */}
              {esFactura && (
                <Section n={nDetraccion} title="Detracción" last>
                  <div className="space-y-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.tiene_detraccion}
                        onChange={e => {
                          const checked = e.target.checked;
                          setForm(f => ({
                            ...f, tiene_detraccion: checked,
                            fecha_limite_detraccion: checked && !f.fecha_limite_detraccion ? sugerirFechaLimiteDetraccion(f.fecha) : f.fecha_limite_detraccion,
                          }));
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Sujeto a detracción</span>
                    </label>

                    {form.tiene_detraccion && (() => {
                      const raw           = parseFloat(form.precio_venta);
                      const totalSolesDet = !isNaN(raw) ? convertirASoles(raw, form.moneda, form.tipo_cambio) : null;
                      const tasaNum       = parseFloat(form.tasa_detraccion);
                      const montoDet      = totalSolesDet != null && !isNaN(tasaNum) ? round2(totalSolesDet * (tasaNum / 100)) : null;
                      const montoNeto     = totalSolesDet != null && montoDet != null ? round2(totalSolesDet - montoDet) : null;
                      return (
                        <div className="space-y-4">
                          <div>
                            <Label>Tipo de Servicio (Tasa)</Label>
                            <select
                              value={form.concepto_detraccion}
                              onChange={e => {
                                const concepto = e.target.value;
                                const opt = TASAS_DETRACCION.find(t => t.concepto === concepto);
                                setForm(f => ({ ...f, concepto_detraccion: concepto, tasa_detraccion: opt && opt.tasa != null ? String(opt.tasa) : f.tasa_detraccion }));
                              }}
                              className={INPUT_CLS}
                            >
                              {TASAS_DETRACCION.map(t => (
                                <option key={t.concepto} value={t.concepto}>{t.concepto}{t.tasa != null ? ` (${t.tasa}%)` : ""}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label>Tasa (%){form.concepto_detraccion === "Otro" ? " *" : ""}</Label>
                            <input
                              type="number" step="0.01" min="0" max="100"
                              value={form.tasa_detraccion}
                              onChange={e => set("tasa_detraccion", e.target.value)}
                              disabled={form.concepto_detraccion !== "Otro"}
                              className={`${INPUT_CLS} ${form.concepto_detraccion !== "Otro" ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}`}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Monto Detracción (S/) — calculado</Label>
                              <div className="px-4 py-3 border border-gray-200 rounded-lg text-sm bg-gray-100 text-gray-500">{fmtS(montoDet)}</div>
                            </div>
                            <div>
                              <Label>Monto Neto a Cobrar (S/) — calculado</Label>
                              <div className="px-4 py-3 border border-green-200 rounded-lg text-sm bg-green-50 text-green-700 font-semibold">{fmtS(montoNeto)}</div>
                            </div>
                          </div>
                          <div>
                            <Label>Fecha Límite de Depósito</Label>
                            <input
                              type="date"
                              value={form.fecha_limite_detraccion}
                              onChange={e => set("fecha_limite_detraccion", e.target.value)}
                              className={INPUT_CLS}
                            />
                            <p className="text-xs text-gray-400 mt-1">Sugerido: día 5 del mes siguiente a la emisión</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </Section>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        {!isView && (
          <div className="flex justify-end gap-3 px-8 py-5 border-t border-gray-100 flex-shrink-0">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit" form="comp-form" disabled={saving || loadingCorrelativo}
              className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60">
              {saving ? "Guardando..." : isCreate ? "Registrar Comprobante" : "Guardar Cambios"}
            </button>
          </div>
        )}
      </div>

      {isView && (
        <ModalEnviarCorreo
          visible={showEnviarCorreo}
          onClose={() => setShowEnviarCorreo(false)}
          comprobante={comprobante}
          onEnviado={(res) => setEnvioInfo(res)}
        />
      )}

      {showEliminarCascada && (
        <EliminarCascadaModal
          comprobanteId={comprobante.id}
          onClose={() => setShowEliminarCascada(false)}
          onEliminado={() => { setShowEliminarCascada(false); onSaved(); }}
        />
      )}

      {confirmarAnulacion && (
        <ModalConfirmarAnulacion
          anulacion={confirmarAnulacion.anulacion}
          notaCreditoId={confirmarAnulacion.notaCreditoId}
          onResuelto={() => { setConfirmarAnulacion(null); onSaved(); }}
        />
      )}
    </div>
  );
}

function ViewField({ label, value, mono, bold, span, badge }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      {badge ? (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>{value}</span>
      ) : (
        <p className={`text-sm ${mono ? "font-mono font-semibold text-blue-700" : ""} ${bold ? "font-bold text-blue-700 text-base" : "text-gray-800"}`}>
          {value || "—"}
        </p>
      )}
    </div>
  );
}
