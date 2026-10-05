const ZONA = 'America/Santo_Domingo';

const formatoDinero = new Intl.NumberFormat('es-DO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function rd(monto) {
  const n = Number(monto) || 0;
  const signo = n < 0 ? '-' : '';
  return `${signo}RD$\u00a0${formatoDinero.format(Math.abs(n))}`;
}

function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Acepta "1,500.50", "1500.5", "RD$ 1,500" y devuelve número o NaN.
function aNumero(valor) {
  if (valor === undefined || valor === null) return NaN;
  const limpio = String(valor).replace(/RD\$|\s|,/gi, '');
  if (limpio === '') return NaN;
  return Number(limpio);
}

function hoy() {
  // AAAA-MM-DD en la hora de República Dominicana
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
}

function fechaValida(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto || '') && !Number.isNaN(Date.parse(texto));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fecha(texto) {
  if (!texto) return '';
  const [a, m, d] = String(texto).slice(0, 10).split('-');
  return `${d}/${MESES[Number(m) - 1]}/${a}`;
}

function numFactura(id) {
  return 'F-' + String(id).padStart(6, '0');
}

function cantidad(n) {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : formatoDinero.format(v);
}

export { rd, redondear, aNumero, hoy, fechaValida, fecha, numFactura, cantidad };
