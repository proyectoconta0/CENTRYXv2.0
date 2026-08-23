import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  HiPlus, HiX, HiEye, HiPencil, HiRefresh, HiLightningBolt, HiTrash, HiExclamationCircle,
} from "react-icons/hi";
import {
  getGarantias, getResumenGarantias, getGarantia,
  crearGarantia, actualizarGarantia, devolverGarantia, ejecutarGarantia, eliminarGarantia,
  buscarClientes, getCuentasBancarias, getFacturasPendientesGarantia, getRecibosInternosPendientesGarantia,
} from "../../api/comercialApi";

const TIPOS_DOC_GARANTIA = ["Recibo Interno", "Factura"];
const METODOS_DEVOLUCION = ["Efectivo", "Transferencia", "Cheque"];
const METODOS_CON_CUENTA = ["Transferencia", "Cheque"];

const ESTADO_INFO = {
  retenida:            { label: "🟡 Retenida",           cls: "bg-amber-100 text-amber-700" },
  devolucion_parcial:  { label: "🟠 Dev. Parcial",        cls: "bg-orange-100 text-orange-700" },
  devuelta:            { label: "🟢 Devuelta",            cls: "bg-green-100 text-green-700" },
  ejecutada:           { label: "🔴 Ejecutada",           cls: "bg-red-100 text-red-700" },
};

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const INPUT_CLS = "w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const LABEL_CLS = "text-xs font-semibold text-gray-700 uppercase";

// ── Buscador de cliente (RUC/DNI/nombre) reutilizable en el modal Crear/Editar
function BuscadorCliente({ ruc, nombre, onChange }) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [mostrar, setMostrar] = useState(false);
  const timer = useRef(null);

  const handleBusquedaChange = (val) => {
    setBusqueda(val);
    clearTimeout(timer.current);
    if (val.trim().length < 3) {
      setResultados([]);
      setMostrar(false);
      return;
    }
    setMostrar(true);
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await buscarClientes(val.trim()) || []);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
  };

  const seleccionar = (c) => {
    onChange({ cliente_ruc: c.ruc, cliente_nombre: c.razon_social });
    setBusqueda(`${c.ruc} - ${c.razon_social}`);
    setMostrar(false);
  };

  return (
    <div>
      <div className="relative">
        <label className={LABEL_CLS}>Buscar Cliente</label>
        <input
          type="text"
          value={busqueda}
          onChange={e => handleBusquedaChange(e.target.value)}
          onFocus={() => busqueda.trim().length >= 3 && setMostrar(true)}
          onBlur={() => setTimeout(() => setMostrar(false), 150)}
          placeholder="🔍 Buscar por RUC, DNI o nombre..."
          autoComplete="off"
          className={INPUT_CLS}
        />
        {mostrar && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
            {buscando ? (
              <p className="text-sm text-gray-400 text-center py-3">Buscando…</p>
            ) : resultados.length === 0 ? (
              <p className="text-sm text-gray-500 px-3 py-3">No encontrado — puedes escribir los datos manualmente abajo</p>
            ) : (
              resultados.map(c => (
                <button key={c.id} type="button" onMouseDown={() => seleccionar(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0">
                  <span className="font-mono text-gray-500">{c.ruc}</span> - <span className="text-gray-800">{c.razon_social}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <label className={LABEL_CLS}>RUC/DNI *</label>
          <input type="text" value={ruc} onChange={e => onChange({ cliente_ruc: e.target.value })}
            placeholder="20123456789" className={`${INPUT_CLS} font-mono`} />
        </div>
        <div>
          <label className={LABEL_CLS}>Nombre/Razón Social *</label>
          <input type="text" value={nombre} onChange={e => onChange({ cliente_nombre: e.target.value })}
            placeholder="Nombre del cliente" className={INPUT_CLS} />
        </div>
      </div>
    </div>
  );
}

// ── Modal: Nueva / Editar Garantía ──────────────────────────────────────────
function ModalGarantia({ garantia, onClose, onSaved }) {
  const esEdicion = !!garantia;
  const [form, setForm] = useState({
    cliente_ruc:      garantia?.cliente_ruc || "",
    cliente_nombre:   garantia?.cliente_nombre || "",
    tipo_documento:   garantia?.tipo_documento || "Recibo Interno",
    numero_documento: garantia?.numero_documento || "",
    monto:            garantia ? String(garantia.monto) : "",
    fecha_cobro:      garantia?.fecha_cobro || hoy(),
    metodo_cobro:     garantia?.metodo_cobro || "Efectivo",
    cuenta_bancaria_id: garantia?.cuenta_bancaria_id ? String(garantia.cuenta_bancaria_id) : "",
    observacion:      garantia?.observacion || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [numeroGenerado, setNumeroGenerado] = useState(null);
  const [cuentas, setCuentas] = useState([]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const esRecibeInternoNuevo = !esEdicion && form.tipo_documento === "Recibo Interno";
  const requiereCuenta = METODOS_CON_CUENTA.includes(form.metodo_cobro);

  useEffect(() => {
    getCuentasBancarias().then(setCuentas).catch(() => setCuentas([]));
  }, []);

  async function guardar() {
    setError("");
    if (!form.cliente_ruc.trim() || !form.cliente_nombre.trim()) { setError("El cliente (RUC/DNI y nombre) es obligatorio"); return; }
    const montoNum = parseFloat(form.monto);
    if (isNaN(montoNum) || montoNum <= 0) { setError("El monto debe ser mayor a 0"); return; }
    if (!form.fecha_cobro) { setError("La fecha de cobro es obligatoria"); return; }
    if (!form.metodo_cobro) { setError("El método de cobro es obligatorio"); return; }
    if (requiereCuenta && !form.cuenta_bancaria_id) { setError(`Selecciona una cuenta bancaria para el método de cobro ${form.metodo_cobro}`); return; }

    const payload = {
      cliente_ruc:      form.cliente_ruc.trim(),
      cliente_nombre:   form.cliente_nombre.trim(),
      tipo_documento:   form.tipo_documento,
      // Para Recibo Interno el N° lo genera el backend — se manda null aunque
      // el campo tenga algo (queda de solo lectura en la UI para ese tipo).
      numero_documento: esRecibeInternoNuevo ? null : (form.numero_documento.trim() || null),
      monto:            montoNum,
      fecha_cobro:      form.fecha_cobro,
      metodo_cobro:     form.metodo_cobro,
      cuenta_bancaria_id: requiereCuenta ? parseInt(form.cuenta_bancaria_id) : null,
      observacion:      form.observacion.trim() || null,
    };

    setSaving(true);
    try {
      if (esEdicion) {
        await actualizarGarantia(garantia.id, payload);
        onSaved();
      } else {
        const creada = await crearGarantia(payload);
        if (esRecibeInternoNuevo) {
          // "Al guardar → mostrar el número generado": no cierra de una, muestra
          // el correlativo asignado antes de confirmar el cierre del modal.
          setNumeroGenerado(creada.numero_documento);
        } else {
          onSaved();
        }
      }
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  }

  if (numeroGenerado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
          <p className="text-sm text-gray-500 mb-1">Garantía registrada — N° Documento generado:</p>
          <p className="text-2xl font-bold text-blue-700 font-mono mb-4">{numeroGenerado}</p>
          <button onClick={onSaved}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
            Listo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">{esEdicion ? "Editar Garantía" : "Nueva Garantía"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6 space-y-4">
          <BuscadorCliente
            ruc={form.cliente_ruc}
            nombre={form.cliente_nombre}
            onChange={patch => setForm(f => ({ ...f, ...patch }))}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Tipo Documento</label>
              <select value={form.tipo_documento} onChange={e => set("tipo_documento", e.target.value)} className={INPUT_CLS}>
                {TIPOS_DOC_GARANTIA.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>N° Documento</label>
              {form.tipo_documento === "Recibo Interno" ? (
                <input type="text" value={esEdicion ? form.numero_documento : ""} readOnly
                  placeholder="Se generará automáticamente"
                  className={`${INPUT_CLS} font-mono bg-gray-50 text-gray-500 cursor-not-allowed`} />
              ) : (
                <input type="text" value={form.numero_documento} onChange={e => set("numero_documento", e.target.value)}
                  placeholder="F001-00123" className={`${INPUT_CLS} font-mono`} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Monto (S/) *</label>
              <input type="number" step="0.01" min="0.01" value={form.monto} onChange={e => set("monto", e.target.value)}
                placeholder="0.00" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha de Cobro *</label>
              <input type="date" value={form.fecha_cobro} onChange={e => set("fecha_cobro", e.target.value)} className={INPUT_CLS} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Método de Cobro *</label>
              <select value={form.metodo_cobro}
                onChange={e => { set("metodo_cobro", e.target.value); set("cuenta_bancaria_id", ""); }} className={INPUT_CLS}>
                {METODOS_DEVOLUCION.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {requiereCuenta && (
              <div>
                <label className={LABEL_CLS}>Cuenta Bancaria *</label>
                <select value={form.cuenta_bancaria_id} onChange={e => set("cuenta_bancaria_id", e.target.value)} className={INPUT_CLS}>
                  <option value="">Selecciona una cuenta…</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.banco} — {c.numero_cuenta}{c.tipo_cuenta ? ` (${c.tipo_cuenta})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Observación</label>
            <textarea value={form.observacion} onChange={e => set("observacion", e.target.value)} rows={2}
              placeholder="Detalle de la garantía…" className={`${INPUT_CLS} resize-none`} />
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

// ── Datos de garantía en modales Devolver/Ejecutar/Detalle ─────────────────
function ResumenGarantia({ g }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-1.5 text-sm mb-4">
      <div className="flex justify-between"><span className="text-gray-500">Cliente</span><span className="font-medium text-gray-800">{g.cliente_nombre || "—"}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">RUC/DNI</span><span className="font-mono text-gray-700">{g.cliente_ruc || "—"}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">N° Documento</span><span className="font-mono font-medium text-gray-800">{g.numero_documento || "—"}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Tipo Documento</span><span className="font-medium text-gray-800">{g.tipo_documento}</span></div>
      <div className="flex justify-between pt-1.5 border-t border-gray-200">
        <span className="text-gray-600 font-semibold">Monto</span>
        <span className="font-bold text-gray-800">{fmtS(g.monto)}</span>
      </div>
    </div>
  );
}

// ── Modal: Ver Detalle ───────────────────────────────────────────────────────
function ModalDetalleGarantia({ garantiaId, onClose }) {
  const [g, setG] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getGarantia(garantiaId)
      .then(setG)
      .catch(() => setG(null))
      .finally(() => setLoading(false));
  }, [garantiaId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-10 text-center text-gray-400 text-sm">Cargando…</div>
      </div>
    );
  }
  if (!g) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-10 text-center text-red-500 text-sm">No se pudo cargar la garantía.</div>
      </div>
    );
  }

  const info = ESTADO_INFO[g.estado] || ESTADO_INFO.retenida;
  const pagos = g.pagos || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Detalle de Garantía</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <span className={`inline-flex text-xs px-2 py-1 rounded-full font-medium mb-4 ${info.cls}`}>{info.label}</span>
          <ResumenGarantia g={g} />

          <div className="grid grid-cols-4 gap-2 bg-gray-50 rounded-xl p-3 mb-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Original</p>
              <p className="text-sm font-semibold text-gray-800">{fmtS(g.monto)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Devuelto</p>
              <p className="text-sm font-semibold text-blue-700">{fmtS(g.monto_devuelto)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ejecutado</p>
              <p className="text-sm font-semibold text-red-700">{fmtS(g.monto_ejecutado)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Pendiente</p>
              <p className="text-sm font-semibold text-amber-700">{fmtS(g.monto_pendiente)}</p>
            </div>
          </div>

          <div className="space-y-1.5 text-sm mb-4">
            <div className="flex justify-between"><span className="text-gray-500">Fecha de cobro</span><span className="text-gray-800">{fmtFecha(g.fecha_cobro)}</span></div>
            {g.observacion && (
              <div>
                <p className="text-gray-500 mb-1">Observación</p>
                <p className="text-gray-800 bg-gray-50 rounded-lg p-2.5">{g.observacion}</p>
              </div>
            )}
            <div className="flex justify-between pt-1.5 border-t border-gray-100">
              <span className="text-gray-500">Creado por</span>
              <span className="text-gray-800">{g.creado_por || "—"} · {g.creado_en || "—"}</span>
            </div>
          </div>

          {pagos.length > 0 && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Historial de Movimientos</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase">
                    <tr className="border-b border-gray-100">
                      <th className="py-2 text-left font-semibold">Fecha</th>
                      <th className="py-2 text-left font-semibold">Tipo</th>
                      <th className="py-2 text-right font-semibold">Monto</th>
                      <th className="py-2 text-left font-semibold">Doc. Generado / Método</th>
                      <th className="py-2 text-left font-semibold">Observación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pagos.map(p => (
                      <tr key={p.id}>
                        <td className="py-2 text-gray-600 whitespace-nowrap">{fmtFecha(p.fecha)}</td>
                        <td className="py-2 text-gray-600 whitespace-nowrap">{p.tipo === "ejecucion" ? "Ejecución" : "Devolución"}</td>
                        <td className="py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(p.monto)}</td>
                        <td className="py-2 text-gray-600 whitespace-nowrap font-mono">
                          {p.tipo === "ejecucion" && p.numero_documento_generado ? `🔗 ${p.numero_documento_generado}` : (p.numero_documento_generado || p.metodo_pago || "—")}
                        </td>
                        <td className="py-2 text-gray-600 max-w-[140px] truncate" title={p.observacion}>{p.observacion || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

// ── Modal: Devolver Garantía (parcial) ──────────────────────────────────────
function ModalDevolverGarantia({ g, onClose, onSaved }) {
  const [cuentas, setCuentas] = useState([]);
  const montoPendiente = g.monto_pendiente ?? g.monto;
  const [montoDevolucion, setMontoDevolucion] = useState(String(montoPendiente));
  const [fecha, setFecha] = useState(hoy());
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCuentasBancarias().then(setCuentas).catch(() => setCuentas([]));
  }, []);

  const montoNum = parseFloat(montoDevolucion);
  const requiereCuenta = METODOS_CON_CUENTA.includes(metodoPago);
  const saldoRestante = !isNaN(montoNum) ? Math.round((montoPendiente - montoNum) * 100) / 100 : null;

  async function confirmar() {
    setError("");
    if (isNaN(montoNum) || montoNum <= 0) { setError("Ingresa un monto válido mayor a 0"); return; }
    if (montoNum > montoPendiente + 0.01) { setError(`El monto no puede superar el saldo pendiente (${fmtS(montoPendiente)})`); return; }
    if (!fecha) { setError("La fecha de devolución es obligatoria"); return; }
    if (requiereCuenta && !cuentaBancariaId) { setError(`Selecciona una cuenta bancaria para ${metodoPago}`); return; }

    setSaving(true);
    try {
      await devolverGarantia(g.id, {
        monto_devolucion:   montoNum,
        fecha,
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
          <h2 className="text-base font-semibold text-gray-800">Devolver Garantía</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <ResumenGarantia g={g} />

          <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-xl p-3 mb-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Monto original</p>
              <p className="text-sm font-semibold text-gray-800">{fmtS(g.monto)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ya devuelto</p>
              <p className="text-sm font-semibold text-blue-700">{fmtS(g.monto_devuelto)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Saldo pendiente</p>
              <p className="text-sm font-semibold text-amber-700">{fmtS(montoPendiente)}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Monto a Devolver (S/) *</label>
              <input type="number" step="0.01" min="0.01" max={montoPendiente} value={montoDevolucion}
                onChange={e => setMontoDevolucion(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha de Devolución *</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Método de Pago</label>
              <select value={metodoPago} onChange={e => { setMetodoPago(e.target.value); setCuentaBancariaId(""); }} className={INPUT_CLS}>
                {METODOS_DEVOLUCION.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {requiereCuenta && (
              <div>
                <label className={LABEL_CLS}>Cuenta Bancaria *</label>
                <select value={cuentaBancariaId} onChange={e => setCuentaBancariaId(e.target.value)} className={INPUT_CLS}>
                  <option value="">Selecciona una cuenta…</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.banco} — {c.numero_cuenta}{c.tipo_cuenta ? ` (${c.tipo_cuenta})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>Observación</label>
              <textarea value={observacion} onChange={e => setObservacion(e.target.value)} rows={2}
                placeholder="Detalle de la devolución…" className={`${INPUT_CLS} resize-none`} />
            </div>
          </div>

          {saldoRestante !== null && !isNaN(montoNum) && montoNum > 0 && montoNum <= montoPendiente + 0.01 && (
            saldoRestante > 0.01 ? (
              <p className="text-xs text-orange-600 font-medium mt-3">⚠️ Quedará {fmtS(saldoRestante)} pendiente</p>
            ) : (
              <p className="text-xs text-green-600 font-medium mt-3">✅ Garantía completamente resuelta</p>
            )
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm mt-3">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={confirmar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Confirmando…" : "✅ Confirmar Devolución"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Ejecutar Garantía (parcial, simplificado) ────────────────────────
function ModalEjecutarGarantia({ g, onClose, onSaved }) {
  const montoPendiente = g.monto_pendiente ?? g.monto;
  const [montoEjecutar, setMontoEjecutar] = useState(String(montoPendiente));
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState("");
  const [aplicarA, setAplicarA] = useState("factura"); // "factura" | "recibo_interno" | "credito"
  const [facturas, setFacturas] = useState([]);
  const [loadingFacturas, setLoadingFacturas] = useState(false);
  const [recibos, setRecibos] = useState([]);
  const [loadingRecibos, setLoadingRecibos] = useState(false);
  const [ventaId, setVentaId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (aplicarA !== "factura" || !g.cliente_ruc) return;
    setLoadingFacturas(true);
    getFacturasPendientesGarantia(g.cliente_ruc)
      .then(setFacturas)
      .catch(() => setFacturas([]))
      .finally(() => setLoadingFacturas(false));
  }, [aplicarA, g.cliente_ruc]);

  useEffect(() => {
    if (aplicarA !== "recibo_interno" || !g.cliente_ruc) return;
    setLoadingRecibos(true);
    getRecibosInternosPendientesGarantia(g.cliente_ruc)
      .then(setRecibos)
      .catch(() => setRecibos([]))
      .finally(() => setLoadingRecibos(false));
  }, [aplicarA, g.cliente_ruc]);

  const montoNum = parseFloat(montoEjecutar);
  const saldoRestante = !isNaN(montoNum) ? Math.round((montoPendiente - montoNum) * 100) / 100 : null;

  async function confirmar() {
    setError("");
    if (isNaN(montoNum) || montoNum <= 0) { setError("Ingresa un monto válido mayor a 0"); return; }
    if (montoNum > montoPendiente + 0.01) { setError(`El monto no puede superar el saldo pendiente (${fmtS(montoPendiente)})`); return; }
    if (!fecha) { setError("La fecha es obligatoria"); return; }
    if (!motivo.trim()) { setError("El motivo es obligatorio"); return; }
    if (aplicarA === "factura" && !ventaId) { setError("Selecciona la factura a saldar"); return; }
    if (aplicarA === "recibo_interno" && !ventaId) { setError("Selecciona el recibo interno a saldar"); return; }

    setSaving(true);
    try {
      await ejecutarGarantia(g.id, {
        monto_ejecutar: montoNum,
        fecha,
        motivo:         motivo.trim(),
        aplicar_a:      aplicarA,
        venta_id:       (aplicarA === "factura" || aplicarA === "recibo_interno") ? parseInt(ventaId) : null,
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
          <h2 className="text-base font-semibold text-gray-800">Ejecutar Garantía</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-lg" /></button>
        </div>
        <div className="p-6">
          <ResumenGarantia g={g} />
          <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2.5 rounded-lg text-sm mb-4">
            <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Esta acción no podrá revertirse.
          </div>

          <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-xl p-3 mb-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Monto original</p>
              <p className="text-sm font-semibold text-gray-800">{fmtS(g.monto)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ya ejecutado</p>
              <p className="text-sm font-semibold text-red-700">{fmtS(g.monto_ejecutado)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Saldo pendiente</p>
              <p className="text-sm font-semibold text-amber-700">{fmtS(montoPendiente)}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Monto a Ejecutar (S/) *</label>
              <input type="number" step="0.01" min="0.01" max={montoPendiente} value={montoEjecutar}
                onChange={e => setMontoEjecutar(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha *</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Motivo *</label>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                placeholder="Motivo de la ejecución…" className={`${INPUT_CLS} resize-none`} />
            </div>

            <div>
              <label className={LABEL_CLS}>¿Aplicar a?</label>
              <div className="mt-1.5 space-y-2">
                <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                  <input type="radio" name="aplicar_a" checked={aplicarA === "factura"}
                    onChange={() => { setAplicarA("factura"); setVentaId(""); }} />
                  <span className="text-sm text-gray-700">Factura pendiente del cliente</span>
                </label>
                <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                  <input type="radio" name="aplicar_a" checked={aplicarA === "recibo_interno"}
                    onChange={() => { setAplicarA("recibo_interno"); setVentaId(""); }} />
                  <span className="text-sm text-gray-700">Recibo Interno pendiente del cliente</span>
                </label>
                <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                  <input type="radio" name="aplicar_a" checked={aplicarA === "credito"}
                    onChange={() => { setAplicarA("credito"); setVentaId(""); }} />
                  <span className="text-sm text-gray-700">Sin documento (queda como crédito disponible)</span>
                </label>
              </div>
            </div>

            {aplicarA === "factura" && (
              <div>
                <label className={LABEL_CLS}>Factura a Saldar *</label>
                {loadingFacturas ? (
                  <p className="text-sm text-gray-400 mt-1.5">Cargando facturas pendientes…</p>
                ) : facturas.length === 0 ? (
                  <p className="text-sm text-gray-400 mt-1.5">Este cliente no tiene facturas pendientes</p>
                ) : (
                  <select value={ventaId} onChange={e => setVentaId(e.target.value)} className={INPUT_CLS}>
                    <option value="">Selecciona una factura…</option>
                    {facturas.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.numero_factura} — Monto {fmtS(f.monto)} — Saldo {fmtS(f.saldo_pendiente)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {aplicarA === "recibo_interno" && (
              <div>
                <label className={LABEL_CLS}>Recibo Interno a Saldar *</label>
                {loadingRecibos ? (
                  <p className="text-sm text-gray-400 mt-1.5">Cargando recibos internos pendientes…</p>
                ) : recibos.length === 0 ? (
                  <p className="text-sm text-gray-400 mt-1.5">Este cliente no tiene recibos internos pendientes</p>
                ) : (
                  <select value={ventaId} onChange={e => setVentaId(e.target.value)} className={INPUT_CLS}>
                    <option value="">Selecciona un recibo interno…</option>
                    {recibos.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.numero_factura} — Monto {fmtS(f.monto)} — Saldo {fmtS(f.saldo_pendiente)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {saldoRestante !== null && !isNaN(montoNum) && montoNum > 0 && montoNum <= montoPendiente + 0.01 && (
            saldoRestante > 0.01 ? (
              <p className="text-xs text-orange-600 font-medium mt-3">⚠️ Quedará {fmtS(saldoRestante)} pendiente</p>
            ) : (
              <p className="text-xs text-green-600 font-medium mt-3">✅ Garantía completamente ejecutada</p>
            )
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm mt-4">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={confirmar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors">
            {saving ? "Ejecutando…" : "✅ Confirmar Ejecución"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab principal ─────────────────────────────────────────────────────────────
export default function GarantiasTab() {
  const [garantias, setGarantias] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resumen, setResumen] = useState(null);

  // Filtros aplicados (los que realmente se mandan a la API)
  const [filtros, setFiltros] = useState({ fecha_desde: "", fecha_hasta: "", cliente: "", estado: "" });
  // Borrador de filtros (lo que el usuario está tipeando, se aplica con "Filtrar")
  const [draft, setDraft] = useState({ fecha_desde: "", fecha_hasta: "", cliente: "", estado: "" });
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  const [modalGarantia, setModalGarantia] = useState(null); // false=cerrado, "nueva", o el objeto a editar
  const [modalDetalleId, setModalDetalleId] = useState(null);
  const [modalDevolver, setModalDevolver] = useState(null);
  const [modalEjecutar, setModalEjecutar] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, per_page: PER_PAGE };
      if (filtros.fecha_desde) params.fecha_desde = filtros.fecha_desde;
      if (filtros.fecha_hasta) params.fecha_hasta = filtros.fecha_hasta;
      if (filtros.cliente)     params.cliente = filtros.cliente;
      if (filtros.estado)      params.estado = filtros.estado;
      const r = await getGarantias(params);
      setGarantias(r.data || []);
      setTotal(r.total || 0);
    } catch { setGarantias([]); setTotal(0); }
    finally { setLoading(false); }
  }, [page, filtros]);

  const cargarResumen = useCallback(async () => {
    try { setResumen(await getResumenGarantias()); } catch { setResumen(null); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  const recargarTodo = () => { cargar(); cargarResumen(); };

  function aplicarFiltros() {
    setPage(1);
    setFiltros({ ...draft });
  }
  function limpiarFiltros() {
    const vacio = { fecha_desde: "", fecha_hasta: "", cliente: "", estado: "" };
    setDraft(vacio);
    setFiltros(vacio);
    setPage(1);
  }

  async function handleEliminar() {
    if (!confirmDel) return;
    setDeletingId(confirmDel.id);
    try {
      await eliminarGarantia(confirmDel.id);
      recargarTodo();
    } catch (err) {
      alert(parsearError(err));
    } finally {
      setDeletingId(null);
      setConfirmDel(null);
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border-l-4 border-amber-500 shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Total Retenido</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{resumen ? fmtS(resumen.total_retenido) : "…"}</p>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-blue-500 shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Total Devuelto</p>
          <p className="text-xl font-bold text-blue-600 mt-1">{resumen ? fmtS(resumen.total_devuelto) : "…"}</p>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-red-500 shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Total Ejecutado</p>
          <p className="text-xl font-bold text-red-600 mt-1">{resumen ? fmtS(resumen.total_ejecutado) : "…"}</p>
        </div>
      </div>

      {/* Filtros + botón nueva */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Desde</label>
            <input type="date" value={draft.fecha_desde} onChange={e => setDraft(d => ({ ...d, fecha_desde: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Hasta</label>
            <input type="date" value={draft.fecha_hasta} onChange={e => setDraft(d => ({ ...d, fecha_hasta: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Cliente (RUC/Nombre)</label>
            <input type="text" value={draft.cliente} onChange={e => setDraft(d => ({ ...d, cliente: e.target.value }))}
              placeholder="Buscar cliente…"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[180px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Estado</label>
            <select value={draft.estado} onChange={e => setDraft(d => ({ ...d, estado: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">Todas</option>
              <option value="retenida">Retenida</option>
              <option value="devolucion_parcial">Devolución Parcial</option>
              <option value="devuelta">Devuelta</option>
              <option value="ejecutada">Ejecutada</option>
            </select>
          </div>
          <button onClick={aplicarFiltros}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg transition-colors">
            Filtrar
          </button>
          <button onClick={limpiarFiltros}
            className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors">
            Limpiar
          </button>
          <button onClick={() => setModalGarantia("nueva")}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
            <HiPlus className="text-base" /> Nueva Garantía
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
                <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                <th className="px-4 py-3 text-left font-semibold">N° Doc</th>
                <th className="px-4 py-3 text-left font-semibold">Tipo Doc</th>
                <th className="px-4 py-3 text-right font-semibold">Monto</th>
                <th className="px-4 py-3 text-right font-semibold">Devuelto</th>
                <th className="px-4 py-3 text-right font-semibold">Ejecutado</th>
                <th className="px-4 py-3 text-right font-semibold">Pendiente</th>
                <th className="px-4 py-3 text-left font-semibold">Estado</th>
                <th className="px-4 py-3 text-center font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
              ) : garantias.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400 text-sm">No hay garantías registradas</td></tr>
              ) : garantias.map(g => {
                const info = ESTADO_INFO[g.estado] || ESTADO_INFO.retenida;
                const puedeEditar    = g.estado === "retenida";
                const puedeDevolver  = g.estado === "retenida" || g.estado === "devolucion_parcial";
                const puedeEjecutar  = g.estado === "retenida" || g.estado === "devolucion_parcial";
                // Eliminar es visible en todos los estados (corrección de errores de digitación).
                return (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(g.fecha_cobro)}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate" title={g.cliente_nombre}>{g.cliente_nombre || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{g.numero_documento || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{g.tipo_documento}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(g.monto)}</td>
                    <td className="px-4 py-3 text-right text-blue-700 whitespace-nowrap">{fmtS(g.monto_devuelto)}</td>
                    <td className="px-4 py-3 text-right text-red-700 whitespace-nowrap">{fmtS(g.monto_ejecutado)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-700 whitespace-nowrap">{fmtS(g.monto_pendiente)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${info.cls}`}>{info.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setModalDetalleId(g.id)} title="Ver Detalle"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <HiEye className="text-base" />
                        </button>
                        {puedeEditar && (
                          <button onClick={() => setModalGarantia(g)} title="Editar"
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                            <HiPencil className="text-base" />
                          </button>
                        )}
                        {puedeDevolver && (
                          <button onClick={() => setModalDevolver(g)} title="Devolver"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <HiRefresh className="text-base" />
                          </button>
                        )}
                        {puedeEjecutar && (
                          <button onClick={() => setModalEjecutar(g)} title="Ejecutar"
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
                            <HiLightningBolt className="text-base" />
                          </button>
                        )}
                        <button onClick={() => setConfirmDel(g)} disabled={deletingId === g.id} title="Eliminar"
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

      {modalGarantia && (
        <ModalGarantia
          garantia={modalGarantia === "nueva" ? null : modalGarantia}
          onClose={() => setModalGarantia(null)}
          onSaved={() => { setModalGarantia(null); recargarTodo(); }}
        />
      )}
      {modalDetalleId && (
        <ModalDetalleGarantia garantiaId={modalDetalleId} onClose={() => setModalDetalleId(null)} />
      )}
      {modalDevolver && (
        <ModalDevolverGarantia g={modalDevolver} onClose={() => setModalDevolver(null)}
          onSaved={() => { setModalDevolver(null); recargarTodo(); }} />
      )}
      {modalEjecutar && (
        <ModalEjecutarGarantia g={modalEjecutar} onClose={() => setModalEjecutar(null)}
          onSaved={() => { setModalEjecutar(null); recargarTodo(); }} />
      )}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-800 mb-1">¿Eliminar esta garantía?</p>
            <p className="text-sm text-gray-500 mb-4">
              {confirmDel.cliente_nombre} — {fmtS(confirmDel.monto)}. Esta acción es irreversible.
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
    </div>
  );
}
