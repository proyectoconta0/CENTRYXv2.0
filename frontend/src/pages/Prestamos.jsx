import React, { useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import Toast from "../components/Toast";
import {
  getPrestamos, getResumenPrestamos, getPrestamo,
  crearPrestamo, actualizarPrestamo, eliminarPrestamo,
  pagarCuotaPrestamo, editarCuotaPrestamo, eliminarCuotaPrestamo,
  calcularAmortizacion, getCuentasBancarias,
  guardarCronograma, pagarCuotaCronograma, editarFilaCronograma, eliminarFilaCronograma,
  importarCronogramaPdf,
} from "../api/comercialApi";
import {
  HiPlus, HiX, HiEye, HiPencil, HiCreditCard, HiTrash, HiExclamationCircle,
} from "react-icons/hi";

const TIPOS_TASA = ["TEM", "TEA", "TNA", "TNM", "TCEA", "Personalizada"];
const TIPOS_TASA_LABEL = {
  TEM: "TEM - Tasa Efectiva Mensual",
  TEA: "TEA - Tasa Efectiva Anual",
  TNA: "TNA - Tasa Nominal Anual",
  TNM: "TNM - Tasa Nominal Mensual",
  TCEA: "TCEA - Tasa de Costo Efectivo Anual",
  Personalizada: "Personalizada",
};
const METODOS_PAGO = ["Efectivo", "Transferencia", "Cheque"];
const METODOS_CON_CUENTA = ["Transferencia", "Cheque"];

const ESTADO_INFO = {
  activo:     { label: "Activo",     cls: "bg-blue-100 text-blue-700" },
  pagado:     { label: "Pagado",     cls: "bg-green-100 text-green-700" },
  cancelado:  { label: "Cancelado",  cls: "bg-gray-200 text-gray-600" },
};

const ESTADO_CUOTA_INFO = {
  pagado:    { label: "✅ Pagado",    cls: "bg-green-100 text-green-700" },
  pendiente: { label: "⏳ Pendiente", cls: "bg-gray-100 text-gray-600" },
  vencido:   { label: "🔴 Vencido",   cls: "bg-red-100 text-red-700" },
};

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(n) {
  if (n == null) return "—";
  return `${(Number(n) * 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
function fmtFecha(d) {
  if (!d) return "—";
  const [y, m, dd] = String(d).split("-");
  return `${dd}/${m}/${y}`;
}
function hoy() { return new Date().toISOString().slice(0, 10); }
function parsearError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return "Ocurrió un error inesperado.";
  if (Array.isArray(d)) return "Error de validación: " + d.map(e => e.msg).join(", ");
  return String(d);
}
// Espejo de convertir_a_tasa_mensual() en backend/app/routers/prestamos.py —
// para mostrar la tasa mensual equivalente en tiempo real sin ida y vuelta al servidor.
function tasaMensualEquivalente(tipoTasa, porcentajeStr) {
  const pct = parseFloat(porcentajeStr);
  if (!tipoTasa || isNaN(pct)) return 0;
  const p = pct / 100;
  switch (tipoTasa) {
    case "TEM": return p;
    case "TEA": return Math.pow(1 + p, 1 / 12) - 1;
    case "TNA": return p / 12;
    case "TNM": return p;
    case "TCEA": return Math.pow(1 + p, 1 / 12) - 1;
    case "Personalizada": return p;
    default: return 0;
  }
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
// Espejo de _sumar_meses() en backend/app/routers/prestamos.py.
function sumarMesesJS(fechaStr, n) {
  const [y, m, d] = (fechaStr || hoy()).split("-").map(Number);
  const mesTotal = (m - 1) + n;
  const anio = y + Math.floor(mesTotal / 12);
  const mes = (mesTotal % 12) + 1;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const INPUT_CLS = "w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const LABEL_CLS = "text-xs font-semibold text-gray-700 uppercase";

// ── Modal: Nuevo / Editar Préstamo ──────────────────────────────────────────
function ModalPrestamo({ grupo, prestamo, onClose, onSaved }) {
  const esEdicion = !!prestamo;
  const tipoInicial = prestamo?.tipo || (grupo === "recibido" ? "recibido_banco" : "otorgado_tercero");

  const [form, setForm] = useState({
    tipo:              tipoInicial,
    nombre_tercero:    prestamo?.nombre_tercero || "",
    ruc_dni_tercero:   prestamo?.ruc_dni_tercero || "",
    monto_original:    prestamo ? String(prestamo.monto_original) : "",
    fecha_inicio:      prestamo?.fecha_inicio || hoy(),
    fecha_vencimiento: prestamo?.fecha_vencimiento || "",
    descripcion:       prestamo?.descripcion || "",
    aplica_interes:    prestamo ? prestamo.aplica_interes : true,
    tipo_tasa:         prestamo?.tipo_tasa || "TEM",
    porcentaje_tasa:   prestamo?.porcentaje_tasa != null ? String(prestamo.porcentaje_tasa) : "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const esEmpleado = form.tipo === "otorgado_empleado";
  const aplicaInteres = !esEmpleado && form.aplica_interes;

  // A Empleado nunca lleva interés (regla del negocio).
  useEffect(() => {
    if (esEmpleado && form.aplica_interes) set("aplica_interes", false);
  }, [esEmpleado]); // eslint-disable-line react-hooks/exhaustive-deps

  const tasaMensual = aplicaInteres ? tasaMensualEquivalente(form.tipo_tasa, form.porcentaje_tasa) : 0;

  // Preview tabla de amortización (opcional)
  const [numCuotas, setNumCuotas] = useState("12");
  const [tablaPreview, setTablaPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  async function verAmortizacion() {
    setError("");
    const monto = parseFloat(form.monto_original);
    const n = parseInt(numCuotas);
    if (isNaN(monto) || monto <= 0) { setError("Ingresa un monto válido antes de ver la tabla"); return; }
    if (isNaN(n) || n <= 0) { setError("Ingresa un número de cuotas válido"); return; }
    setLoadingPreview(true);
    try {
      const r = await calcularAmortizacion({
        monto, tasa_mensual: tasaMensual, num_cuotas: n, fecha_inicio: form.fecha_inicio || hoy(),
      });
      setTablaPreview(r.tabla || []);
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function guardar() {
    setError("");
    if (!form.nombre_tercero.trim()) { setError("El nombre/razón social es obligatorio"); return; }
    const montoNum = parseFloat(form.monto_original);
    if (isNaN(montoNum) || montoNum <= 0) { setError("El monto debe ser mayor a 0"); return; }
    if (!form.fecha_inicio) { setError("La fecha de inicio es obligatoria"); return; }
    if (aplicaInteres && (form.porcentaje_tasa === "" || isNaN(parseFloat(form.porcentaje_tasa)))) {
      setError("Ingresa el porcentaje de la tasa"); return;
    }

    const payload = {
      tipo:              form.tipo,
      nombre_tercero:    form.nombre_tercero.trim(),
      ruc_dni_tercero:   form.ruc_dni_tercero.trim() || null,
      monto_original:    montoNum,
      fecha_inicio:      form.fecha_inicio,
      fecha_vencimiento: form.fecha_vencimiento || null,
      aplica_interes:    aplicaInteres,
      tipo_tasa:         aplicaInteres ? form.tipo_tasa : null,
      porcentaje_tasa:   aplicaInteres ? parseFloat(form.porcentaje_tasa) : null,
      descripcion:       form.descripcion.trim() || null,
    };

    setSaving(true);
    try {
      if (esEdicion) {
        await actualizarPrestamo(prestamo.id, payload);
      } else {
        await crearPrestamo(payload);
      }
      onSaved();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">
            {esEdicion ? "Editar Préstamo" : grupo === "recibido" ? "Nuevo Préstamo Recibido" : "Nuevo Préstamo Otorgado"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={LABEL_CLS}>Tipo</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {grupo === "recibido" ? (
                <>
                  <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="tipo" disabled={esEdicion} checked={form.tipo === "recibido_banco"} onChange={() => set("tipo", "recibido_banco")} />
                    <span className="text-sm text-gray-700">De Banco</span>
                  </label>
                  <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="tipo" disabled={esEdicion} checked={form.tipo === "recibido_tercero"} onChange={() => set("tipo", "recibido_tercero")} />
                    <span className="text-sm text-gray-700">De Tercero</span>
                  </label>
                </>
              ) : (
                <>
                  <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="tipo" disabled={esEdicion} checked={form.tipo === "otorgado_tercero"} onChange={() => set("tipo", "otorgado_tercero")} />
                    <span className="text-sm text-gray-700">A Tercero (con intereses)</span>
                  </label>
                  <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="tipo" disabled={esEdicion} checked={form.tipo === "otorgado_empleado"} onChange={() => set("tipo", "otorgado_empleado")} />
                    <span className="text-sm text-gray-700">A Empleado (sin intereses)</span>
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Nombre / Razón Social <span className="text-red-500">*</span></label>
              <input type="text" value={form.nombre_tercero} onChange={e => set("nombre_tercero", e.target.value)}
                placeholder="Nombre del prestamista/prestatario" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>RUC / DNI</label>
              <input type="text" value={form.ruc_dni_tercero} onChange={e => set("ruc_dni_tercero", e.target.value)}
                placeholder="20123456789" className={`${INPUT_CLS} font-mono`} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={LABEL_CLS}>Monto (S/) <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" min="0.01" value={form.monto_original}
                onChange={e => set("monto_original", e.target.value)} placeholder="0.00" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha Inicio <span className="text-red-500">*</span></label>
              <input type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha Vencimiento</label>
              <input type="date" value={form.fecha_vencimiento} onChange={e => set("fecha_vencimiento", e.target.value)} className={INPUT_CLS} />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Descripción</label>
            <textarea value={form.descripcion} onChange={e => set("descripcion", e.target.value)} rows={2}
              placeholder="Detalle del préstamo…" className={`${INPUT_CLS} resize-none`} />
          </div>

          {esEmpleado && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Los préstamos a empleados no generan intereses.
            </p>
          )}

          {aplicaInteres && (
            <div className="border border-gray-200 rounded-xl p-4 space-y-4 bg-gray-50">
              <div>
                <label className={LABEL_CLS}>Tipo de Tasa</label>
                <select value={form.tipo_tasa} onChange={e => set("tipo_tasa", e.target.value)} className={INPUT_CLS}>
                  {TIPOS_TASA.map(t => <option key={t} value={t}>{TIPOS_TASA_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4 items-end">
                <div>
                  <label className={LABEL_CLS}>Porcentaje (%)</label>
                  <input type="number" step="0.01" min="0" value={form.porcentaje_tasa}
                    onChange={e => set("porcentaje_tasa", e.target.value)} placeholder="0.00" className={INPUT_CLS} />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-gray-500">Tasa mensual equivalente</p>
                  <p className="text-sm font-bold text-blue-700">{fmtPct(tasaMensual)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Preview Tabla de Amortización (opcional)</p>
            <div className="flex items-end gap-3">
              <div className="w-32">
                <label className={LABEL_CLS}>N° Cuotas</label>
                <input type="number" min="1" value={numCuotas} onChange={e => setNumCuotas(e.target.value)} className={INPUT_CLS} />
              </div>
              <button onClick={verAmortizacion} disabled={loadingPreview}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
                {loadingPreview ? "Calculando…" : "Ver tabla de amortización"}
              </button>
            </div>

            {tablaPreview && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase">
                    <tr className="border-b border-gray-100">
                      <th className="py-2 text-left font-semibold">N°</th>
                      <th className="py-2 text-left font-semibold">Fecha</th>
                      <th className="py-2 text-right font-semibold">Saldo Inicial</th>
                      <th className="py-2 text-right font-semibold">Amortización</th>
                      <th className="py-2 text-right font-semibold">Interés</th>
                      <th className="py-2 text-right font-semibold">Cuota Total</th>
                      <th className="py-2 text-right font-semibold">Saldo Final</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tablaPreview.map(c => (
                      <tr key={c.numero_cuota}>
                        <td className="py-2 text-gray-600">{c.numero_cuota}</td>
                        <td className="py-2 text-gray-600 whitespace-nowrap">{fmtFecha(c.fecha_pago)}</td>
                        <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.saldo_inicial)}</td>
                        <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.amortizacion)}</td>
                        <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.interes)}</td>
                        <td className="py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(c.cuota_total)}</td>
                        <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.saldo_final)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={guardar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Nuevo Préstamo — wizard 2 pasos (datos básicos + cronograma) ────
const METODOS_GENERACION = [
  { key: "frances", label: "Cuota fija (francesa)" },
  { key: "fija",    label: "Amortización fija" },
  { key: "manual",  label: "Ingresar manualmente" },
  { key: "pdf",     label: "Importar Cronograma de Pagos" },
];

function ModalNuevoPrestamoWizard({ grupo, onClose, onSaved }) {
  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState({
    tipo:              grupo === "recibido" ? "recibido_banco" : "otorgado_tercero",
    nombre_tercero:    "",
    ruc_dni_tercero:   "",
    monto_original:    "",
    fecha_inicio:      hoy(),
    fecha_vencimiento: "",
    descripcion:       "",
    aplica_interes:    true,
    tipo_tasa:         "TEM",
    porcentaje_tasa:   "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const esEmpleado = form.tipo === "otorgado_empleado";
  const aplicaInteres = !esEmpleado && form.aplica_interes;
  useEffect(() => {
    if (esEmpleado && form.aplica_interes) set("aplica_interes", false);
  }, [esEmpleado]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasaMensual = aplicaInteres ? tasaMensualEquivalente(form.tipo_tasa, form.porcentaje_tasa) : 0;

  // ── Cronograma (Paso 2) ──────────────────────────────────────────────────
  const [metodoGeneracion, setMetodoGeneracion] = useState("frances");
  const [numCuotasGen, setNumCuotasGen] = useState("12");
  const [filas, setFilas] = useState([]);
  const [generando, setGenerando] = useState(false);
  const [procesandoPdf, setProcesandoPdf] = useState(false);
  const [pdfInfo, setPdfInfo] = useState(null);
  const pdfInputRef = useRef(null);
  const keyCounter = useRef(0);
  const nextKey = () => { keyCounter.current += 1; return keyCounter.current; };

  function propagarDesde(filasArr, index) {
    const nuevas = [...filasArr];
    for (let i = index; i < nuevas.length; i++) {
      const f = { ...nuevas[i] };
      if (i > index) f.saldo_inicial = nuevas[i - 1].saldo_final;
      const amort = parseFloat(f.amortizacion) || 0;
      f.saldo_final = round2(Math.max((parseFloat(f.saldo_inicial) || 0) - amort, 0));
      nuevas[i] = f;
    }
    return nuevas.map((f, i) => ({ ...f, numero_cuota: i + 1 }));
  }

  function validarPaso1() {
    if (!form.nombre_tercero.trim()) { setError("El nombre/razón social es obligatorio"); return false; }
    const montoNum = parseFloat(form.monto_original);
    if (isNaN(montoNum) || montoNum <= 0) { setError("El monto debe ser mayor a 0"); return false; }
    if (!form.fecha_inicio) { setError("La fecha de inicio es obligatoria"); return false; }
    if (aplicaInteres && (form.porcentaje_tasa === "" || isNaN(parseFloat(form.porcentaje_tasa)))) {
      setError("Ingresa el porcentaje de la tasa"); return false;
    }
    return true;
  }

  function irACronograma() {
    setError("");
    if (!validarPaso1()) return;
    setPaso(2);
  }

  async function generar() {
    setError("");
    const monto = parseFloat(form.monto_original);
    const n = parseInt(numCuotasGen);
    if (isNaN(monto) || monto <= 0) { setError("Ingresa un monto válido en el Paso 1"); return; }
    if (isNaN(n) || n <= 0) { setError("Ingresa un número de cuotas válido"); return; }

    if (metodoGeneracion === "manual") {
      let saldo = round2(monto);
      const nuevas = [];
      for (let i = 1; i <= n; i++) {
        nuevas.push({
          _key: nextKey(), numero_cuota: i,
          fecha_pago: sumarMesesJS(form.fecha_inicio, i),
          saldo_inicial: saldo, amortizacion: 0, interes: 0, seguro_desgravamen: 0, cuota_total: 0, saldo_final: saldo,
          es_adelanto: false, monto_adelanto: 0,
        });
      }
      setFilas(nuevas);
      return;
    }

    setGenerando(true);
    try {
      const r = await calcularAmortizacion({
        monto, tasa_mensual: tasaMensual, num_cuotas: n,
        fecha_inicio: form.fecha_inicio, metodo: metodoGeneracion,
      });
      setFilas((r.tabla || []).map(c => ({ _key: nextKey(), seguro_desgravamen: 0, ...c })));
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setGenerando(false);
    }
  }

  async function handleArchivoPdf(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo si hace falta reintentar
    if (!file) return;

    setError("");
    setPdfInfo(null);
    setProcesandoPdf(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const r = await importarCronogramaPdf(formData);

      // Autocompletar campos del préstamo detectados en el PDF.
      if (r.monto != null) set("monto_original", String(r.monto));
      if (r.fecha_inicio) set("fecha_inicio", r.fecha_inicio);
      if (r.tea != null) {
        set("aplica_interes", true);
        set("tipo_tasa", "TEA");
        set("porcentaje_tasa", String(r.tea));
      }
      if (r.numero_credito && !form.descripcion.trim()) {
        set("descripcion", `Crédito BCP N° ${r.numero_credito}`);
      }

      // Llenar la tabla editable con el cronograma detectado.
      setFilas((r.cuotas || []).map(c => ({ _key: nextKey(), ...c })));
      setPdfInfo(r);

      if (r.estado === "no_valido") {
        setError("No se pudo detectar el cronograma en el PDF. Verifica el archivo o ingresa los datos manualmente.");
      }
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setProcesandoPdf(false);
    }
  }

  function actualizarFila(index, campo, valorCrudo) {
    setFilas(prev => {
      let filas = [...prev];
      let f = { ...filas[index] };
      if (campo === "fecha_pago") {
        f.fecha_pago = valorCrudo;
        filas[index] = f;
        return filas;
      }
      f[campo] = valorCrudo;

      if (campo === "amortizacion" || campo === "interes" || campo === "seguro_desgravamen") {
        const amort  = parseFloat(f.amortizacion) || 0;
        const interes = parseFloat(f.interes) || 0;
        const seguro = parseFloat(f.seguro_desgravamen) || 0;
        f.cuota_total = round2(amort + interes + seguro);
      } else if (campo === "cuota_total") {
        const totalNuevo = parseFloat(valorCrudo) || 0;
        const amortActual  = parseFloat(filas[index].amortizacion) || 0;
        const interesActual = parseFloat(filas[index].interes) || 0;
        const seguroActual = parseFloat(filas[index].seguro_desgravamen) || 0;
        const suma = amortActual + interesActual;
        const disponible = round2(totalNuevo - seguroActual);
        if (suma > 0) {
          f.amortizacion = round2(disponible * (amortActual / suma));
          f.interes = round2(disponible - f.amortizacion);
        } else {
          f.amortizacion = round2(disponible);
          f.interes = 0;
        }
      }
      filas[index] = f;
      return propagarDesde(filas, index);
    });
  }

  function actualizarMontoAdelanto(index, valorCrudo) {
    setFilas(prev => {
      let filas = [...prev];
      const monto = parseFloat(valorCrudo) || 0;
      filas[index] = {
        ...filas[index], monto_adelanto: valorCrudo,
        amortizacion: round2(monto), interes: 0, cuota_total: round2(monto),
      };
      return propagarDesde(filas, index);
    });
  }

  function agregarFila() {
    setFilas(prev => {
      const ultima = prev[prev.length - 1];
      const saldoBase = ultima ? ultima.saldo_final : (parseFloat(form.monto_original) || 0);
      const fechaBase = ultima ? ultima.fecha_pago : form.fecha_inicio;
      const nueva = {
        _key: nextKey(), numero_cuota: prev.length + 1,
        fecha_pago: sumarMesesJS(fechaBase, 1),
        saldo_inicial: saldoBase, amortizacion: 0, interes: 0, seguro_desgravamen: 0, cuota_total: 0, saldo_final: saldoBase,
        es_adelanto: false, monto_adelanto: 0,
      };
      return propagarDesde([...prev, nueva], prev.length);
    });
  }

  function agregarAdelanto() {
    setFilas(prev => {
      const ultima = prev[prev.length - 1];
      const saldoBase = ultima ? ultima.saldo_final : (parseFloat(form.monto_original) || 0);
      const fechaBase = ultima ? ultima.fecha_pago : form.fecha_inicio;
      const nueva = {
        _key: nextKey(), numero_cuota: prev.length + 1,
        fecha_pago: fechaBase, saldo_inicial: saldoBase,
        amortizacion: 0, interes: 0, seguro_desgravamen: 0, cuota_total: 0, saldo_final: saldoBase,
        es_adelanto: true, monto_adelanto: 0,
      };
      return propagarDesde([...prev, nueva], prev.length);
    });
  }

  function eliminarFila(index) {
    setFilas(prev => propagarDesde(prev.filter((_, i) => i !== index), 0));
  }

  async function crearYGuardar() {
    setError("");
    if (!validarPaso1()) { setPaso(1); return; }
    if (filas.length === 0) { setError("Genera o ingresa al menos una cuota en el cronograma"); return; }

    const montoNum = parseFloat(form.monto_original);
    const payloadPrestamo = {
      tipo:              form.tipo,
      nombre_tercero:    form.nombre_tercero.trim(),
      ruc_dni_tercero:   form.ruc_dni_tercero.trim() || null,
      monto_original:    montoNum,
      fecha_inicio:      form.fecha_inicio,
      fecha_vencimiento: form.fecha_vencimiento || null,
      aplica_interes:    aplicaInteres,
      tipo_tasa:         aplicaInteres ? form.tipo_tasa : null,
      porcentaje_tasa:   aplicaInteres ? parseFloat(form.porcentaje_tasa) : null,
      descripcion:       form.descripcion.trim() || null,
    };
    const payloadCuotas = filas.map(f => ({
      numero_cuota:   f.numero_cuota,
      fecha_pago:     f.fecha_pago,
      saldo_inicial:  parseFloat(f.saldo_inicial) || 0,
      amortizacion:   parseFloat(f.amortizacion) || 0,
      interes:        parseFloat(f.interes) || 0,
      seguro_desgravamen: parseFloat(f.seguro_desgravamen) || 0,
      seguro_bien:    parseFloat(f.seguro_bien) || 0,
      comisiones:     parseFloat(f.comisiones) || 0,
      cuota_total:    parseFloat(f.cuota_total) || 0,
      saldo_final:    parseFloat(f.saldo_final) || 0,
      es_adelanto:    !!f.es_adelanto,
      monto_adelanto: parseFloat(f.monto_adelanto) || 0,
    }));

    setSaving(true);
    try {
      const nuevo = await crearPrestamo(payloadPrestamo);
      await guardarCronograma(nuevo.id, payloadCuotas);
      onSaved();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">
            {grupo === "recibido" ? "Nuevo Préstamo Recibido" : "Nuevo Préstamo Otorgado"}
            <span className="text-gray-400 font-normal"> — Paso {paso} de 2</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>

        {paso === 1 && (
          <div className="p-6 space-y-4 max-w-2xl">
            <div>
              <label className={LABEL_CLS}>Tipo</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {grupo === "recibido" ? (
                  <>
                    <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="tipo" checked={form.tipo === "recibido_banco"} onChange={() => set("tipo", "recibido_banco")} />
                      <span className="text-sm text-gray-700">De Banco</span>
                    </label>
                    <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="tipo" checked={form.tipo === "recibido_tercero"} onChange={() => set("tipo", "recibido_tercero")} />
                      <span className="text-sm text-gray-700">De Tercero</span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="tipo" checked={form.tipo === "otorgado_tercero"} onChange={() => set("tipo", "otorgado_tercero")} />
                      <span className="text-sm text-gray-700">A Tercero (con intereses)</span>
                    </label>
                    <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="tipo" checked={form.tipo === "otorgado_empleado"} onChange={() => set("tipo", "otorgado_empleado")} />
                      <span className="text-sm text-gray-700">A Empleado (sin intereses)</span>
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>Nombre / Razón Social <span className="text-red-500">*</span></label>
                <input type="text" value={form.nombre_tercero} onChange={e => set("nombre_tercero", e.target.value)}
                  placeholder="Nombre del prestamista/prestatario" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>RUC / DNI</label>
                <input type="text" value={form.ruc_dni_tercero} onChange={e => set("ruc_dni_tercero", e.target.value)}
                  placeholder="20123456789" className={`${INPUT_CLS} font-mono`} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={LABEL_CLS}>Monto Original (S/) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" min="0.01" value={form.monto_original}
                  onChange={e => set("monto_original", e.target.value)} placeholder="0.00" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Fecha Inicio <span className="text-red-500">*</span></label>
                <input type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Fecha Vencimiento</label>
                <input type="date" value={form.fecha_vencimiento} onChange={e => set("fecha_vencimiento", e.target.value)} className={INPUT_CLS} />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Descripción</label>
              <textarea value={form.descripcion} onChange={e => set("descripcion", e.target.value)} rows={2}
                placeholder="Detalle del préstamo…" className={`${INPUT_CLS} resize-none`} />
            </div>

            {esEmpleado && (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                Los préstamos a empleados no generan intereses.
              </p>
            )}

            {aplicaInteres && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-4 bg-gray-50">
                <div>
                  <label className={LABEL_CLS}>Tipo de Tasa</label>
                  <select value={form.tipo_tasa} onChange={e => set("tipo_tasa", e.target.value)} className={INPUT_CLS}>
                    {TIPOS_TASA.map(t => <option key={t} value={t}>{TIPOS_TASA_LABEL[t]}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4 items-end">
                  <div>
                    <label className={LABEL_CLS}>Porcentaje (%)</label>
                    <input type="number" step="0.01" min="0" value={form.porcentaje_tasa}
                      onChange={e => set("porcentaje_tasa", e.target.value)} placeholder="0.00" className={INPUT_CLS} />
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs text-gray-500">Tasa mensual equivalente</p>
                    <p className="text-sm font-bold text-blue-700">{fmtPct(tasaMensual)}</p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}
          </div>
        )}

        {paso === 2 && (
          <div className="p-6 space-y-4">
            <div>
              <label className={LABEL_CLS}>Opciones de Generación</label>
              <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {METODOS_GENERACION.map(m => (
                  <label key={m.key} className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="metodo_gen" checked={metodoGeneracion === m.key} onChange={() => setMetodoGeneracion(m.key)} />
                    <span className="text-xs text-gray-700">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {metodoGeneracion === "pdf" ? (
              <div>
                <label className={LABEL_CLS}>Cronograma de Pagos (PDF)</label>
                <div className="mt-1.5 flex items-center gap-3">
                  <input type="file" accept="application/pdf" ref={pdfInputRef} onChange={handleArchivoPdf} className="hidden" />
                  <button onClick={() => pdfInputRef.current?.click()} disabled={procesandoPdf}
                    className="px-4 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
                    📄 Seleccionar PDF
                  </button>
                  {procesandoPdf && <span className="text-sm text-gray-500">Procesando PDF…</span>}
                </div>
                {pdfInfo && !procesandoPdf && (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-xs text-blue-800 space-y-0.5">
                    <p>✅ {pdfInfo.cuotas_detectadas} cuota{pdfInfo.cuotas_detectadas === 1 ? "" : "s"} detectada{pdfInfo.cuotas_detectadas === 1 ? "" : "s"}{pdfInfo.numero_credito ? ` — Crédito N° ${pdfInfo.numero_credito}` : ""}</p>
                    {pdfInfo.tea != null && (
                      <p>TEA: {pdfInfo.tea}%{pdfInfo.tcea != null ? ` · TCEA: ${pdfInfo.tcea}%` : ""}</p>
                    )}
                    {pdfInfo.campos_no_detectados?.length > 0 && (
                      <p className="text-amber-700">⚠️ No se detectaron: {pdfInfo.campos_no_detectados.join(", ")} — revisa los datos antes de guardar.</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <div className="w-32">
                  <label className={LABEL_CLS}>N° Cuotas</label>
                  <input type="number" min="1" value={numCuotasGen} onChange={e => setNumCuotasGen(e.target.value)} className={INPUT_CLS} />
                </div>
                <button onClick={generar} disabled={generando}
                  className="px-4 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
                  {generando ? "Generando…" : "Generar Cronograma"}
                </button>
              </div>
            )}

            {filas.length > 0 && (
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase bg-gray-50">
                    <tr>
                      <th className="py-2 px-2 text-left font-semibold">N°</th>
                      <th className="py-2 px-2 text-left font-semibold">Fecha</th>
                      <th className="py-2 px-2 text-right font-semibold">Saldo Ini</th>
                      <th className="py-2 px-2 text-right font-semibold">Amort</th>
                      <th className="py-2 px-2 text-right font-semibold">Interés</th>
                      <th className="py-2 px-2 text-right font-semibold">Seg.Desgr</th>
                      <th className="py-2 px-2 text-right font-semibold">Total</th>
                      <th className="py-2 px-2 text-right font-semibold">Saldo Final</th>
                      <th className="py-2 px-2 text-center font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filas.map((f, i) => (
                      <tr key={f._key} className={f.es_adelanto ? "bg-blue-50" : ""}>
                        <td className="px-2 py-1 text-gray-500">{f.numero_cuota}</td>
                        <td className="px-2 py-1">
                          <input type="date" value={f.fecha_pago}
                            onChange={e => actualizarFila(i, "fecha_pago", e.target.value)}
                            className="w-32 px-1 py-1 border border-transparent rounded focus:border-blue-400 focus:bg-white focus:outline-none bg-transparent" />
                        </td>
                        {f.es_adelanto ? (
                          <>
                            <td className="px-2 py-1 text-right text-gray-600">{fmtS(f.saldo_inicial)}</td>
                            <td className="px-2 py-1 text-blue-700 font-semibold text-center" colSpan={4}>
                              Adelanto: S/{" "}
                              <input type="text" inputMode="decimal" value={f.monto_adelanto}
                                onChange={e => actualizarMontoAdelanto(i, e.target.value)}
                                className="w-24 px-1 py-1 border border-blue-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" />
                            </td>
                            <td className="px-2 py-1 text-right text-gray-600">{fmtS(f.saldo_final)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-1 text-right text-gray-600">{fmtS(f.saldo_inicial)}</td>
                            <td className="px-2 py-1">
                              <input type="text" inputMode="decimal" value={f.amortizacion}
                                onChange={e => actualizarFila(i, "amortizacion", e.target.value)}
                                className="w-20 px-1 py-1 border border-transparent rounded text-right focus:border-blue-400 focus:bg-white focus:outline-none bg-transparent" />
                            </td>
                            <td className="px-2 py-1">
                              <input type="text" inputMode="decimal" value={f.interes}
                                onChange={e => actualizarFila(i, "interes", e.target.value)}
                                className="w-20 px-1 py-1 border border-transparent rounded text-right focus:border-blue-400 focus:bg-white focus:outline-none bg-transparent" />
                            </td>
                            <td className="px-2 py-1">
                              <input type="text" inputMode="decimal" value={f.seguro_desgravamen ?? 0}
                                onChange={e => actualizarFila(i, "seguro_desgravamen", e.target.value)}
                                className="w-20 px-1 py-1 border border-transparent rounded text-right focus:border-blue-400 focus:bg-white focus:outline-none bg-transparent" />
                            </td>
                            <td className="px-2 py-1">
                              <input type="text" inputMode="decimal" value={f.cuota_total}
                                onChange={e => actualizarFila(i, "cuota_total", e.target.value)}
                                className="w-20 px-1 py-1 border border-transparent rounded text-right font-semibold focus:border-blue-400 focus:bg-white focus:outline-none bg-transparent" />
                            </td>
                            <td className="px-2 py-1 text-right text-gray-600">{fmtS(f.saldo_final)}</td>
                          </>
                        )}
                        <td className="px-2 py-1 text-center">
                          <button onClick={() => eliminarFila(i)} title="Eliminar fila"
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                            <HiTrash className="text-sm" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex gap-2 p-2 bg-gray-50 border-t border-gray-100">
                  <button onClick={agregarFila}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
                    <HiPlus className="text-sm" /> Agregar fila
                  </button>
                  <button onClick={agregarAdelanto}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 rounded-lg transition-colors">
                    <HiPlus className="text-sm" /> Agregar adelanto
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 px-6 pb-6">
          {paso === 1 ? (
            <>
              <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={irACronograma}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
                Siguiente → Cronograma
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setPaso(1)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">← Atrás</button>
              <button onClick={crearYGuardar} disabled={saving}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? "Guardando…" : "✅ Crear Préstamo y Guardar Cronograma"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal: Registrar Cuota ───────────────────────────────────────────────────
function ModalRegistrarCuota({ prestamo, onClose, onSaved }) {
  const [cuentas, setCuentas] = useState([]);
  const [amortizacion, setAmortizacion] = useState("");
  const [interesEditado, setInteresEditado] = useState(null); // null = usar el calculado automáticamente
  const [fechaPago, setFechaPago] = useState(hoy());
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCuentasBancarias().then(setCuentas).catch(() => setCuentas([]));
  }, []);

  const saldoPendiente = prestamo.monto_pendiente;
  const amortNum = parseFloat(amortizacion);
  const interesCalculado = round2(saldoPendiente * (prestamo.tasa_mensual || 0));
  const interesNum = interesEditado !== null && interesEditado !== "" ? parseFloat(interesEditado) : interesCalculado;
  const totalCuota = (!isNaN(amortNum) ? amortNum : 0) + (!isNaN(interesNum) ? interesNum : 0);
  const requiereCuenta = METODOS_CON_CUENTA.includes(metodoPago);

  function round2(n) { return Math.round(n * 100) / 100; }

  async function confirmar() {
    setError("");
    if (isNaN(amortNum) || amortNum <= 0) { setError("Ingresa una amortización válida mayor a 0"); return; }
    if (amortNum > saldoPendiente + 0.01) { setError(`La amortización no puede superar el saldo pendiente (${fmtS(saldoPendiente)})`); return; }
    if (!fechaPago) { setError("La fecha de pago es obligatoria"); return; }
    if (requiereCuenta && !cuentaBancariaId) { setError(`Selecciona una cuenta bancaria para ${metodoPago}`); return; }

    setSaving(true);
    try {
      await pagarCuotaPrestamo(prestamo.id, {
        amortizacion:       amortNum,
        interes:            interesEditado !== null && interesEditado !== "" ? parseFloat(interesEditado) : null,
        fecha_pago:         fechaPago,
        metodo_pago:        metodoPago,
        cuenta_bancaria_id: requiereCuenta ? parseInt(cuentaBancariaId) : null,
        observacion:        observacion.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Registrar Cuota</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-1.5 text-sm mb-4">
            <div className="flex justify-between"><span className="text-gray-500">Préstamo</span><span className="font-medium text-gray-800">{prestamo.nombre_tercero}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Saldo pendiente</span><span className="font-bold text-amber-700">{fmtS(saldoPendiente)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Interés del mes (auto)</span><span className="font-medium text-gray-800">{fmtS(interesCalculado)}</span></div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Amortización (S/, a capital) <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" min="0.01" max={saldoPendiente} value={amortizacion}
                onChange={e => setAmortizacion(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Interés (S/, editable)</label>
              <input type="number" step="0.01" min="0" value={interesEditado !== null ? interesEditado : ""}
                onChange={e => setInteresEditado(e.target.value)}
                placeholder={interesCalculado.toFixed(2)} className={INPUT_CLS} />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 flex justify-between items-center">
              <span className="text-sm text-blue-800 font-semibold">Total Cuota</span>
              <span className="text-base font-bold text-blue-800">{fmtS(totalCuota)}</span>
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha de Pago <span className="text-red-500">*</span></label>
              <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Método de Pago</label>
              <select value={metodoPago} onChange={e => { setMetodoPago(e.target.value); setCuentaBancariaId(""); }} className={INPUT_CLS}>
                {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {requiereCuenta && (
              <div>
                <label className={LABEL_CLS}>Cuenta Bancaria <span className="text-red-500">*</span></label>
                <select value={cuentaBancariaId} onChange={e => setCuentaBancariaId(e.target.value)} className={INPUT_CLS}>
                  <option value="">Selecciona una cuenta…</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.banco} — {c.numero_cuenta}{c.tipo_cuenta ? ` (${c.tipo_cuenta})` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>Observación</label>
              <textarea value={observacion} onChange={e => setObservacion(e.target.value)} rows={2}
                placeholder="Detalle del pago…" className={`${INPUT_CLS} resize-none`} />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm mt-4">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={confirmar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Confirmando…" : "✅ Registrar Cuota"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Ver Detalle ───────────────────────────────────────────────────────
function ModalEditarCuota({ prestamoId, cuota, onClose, onSaved }) {
  const [cuentas, setCuentas] = useState([]);
  const [amortizacion, setAmortizacion] = useState(String(cuota.amortizacion));
  const [interes, setInteres] = useState(String(cuota.interes));
  const [fechaPago, setFechaPago] = useState(cuota.fecha_pago || hoy());
  const [metodoPago, setMetodoPago] = useState(cuota.metodo_pago || "Efectivo");
  const [cuentaBancariaId, setCuentaBancariaId] = useState(cuota.cuenta_bancaria_id ? String(cuota.cuenta_bancaria_id) : "");
  const [observacion, setObservacion] = useState(cuota.observacion || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCuentasBancarias().then(setCuentas).catch(() => setCuentas([]));
  }, []);

  const amortNum = parseFloat(amortizacion);
  const interesNum = parseFloat(interes);
  const totalCuota = (!isNaN(amortNum) ? amortNum : 0) + (!isNaN(interesNum) ? interesNum : 0);
  const requiereCuenta = METODOS_CON_CUENTA.includes(metodoPago);

  async function guardar() {
    setError("");
    if (isNaN(amortNum) || amortNum <= 0) { setError("Ingresa una amortización válida mayor a 0"); return; }
    if (isNaN(interesNum) || interesNum < 0) { setError("Ingresa un interés válido"); return; }
    if (!fechaPago) { setError("La fecha de pago es obligatoria"); return; }
    if (requiereCuenta && !cuentaBancariaId) { setError(`Selecciona una cuenta bancaria para ${metodoPago}`); return; }

    setSaving(true);
    try {
      await editarCuotaPrestamo(prestamoId, cuota.id, {
        amortizacion:       amortNum,
        interes:            interesNum,
        fecha_pago:         fechaPago,
        metodo_pago:        metodoPago,
        cuenta_bancaria_id: requiereCuenta ? parseInt(cuentaBancariaId) : null,
        observacion:        observacion.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Editar Cuota #{cuota.numero_cuota}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Amortización (S/)</label>
              <input type="number" step="0.01" min="0.01" value={amortizacion}
                onChange={e => setAmortizacion(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Interés (S/)</label>
              <input type="number" step="0.01" min="0" value={interes}
                onChange={e => setInteres(e.target.value)} className={INPUT_CLS} />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 flex justify-between items-center">
              <span className="text-sm text-blue-800 font-semibold">Total Cuota</span>
              <span className="text-base font-bold text-blue-800">{fmtS(totalCuota)}</span>
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha de Pago</label>
              <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Método de Pago</label>
              <select value={metodoPago} onChange={e => { setMetodoPago(e.target.value); setCuentaBancariaId(""); }} className={INPUT_CLS}>
                {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {requiereCuenta && (
              <div>
                <label className={LABEL_CLS}>Cuenta Bancaria</label>
                <select value={cuentaBancariaId} onChange={e => setCuentaBancariaId(e.target.value)} className={INPUT_CLS}>
                  <option value="">Selecciona una cuenta…</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.banco} — {c.numero_cuenta}{c.tipo_cuenta ? ` (${c.tipo_cuenta})` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>Observación</label>
              <textarea value={observacion} onChange={e => setObservacion(e.target.value)} rows={2}
                placeholder="Detalle del pago…" className={`${INPUT_CLS} resize-none`} />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm mt-4">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={guardar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Guardando…" : "✅ Guardar Cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Ver detalle de un pago (cuota ya pagada) ─────────────────────────
function ModalVerPago({ cuota, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Pago de Cuota #{cuota.numero_cuota}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Fecha de pago</span><span className="text-gray-800">{fmtFecha(cuota.fecha_pago_real || cuota.fecha_pago)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Método de pago</span><span className="text-gray-800">{cuota.metodo_pago || "—"}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Cuenta bancaria</span><span className="text-gray-800">{cuota.cuenta_bancaria || "—"}</span></div>
          <div className="flex justify-between pt-2 border-t border-gray-100"><span className="text-gray-500 font-semibold">Total pagado</span><span className="font-bold text-gray-800">{fmtS(cuota.cuota_total)}</span></div>
          {cuota.observacion && (
            <div>
              <p className="text-gray-500 mb-1">Observación</p>
              <p className="text-gray-800 bg-gray-50 rounded-lg p-2.5">{cuota.observacion}</p>
            </div>
          )}
        </div>
        <div className="flex px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Pagar cuota del cronograma (pendiente/vencida) ───────────────────
function ModalPagarCuotaCronograma({ prestamoId, cuota, onClose, onSaved }) {
  const [cuentas, setCuentas] = useState([]);
  const [fechaPagoReal, setFechaPagoReal] = useState(hoy());
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { getCuentasBancarias().then(setCuentas).catch(() => setCuentas([])); }, []);

  const requiereCuenta = METODOS_CON_CUENTA.includes(metodoPago);

  async function confirmar() {
    setError("");
    if (!fechaPagoReal) { setError("La fecha de pago es obligatoria"); return; }
    if (requiereCuenta && !cuentaBancariaId) { setError(`Selecciona una cuenta bancaria para ${metodoPago}`); return; }
    setSaving(true);
    try {
      await pagarCuotaCronograma(prestamoId, cuota.id, {
        fecha_pago_real:    fechaPagoReal,
        metodo_pago:        metodoPago,
        cuenta_bancaria_id: requiereCuenta ? parseInt(cuentaBancariaId) : null,
        observacion:        observacion.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Pagar Cuota #{cuota.numero_cuota}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-1.5 text-sm mb-4">
            <div className="flex justify-between"><span className="text-gray-500">Fecha programada</span><span className="text-gray-800">{fmtFecha(cuota.fecha_pago)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Amortización</span><span className="text-gray-800">{fmtS(cuota.amortizacion)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Interés</span><span className="text-gray-800">{fmtS(cuota.interes)}</span></div>
            <div className="flex justify-between pt-1.5 border-t border-gray-200"><span className="text-gray-600 font-semibold">Total a pagar</span><span className="font-bold text-gray-800">{fmtS(cuota.cuota_total)}</span></div>
          </div>
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Fecha de Pago <span className="text-red-500">*</span></label>
              <input type="date" value={fechaPagoReal} onChange={e => setFechaPagoReal(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Método de Pago</label>
              <select value={metodoPago} onChange={e => { setMetodoPago(e.target.value); setCuentaBancariaId(""); }} className={INPUT_CLS}>
                {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {requiereCuenta && (
              <div>
                <label className={LABEL_CLS}>Cuenta Bancaria <span className="text-red-500">*</span></label>
                <select value={cuentaBancariaId} onChange={e => setCuentaBancariaId(e.target.value)} className={INPUT_CLS}>
                  <option value="">Selecciona una cuenta…</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.banco} — {c.numero_cuenta}{c.tipo_cuenta ? ` (${c.tipo_cuenta})` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>Observación</label>
              <textarea value={observacion} onChange={e => setObservacion(e.target.value)} rows={2}
                placeholder="Detalle del pago…" className={`${INPUT_CLS} resize-none`} />
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm mt-4">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={confirmar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? "Confirmando…" : "✅ Confirmar Pago"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Editar fila pendiente/vencida del cronograma ─────────────────────
function ModalEditarFilaCronograma({ prestamoId, cuota, onClose, onSaved }) {
  const [fechaPago, setFechaPago] = useState(cuota.fecha_pago);
  const [saldoInicial, setSaldoInicial] = useState(String(cuota.saldo_inicial));
  const [amortizacion, setAmortizacion] = useState(String(cuota.amortizacion));
  const [interes, setInteres] = useState(String(cuota.interes));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const saldoNum = parseFloat(saldoInicial) || 0;
  const amortNum = parseFloat(amortizacion) || 0;
  const interesNum = parseFloat(interes) || 0;
  const cuotaTotal = round2(amortNum + interesNum);
  const saldoFinal = round2(Math.max(saldoNum - amortNum, 0));

  async function guardar() {
    setError("");
    if (!fechaPago) { setError("La fecha es obligatoria"); return; }
    if (amortNum < 0 || interesNum < 0 || saldoNum < 0) { setError("Los montos no pueden ser negativos"); return; }
    setSaving(true);
    try {
      await editarFilaCronograma(prestamoId, cuota.id, {
        fecha_pago:     fechaPago,
        saldo_inicial:  saldoNum,
        amortizacion:   amortNum,
        interes:        interesNum,
        cuota_total:    cuotaTotal,
        saldo_final:    saldoFinal,
      });
      onSaved();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Editar Cuota #{cuota.numero_cuota} (cronograma)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            Esto solo ajusta esta fila — no recalcula automáticamente el resto del cronograma. Usa el editor completo al crear el préstamo para reordenar todo el cronograma.
          </p>
          <div>
            <label className={LABEL_CLS}>Fecha de Pago</label>
            <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Saldo Inicial (S/)</label>
            <input type="number" step="0.01" min="0" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)} className={INPUT_CLS} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Amortización (S/)</label>
              <input type="number" step="0.01" min="0" value={amortizacion} onChange={e => setAmortizacion(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Interés (S/)</label>
              <input type="number" step="0.01" min="0" value={interes} onChange={e => setInteres(e.target.value)} className={INPUT_CLS} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
              <p className="text-xs text-blue-700">Cuota Total</p>
              <p className="text-sm font-bold text-blue-800">{fmtS(cuotaTotal)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
              <p className="text-xs text-gray-500">Saldo Final</p>
              <p className="text-sm font-bold text-gray-800">{fmtS(saldoFinal)}</p>
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={guardar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Guardando…" : "✅ Guardar Cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalDetallePrestamo({ prestamoId, onClose, onPrestamoChanged }) {
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cuotaEditar, setCuotaEditar] = useState(null);
  const [confirmDelCuota, setConfirmDelCuota] = useState(null);
  const [deletingCuotaId, setDeletingCuotaId] = useState(null);
  const [cuotaVerPago, setCuotaVerPago] = useState(null);
  const [cuotaPagar, setCuotaPagar] = useState(null);
  const [filaEditar, setFilaEditar] = useState(null);
  const [confirmDelFila, setConfirmDelFila] = useState(null);
  const [deletingFilaId, setDeletingFilaId] = useState(null);
  const [toast, setToast] = useState(null);

  const cargar = useCallback(() => {
    getPrestamo(prestamoId).then(setP).catch(() => setP(null)).finally(() => setLoading(false));
  }, [prestamoId]);

  useEffect(() => { cargar(); }, [cargar]);

  function recargarTrasEdicion() {
    setCuotaEditar(null);
    setCuotaPagar(null);
    setFilaEditar(null);
    cargar();
    onPrestamoChanged && onPrestamoChanged();
  }

  async function handleEliminarCuota() {
    if (!confirmDelCuota) return;
    setDeletingCuotaId(confirmDelCuota.id);
    try {
      await eliminarCuotaPrestamo(prestamoId, confirmDelCuota.id);
      setConfirmDelCuota(null);
      cargar();
      onPrestamoChanged && onPrestamoChanged();
    } catch (err) {
      setToast({ message: parsearError(err), type: "error" });
    } finally {
      setDeletingCuotaId(null);
    }
  }

  async function handleEliminarFila() {
    if (!confirmDelFila) return;
    setDeletingFilaId(confirmDelFila.id);
    try {
      await eliminarFilaCronograma(prestamoId, confirmDelFila.id);
      setConfirmDelFila(null);
      cargar();
      onPrestamoChanged && onPrestamoChanged();
    } catch (err) {
      setToast({ message: parsearError(err), type: "error" });
    } finally {
      setDeletingFilaId(null);
    }
  }

  if (loading || !p) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-10 text-center text-gray-400 text-sm">
          {loading ? "Cargando…" : "No se pudo cargar el préstamo."}
        </div>
      </div>
    );
  }

  const info = ESTADO_INFO[p.estado] || ESTADO_INFO.activo;
  const pagado = Math.max(0, p.monto_original - p.monto_pendiente);
  const pctPagado = p.monto_original > 0 ? Math.min(100, Math.round((pagado / p.monto_original) * 100)) : 0;
  const cuotas = p.cuotas || [];
  const totalSeguroDesgravamenPagado = cuotas
    .filter(c => c.estado === "pagado")
    .reduce((s, c) => s + (c.seguro_desgravamen || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Detalle de Préstamo</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <span className={`inline-flex text-xs px-2 py-1 rounded-full font-medium mb-4 ${info.cls}`}>{info.label}</span>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-1.5 text-sm mb-4">
            <div className="flex justify-between"><span className="text-gray-500">Nombre / Razón Social</span><span className="font-medium text-gray-800">{p.nombre_tercero}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">RUC / DNI</span><span className="font-mono text-gray-700">{p.ruc_dni_tercero || "—"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Fecha inicio</span><span className="text-gray-800">{fmtFecha(p.fecha_inicio)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Fecha vencimiento</span><span className="text-gray-800">{fmtFecha(p.fecha_vencimiento)}</span></div>
            {p.aplica_interes && (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Tasa</span><span className="text-gray-800">{p.tipo_tasa} — {p.porcentaje_tasa}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Tasa mensual equivalente</span><span className="text-gray-800">{fmtPct(p.tasa_mensual)}</span></div>
              </>
            )}
            {p.descripcion && (
              <div>
                <p className="text-gray-500 mb-1">Descripción</p>
                <p className="text-gray-800 bg-white rounded-lg p-2.5">{p.descripcion}</p>
              </div>
            )}
          </div>

          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-600 font-medium">Progreso</span>
              <span className="text-gray-800 font-semibold">{fmtS(pagado)} pagado de {fmtS(p.monto_original)}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div className="bg-green-500 h-2.5 rounded-full transition-all" style={{ width: `${pctPagado}%` }} />
            </div>
            {totalSeguroDesgravamenPagado > 0.01 && (
              <p className="text-xs text-gray-500 mt-1.5">
                Total seguro desgravamen pagado: <span className="font-semibold text-gray-700">{fmtS(totalSeguroDesgravamenPagado)}</span>
              </p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Cronograma de Pagos</h3>
            {cuotas.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sin cuotas registradas</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase">
                    <tr className="border-b border-gray-100">
                      <th className="py-2 text-left font-semibold">N°</th>
                      <th className="py-2 text-left font-semibold">Fecha</th>
                      <th className="py-2 text-right font-semibold">Saldo Ini</th>
                      <th className="py-2 text-right font-semibold">Amort</th>
                      <th className="py-2 text-right font-semibold">Interés</th>
                      <th className="py-2 text-right font-semibold">Seg. Desgr</th>
                      <th className="py-2 text-right font-semibold">Total</th>
                      <th className="py-2 text-right font-semibold">Saldo Final</th>
                      <th className="py-2 text-left font-semibold">Estado</th>
                      <th className="py-2 text-center font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {cuotas.map(c => {
                      const cuotasPagadas = cuotas.filter(x => x.estado === "pagado");
                      const esUltimaPagada = c.estado === "pagado" &&
                        c.numero_cuota === Math.max(...cuotasPagadas.map(x => x.numero_cuota));
                      const estadoInfo = ESTADO_CUOTA_INFO[c.estado] || ESTADO_CUOTA_INFO.pendiente;
                      return (
                        <tr key={c.id} className={c.es_adelanto ? "bg-blue-50" : ""}>
                          <td className="py-2 text-gray-600">{c.numero_cuota}</td>
                          <td className="py-2 text-gray-600 whitespace-nowrap">{fmtFecha(c.fecha_pago)}</td>
                          <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.saldo_inicial)}</td>
                          <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.amortizacion)}</td>
                          <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.interes)}</td>
                          <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.seguro_desgravamen)}</td>
                          <td className="py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(c.cuota_total)}</td>
                          <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtS(c.saldo_final)}</td>
                          <td className="py-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${estadoInfo.cls}`}>{estadoInfo.label}</span>
                          </td>
                          <td className="py-2">
                            <div className="flex items-center justify-center gap-1">
                              {c.estado === "pagado" ? (
                                <>
                                  <button onClick={() => setCuotaVerPago(c)} title="Ver Pago"
                                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <HiEye className="text-sm" />
                                  </button>
                                  {esUltimaPagada && (
                                    <button onClick={() => setConfirmDelCuota(c)} disabled={deletingCuotaId === c.id} title="Eliminar"
                                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                      <HiTrash className="text-sm" />
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  <button onClick={() => setCuotaPagar(c)} title="Pagar"
                                    className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                                    <HiCreditCard className="text-sm" />
                                  </button>
                                  <button onClick={() => setFilaEditar(c)} title="Editar"
                                    className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                    <HiPencil className="text-sm" />
                                  </button>
                                  <button onClick={() => setConfirmDelFila(c)} disabled={deletingFilaId === c.id} title="Eliminar"
                                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                                    <HiTrash className="text-sm" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="flex px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cerrar</button>
        </div>
      </div>

      {cuotaEditar && (
        <ModalEditarCuota prestamoId={prestamoId} cuota={cuotaEditar}
          onClose={() => setCuotaEditar(null)} onSaved={recargarTrasEdicion} />
      )}
      {cuotaVerPago && (
        <ModalVerPago cuota={cuotaVerPago} onClose={() => setCuotaVerPago(null)} />
      )}
      {cuotaPagar && (
        <ModalPagarCuotaCronograma prestamoId={prestamoId} cuota={cuotaPagar}
          onClose={() => setCuotaPagar(null)} onSaved={recargarTrasEdicion} />
      )}
      {filaEditar && (
        <ModalEditarFilaCronograma prestamoId={prestamoId} cuota={filaEditar}
          onClose={() => setFilaEditar(null)} onSaved={recargarTrasEdicion} />
      )}
      {confirmDelCuota && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelCuota(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-800 mb-1">¿Eliminar este pago?</p>
            <p className="text-sm text-gray-500 mb-4">
              El saldo pendiente del préstamo se restaurará automáticamente.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelCuota(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={handleEliminarCuota} disabled={deletingCuotaId === confirmDelCuota.id}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deletingCuotaId === confirmDelCuota.id ? "Eliminando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelFila && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelFila(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-800 mb-1">¿Eliminar esta cuota del cronograma?</p>
            <p className="text-sm text-gray-500 mb-4">
              Esta fila aún no ha sido pagada. Esta acción es irreversible.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelFila(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={handleEliminarFila} disabled={deletingFilaId === confirmDelFila.id}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deletingFilaId === confirmDelFila.id ? "Eliminando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function Prestamos() {
  const [tab, setTab] = useState("recibido"); // "recibido" | "otorgado"
  const [prestamos, setPrestamos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resumen, setResumen] = useState(null);

  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fBuscar, setFBuscar] = useState("");
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  const [modalCrear, setModalCrear] = useState(false);
  const [modalEditar, setModalEditar] = useState(null);
  const [modalDetalleId, setModalDetalleId] = useState(null);
  const [modalCuota, setModalCuota] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [toast, setToast] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = { grupo: tab, page, per_page: PER_PAGE };
      if (fDesde)  params.fecha_desde = fDesde;
      if (fHasta)  params.fecha_hasta = fHasta;
      if (fEstado) params.estado = fEstado;
      if (fBuscar) params.search = fBuscar;
      const r = await getPrestamos(params);
      setPrestamos(r.data || []);
      setTotal(r.total || 0);
    } catch { setPrestamos([]); setTotal(0); }
    finally { setLoading(false); }
  }, [tab, page, fDesde, fHasta, fEstado, fBuscar]);

  const cargarResumen = useCallback(async () => {
    try { setResumen(await getResumenPrestamos()); } catch { setResumen(null); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);
  useEffect(() => { setPage(1); }, [tab]);

  const recargarTodo = () => { cargar(); cargarResumen(); };

  async function handleEliminar() {
    if (!confirmDel) return;
    setDeletingId(confirmDel.id);
    try {
      await eliminarPrestamo(confirmDel.id);
      recargarTodo();
    } catch (err) {
      setToast({ message: parsearError(err), type: "error" });
    } finally {
      setDeletingId(null);
      setConfirmDel(null);
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  const labelTercero = tab === "recibido" ? "Prestamista" : "Prestatario";

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Préstamos" />
        <main className="flex-1 overflow-y-auto p-6">

          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Préstamos</h1>
              <p className="text-sm text-gray-500 mt-0.5">Préstamos recibidos y otorgados</p>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border-l-4 border-blue-500 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Total Prestado Recibido</p>
              <p className="text-xl font-bold text-blue-600 mt-1">{resumen ? fmtS(resumen.total_recibido) : "…"}</p>
            </div>
            <div className="bg-white rounded-xl border-l-4 border-purple-500 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Total Prestado Otorgado</p>
              <p className="text-xl font-bold text-purple-600 mt-1">{resumen ? fmtS(resumen.total_otorgado) : "…"}</p>
            </div>
            <div className="bg-white rounded-xl border-l-4 border-amber-500 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Total Pendiente Recibido</p>
              <p className="text-xl font-bold text-amber-600 mt-1">{resumen ? fmtS(resumen.pendiente_recibido) : "…"}</p>
            </div>
            <div className="bg-white rounded-xl border-l-4 border-red-500 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">Total Pendiente Otorgado</p>
              <p className="text-xl font-bold text-red-600 mt-1">{resumen ? fmtS(resumen.pendiente_otorgado) : "…"}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit mb-4">
            {[
              { key: "recibido", label: "Préstamos Recibidos" },
              { key: "otorgado", label: "Préstamos Otorgados" },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${tab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Filtros + botón nuevo */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Desde</label>
                <input type="date" value={fDesde} onChange={e => { setFDesde(e.target.value); setPage(1); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Hasta</label>
                <input type="date" value={fHasta} onChange={e => { setFHasta(e.target.value); setPage(1); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Estado</label>
                <select value={fEstado} onChange={e => { setFEstado(e.target.value); setPage(1); }}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="">Todos</option>
                  <option value="activo">Activo</option>
                  <option value="pagado">Pagado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Buscar (nombre/RUC)</label>
                <input type="text" value={fBuscar} onChange={e => { setFBuscar(e.target.value); setPage(1); }}
                  placeholder="Buscar…" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[180px]" />
              </div>
              <button onClick={() => setModalCrear(true)}
                className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
                <HiPlus className="text-base" /> Nuevo Préstamo
              </button>
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                    <th className="px-4 py-3 text-left font-semibold">{labelTercero}</th>
                    <th className="px-4 py-3 text-right font-semibold">Monto Original</th>
                    <th className="px-4 py-3 text-right font-semibold">Monto Pendiente</th>
                    <th className="px-4 py-3 text-right font-semibold">Tasa</th>
                    <th className="px-4 py-3 text-left font-semibold">Tipo Tasa</th>
                    <th className="px-4 py-3 text-left font-semibold">Estado</th>
                    <th className="px-4 py-3 text-center font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
                  ) : prestamos.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">No hay préstamos registrados</td></tr>
                  ) : prestamos.map(p => {
                    const info = ESTADO_INFO[p.estado] || ESTADO_INFO.activo;
                    const puedeEditar = p.estado === "activo";
                    const puedeCuota  = p.estado === "activo";
                    return (
                      <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(p.fecha_inicio)}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate" title={p.nombre_tercero}>{p.nombre_tercero}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(p.monto_original)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-700 whitespace-nowrap">{fmtS(p.monto_pendiente)}</td>
                        <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{p.aplica_interes ? fmtPct(p.tasa_mensual) : "—"}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.aplica_interes ? p.tipo_tasa : "Sin interés"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${info.cls}`}>{info.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setModalDetalleId(p.id)} title="Ver Detalle"
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                              <HiEye className="text-base" />
                            </button>
                            {puedeEditar && (
                              <button onClick={() => setModalEditar(p)} title="Editar"
                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                <HiPencil className="text-base" />
                              </button>
                            )}
                            {puedeCuota && (
                              <button onClick={() => setModalCuota(p)} title="Registrar Cuota"
                                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                                <HiCreditCard className="text-base" />
                              </button>
                            )}
                            <button onClick={() => setConfirmDel(p)} disabled={deletingId === p.id} title="Eliminar"
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                              <HiTrash className="text-base" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
                <span>Mostrando {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de {total}</span>
                <div className="flex gap-2">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">Anterior</button>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">Siguiente</button>
                </div>
              </div>
            )}
          </div>

        </main>
      </div>

      {modalCrear && (
        <ModalNuevoPrestamoWizard grupo={tab} onClose={() => setModalCrear(false)}
          onSaved={() => { setModalCrear(false); recargarTodo(); }} />
      )}
      {modalEditar && (
        <ModalPrestamo grupo={tab} prestamo={modalEditar} onClose={() => setModalEditar(null)}
          onSaved={() => { setModalEditar(null); recargarTodo(); }} />
      )}
      {modalDetalleId && (
        <ModalDetallePrestamo prestamoId={modalDetalleId} onClose={() => setModalDetalleId(null)}
          onPrestamoChanged={recargarTodo} />
      )}
      {modalCuota && (
        <ModalRegistrarCuota prestamo={modalCuota} onClose={() => setModalCuota(null)}
          onSaved={() => { setModalCuota(null); recargarTodo(); }} />
      )}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-800 mb-1">¿Eliminar este préstamo?</p>
            <p className="text-sm text-gray-500 mb-4">
              {confirmDel.nombre_tercero} — {fmtS(confirmDel.monto_original)}. Esta acción es irreversible.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={handleEliminar} disabled={deletingId === confirmDel.id}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
                {deletingId === confirmDel.id ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
