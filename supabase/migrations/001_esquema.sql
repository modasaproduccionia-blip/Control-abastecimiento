-- Control de Abastecimiento | MODASA — esquema inicial
-- BORRADOR PARA REVISIÓN. Ejecutar en Supabase > SQL Editor solo cuando se apruebe (fase 2).
-- Decisiones: docs/DECISIONES.md

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
  datos           jsonb not null,               -- { stations, pieces, models, areas, schedule, breaks, logo }
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users
);

-- ========== Programación por línea ==========
create table public.planes (
  linea           text primary key check (linea in ('L1','L2')),
  buses           jsonb not null default '[]',  -- [{ id, mes, op, cliente, d:{chasis,estr,pint,acab,of,lib} }]
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users
);

-- ========== Revisiones ==========
create table public.revisiones (
  id              text primary key,             -- mismo id que hoy: bus__estación__tipo
  bus_id          text not null,
  op              text, cliente text, linea text, modelo text,
  estacion        text not null,
  area            text not null,
  inicio          timestamptz,
  fin             timestamptz,
  items           jsonb not null default '{}',  -- { idPieza: { st, qty, req, at, arrivedAt, por } }
  creado_por      uuid references auth.users,   -- quién inició la revisión
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users    -- quién hizo el último cambio
);
create index revisiones_bus_idx on public.revisiones (bus_id);

-- Campos de auditoría los pone el servidor, no el navegador
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

-- Quién inició la revisión: lo fija el servidor al crearla y no se puede cambiar
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

-- Marcar una pieza de forma atómica (evita sobrescrituras entre tablets).
-- Cada pieza guarda "por": el usuario que la marcó (lo pone el servidor).
create or replace function public.marcar_pieza(p_id text, p_base jsonb, p_pieza text, p_item jsonb)
returns public.revisiones
language plpgsql security invoker set search_path = '' as $$
declare r public.revisiones;
begin
  p_item := coalesce(p_item, '{}'::jsonb) || jsonb_build_object('por', auth.uid());
  insert into public.revisiones (id, bus_id, op, cliente, linea, modelo, estacion, area, inicio, items)
  values (p_id, p_base->>'busId', p_base->>'op', p_base->>'cliente', p_base->>'line',
          p_base->>'model', p_base->>'station', p_base->>'area', now(),
          jsonb_build_object(p_pieza, p_item))
  on conflict (id) do update
    set items  = public.revisiones.items || jsonb_build_object(p_pieza, p_item),
        inicio = coalesce(public.revisiones.inicio, now())
  returning * into r;
  return r;
end $$;

-- Funciones: solo usuarios con sesión; el trigger no se puede llamar desde la API
revoke execute on function public.es_admin()     from public, anon;
revoke execute on function public.marcar_pieza(text, jsonb, text, jsonb) from public, anon;
revoke execute on function public.crear_perfil() from public, anon, authenticated;
revoke execute on function public.sellar()       from public, anon, authenticated;
revoke execute on function public.sellar_creacion() from public, anon, authenticated;
grant  execute on function public.es_admin()     to authenticated;
grant  execute on function public.marcar_pieza(text, jsonb, text, jsonb) to authenticated;

-- ========== Seguridad por filas (RLS) ==========
alter table public.perfiles   enable row level security;
alter table public.config     enable row level security;
alter table public.planes     enable row level security;
alter table public.revisiones enable row level security;

-- Sin sesión no se ve nada
revoke all on public.perfiles, public.config, public.planes, public.revisiones from anon;

create policy perfiles_leer on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_admin());
-- sin políticas de insert/update: los roles solo se cambian desde el panel/SQL Editor

create policy config_leer   on public.config for select to authenticated using (true);
create policy config_crear  on public.config for insert to authenticated with check (public.es_admin());
create policy config_editar on public.config for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Programación: operarios solo consultan; el administrador crea, edita y borra
create policy planes_leer   on public.planes for select to authenticated using (true);
create policy planes_crear  on public.planes for insert to authenticated with check (public.es_admin());
create policy planes_editar on public.planes for update to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy planes_borrar on public.planes for delete to authenticated using (public.es_admin());

-- Revisiones: todo usuario con sesión registra; solo el administrador borra
create policy rev_leer   on public.revisiones for select to authenticated using (true);
create policy rev_crear  on public.revisiones for insert to authenticated with check (true);
create policy rev_editar on public.revisiones for update to authenticated using (true) with check (true);
create policy rev_borrar on public.revisiones for delete to authenticated using (public.es_admin());

-- ========== Tiempo real ==========
alter publication supabase_realtime add table public.config, public.planes, public.revisiones;
