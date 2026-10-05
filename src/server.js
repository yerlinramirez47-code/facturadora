import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import * as db from './db.js';
import * as v from './vistas.js';
import * as u from './util.js';

const PUERTO = Number(process.env.PORT) || 3000;
const CARPETA_PUBLICA = join(import.meta.dir, '..', 'public');
const DURACION_SESION_H = 12;
const COOKIE = 'sid';

// ================================================================== Utilidades HTTP

const respuestaHtml = (contenido, estado = 200) =>
  new Response(String(contenido), {
    status: estado,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const redirigir = (url, encabezados = {}) => new Response(null, { status: 303, headers: { Location: url, ...encabezados } });

function leerCookies(req) {
  const salida = {};
  for (const parte of (req.headers.get('cookie') || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) salida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

const esHttps = (req) => req.headers.get('x-forwarded-proto') === 'https' || req.url.startsWith('https:');

function cookieSesion(req, token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${esHttps(req) ? '; Secure' : ''}`;
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function ipCliente(req, servidor) {
  const reenviada = req.headers.get('x-forwarded-for');
  if (reenviada) return reenviada.split(',')[0].trim();
  return servidor.requestIP(req)?.address || 'desconocida';
}

/** Lee un campo de texto del formulario. */
const campo = (form, nombre) => String(form.get(nombre) ?? '').trim();

// ================================================================== Sesiones

async function cargarSesion(req) {
  const token = leerCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const id = hashToken(token);
  const [fila] = await db.q(
    `SELECT s.id, s.flash, s.expira, us.id AS usuario_id, us.usuario, us.nombre, us.es_admin
       FROM sesiones s JOIN usuarios us ON us.id = s.usuario_id
      WHERE s.id = $1 AND s.expira > NOW() AND us.activo`,
    [id]
  );
  if (!fila) return null;
  // Renueva la expiración como máximo una vez por hora
  if (new Date(fila.expira).getTime() - Date.now() < (DURACION_SESION_H - 1) * 3600e3) {
    await db.q(`UPDATE sesiones SET expira = NOW() + INTERVAL '${DURACION_SESION_H} hours' WHERE id = $1`, [id]);
  }
  return {
    id,
    flash: fila.flash ? JSON.parse(fila.flash) : null,
    usuario: { id: fila.usuario_id, usuario: fila.usuario, nombre: fila.nombre, es_admin: fila.es_admin },
  };
}

async function abrirSesion(req, usuarioId) {
  const token = randomBytes(32).toString('base64url');
  await db.q(
    `INSERT INTO sesiones (id, usuario_id, expira) VALUES ($1, $2, NOW() + INTERVAL '${DURACION_SESION_H} hours')`,
    [hashToken(token), usuarioId]
  );
  return cookieSesion(req, token, DURACION_SESION_H * 3600);
}

async function aviso(ctx, tipo, texto) {
  await db.q('UPDATE sesiones SET flash = $1 WHERE id = $2', [JSON.stringify({ tipo, texto }), ctx.sesion.id]);
}

// Limitar intentos de inicio de sesión fallidos por IP
const intentos = new Map();
const bloqueada = (ip) => (intentos.get(ip)?.hasta || 0) > Date.now();
function registrarFallo(ip) {
  const r = intentos.get(ip) || { fallos: 0, hasta: 0 };
  r.fallos += 1;
  if (r.fallos >= 10) {
    r.fallos = 0;
    r.hasta = Date.now() + 15 * 60 * 1000;
  }
  intentos.set(ip, r);
}

// ================================================================== Rutas

const rutas = [];
const ruta = (metodo, patron, manejador, opciones = {}) => {
  const regex = new RegExp('^' + patron.replace(/:(\w+)/g, '(?<$1>\\d+)') + '$');
  rutas.push({ metodo, regex, manejador, ...opciones });
};
const GET = (p, m, o) => ruta('GET', p, m, o);
const POST = (p, m, o) => ruta('POST', p, m, o);

const noEncontrado = (ctx, mensaje = 'La página que buscas no existe.') =>
  respuestaHtml(v.error(ctx, 'No encontrado', mensaje), 404);

// ------------------------------------------------------------------ Sesión

GET('/login', (ctx) => (ctx.usuario ? redirigir('/facturas') : respuestaHtml(v.login(ctx))), { publica: true });

POST(
  '/login',
  async (ctx) => {
    if (bloqueada(ctx.ip)) {
      return respuestaHtml(v.login(ctx, { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' }), 429);
    }
    const form = await ctx.form();
    const usuario = campo(form, 'usuario').toLowerCase();
    const clave = String(form.get('clave') ?? '');
    const [fila] = await db.q('SELECT id, password_hash FROM usuarios WHERE usuario = $1 AND activo', [usuario]);
    const ok = fila && (await db.verificarClave(clave, fila.password_hash));
    if (!ok) {
      registrarFallo(ctx.ip);
      return respuestaHtml(v.login(ctx, { error: 'Usuario o contraseña incorrectos.', usuarioIngresado: usuario }), 401);
    }
    intentos.delete(ctx.ip);
    if (ctx.sesion) await db.q('DELETE FROM sesiones WHERE id = $1', [ctx.sesion.id]);
    return redirigir('/facturas', { 'Set-Cookie': await abrirSesion(ctx.req, fila.id) });
  },
  { publica: true }
);

POST(
  '/logout',
  async (ctx) => {
    if (ctx.sesion) await db.q('DELETE FROM sesiones WHERE id = $1', [ctx.sesion.id]);
    return redirigir('/login', { 'Set-Cookie': cookieSesion(ctx.req, '', 0) });
  },
  { publica: true }
);

GET('/salud', async () => {
  try {
    await db.q('SELECT 1');
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'Sin conexión a la base de datos' }, { status: 500 });
  }
}, { publica: true, sinContexto: true });

GET('/', () => redirigir('/facturas'));

// ------------------------------------------------------------------ Clientes

GET('/clientes', async (ctx) => {
  const q = (ctx.url.searchParams.get('q') || '').trim();
  const params = [];
  let filtro = '';
  if (q) {
    params.push(`%${q}%`);
    filtro = 'WHERE c.nombre ILIKE $1 OR c.telefono ILIKE $1 OR c.telefono2 ILIKE $1 OR c.documento ILIKE $1';
  }
  const clientes = await db.q(
    `SELECT c.*, COUNT(f.id) AS facturas,
            COALESCE(SUM(f.total - COALESCE(p.abonado, 0)), 0) AS saldo
       FROM clientes c
       LEFT JOIN facturas f ON f.cliente_id = c.id
       LEFT JOIN (SELECT factura_id, SUM(monto) AS abonado FROM pagos GROUP BY factura_id) p ON p.factura_id = f.id
       ${filtro}
      GROUP BY c.id
      ORDER BY LOWER(c.nombre)
      LIMIT 500`,
    params
  );
  return respuestaHtml(v.listaClientes(ctx, { clientes, q }));
});

const CAMPOS_CLIENTE = ['nombre', 'telefono', 'telefono2', 'documento', 'direccion', 'notas'];
const clienteDesde = (form) => Object.fromEntries(CAMPOS_CLIENTE.map((c) => [c, form ? campo(form, c) : '']));

GET('/clientes/nuevo', (ctx) => respuestaHtml(v.formularioCliente(ctx, { titulo: 'Nuevo cliente', cliente: clienteDesde(null) })));

POST('/clientes', async (ctx) => {
  const c = clienteDesde(await ctx.form());
  if (!c.nombre) {
    return respuestaHtml(v.formularioCliente(ctx, { titulo: 'Nuevo cliente', cliente: c, error: 'El nombre es obligatorio.' }), 400);
  }
  await db.q(
    `INSERT INTO clientes (nombre, telefono, telefono2, documento, direccion, notas) VALUES ($1,$2,$3,$4,$5,$6)`,
    CAMPOS_CLIENTE.map((k) => c[k])
  );
  await aviso(ctx, 'ok', `Cliente "${c.nombre}" registrado.`);
  return redirigir('/clientes');
});

GET('/clientes/:id/editar', async (ctx) => {
  const [cliente] = await db.q('SELECT * FROM clientes WHERE id = $1', [ctx.id]);
  if (!cliente) return noEncontrado(ctx, 'Ese cliente no existe.');
  return respuestaHtml(v.formularioCliente(ctx, { titulo: 'Editar cliente', cliente }));
});

POST('/clientes/:id', async (ctx) => {
  const c = clienteDesde(await ctx.form());
  if (!c.nombre) {
    return respuestaHtml(
      v.formularioCliente(ctx, { titulo: 'Editar cliente', cliente: { ...c, id: ctx.id }, error: 'El nombre es obligatorio.' }),
      400
    );
  }
  await db.q(
    `UPDATE clientes SET nombre=$1, telefono=$2, telefono2=$3, documento=$4, direccion=$5, notas=$6 WHERE id=$7`,
    [...CAMPOS_CLIENTE.map((k) => c[k]), ctx.id]
  );
  await aviso(ctx, 'ok', 'Cliente actualizado.');
  return redirigir('/clientes');
});

// ------------------------------------------------------------------ Facturas

const SQL_RESUMEN = `
  SELECT f.id, f.fecha, f.tipo, f.total, f.cliente_id,
         c.nombre AS cliente, c.telefono,
         COALESCE(p.abonado, 0) AS abonado,
         f.total - COALESCE(p.abonado, 0) AS saldo
    FROM facturas f
    JOIN clientes c ON c.id = f.cliente_id
    LEFT JOIN (SELECT factura_id, SUM(monto) AS abonado FROM pagos GROUP BY factura_id) p ON p.factura_id = f.id`;

GET('/facturas', async (ctx) => {
  const sp = ctx.url.searchParams;
  const q = (sp.get('q') || '').trim();
  const estado = ['pendiente', 'pagada'].includes(sp.get('estado')) ? sp.get('estado') : '';
  const clienteId = Number(sp.get('cliente')) || 0;
  const condiciones = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    const n = params.length;
    let cond = `(c.nombre ILIKE $${n} OR c.telefono ILIKE $${n} OR c.telefono2 ILIKE $${n}`;
    const num = q.replace(/^f-?/i, '');
    if (/^\d{1,9}$/.test(num)) {
      params.push(Number(num));
      cond += ` OR f.id = $${params.length}`;
    }
    condiciones.push(cond + ')');
  }
  if (clienteId) {
    params.push(clienteId);
    condiciones.push(`f.cliente_id = $${params.length}`);
  }
  if (estado === 'pendiente') condiciones.push('f.total - COALESCE(p.abonado, 0) > 0.004');
  if (estado === 'pagada') condiciones.push('f.total - COALESCE(p.abonado, 0) <= 0.004');
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const facturas = await db.q(`${SQL_RESUMEN} ${where} ORDER BY f.fecha DESC, f.id DESC LIMIT 500`, params);
  const totales = facturas.reduce(
    (t, f) => ({ total: t.total + f.total, abonado: t.abonado + f.abonado, saldo: t.saldo + f.saldo }),
    { total: 0, abonado: 0, saldo: 0 }
  );
  let clienteFiltro = null;
  if (clienteId) [clienteFiltro] = await db.q('SELECT id, nombre FROM clientes WHERE id = $1', [clienteId]);
  return respuestaHtml(v.listaFacturas(ctx, { facturas, q, estado, totales, clienteFiltro }));
});

const listaClientesSimple = () => db.q('SELECT id, nombre, telefono FROM clientes ORDER BY LOWER(nombre)');

GET('/facturas/nueva', async (ctx) => {
  const datos = {
    cliente_id: ctx.url.searchParams.get('cliente') || '',
    fecha: u.hoy(),
    tipo: 'contado',
    items: [],
    abono_inicial: '',
    metodo: 'Efectivo',
    notas: '',
  };
  return respuestaHtml(v.nuevaFactura(ctx, { clientes: await listaClientesSimple(), datos }));
});

POST('/facturas', async (ctx) => {
  const form = await ctx.form();
  const descripciones = form.getAll('descripcion').map(String);
  const cantidades = form.getAll('cantidad').map(String);
  const precios = form.getAll('precio').map(String);
  const errores = [];
  const items = [];

  descripciones.forEach((d, i) => {
    const descripcion = d.trim();
    if (!descripcion && !(cantidades[i] || '').trim() && !(precios[i] || '').trim()) return; // fila vacía
    const cant = u.aNumero(cantidades[i]);
    const precio = u.aNumero(precios[i]);
    if (!descripcion) errores.push(`Fila ${i + 1}: falta la descripción del producto.`);
    if (!(cant > 0)) errores.push(`Fila ${i + 1}: la cantidad debe ser mayor que cero.`);
    if (!(precio >= 0)) errores.push(`Fila ${i + 1}: el precio no es válido.`);
    items.push({ descripcion, cantidad: cant, precio, subtotal: u.redondear(cant * precio) });
  });
  if (!items.length) errores.push('Agrega al menos un producto.');

  const tipo = campo(form, 'tipo') === 'credito' ? 'credito' : 'contado';
  const fechaTexto = campo(form, 'fecha');
  const fecha = u.fechaValida(fechaTexto) ? fechaTexto : null;
  if (!fecha) errores.push('La fecha no es válida.');
  const total = u.redondear(items.reduce((s, it) => s + (it.subtotal || 0), 0));
  const abonoTexto = campo(form, 'abono_inicial');
  let abonoInicial = total;
  if (tipo === 'credito') {
    abonoInicial = abonoTexto === '' ? 0 : u.aNumero(abonoTexto);
    if (!(abonoInicial >= 0)) errores.push('El abono inicial no es válido.');
    else if (abonoInicial > total + 0.004) errores.push('El abono inicial no puede ser mayor que el total.');
    abonoInicial = u.redondear(abonoInicial);
  }
  const metodo = campo(form, 'metodo').slice(0, 40) || 'Efectivo';
  const notas = campo(form, 'notas');

  const clienteValor = campo(form, 'cliente_id');
  const clienteNuevo = clienteValor === 'nuevo';
  const nuevoNombre = campo(form, 'nuevo_nombre');
  const nuevoTelefono = campo(form, 'nuevo_telefono');
  let clienteId = Number(clienteValor) || 0;
  if (clienteNuevo && !nuevoNombre) errores.push('Escribe el nombre del cliente nuevo.');
  if (!clienteNuevo) {
    const [existe] = await db.q('SELECT id FROM clientes WHERE id = $1', [clienteId]);
    if (!existe) errores.push('Selecciona un cliente.');
  }

  if (errores.length) {
    const datos = {
      cliente_id: clienteValor,
      nuevo_nombre: nuevoNombre,
      nuevo_telefono: nuevoTelefono,
      fecha: fechaTexto,
      tipo,
      items: descripciones.map((d, i) => ({ descripcion: d, cantidad: cantidades[i], precio: precios[i] })),
      abono_inicial: abonoTexto,
      metodo,
      notas,
    };
    return respuestaHtml(v.nuevaFactura(ctx, { clientes: await listaClientesSimple(), error: errores.join(' '), datos }), 400);
  }

  const usuarioId = ctx.usuario.id;
  const facturaId = await db.transaccion(async (q) => {
    if (clienteNuevo) {
      [{ id: clienteId }] = await q('INSERT INTO clientes (nombre, telefono) VALUES ($1, $2) RETURNING id', [nuevoNombre, nuevoTelefono]);
    }
    const [{ id }] = await q(
      `INSERT INTO facturas (cliente_id, fecha, tipo, total, notas, usuario_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [clienteId, fecha, tipo, total, notas, usuarioId]
    );
    for (const it of items) {
      await q(`INSERT INTO factura_items (factura_id, descripcion, cantidad, precio, subtotal) VALUES ($1,$2,$3,$4,$5)`, [
        id, it.descripcion, it.cantidad, it.precio, it.subtotal,
      ]);
    }
    if (abonoInicial > 0) {
      await q(
        `INSERT INTO pagos (factura_id, fecha, monto, metodo, nota, es_inicial, usuario_id) VALUES ($1,$2,$3,$4,$5,TRUE,$6)`,
        [id, fecha, abonoInicial, metodo, tipo === 'contado' ? 'Pago de contado' : 'Abono inicial', usuarioId]
      );
    }
    return id;
  });
  await aviso(ctx, 'ok', `Factura ${u.numFactura(facturaId)} creada.`);
  return redirigir(`/facturas/${facturaId}`);
});

async function cargarFactura(id) {
  const [factura] = await db.q(
    `SELECT f.*, c.nombre AS cliente, c.telefono, c.telefono2, c.documento, c.direccion,
            us.nombre AS vendedor, us.usuario AS vendedor_usuario
       FROM facturas f
       JOIN clientes c ON c.id = f.cliente_id
       LEFT JOIN usuarios us ON us.id = f.usuario_id
      WHERE f.id = $1`,
    [id]
  );
  if (!factura) return null;
  factura.items = await db.q('SELECT * FROM factura_items WHERE factura_id = $1 ORDER BY id', [id]);
  factura.pagos = await db.q('SELECT * FROM pagos WHERE factura_id = $1 ORDER BY fecha, id', [id]);
  factura.abonado = u.redondear(factura.pagos.reduce((s, p) => s + p.monto, 0));
  factura.saldo = u.redondear(factura.total - factura.abonado);
  factura.estado = factura.saldo > 0.004 ? 'pendiente' : 'pagada';
  return factura;
}

GET('/facturas/:id', async (ctx) => {
  const f = await cargarFactura(ctx.id);
  return f ? respuestaHtml(v.detalleFactura(ctx, f)) : noEncontrado(ctx, 'Esa factura no existe.');
});

GET('/facturas/:id/imprimir', async (ctx) => {
  const f = await cargarFactura(ctx.id);
  return f ? respuestaHtml(v.comprobante(ctx, f)) : noEncontrado(ctx, 'Esa factura no existe.');
});

POST('/facturas/:id/abonos', async (ctx) => {
  const form = await ctx.form();
  const monto = u.redondear(u.aNumero(campo(form, 'monto')));
  const fechaTexto = campo(form, 'fecha');
  const fecha = u.fechaValida(fechaTexto) ? fechaTexto : null;
  const metodo = campo(form, 'metodo').slice(0, 40) || 'Efectivo';
  const nota = campo(form, 'nota').slice(0, 200);
  const usuarioId = ctx.usuario.id;

  const error = await db.transaccion(async (q) => {
    // Bloquea la factura para que dos abonos simultáneos no superen el saldo
    const [f] = await q('SELECT total FROM facturas WHERE id = $1 FOR UPDATE', [ctx.id]);
    if (!f) return 'Esa factura no existe.';
    const [{ abonado }] = await q('SELECT COALESCE(SUM(monto), 0) AS abonado FROM pagos WHERE factura_id = $1', [ctx.id]);
    const saldo = u.redondear(f.total - abonado);
    if (!(monto > 0)) return 'El monto del abono debe ser mayor que cero.';
    if (!fecha) return 'La fecha no es válida.';
    if (saldo <= 0.004) return 'Esta factura ya está pagada.';
    if (monto > saldo + 0.004) return `El abono no puede ser mayor que el saldo pendiente (${u.rd(saldo)}).`;
    await q(`INSERT INTO pagos (factura_id, fecha, monto, metodo, nota, usuario_id) VALUES ($1,$2,$3,$4,$5,$6)`, [
      ctx.id, fecha, monto, metodo, nota, usuarioId,
    ]);
    return null;
  });
  await aviso(ctx, error ? 'error' : 'ok', error || `Abono de ${u.rd(monto)} registrado.`);
  return redirigir(`/facturas/${ctx.id}`);
});

POST('/pagos/:id/eliminar', async (ctx) => {
  const [pago] = await db.q('DELETE FROM pagos WHERE id = $1 RETURNING factura_id, monto', [ctx.id]);
  if (!pago) return redirigir('/facturas');
  await aviso(ctx, 'ok', `Se eliminó el pago de ${u.rd(pago.monto)}.`);
  return redirigir(`/facturas/${pago.factura_id}`);
}, { admin: true });

POST('/facturas/:id/eliminar', async (ctx) => {
  await db.q('DELETE FROM facturas WHERE id = $1', [ctx.id]);
  await aviso(ctx, 'ok', `Factura ${u.numFactura(ctx.id)} eliminada.`);
  return redirigir('/facturas');
}, { admin: true });

// ------------------------------------------------------------------ Cuenta y usuarios

GET('/cuenta', (ctx) => respuestaHtml(v.cuenta(ctx)));

POST('/cuenta', async (ctx) => {
  const form = await ctx.form();
  const actual = String(form.get('actual') ?? '');
  const nueva = String(form.get('nueva') ?? '');
  const repetir = String(form.get('repetir') ?? '');
  const [fila] = await db.q('SELECT password_hash FROM usuarios WHERE id = $1', [ctx.usuario.id]);
  let error = null;
  if (!fila || !(await db.verificarClave(actual, fila.password_hash))) error = 'La contraseña actual no es correcta.';
  else if (nueva.length < 8) error = 'La nueva contraseña debe tener al menos 8 caracteres.';
  else if (nueva !== repetir) error = 'Las contraseñas nuevas no coinciden.';
  if (error) return respuestaHtml(v.cuenta(ctx, { error }), 400);
  await db.q('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [await db.hashClave(nueva), ctx.usuario.id]);
  // Cierra las demás sesiones abiertas de este usuario
  await db.q('DELETE FROM sesiones WHERE usuario_id = $1 AND id <> $2', [ctx.usuario.id, ctx.sesion.id]);
  await aviso(ctx, 'ok', 'Contraseña cambiada.');
  return redirigir('/facturas');
});

const listaUsuarios = () => db.q('SELECT id, usuario, nombre, es_admin, activo FROM usuarios ORDER BY usuario');

GET('/usuarios', async (ctx) => respuestaHtml(v.usuarios(ctx, { usuarios: await listaUsuarios() })), { admin: true });

POST('/usuarios', async (ctx) => {
  const form = await ctx.form();
  const usuario = campo(form, 'usuario').toLowerCase();
  const clave = String(form.get('clave') ?? '');
  let error = null;
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) error = 'El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo (sin espacios).';
  else if (clave.length < 8) error = 'La contraseña debe tener al menos 8 caracteres.';
  else if ((await db.q('SELECT 1 FROM usuarios WHERE usuario = $1', [usuario])).length) error = 'Ese usuario ya existe.';
  if (error) return respuestaHtml(v.usuarios(ctx, { usuarios: await listaUsuarios(), error }), 400);
  await db.crearUsuario({ usuario, clave, nombre: campo(form, 'nombre'), esAdmin: form.get('es_admin') === 'on' });
  await aviso(ctx, 'ok', `Usuario "${usuario}" creado.`);
  return redirigir('/usuarios');
}, { admin: true });

POST('/usuarios/:id/clave', async (ctx) => {
  const clave = String((await ctx.form()).get('clave') ?? '');
  if (clave.length < 8) {
    await aviso(ctx, 'error', 'La contraseña debe tener al menos 8 caracteres.');
    return redirigir('/usuarios');
  }
  await db.q('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [await db.hashClave(clave), ctx.id]);
  if (ctx.id !== ctx.usuario.id) await db.q('DELETE FROM sesiones WHERE usuario_id = $1', [ctx.id]);
  await aviso(ctx, 'ok', 'Contraseña restablecida.');
  return redirigir('/usuarios');
}, { admin: true });

POST('/usuarios/:id/activo', async (ctx) => {
  if (ctx.id === ctx.usuario.id) {
    await aviso(ctx, 'error', 'No puedes desactivar tu propio usuario.');
    return redirigir('/usuarios');
  }
  await db.q('UPDATE usuarios SET activo = NOT activo WHERE id = $1', [ctx.id]);
  await db.q('DELETE FROM sesiones WHERE usuario_id = $1', [ctx.id]);
  await aviso(ctx, 'ok', 'Usuario actualizado.');
  return redirigir('/usuarios');
}, { admin: true });

// ------------------------------------------------------------------ Datos de la tienda

GET('/configuracion', (ctx) => respuestaHtml(v.configuracion(ctx)), { admin: true });

POST('/configuracion', async (ctx) => {
  const form = await ctx.form();
  const valores = Object.fromEntries([...form.entries()].map(([k, val]) => [k, String(val)]));
  if (!String(valores.tienda_nombre || '').trim()) {
    await aviso(ctx, 'error', 'El nombre de la tienda es obligatorio.');
    return redirigir('/configuracion');
  }
  await db.guardarConfig(valores);
  await aviso(ctx, 'ok', 'Datos de la tienda guardados.');
  return redirigir('/configuracion');
}, { admin: true });

// ================================================================== Servidor

async function archivoEstatico(ruta) {
  if (!/^\/[\w.-]+\.(css|js|png|ico|svg)$/.test(ruta)) return null;
  const archivo = Bun.file(join(CARPETA_PUBLICA, ruta));
  if (!(await archivo.exists())) return null;
  return new Response(archivo, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}

function origenValido(req) {
  // Protección básica contra envíos de formularios desde otros sitios
  const origen = req.headers.get('origin');
  if (!origen) return true;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

async function atender(req, servidor) {
  const url = new URL(req.url);
  const metodo = req.method === 'HEAD' ? 'GET' : req.method;

  if (metodo === 'GET') {
    const estatico = await archivoEstatico(url.pathname);
    if (estatico) return estatico;
  }

  let encontrada = null;
  let params = null;
  for (const r of rutas) {
    if (r.metodo !== metodo) continue;
    const m = r.regex.exec(url.pathname);
    if (m) {
      encontrada = r;
      params = m.groups || {};
      break;
    }
  }

  if (encontrada?.sinContexto) return encontrada.manejador();

  const sesion = await cargarSesion(req);
  const ctx = {
    req,
    url,
    ip: ipCliente(req, servidor),
    sesion,
    usuario: sesion?.usuario || null,
    flash: sesion?.flash || null,
    ruta: url.pathname,
    config: await db.obtenerConfig(),
    id: params?.id ? Number(params.id) : 0,
    form: () => req.formData().catch(() => new FormData()),
  };
  if (sesion?.flash) await db.q('UPDATE sesiones SET flash = NULL WHERE id = $1', [sesion.id]);

  if (!encontrada) return ctx.usuario ? noEncontrado(ctx) : redirigir('/login');
  if (metodo === 'POST' && !origenValido(req)) return new Response('Origen no permitido', { status: 403 });
  if (!encontrada.publica && !ctx.usuario) return redirigir('/login');
  if (encontrada.admin && !ctx.usuario.es_admin) {
    return respuestaHtml(v.error(ctx, 'Acceso denegado', 'Solo un administrador puede hacer esto.'), 403);
  }
  return encontrada.manejador(ctx);
}

async function iniciar() {
  for (let intento = 1; ; intento++) {
    try {
      await db.migrar();
      break;
    } catch (e) {
      if (intento >= 10) throw e;
      console.log(`Esperando la base de datos (intento ${intento}/10): ${e.message}`);
      await Bun.sleep(3000);
    }
  }
  await db.asegurarAdmin();
  const limpiar = () => db.q('DELETE FROM sesiones WHERE expira < NOW()').catch(() => {});
  limpiar();
  setInterval(limpiar, 3600e3);

  Bun.serve({
    port: PUERTO,
    hostname: '0.0.0.0',
    maxRequestBodySize: 2 * 1024 * 1024,
    async fetch(req, servidor) {
      try {
        return await atender(req, servidor);
      } catch (e) {
        console.error(e);
        return new Response('Ocurrió un error inesperado. Vuelve atrás e inténtalo de nuevo.', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    },
  });
  console.log(`Facturadora lista en el puerto ${PUERTO}`);
}

iniciar().catch((e) => {
  console.error('No se pudo iniciar la aplicación:', e);
  process.exit(1);
});
