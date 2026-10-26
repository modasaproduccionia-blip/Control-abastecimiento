// Genera supabase/seed.sql a partir de datos/config.json y datos/plan-L2.json.
// Uso: npm run seed:sql  (comprobar sin escribir: npm run seed:check)
// No crea programación L1 (todavía no existe). No necesita claves.
//
// El seed es seguro de repetir: solo inserta si la fila no existe. Si los parámetros o la
// programación L2 ya existen (por ejemplo, editados desde la app), NO se tocan; el resultado
// indica si siguen iguales al original o si tienen cambios.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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
--
-- Seguro de repetir: solo inserta lo que falta. Nunca sobrescribe parámetros ni programación
-- existentes. No crea programación L1.

with original as (
  select ${json(config)} as config,
         ${json(planL2.buses)} as buses_l2
),
cfg_nueva as (
  insert into public.config (id, datos)
  select 1, config from original
  on conflict (id) do nothing
  returning 1
),
l2_nueva as (
  insert into public.planes (linea, buses)
  select 'L2', buses_l2 from original
  on conflict (linea) do nothing
  returning 1
)
select 'config' as tabla,
       case when exists (select from cfg_nueva) then 'cargado'
            when (select datos from public.config where id = 1) = (select config from original) then 'ya existía, igual al original'
            else 'ya existía con cambios: NO se tocó' end as resultado
union all
select 'planes L2',
       case when exists (select from l2_nueva) then 'cargado'
            when (select buses from public.planes where linea = 'L2') = (select buses_l2 from original) then 'ya existía, igual al original'
            else 'ya existía con cambios: NO se tocó' end;
`;

// Garantías: nunca sobrescribe datos existentes y nunca crea L1.
const prohibido = [/do\s+update/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i, /\btruncate\b/i, /'L1'/];
for (const re of prohibido) if (re.test(sql)) throw new Error(`El seed generado contiene algo prohibido: ${re}`);
if ((sql.match(/on conflict \([a-z]+\) do nothing/g) || []).length !== 2) throw new Error('Faltan los "on conflict ... do nothing"');

const destino = new URL('../supabase/seed.sql', import.meta.url);
if (process.argv.includes('--check')) {
  // npm run seed:check — comprueba que supabase/seed.sql está al día con datos/ y cumple las garantías
  const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
  if (actual !== sql) { console.error('supabase/seed.sql no coincide con datos/: ejecuta npm run seed:sql'); process.exit(1); }
  console.log(`supabase/seed.sql al día: ${config.pieces.length} piezas, ${planL2.buses.length} buses L2, sin sobrescritura, sin L1`);
} else {
  writeFileSync(destino, sql);
  console.log(`supabase/seed.sql: ${config.pieces.length} piezas, ${planL2.buses.length} buses L2`);
}
