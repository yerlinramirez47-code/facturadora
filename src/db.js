import { SQL } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_BD = process.env.DATABASE_URL;
if (!URL_BD) {
  console.error('ERROR: falta la variable DATABASE_URL. En Railway, agrégala con el valor ${{Postgres.DATABASE_URL}}');
  process.exit(1);
}

function necesitaSSL(url) {
  const flag = (process.env.DATABASE_SSL || '').toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  // Automático: sin SSL en la red privada de Railway y en la máquina local.
  return !/@(localhost|127\.0\.0\.1|[^/:]+\.railway\.internal)[:/]/.test(url);
}

const ssl = necesitaSSL(URL_BD);
export const sql = new SQL({
  url: URL_BD,
  max: 10,
  idleTimeout: 30,
  ...(ssl ? { tls: { rejectUnauthorized: false } } : {}),
});

// Columnas numéricas (NUMERIC/BIGINT llegan como texto) y de fecha (DATE llega como Date).
const NUMERICAS = new Set(['total', 'abonado', 'saldo', 'monto', 'precio', 'cantidad', 'subtotal', 'facturas', 'n']);
const FECHAS = new Set(['fecha']);

function normalizar(fila) {
  for (const k in fila) {
    const v = fila[k];
    if (v === null || v === undefined) continue;
    if (NUMERICAS.has(k)) fila[k] = Number(v);
    else if (FECHAS.has(k) && v instanceof Date) fila[k] = v.toISOString().slice(0, 10);
  }
  return fila;
}

async function ejecutar(conexion, texto, params = []) {
  const filas = await conexion.unsafe(texto, params);
  return Array.from(filas, normalizar);
}

/** Ejecuta una consulta con parámetros $1, $2… y devuelve las filas. */
export const q = (texto, params) => ejecutar(sql, texto, params);

/** Ejecuta fn dentro de una transacción. fn recibe su propia función q. */
export function transaccion(fn) {
  return sql.begin((tx) => fn((texto, params) => ejecutar(tx, texto, params)));
}

export async function migrar() {
  const esquema = readFileSync(join(import.meta.dir, 'schema.sql'), 'utf8');
  await sql.unsafe(esquema);
}

const CONFIG_POR_DEFECTO = {
  tienda_nombre: 'Mi Tienda',
  tienda_rnc: '',
  tienda_direccion: '',
  tienda_telefono: '',
  tienda_correo: '',
  pie_comprobante: '¡Gracias por su compra!',
};

export async function obtenerConfig() {
  const filas = await q('SELECT clave, valor FROM configuracion');
  const config = { ...CONFIG_POR_DEFECTO };
  if (process.env.TIENDA_NOMBRE) config.tienda_nombre = process.env.TIENDA_NOMBRE;
  for (const f of filas) config[f.clave] = f.valor;
  return config;
}

export async function guardarConfig(valores) {
  for (const clave of Object.keys(CONFIG_POR_DEFECTO)) {
    if (valores[clave] === undefined) continue;
    await q(
      `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [clave, String(valores[clave]).trim()]
    );
  }
}

export const hashClave = (clave) => Bun.password.hash(clave, { algorithm: 'bcrypt', cost: 10 });
export const verificarClave = (clave, hash) => Bun.password.verify(clave, hash).catch(() => false);

export async function crearUsuario({ usuario, clave, nombre = '', esAdmin = false }) {
  const [fila] = await q(
    `INSERT INTO usuarios (usuario, nombre, password_hash, es_admin) VALUES ($1, $2, $3, $4) RETURNING id`,
    [usuario.trim().toLowerCase(), nombre.trim(), await hashClave(clave), esAdmin]
  );
  return fila.id;
}

/**
 * Crea el administrador inicial a partir de ADMIN_USUARIO / ADMIN_CLAVE
 * solo si ese usuario todavía no existe. Nunca cambia una contraseña existente.
 */
export async function asegurarAdmin() {
  const usuario = (process.env.ADMIN_USUARIO || '').trim().toLowerCase();
  const clave = process.env.ADMIN_CLAVE || '';
  const [{ n }] = await q('SELECT COUNT(*) AS n FROM usuarios');
  if (!usuario || !clave) {
    if (n === 0) console.warn('AVISO: no hay usuarios. Define ADMIN_USUARIO y ADMIN_CLAVE y reinicia para crear el administrador.');
    return;
  }
  const existe = await q('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
  if (existe.length) return;
  if (clave.length < 8) {
    console.warn('AVISO: ADMIN_CLAVE debe tener al menos 8 caracteres. No se creó el administrador.');
    return;
  }
  await crearUsuario({ usuario, clave, nombre: 'Administrador', esAdmin: true });
  console.log(`Administrador "${usuario}" creado.`);
}
