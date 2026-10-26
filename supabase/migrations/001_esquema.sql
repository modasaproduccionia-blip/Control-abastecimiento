-- Control de Abastecimiento | MODASA — esquema inicial
-- BORRADOR PARA REVISIÓN. Ejecutar en Supabase > SQL Editor solo cuando se apruebe (fase 2).
-- Decisiones: docs/DECISIONES.md
--
-- Modelo de permisos
--   * Sin sesión (anon): ningún acceso.
--   * Con sesión (authenticated): lee todo.
--   * Parámetros y programación: solo el administrador escribe (RLS).
--   * Revisiones: nadie escribe directo en la tabla. Se registran solo con las funciones
--     marcar_pieza, cerrar_revision y reabrir_revision, que validan los datos contra la
--     configuración y la programación, y asignan en el servidor quién hizo cada cosa.
--     Solo el administrador borra revisiones.

-- ========== Perfiles y roles ==========
create table public.perfiles (
  id        uuid primary key references auth.users on delete cascade,
  nombre    text not null default '',
  rol       text not null default 'operador' check (rol in ('operador','admin')),
  creado_en timestamptz not null default now()
);

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select rol = 'admin' from public.perfiles where id = auth.uid()), false)
$$;

-- Perfil creado automáticamente (como operador) al crear el usuario en el panel
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email));
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- ========== Parámetros (una sola fila) ==========
create table public.config (
  id              smallint primary key default 1 check (id = 1),
  datos           jsonb not null check (
                    jsonb_typeof(datos) = 'object'
                    and jsonb_typeof(datos->'pieces') = 'array'
                    and jsonb_typeof(datos->'stations') = 'object'),
                  -- { stations, pieces, models, areas, schedule, breaks, logo }
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users
);

-- ========== Programación por línea ==========
create table public.planes (
  linea           text primary key check (linea in ('L1','L2')),
  buses           jsonb not null default '[]' check (jsonb_typeof(buses) = 'array'),
                  -- [{ id, mes, op, cliente, d:{chasis,estr,pint,acab,of,lib} }]
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users
);

-- ========== Revisiones ==========
-- Una revisión por bus + estación + tipo de pieza (area). El id lo genera el servidor;
-- la app ubica cada revisión por (bus_id, estacion, area).
create table public.revisiones (
  id              uuid primary key default gen_random_uuid(),
  bus_id          text not null,
  op              text not null,
  cliente         text not null default '',
  linea           text not null check (linea in ('L1','L2')),
  modelo          text not null,
  estacion        text not null,
  area            text not null,
  inicio          timestamptz not null default now(),
  fin             timestamptz,
  items           jsonb not null default '{}' check (jsonb_typeof(items) = 'object'),
                  -- { idPieza: { st, qty, req, at, arrivedAt?, por } }  (at y arrivedAt en ms, como la app)
  creado_por      uuid references auth.users,   -- quién inició la revisión
  cerrado_por     uuid references auth.users,   -- quién la reportó o terminó
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users,   -- quién hizo el último cambio
  unique (bus_id, estacion, area),
  check (fin is null or fin >= inicio)
);
create index revisiones_bus_idx on public.revisiones (bus_id);

-- Campos de auditoría: los pone el servidor, no el navegador
create or replace function public.sellar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_en  := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;

create trigger sellar_config     before insert or update on public.config     for each row execute function public.sellar();
create trigger sellar_planes     before insert or update on public.planes     for each row execute function public.sellar();
create trigger sellar_revisiones before insert or update on public.revisiones for each row execute function public.sellar();

-- Quién inició la revisión: se fija al crearla y no cambia nunca
create or replace function public.sellar_creacion() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.creado_por := auth.uid();
  else new.creado_por := old.creado_por;
  end if;
  return new;
end $$;

create trigger sellar_creacion_revisiones before insert or update on public.revisiones
  for each row execute function public.sellar_creacion();

-- ========== Reglas de la app, en el servidor ==========
-- Hora actual en milisegundos (mismo formato que Date.now() de la app)
create or replace function public.ahora_ms() returns bigint
language sql stable set search_path = '' as $$
  select (extract(epoch from now()) * 1000)::bigint
$$;

-- Modelo de un bus según su O/P: el prefijo más largo que coincide (igual que modelOf() de la app)
create or replace function public.modelo_de(p_cfg jsonb, p_op text) returns text
language sql immutable set search_path = '' as $$
  select m->>'model'
  from jsonb_array_elements(coalesce(p_cfg->'models', '[]')) m
  where coalesce(m->>'prefix', '') <> ''
    and starts_with(upper(regexp_replace(coalesce(p_op, ''), '\s+', '', 'g')),
                    upper(regexp_replace(m->>'prefix', '\s+', '', 'g')))
  order by length(m->>'prefix') desc
  limit 1
$$;

-- Tipo de pieza efectivo (igual que areaOf() de la app)
create or replace function public.area_de(p_cfg jsonb, p_pieza jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_pieza->>'area' is not null and coalesce(p_cfg->'areas', '[]') ? (p_pieza->>'area') then p_pieza->>'area'
    else coalesce(p_cfg->'areas'->>0, 'Fibra de vidrio')
  end
$$;

-- Piezas que corresponden a un modelo + estación + tipo
create or replace function public.piezas_de(p_cfg jsonb, p_modelo text, p_estacion text, p_area text)
returns setof jsonb
language sql immutable set search_path = '' as $$
  select p
  from jsonb_array_elements(coalesce(p_cfg->'pieces', '[]')) p
  where p->>'model' = p_modelo
    and p->>'station' = p_estacion
    and public.area_de(p_cfg, p) = p_area
$$;

-- ========== Registro de revisiones (único camino de escritura) ==========

-- Marca una pieza. Crea la revisión si no existe (inicia el tiempo).
-- Concurrencia: la fila se bloquea (FOR UPDATE) mientras se actualiza, y solo cambia la
-- pieza indicada, así dos tablets que marcan a la vez no se pisan.
-- p_estado: 'ok' (llegó), 'parcial' (con p_cantidad) o 'no' (no llegó).
-- Cualquier usuario con sesión puede marcar (trabajo en equipo y llegada de faltantes);
-- cada pieza guarda "por" = quien la marcó.
create or replace function public.marcar_pieza(
  p_bus_id text, p_estacion text, p_area text, p_pieza text, p_estado text, p_cantidad integer default null)
returns public.revisiones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_cfg   jsonb;
  v_bus   jsonb;
  v_linea text;
  v_mod   text;
  v_pieza jsonb;
  v_req   integer;
  v_st    text := p_estado;
  v_qty   integer;
  v_prev  jsonb;
  v_item  jsonb;
  r       public.revisiones;
begin
  if v_uid is null then raise exception 'Inicia sesión para registrar.' using errcode = '42501'; end if;
  if p_estado not in ('ok', 'parcial', 'no') then raise exception 'Estado no válido: %', p_estado using errcode = '22023'; end if;

  select datos into v_cfg from public.config where id = 1;
  if v_cfg is null then raise exception 'Faltan los parámetros (config).' using errcode = 'P0002'; end if;

  select * into r from public.revisiones
   where bus_id = p_bus_id and estacion = p_estacion and area = p_area
   for update;

  if not found then
    -- Revisión nueva: el bus debe estar en la programación y la estación en su línea
    select pl.linea, b into v_linea, v_bus
      from public.planes pl, jsonb_array_elements(pl.buses) b
     where b->>'id' = p_bus_id
     limit 1;
    if v_bus is null then raise exception 'El bus % no está en la programación.', p_bus_id using errcode = 'P0002'; end if;
    if not coalesce(v_cfg->'stations'->v_linea, '[]') @> jsonb_build_array(jsonb_build_object('id', p_estacion)) then
      raise exception 'La estación % no pertenece a %.', p_estacion, v_linea using errcode = '22023';
    end if;
    v_mod := public.modelo_de(v_cfg, v_bus->>'op');
    if v_mod is null then raise exception 'El bus % no tiene modelo reconocido.', v_bus->>'op' using errcode = '22023'; end if;

    insert into public.revisiones (bus_id, op, cliente, linea, modelo, estacion, area)
    values (p_bus_id, v_bus->>'op', coalesce(v_bus->>'cliente', ''), v_linea, v_mod, p_estacion, p_area)
    on conflict (bus_id, estacion, area) do nothing;   -- si otra tablet la creó en paralelo, se usa esa

    select * into r from public.revisiones
     where bus_id = p_bus_id and estacion = p_estacion and area = p_area
     for update;
  end if;

  -- La pieza debe corresponder al modelo, estación y tipo de esta revisión
  select p into v_pieza from public.piezas_de(v_cfg, r.modelo, r.estacion, r.area) p
   where p->>'id' = p_pieza limit 1;
  if v_pieza is null then raise exception 'La pieza % no corresponde a esta revisión.', p_pieza using errcode = '22023'; end if;

  -- Misma regla que setItem() de la app
  v_req := greatest(0, coalesce((v_pieza->>'qty')::integer, 0));
  v_qty := case v_st when 'ok' then v_req when 'no' then 0
                     else greatest(0, least(v_req, coalesce(p_cantidad, 0))) end;
  if v_st = 'parcial' and v_qty >= v_req then v_st := 'ok'; end if;
  if v_st = 'parcial' and v_qty <= 0     then v_st := 'no'; end if;

  v_prev := r.items->p_pieza;
  v_item := jsonb_build_object('st', v_st, 'qty', v_qty, 'req', v_req, 'at', public.ahora_ms(), 'por', v_uid);
  if r.fin is not null and v_st = 'ok' and coalesce(v_prev->>'st', '') <> 'ok' then
    v_item := v_item || jsonb_build_object('arrivedAt', public.ahora_ms());   -- llegó después del reporte
  elsif v_st = 'ok' and v_prev ? 'arrivedAt' then
    v_item := v_item || jsonb_build_object('arrivedAt', v_prev->'arrivedAt');
  end if;

  update public.revisiones
     set items = items || jsonb_build_object(p_pieza, v_item)
   where id = r.id
  returning * into r;
  return r;
end $$;

-- Reporta o termina una revisión: las piezas sin marcar quedan como "no llegó" y se cierra el tiempo.
-- TODO(confirmar): hoy solo quien la inició o el administrador puede cerrarla.
create or replace function public.cerrar_revision(p_revision uuid)
returns public.revisiones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb;
  v_ms  bigint := public.ahora_ms();
  r     public.revisiones;
begin
  if v_uid is null then raise exception 'Inicia sesión para registrar.' using errcode = '42501'; end if;
  select * into r from public.revisiones where id = p_revision for update;
  if not found then raise exception 'La revisión no existe.' using errcode = 'P0002'; end if;
  if r.creado_por is distinct from v_uid and not public.es_admin() then
    raise exception 'Solo quien inició la revisión o un administrador puede cerrarla.' using errcode = '42501';
  end if;
  if r.fin is not null then return r; end if;   -- ya estaba cerrada: no cambia nada

  select datos into v_cfg from public.config where id = 1;
  update public.revisiones
     set items = coalesce((
           select jsonb_object_agg(p->>'id', jsonb_build_object(
                    'st', 'no', 'qty', 0, 'req', greatest(0, coalesce((p->>'qty')::integer, 0)),
                    'at', v_ms, 'por', v_uid))
             from public.piezas_de(v_cfg, r.modelo, r.estacion, r.area) p
            where not (r.items ? (p->>'id'))
         ), '{}'::jsonb) || items,
         fin = now(),
         cerrado_por = v_uid
   where id = r.id
  returning * into r;
  return r;
end $$;

-- Reabre una revisión cerrada. El tiempo sigue desde el inicio original.
-- TODO(confirmar): hoy solo quien la inició o el administrador puede reabrirla.
create or replace function public.reabrir_revision(p_revision uuid)
returns public.revisiones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r     public.revisiones;
begin
  if v_uid is null then raise exception 'Inicia sesión para registrar.' using errcode = '42501'; end if;
  select * into r from public.revisiones where id = p_revision for update;
  if not found then raise exception 'La revisión no existe.' using errcode = 'P0002'; end if;
  if r.creado_por is distinct from v_uid and not public.es_admin() then
    raise exception 'Solo quien inició la revisión o un administrador puede reabrirla.' using errcode = '42501';
  end if;
  update public.revisiones set fin = null, cerrado_por = null where id = r.id
  returning * into r;
  return r;
end $$;

-- ========== Permisos sobre funciones ==========
-- Supabase da EXECUTE a todos por defecto: se quita y se da solo lo necesario.
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on function public.es_admin()                                          to authenticated;
grant  execute on function public.marcar_pieza(text, text, text, text, text, integer) to authenticated;
grant  execute on function public.cerrar_revision(uuid)                               to authenticated;
grant  execute on function public.reabrir_revision(uuid)                              to authenticated;

-- ========== Permisos sobre tablas ==========
-- Supabase da ALL (incluido TRUNCATE, que no respeta RLS) a anon y authenticated: se quita todo
-- y se concede solo lo que cada tabla necesita. RLS decide además qué filas.
revoke all on public.perfiles, public.config, public.planes, public.revisiones from public, anon, authenticated;
grant select                         on public.perfiles   to authenticated;
grant select, insert, update         on public.config     to authenticated;   -- RLS: escribe solo admin
grant select, insert, update, delete on public.planes     to authenticated;   -- RLS: escribe solo admin
grant select, delete                 on public.revisiones to authenticated;   -- RLS: borra solo admin; escribir solo por funciones

-- ========== Seguridad por filas (RLS) ==========
alter table public.perfiles   enable row level security;
alter table public.config     enable row level security;
alter table public.planes     enable row level security;
alter table public.revisiones enable row level security;

-- Cada uno ve su perfil; el administrador ve todos. Los roles solo se cambian desde el panel/SQL Editor.
create policy perfiles_leer on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()));

create policy config_leer   on public.config for select to authenticated using (true);
create policy config_crear  on public.config for insert to authenticated with check ((select public.es_admin()));
create policy config_editar on public.config for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- Programación: operarios solo consultan; el administrador crea, edita y borra
create policy planes_leer   on public.planes for select to authenticated using (true);
create policy planes_crear  on public.planes for insert to authenticated with check ((select public.es_admin()));
create policy planes_editar on public.planes for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy planes_borrar on public.planes for delete to authenticated using ((select public.es_admin()));

-- Revisiones: todos con sesión leen; solo el administrador borra.
-- No hay políticas de insert/update: sin ellas (y sin el permiso) nadie escribe directo.
create policy rev_leer   on public.revisiones for select to authenticated using (true);
create policy rev_borrar on public.revisiones for delete to authenticated using ((select public.es_admin()));

-- ========== Tiempo real ==========
alter publication supabase_realtime add table public.config, public.planes, public.revisiones;
