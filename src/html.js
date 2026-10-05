// Plantillas HTML seguras: todo lo que se interpola se escapa,
// salvo lo que ya viene de otra plantilla html`` o de raw().

class Seguro {
  constructor(texto) {
    this.texto = texto;
  }
  toString() {
    return this.texto;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(valor) {
  if (valor === null || valor === undefined || valor === false) return '';
  if (valor instanceof Seguro) return valor.texto;
  if (Array.isArray(valor)) return valor.map(esc).join('');
  return String(valor).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function html(partes, ...valores) {
  let salida = partes[0];
  for (let i = 0; i < valores.length; i++) salida += esc(valores[i]) + partes[i + 1];
  return new Seguro(salida);
}

export const raw = (texto) => new Seguro(String(texto));

/** JSON seguro para incrustar dentro de <script>. */
export const json = (valor) => raw(JSON.stringify(valor).replace(/</g, '\\u003c'));
