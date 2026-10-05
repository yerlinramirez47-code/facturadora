-- Esquema de la facturadora. Se ejecuta en cada arranque; es seguro repetirlo.

CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  usuario       TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  es_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clientes (
  id           SERIAL PRIMARY KEY,
  nombre       TEXT NOT NULL,
  telefono     TEXT NOT NULL DEFAULT '',
  telefono2    TEXT NOT NULL DEFAULT '',
  documento    TEXT NOT NULL DEFAULT '',
  direccion    TEXT NOT NULL DEFAULT '',
  notas        TEXT NOT NULL DEFAULT '',
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clientes_nombre_idx ON clientes (LOWER(nombre));

CREATE TABLE IF NOT EXISTS facturas (
  id          SERIAL PRIMARY KEY,
  cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  fecha       DATE NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('contado', 'credito')),
  total       NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  notas       TEXT NOT NULL DEFAULT '',
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS facturas_cliente_idx ON facturas (cliente_id);

CREATE TABLE IF NOT EXISTS factura_items (
  id           SERIAL PRIMARY KEY,
  factura_id   INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  descripcion  TEXT NOT NULL,
  cantidad     NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  precio       NUMERIC(14,2) NOT NULL CHECK (precio >= 0),
  subtotal     NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS factura_items_factura_idx ON factura_items (factura_id);

CREATE TABLE IF NOT EXISTS pagos (
  id          SERIAL PRIMARY KEY,
  factura_id  INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  monto       NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  metodo      TEXT NOT NULL DEFAULT 'Efectivo',
  nota        TEXT NOT NULL DEFAULT '',
  es_inicial  BOOLEAN NOT NULL DEFAULT FALSE,
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pagos_factura_idx ON pagos (factura_id);

CREATE TABLE IF NOT EXISTS configuracion (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL DEFAULT ''
);

-- Sesiones de inicio de sesión (se guarda el hash del token, nunca el token)
CREATE TABLE IF NOT EXISTS sesiones (
  id          TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  flash       TEXT,
  expira      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_expira_idx ON sesiones (expira);
