import { getComprobanteBlob, getComprobanteImprimir } from "../../api/comercialApi";

function getValueByPath(obj, path) {
  if (!obj || !path) return null;

  const keys = path.split('.');
  let value = obj;

  for (const key of keys) {
    if (value === null || value === undefined) return null;
    value = value[key];
  }

  return value ?? null;
}

function renderTemplate(template, data) {
  if (!template || !data) return '';

  let html = template;

  // Manejar listas dinámicas {{#items}}...{{/items}} y condicionales positivos {{#campo}}...{{/campo}}
  html = html.replace(
    /\{\{#([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (match, key, content) => {
      const value = getValueByPath(data, key);

      if (Array.isArray(value)) {
        if (value.length === 0) return '';
        return value
          .map((item, idx) => {
            const esObjeto = item !== null && typeof item === 'object';
            const itemConIndice = esObjeto ? { numero: idx + 1, ...item } : item;
            return content.replace(/\{\{(\.|[a-zA-Z0-9_.]+)\}\}/g, (m, k) => {
              if (k === '.') return itemConIndice ?? '';
              return getValueByPath(itemConIndice, k) ?? '';
            });
          })
          .join('');
      }

      if (!value) return '';

      // Condicional positivo con valor escalar: renderizar una vez contra los datos del padre
      return content.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (m, k) => {
        return getValueByPath(data, k) ?? '';
      });
    }
  );

  // Manejar condicionales negativos {{^campo}}...{{/campo}}
  html = html.replace(
    /\{\{\^([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (match, key, content) => {
      const value = getValueByPath(data, key);
      return !value || (Array.isArray(value) && value.length === 0) ? content : '';
    }
  );

  // Reemplazar placeholders simples {{placeholder}}
  html = html.replace(
    /\{\{([a-zA-Z0-9_.]+)\}\}/g,
    (match, key) => {
      const value = getValueByPath(data, key);
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  );

  return html;
}

// Función imperativa: recibe el comprobante ya cargado, renderiza el
// template y dispara la impresión del navegador.
//
// Por defecto abre una ventana nueva (uso desde un modal dentro de la SPA,
// como FormComprobante.jsx o Gastos.jsx, donde la función se invoca directo
// desde un onClick y el navegador todavía asocia la llamada a window.open
// con el gesto del usuario).
//
// Con { enVentanaActual: true } imprime reemplazando el documento de la
// ventana actual en vez de abrir una nueva — necesario cuando quien llama ya
// es una pestaña dedicada a imprimir (ImprimirComprobante.jsx, abierta con
// window.open desde Ventas.jsx): un window.open() adicional disparado desde
// un useEffect al montar esa pestaña no tiene gesto de usuario asociado y el
// navegador lo bloquea como popup.
//
// Con { ventanaDestino } escribe el documento en una ventana ya abierta por
// quien llama (ver imprimirComprobanteVenta más abajo), en vez de abrir una
// nueva o usar la actual.
async function imprimirComprobante(data, { enVentanaActual = false, ventanaDestino = null } = {}) {
  console.log('Datos recibidos para imprimir:', data);

  const [templateRes, cssRes] = await Promise.all([
    fetch('/templates/factura.html'),
    fetch('/templates/factura.css'),
  ]);

  if (!templateRes.ok) throw new Error('No se pudo cargar el template HTML');
  if (!cssRes.ok) throw new Error('No se pudo cargar el CSS');

  const [templateHTML, cssText] = await Promise.all([
    templateRes.text(),
    cssRes.text(),
  ]);

  const htmlFinal = renderTemplate(templateHTML, data).replace(
    '<link rel="stylesheet" href="factura.css">',
    `<style>${cssText}</style>`
  );

  const ventana = ventanaDestino || (enVentanaActual ? window : window.open('', '_blank'));
  if (!ventana) throw new Error('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes.');

  ventana.document.open();
  ventana.document.write(htmlFinal);
  ventana.document.close();

  await new Promise((resolve) => {
    ventana.addEventListener('load', resolve, { once: true });
    setTimeout(resolve, 500);
  });

  ventana.focus();
  ventana.print();
}

// Lógica única de impresión de un comprobante de venta, compartida por el
// botón de la tabla (Ventas.jsx) y el de la vista de detalle
// (FormComprobante.jsx):
//   1. Si el comprobante tiene un PDF original importado (tiene_comprobante)
//      → se descarga como blob (con el token JWT, vía axios) y se abre tal
//      cual, sin regenerar ninguna plantilla.
//   2. Si no lo tiene → se cae a la plantilla HTML generada por el sistema
//      (mismo comportamiento de siempre para comprobantes creados a mano).
async function imprimirComprobanteVenta(comprobante) {
  // La pestaña se abre ANTES de cualquier await para no disparar el
  // bloqueador de pop-ups del navegador (solo permite window.open síncrono
  // como reacción directa al clic) — mismo patrón que ya usa Gastos.jsx.
  const ventana = window.open('', '_blank');
  if (!ventana) throw new Error('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes.');

  try {
    if (comprobante.tiene_comprobante) {
      const blob = await getComprobanteBlob(comprobante.id);
      const url = window.URL.createObjectURL(blob);
      ventana.location.href = url;
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } else {
      const data = await getComprobanteImprimir(comprobante.id);
      await imprimirComprobante(data, { ventanaDestino: ventana });
    }
  } catch (err) {
    ventana.close();
    throw err;
  }
}

export default imprimirComprobante;
export { imprimirComprobante, imprimirComprobanteVenta };
