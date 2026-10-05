// Crea un administrador, o le restablece la contraseña si ya existe.
// Uso:  bun run crear-admin <usuario> <contraseña>
import * as db from '../src/db.js';

const [usuario, clave] = process.argv.slice(2);
if (!usuario || !clave) {
  console.error('Uso: bun run crear-admin <usuario> <contraseña>');
  process.exit(1);
}
if (clave.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

try {
  await db.migrar();
  const nombre = usuario.trim().toLowerCase();
  const [existe] = await db.q('SELECT id FROM usuarios WHERE usuario = $1', [nombre]);
  if (existe) {
    await db.q('UPDATE usuarios SET password_hash = $1, es_admin = TRUE, activo = TRUE WHERE id = $2', [
      await db.hashClave(clave),
      existe.id,
    ]);
    console.log(`Usuario "${nombre}" actualizado: ahora es administrador con la nueva contraseña.`);
  } else {
    await db.crearUsuario({ usuario: nombre, clave, nombre: 'Administrador', esAdmin: true });
    console.log(`Administrador "${nombre}" creado.`);
  }
  await db.sql.close();
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
