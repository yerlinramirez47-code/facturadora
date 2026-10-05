import { html, raw, json } from './html.js';
import * as u from './util.js';

const si = (cond, texto) => (cond ? raw(texto) : '');
const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', 'Otro'];

// ------------------------------------------------------------------ Plantilla general

export function pagina(ctx, titulo, contenido) {
  const { usuario, config, ruta, flash } = ctx;
  const enlace = (href, texto, activo) => html`<a href="${href}" class="${activo ? 'activo' : ''}">${texto}</a>`;
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${titulo ? titulo + ' · ' : ''}${config.tienda_nombre}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${usuario
  ? html`<header class="barra">
  <div class="barra-in">
    <a class="marca" href="/facturas">${config.tienda_nombre}</a>
    <button class="menu-btn" type="button" aria-label="Menú" onclick="document.body.classList.toggle('menu-abierto')">☰</button>
    <nav class="menu">
      ${enlace('/facturas/nueva', '+ Factura', ruta === '/facturas/nueva')}
      ${enlace('/facturas', 'Facturas', ruta === '/facturas')}
      ${enlace('/clientes', 'Clientes', ruta.startsWith('/clientes'))}
      ${usuario.es_admin ? [enlace('/usuarios', 'Usuarios', ruta === '/usuarios'), enlace('/configuracion', 'Tienda', ruta === '/configuracion')] : ''}
      ${enlace('/cuenta', 'Mi cuenta', ruta === '/cuenta')}
      <form method="post" action="/logout" class="salir"><button type="submit">Salir (${usuario.usuario})</button></form>
    </nav>
  </div>
</header>`
  : ''}
<main class="contenido">
${flash ? html`<div class="aviso aviso-${flash.tipo}">${flash.texto}</div>` : ''}
${contenido}
</main>
</body>
</html>`;
}

const avisoError = (error) => (error ? html`<div class="aviso aviso-error">${error}</div>` : '');
const estadoEtiqueta = (pagada) =>
  html`<span class="estado ${pagada ? 'pagada' : 'pendiente'}">${pagada ? 'Pagada' : 'Pendiente'}</span>`;

// ------------------------------------------------------------------ Sesión y errores

export function login(ctx, { error = null, usuarioIngresado = '' } = {}) {
  return pagina(ctx, 'Iniciar sesión', html`
<div class="login">
  <h1>${ctx.config.tienda_nombre}</h1>
  <p class="sutil">Facturación</p>
  ${avisoError(error)}
  <form method="post" action="/login" class="tarjeta">
    <label>Usuario
      <input name="usuario" value="${usuarioIngresado}" autocomplete="username" autocapitalize="none" required autofocus>
    </label>
    <label>Contraseña
      <input name="clave" type="password" autocomplete="current-password" required>
    </label>
    <button class="btn btn-primario ancho" type="submit">Entrar</button>
  </form>
</div>`);
}

export function error(ctx, titulo, mensaje) {
  return pagina(ctx, titulo, html`
<div class="tarjeta">
  <h1>${titulo}</h1>
  <p>${mensaje}</p>
  <p><a class="btn" href="/facturas">Ir a facturas</a></p>
</div>`);
}

// ------------------------------------------------------------------ Facturas

export function listaFacturas(ctx, { facturas, q, estado, totales, clienteFiltro }) {
  const filas = facturas.map((f) => {
    const pagada = f.saldo <= 0.004;
    return html`
    <tr onclick="location.href='/facturas/${f.id}'" class="clic">
      <td data-t="Núm."><a href="/facturas/${f.id}">${u.numFactura(f.id)}</a></td>
      <td data-t="Fecha">${u.fecha(f.fecha)}</td>
      <td data-t="Cliente"><span>${f.cliente}${f.telefono ? html` <span class="sutil">· ${f.telefono}</span>` : ''}</span></td>
      <td data-t="Total" class="der">${u.rd(f.total)}</td>
      <td data-t="Abonado" class="der">${u.rd(f.abonado)}</td>
      <td data-t="Saldo" class="der"><strong>${u.rd(f.saldo)}</strong></td>
      <td data-t="Estado">${estadoEtiqueta(pagada)}</td>
    </tr>`;
  });
  return pagina(ctx, 'Facturas', html`
<div class="encabezado">
  <h1>Facturas</h1>
  <a class="btn btn-primario" href="/facturas/nueva">+ Nueva factura</a>
</div>

<form method="get" action="/facturas" class="filtros">
  ${clienteFiltro ? html`<input type="hidden" name="cliente" value="${clienteFiltro.id}">` : ''}
  <input type="search" name="q" value="${q}" placeholder="Buscar cliente, teléfono o núm. de factura">
  <select name="estado" onchange="this.form.submit()" aria-label="Estado">
    <option value="" ${si(estado === '', 'selected')}>Todas</option>
    <option value="pendiente" ${si(estado === 'pendiente', 'selected')}>Pendientes</option>
    <option value="pagada" ${si(estado === 'pagada', 'selected')}>Pagadas</option>
  </select>
  <button class="btn" type="submit">Buscar</button>
</form>

${clienteFiltro ? html`<p class="sutil">Mostrando facturas de <strong>${clienteFiltro.nombre}</strong> · <a href="/facturas">ver todas</a></p>` : ''}

<div class="resumen">
  <div><span>Facturado</span><strong>${u.rd(totales.total)}</strong></div>
  <div><span>Cobrado</span><strong>${u.rd(totales.abonado)}</strong></div>
  <div><span>Por cobrar</span><strong class="rojo">${u.rd(totales.saldo)}</strong></div>
</div>

${facturas.length
  ? html`<table class="tabla tabla-apilada">
  <thead>
    <tr><th>Núm.</th><th>Fecha</th><th>Cliente</th><th class="der">Total</th><th class="der">Abonado</th><th class="der">Saldo</th><th>Estado</th></tr>
  </thead>
  <tbody>${filas}</tbody>
</table>
${facturas.length === 500 ? html`<p class="sutil">Se muestran las 500 más recientes. Usa la búsqueda para encontrar otras.</p>` : ''}`
  : html`<div class="tarjeta vacio">No hay facturas que coincidan.</div>`}`);
}

export function nuevaFactura(ctx, { clientes, error = null, datos }) {
  const opcionesClientes = clientes.map(
    (c) => html`<option value="${c.id}" ${si(String(datos.cliente_id) === String(c.id), 'selected')}>${c.nombre}${c.telefono ? ' · ' + c.telefono : ''}</option>`
  );
  return pagina(ctx, 'Nueva factura', html`
<h1>Nueva factura</h1>
${avisoError(error)}

<form method="post" action="/facturas" id="form-factura" class="tarjeta">
  <fieldset>
    <legend>Cliente</legend>
    ${clientes.length > 8 ? html`<input type="search" id="filtro-cliente" placeholder="Filtrar clientes por nombre o teléfono" aria-label="Filtrar clientes">` : ''}
    <select name="cliente_id" id="cliente_id" required aria-label="Cliente">
      <option value="">— Selecciona un cliente —</option>
      <option value="nuevo" ${si(datos.cliente_id === 'nuevo', 'selected')}>+ Cliente nuevo…</option>
      ${opcionesClientes}
    </select>
    <div id="cliente-nuevo" class="fila-2" hidden>
      <label>Nombre del cliente<input name="nuevo_nombre" value="${datos.nuevo_nombre || ''}"></label>
      <label>Teléfono<input name="nuevo_telefono" type="tel" value="${datos.nuevo_telefono || ''}"></label>
    </div>
  </fieldset>

  <div class="fila-2">
    <label>Fecha<input type="date" name="fecha" value="${datos.fecha}" required></label>
    <label>Tipo de venta
      <select name="tipo" id="tipo">
        <option value="contado" ${si(datos.tipo === 'contado', 'selected')}>Contado</option>
        <option value="credito" ${si(datos.tipo === 'credito', 'selected')}>Crédito</option>
      </select>
    </label>
  </div>

  <fieldset>
    <legend>Productos</legend>
    <div id="items">
      <div class="item item-titulos" aria-hidden="true">
        <span>Descripción</span><span>Cant.</span><span>Precio (RD$)</span><span class="der">Subtotal</span><span></span>
      </div>
    </div>
    <button type="button" class="btn" id="agregar">+ Agregar producto</button>
  </fieldset>

  <div class="totales-form">
    <div><span>Total</span><strong id="total">RD$ 0.00</strong></div>
  </div>

  <fieldset id="pago">
    <legend>Pago</legend>
    <div class="fila-2">
      <label id="lbl-abono">Abono inicial (RD$)
        <input name="abono_inicial" id="abono" inputmode="decimal" value="${datos.abono_inicial || ''}" placeholder="0.00">
      </label>
      <label>Método de pago
        <select name="metodo">
          ${METODOS.map((m) => html`<option ${si(datos.metodo === m, 'selected')}>${m}</option>`)}
        </select>
      </label>
    </div>
    <p class="sutil" id="nota-pago"></p>
  </fieldset>

  <label>Notas (opcional)<textarea name="notas" rows="2">${datos.notas}</textarea></label>

  <button class="btn btn-primario ancho" type="submit">Guardar factura</button>
</form>

<template id="tpl-item">
  <div class="item">
    <input name="descripcion" placeholder="Producto" aria-label="Descripción">
    <input name="cantidad" inputmode="decimal" value="1" placeholder="Cant." aria-label="Cantidad">
    <input name="precio" inputmode="decimal" placeholder="Precio" aria-label="Precio">
    <span class="subtotal der">RD$ 0.00</span>
    <button type="button" class="quitar" aria-label="Quitar">✕</button>
  </div>
</template>

<script>
(function () {
  const previos = ${json(datos.items || [])};
  const items = document.getElementById('items');
  const tpl = document.getElementById('tpl-item');
  const fmt = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rd = (n) => 'RD$ ' + fmt.format(n || 0);
  const num = (v) => { const n = Number(String(v || '').replace(/RD\\$|\\s|,/gi, '')); return isFinite(n) ? n : 0; };

  function agregar(d) {
    const nodo = tpl.content.firstElementChild.cloneNode(true);
    if (d) {
      nodo.querySelector('[name=descripcion]').value = d.descripcion || '';
      nodo.querySelector('[name=cantidad]').value = d.cantidad || '';
      nodo.querySelector('[name=precio]').value = d.precio || '';
    }
    items.appendChild(nodo);
    return nodo;
  }

  let total = 0;
  function recalcular() {
    total = 0;
    items.querySelectorAll('.item:not(.item-titulos)').forEach((fila) => {
      const st = Math.round(num(fila.querySelector('[name=cantidad]').value) * num(fila.querySelector('[name=precio]').value) * 100) / 100;
      fila.querySelector('.subtotal').textContent = rd(st);
      total += st;
    });
    document.getElementById('total').textContent = rd(total);
    actualizarPago();
  }

  const tipo = document.getElementById('tipo');
  const abono = document.getElementById('abono');
  function actualizarPago() {
    const credito = tipo.value === 'credito';
    document.getElementById('lbl-abono').hidden = !credito;
    const nota = document.getElementById('nota-pago');
    if (credito) {
      const ab = num(abono.value);
      nota.textContent = ab > total + 0.004
        ? 'El abono no puede ser mayor que el total.'
        : 'Quedará pendiente: ' + rd(Math.max(total - ab, 0));
    } else {
      nota.textContent = 'Venta de contado: se registrará un pago por el total (' + rd(total) + ').';
    }
  }

  items.addEventListener('input', recalcular);
  items.addEventListener('click', (e) => {
    if (!e.target.classList.contains('quitar')) return;
    const filas = items.querySelectorAll('.item:not(.item-titulos)');
    if (filas.length > 1) e.target.closest('.item').remove();
    else e.target.closest('.item').querySelectorAll('input').forEach((i) => (i.value = i.name === 'cantidad' ? '1' : ''));
    recalcular();
  });
  document.getElementById('agregar').addEventListener('click', () => { agregar().querySelector('input').focus(); });
  tipo.addEventListener('change', actualizarPago);
  abono.addEventListener('input', actualizarPago);

  const sel = document.getElementById('cliente_id');
  const bloqueNuevo = document.getElementById('cliente-nuevo');
  function verNuevo() {
    const nuevo = sel.value === 'nuevo';
    bloqueNuevo.hidden = !nuevo;
    bloqueNuevo.querySelector('[name=nuevo_nombre]').required = nuevo;
  }
  sel.addEventListener('change', verNuevo);

  const filtro = document.getElementById('filtro-cliente');
  if (filtro) {
    filtro.addEventListener('input', () => {
      const t = filtro.value.toLowerCase();
      let primero = null;
      Array.from(sel.options).forEach((o) => {
        if (!o.value || o.value === 'nuevo') return;
        const ver = o.text.toLowerCase().includes(t);
        o.hidden = !ver;
        if (ver && !primero) primero = o;
      });
      if (t && primero) { sel.value = primero.value; verNuevo(); }
    });
  }

  if (previos.length) previos.forEach(agregar); else agregar();
  verNuevo();
  recalcular();
})();
</script>`);
}

export function detalleFactura(ctx, f) {
  const admin = ctx.usuario.es_admin;
  const pendiente = f.saldo > 0.004;
  return pagina(ctx, u.numFactura(f.id), html`
<div class="encabezado">
  <h1>Factura ${u.numFactura(f.id)} ${estadoEtiqueta(!pendiente)}</h1>
  <a class="btn btn-primario" href="/facturas/${f.id}/imprimir" target="_blank">🖨 Imprimir comprobante</a>
</div>

<div class="rejilla">
  <section class="tarjeta">
    <h2>Cliente</h2>
    <p><strong>${f.cliente}</strong></p>
    ${f.telefono ? html`<p>Tel.: <a href="tel:${f.telefono}">${f.telefono}</a>${f.telefono2 ? ' / ' + f.telefono2 : ''}</p>` : ''}
    ${f.documento ? html`<p>Cédula/RNC: ${f.documento}</p>` : ''}
    ${f.direccion ? html`<p>${f.direccion}</p>` : ''}
    <p class="sutil"><a href="/facturas?cliente=${f.cliente_id}">Ver todas sus facturas</a></p>
  </section>
  <section class="tarjeta">
    <h2>Resumen</h2>
    <p>Fecha: <strong>${u.fecha(f.fecha)}</strong> · ${f.tipo === 'credito' ? 'Crédito' : 'Contado'}</p>
    <div class="cifras">
      <div><span>Total</span><strong>${u.rd(f.total)}</strong></div>
      <div><span>Abonado</span><strong class="verde">${u.rd(f.abonado)}</strong></div>
      <div><span>Saldo</span><strong class="${pendiente ? 'rojo' : 'verde'}">${u.rd(f.saldo)}</strong></div>
    </div>
    ${f.vendedor_usuario ? html`<p class="sutil">Registrada por ${f.vendedor || f.vendedor_usuario}</p>` : ''}
  </section>
</div>

<section class="tarjeta">
  <h2>Productos</h2>
  <div class="tabla-scroll"><table class="tabla">
    <thead><tr><th>Descripción</th><th class="der">Cant.</th><th class="der">Precio</th><th class="der">Subtotal</th></tr></thead>
    <tbody>
    ${f.items.map((it) => html`<tr><td>${it.descripcion}</td><td class="der">${u.cantidad(it.cantidad)}</td><td class="der">${u.rd(it.precio)}</td><td class="der">${u.rd(it.subtotal)}</td></tr>`)}
    </tbody>
    <tfoot><tr><th colspan="3" class="der">Total</th><th class="der">${u.rd(f.total)}</th></tr></tfoot>
  </table></div>
  ${f.notas ? html`<p class="sutil">Notas: ${f.notas}</p>` : ''}
</section>

<section class="tarjeta">
  <h2>Pagos y abonos</h2>
  ${f.pagos.length
    ? html`<div class="tabla-scroll"><table class="tabla">
    <thead><tr><th>Fecha</th><th>Método</th><th>Nota</th><th class="der">Monto</th>${admin ? html`<th></th>` : ''}</tr></thead>
    <tbody>
    ${f.pagos.map((p) => html`
      <tr>
        <td>${u.fecha(p.fecha)}</td>
        <td>${p.metodo}</td>
        <td>${p.nota}</td>
        <td class="der">${u.rd(p.monto)}</td>
        ${admin
          ? html`<td class="der">
          <form method="post" action="/pagos/${p.id}/eliminar" data-confirmar="¿Eliminar este pago de ${u.rd(p.monto)}?">
            <button class="enlace-peligro" type="submit">Eliminar</button>
          </form>
        </td>`
          : ''}
      </tr>`)}
    </tbody>
  </table></div>`
    : html`<p class="sutil">Todavía no hay pagos registrados.</p>`}

  ${pendiente
    ? html`<form method="post" action="/facturas/${f.id}/abonos" class="abono">
    <h3>Registrar abono</h3>
    <div class="fila-3">
      <label>Monto (RD$)<input name="monto" inputmode="decimal" required placeholder="${f.saldo.toFixed(2)}"></label>
      <label>Fecha<input type="date" name="fecha" value="${u.hoy()}" required></label>
      <label>Método
        <select name="metodo">${METODOS.map((m) => html`<option>${m}</option>`)}</select>
      </label>
    </div>
    <label>Nota (opcional)<input name="nota" maxlength="200"></label>
    <div class="acciones">
      <button class="btn btn-primario" type="submit">Registrar abono</button>
      <button class="btn" type="button" onclick="this.form.monto.value='${f.saldo.toFixed(2)}'">Saldar todo (${u.rd(f.saldo)})</button>
    </div>
  </form>`
    : ''}
</section>

${admin
  ? html`<form method="post" action="/facturas/${f.id}/eliminar" class="zona-peligro" data-confirmar="¿Eliminar la factura ${u.numFactura(f.id)} con todos sus pagos? No se puede deshacer.">
  <button class="enlace-peligro" type="submit">Eliminar factura</button>
</form>`
  : ''}
<script>
document.querySelectorAll('form[data-confirmar]').forEach((f) =>
  f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirmar)) e.preventDefault(); }));
</script>`);
}

export function comprobante(ctx, f) {
  const c = ctx.config;
  const contacto = [c.tienda_telefono && 'Tel.: ' + c.tienda_telefono, c.tienda_correo].filter(Boolean).join(' · ');
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Comprobante ${u.numFactura(f.id)} · ${c.tienda_nombre}</title>
  <link rel="stylesheet" href="/imprimir.css">
</head>
<body>
  <div class="controles">
    <button onclick="window.print()">🖨 Imprimir</button>
    <a href="/facturas/${f.id}">← Volver a la factura</a>
  </div>

  <article class="comprobante">
    <header>
      <div>
        <h1>${c.tienda_nombre}</h1>
        ${c.tienda_rnc ? html`<p>RNC: ${c.tienda_rnc}</p>` : ''}
        ${c.tienda_direccion ? html`<p>${c.tienda_direccion}</p>` : ''}
        ${contacto ? html`<p>${contacto}</p>` : ''}
      </div>
      <div class="doc">
        <h2>FACTURA</h2>
        <p class="num">${u.numFactura(f.id)}</p>
        <p>Fecha: ${u.fecha(f.fecha)}</p>
        <p>Venta a ${f.tipo === 'credito' ? 'crédito' : 'contado'}</p>
        <p class="sello ${f.estado}">${f.estado === 'pagada' ? 'PAGADA' : 'PENDIENTE'}</p>
      </div>
    </header>

    <section class="cliente">
      <strong>Cliente:</strong> ${f.cliente}
      ${f.telefono ? html` · Tel.: ${f.telefono}${f.telefono2 ? ' / ' + f.telefono2 : ''}` : ''}
      ${f.documento ? html`<br>Cédula/RNC: ${f.documento}` : ''}
      ${f.direccion ? html`<br>${f.direccion}` : ''}
    </section>

    <table>
      <thead><tr><th>Descripción</th><th class="der">Cant.</th><th class="der">Precio</th><th class="der">Subtotal</th></tr></thead>
      <tbody>
      ${f.items.map((it) => html`<tr><td>${it.descripcion}</td><td class="der">${u.cantidad(it.cantidad)}</td><td class="der">${u.rd(it.precio)}</td><td class="der">${u.rd(it.subtotal)}</td></tr>`)}
      </tbody>
    </table>

    <div class="pie">
      <div class="pagos">
        <h3>Pagos recibidos</h3>
        ${f.pagos.length
          ? html`<table>${f.pagos.map((p) => html`<tr><td>${u.fecha(p.fecha)}</td><td>${p.metodo}${p.nota ? ' — ' + p.nota : ''}</td><td class="der">${u.rd(p.monto)}</td></tr>`)}</table>`
          : html`<p>Sin pagos registrados.</p>`}
      </div>
      <div class="totales">
        <div><span>Total</span><strong>${u.rd(f.total)}</strong></div>
        <div><span>Abonado</span><strong>${u.rd(f.abonado)}</strong></div>
        <div class="saldo"><span>Saldo pendiente</span><strong>${u.rd(f.saldo)}</strong></div>
      </div>
    </div>

    ${f.notas ? html`<p class="notas">Notas: ${f.notas}</p>` : ''}
    ${f.tipo === 'credito' ? html`<div class="firmas"><div>Firma del cliente</div><div>Recibido por</div></div>` : ''}
    ${c.pie_comprobante ? html`<p class="gracias">${c.pie_comprobante}</p>` : ''}
  </article>
</body>
</html>`;
}

// ------------------------------------------------------------------ Clientes

export function listaClientes(ctx, { clientes, q }) {
  return pagina(ctx, 'Clientes', html`
<div class="encabezado">
  <h1>Clientes</h1>
  <a class="btn btn-primario" href="/clientes/nuevo">+ Nuevo cliente</a>
</div>

<form method="get" action="/clientes" class="filtros">
  <input type="search" name="q" value="${q}" placeholder="Buscar por nombre, teléfono o cédula">
  <button class="btn" type="submit">Buscar</button>
</form>

${clientes.length
  ? html`<table class="tabla tabla-apilada">
  <thead><tr><th>Nombre</th><th>Teléfonos</th><th class="der">Facturas</th><th class="der">Saldo pendiente</th><th></th></tr></thead>
  <tbody>
  ${clientes.map((c) => html`
    <tr>
      <td data-t="Nombre"><span><strong>${c.nombre}</strong>${c.documento ? html`<br><span class="sutil">${c.documento}</span>` : ''}</span></td>
      <td data-t="Teléfonos"><span>
        ${c.telefono ? html`<a href="tel:${c.telefono}">${c.telefono}</a>` : ''}
        ${c.telefono2 ? html`<br><a href="tel:${c.telefono2}">${c.telefono2}</a>` : ''}
      </span></td>
      <td data-t="Facturas" class="der"><a href="/facturas?cliente=${c.id}">${c.facturas}</a></td>
      <td data-t="Saldo" class="der"><strong class="${c.saldo > 0.004 ? 'rojo' : ''}">${u.rd(c.saldo)}</strong></td>
      <td class="der acciones-fila">
        <a href="/facturas/nueva?cliente=${c.id}">Facturar</a>
        <a href="/clientes/${c.id}/editar">Editar</a>
      </td>
    </tr>`)}
  </tbody>
</table>`
  : html`<div class="tarjeta vacio">${q ? 'Ningún cliente coincide con la búsqueda.' : 'Aún no hay clientes registrados.'}</div>`}`);
}

export function formularioCliente(ctx, { titulo, cliente, error = null }) {
  return pagina(ctx, titulo, html`
<h1>${titulo}</h1>
${avisoError(error)}
<form method="post" action="${cliente.id ? '/clientes/' + cliente.id : '/clientes'}" class="tarjeta">
  <label>Nombre completo *<input name="nombre" value="${cliente.nombre}" required autofocus></label>
  <div class="fila-2">
    <label>Teléfono<input name="telefono" type="tel" value="${cliente.telefono}" placeholder="809-000-0000"></label>
    <label>Otro teléfono<input name="telefono2" type="tel" value="${cliente.telefono2}"></label>
  </div>
  <div class="fila-2">
    <label>Cédula o RNC<input name="documento" value="${cliente.documento}"></label>
    <label>Dirección<input name="direccion" value="${cliente.direccion}"></label>
  </div>
  <label>Notas<textarea name="notas" rows="2">${cliente.notas}</textarea></label>
  <div class="acciones">
    <button class="btn btn-primario" type="submit">Guardar</button>
    <a class="btn" href="/clientes">Cancelar</a>
  </div>
</form>`);
}

// ------------------------------------------------------------------ Cuenta, usuarios y tienda

export function cuenta(ctx, { error = null } = {}) {
  const usuario = ctx.usuario;
  return pagina(ctx, 'Mi cuenta', html`
<h1>Mi cuenta</h1>
<p class="sutil">Usuario: <strong>${usuario.usuario}</strong>${usuario.es_admin ? ' (administrador)' : ''}</p>
${avisoError(error)}
<form method="post" action="/cuenta" class="tarjeta estrecha">
  <h2>Cambiar contraseña</h2>
  <label>Contraseña actual<input type="password" name="actual" autocomplete="current-password" required></label>
  <label>Nueva contraseña (mínimo 8 caracteres)<input type="password" name="nueva" autocomplete="new-password" minlength="8" required></label>
  <label>Repite la nueva contraseña<input type="password" name="repetir" autocomplete="new-password" minlength="8" required></label>
  <button class="btn btn-primario" type="submit">Cambiar contraseña</button>
</form>`);
}

export function usuarios(ctx, { usuarios, error = null }) {
  return pagina(ctx, 'Usuarios', html`
<h1>Usuarios</h1>
${avisoError(error)}
<table class="tabla tabla-apilada">
  <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Restablecer contraseña</th><th></th></tr></thead>
  <tbody>
  ${usuarios.map((x) => html`
    <tr>
      <td data-t="Usuario"><strong>${x.usuario}</strong></td>
      <td data-t="Nombre">${x.nombre}</td>
      <td data-t="Rol">${x.es_admin ? 'Administrador' : 'Vendedor'}</td>
      <td data-t="Estado">${x.activo ? 'Activo' : 'Desactivado'}</td>
      <td data-t="Contraseña">
        <form method="post" action="/usuarios/${x.id}/clave" class="en-linea">
          <input type="password" name="clave" minlength="8" placeholder="Nueva contraseña" autocomplete="new-password" required aria-label="Nueva contraseña">
          <button class="btn" type="submit">Cambiar</button>
        </form>
      </td>
      <td class="der">
        ${x.id !== ctx.usuario.id
          ? html`<form method="post" action="/usuarios/${x.id}/activo">
          <button class="${x.activo ? 'enlace-peligro' : 'enlace'}" type="submit">${x.activo ? 'Desactivar' : 'Activar'}</button>
        </form>`
          : ''}
      </td>
    </tr>`)}
  </tbody>
</table>

<form method="post" action="/usuarios" class="tarjeta estrecha" style="margin-top:1rem">
  <h2>Nuevo usuario</h2>
  <label>Usuario (sin espacios)<input name="usuario" autocapitalize="none" pattern="[a-zA-Z0-9._\\-]{3,30}" required></label>
  <label>Nombre<input name="nombre"></label>
  <label>Contraseña (mínimo 8 caracteres)<input type="password" name="clave" minlength="8" autocomplete="new-password" required></label>
  <label class="check"><input type="checkbox" name="es_admin"> Es administrador (puede gestionar usuarios, datos de la tienda y eliminar pagos o facturas)</label>
  <button class="btn btn-primario" type="submit">Crear usuario</button>
</form>`);
}

export function configuracion(ctx) {
  const c = ctx.config;
  return pagina(ctx, 'Datos de la tienda', html`
<h1>Datos de la tienda</h1>
<p class="sutil">Estos datos aparecen en el comprobante impreso.</p>
<form method="post" action="/configuracion" class="tarjeta estrecha">
  <label>Nombre de la tienda *<input name="tienda_nombre" value="${c.tienda_nombre}" required></label>
  <label>RNC<input name="tienda_rnc" value="${c.tienda_rnc}"></label>
  <label>Dirección<input name="tienda_direccion" value="${c.tienda_direccion}"></label>
  <div class="fila-2">
    <label>Teléfono<input name="tienda_telefono" type="tel" value="${c.tienda_telefono}"></label>
    <label>Correo<input name="tienda_correo" type="email" value="${c.tienda_correo}"></label>
  </div>
  <label>Mensaje al pie del comprobante<input name="pie_comprobante" value="${c.pie_comprobante}"></label>
  <button class="btn btn-primario" type="submit">Guardar</button>
</form>`);
}
