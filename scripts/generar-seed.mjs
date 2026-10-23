// Genera supabase/seed.sql a partir de datos/config.json y datos/plan-L2.json.
// Uso: npm run seed:sql
// No crea programación L1 (todavía no existe). No necesita claves.
import { readFileSync, writeFileSync } from 'node:fs';

const leer = (ruta) => JSON.parse(readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8'));
const config = leer('datos/config.json');
const planL2 = leer('datos/plan-L2.json');

const json = (v) => {
  const s = JSON.stringify(v);
  if (s.includes('$json$')) throw new Error('El JSON contiene el delimitador $json$');
  return `$json$${s}$json$::jsonb`;
};

const sql = `-- Generado por scripts/generar-seed.mjs — no editar a mano.
-- Carga inicial: ${config.pieces.length} piezas, estaciones, modelos, horario y refrigerio; programación L2 (${planL2.buses.length} buses).
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 001_esquema.sql (fase 2).

insert into public.config (id, datos)
values (1, ${json(config)})
on conflict (id) do update set datos = excluded.datos;

insert into public.planes (linea, buses)
values ('L2', ${json(planL2.buses)})
on conflict (linea) do update set buses = excluded.buses;
`;

writeFileSync(new URL('../supabase/seed.sql', import.meta.url), sql);
console.log(`supabase/seed.sql: ${config.pieces.length} piezas, ${planL2.buses.length} buses L2`);
