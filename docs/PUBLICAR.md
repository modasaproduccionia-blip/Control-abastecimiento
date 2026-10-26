# Publicar: Supabase + Vercel (paso a paso)

> Regla de oro: en el navegador solo van **la URL del proyecto** y la **clave pública**
> (`sb_publishable_...` o la antigua `anon`). La clave **`service_role` / `sb_secret_...`**
> y la contraseña de la base de datos **nunca** se copian en el código, en `.env.example`, en GitHub ni en Vercel.
> La seguridad real la dan las políticas RLS de `001_esquema.sql`.

## A. Supabase (fase 2)

Proyecto: `ggpvrvwteusirfgrpluo` → https://supabase.com/dashboard/project/ggpvrvwteusirfgrpluo

1. **Crear las tablas y políticas**
   SQL Editor → New query → pegar todo `supabase/migrations/001_esquema.sql` → Run.
   Debe terminar sin errores.
2. **Cargar datos iniciales**
   Nueva consulta → pegar `supabase/seed.sql` → Run.
   El resultado dice `cargado` la primera vez. Si se repite, nunca sobrescribe: responde
   `ya existía, igual al original` o `ya existía con cambios: NO se tocó`.
   Comprobar:
   ```sql
   select jsonb_array_length(datos->'pieces') as piezas from config;           -- 88
   select linea, jsonb_array_length(buses) as buses from planes;               -- L2 | 85
   ```
3. **Cerrar el registro público**
   Authentication → Sign In / Providers → Email: dejar activo; desactivar **"Allow new users to sign up"**.
   Así solo existen las cuentas que tú creas.
4. **Crear las cuentas** (una por operario y la tuya)
   Authentication → Users → Add user → Create new user → correo + contraseña → marcar **Auto Confirm User**.
   Si un operario no tiene correo, se puede usar uno interno, por ejemplo `op01@modasa.local`.
   El perfil se crea solo, con rol `operador`.
5. **Poner nombres y hacerte administrador** (SQL Editor):
   ```sql
   update perfiles p set nombre = 'Juan Pérez' from auth.users u
    where u.id = p.id and u.email = 'op01@modasa.local';

   update perfiles p set rol = 'admin' from auth.users u
    where u.id = p.id and u.email = 'TU_CORREO';

   select u.email, p.nombre, p.rol from perfiles p join auth.users u on u.id = p.id;
   ```
6. **Copiar los dos valores públicos**
   Project Settings → API Keys → copiar la **Publishable key** (o `anon` en Legacy API Keys).
   La URL es `https://ggpvrvwteusirfgrpluo.supabase.co`.

## B. Probar en tu computadora (fase 3)

```bash
cp .env.example .env.local      # .env.local no se sube a GitHub (.gitignore)
# editar .env.local y pegar VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev
```

## C. Vercel (fase 4)

1. Entrar a https://vercel.com con tu cuenta de GitHub → **Add New… → Project**.
2. Importar el repositorio `control-abastecimiento` (si no aparece: *Adjust GitHub App Permissions* y darle acceso a ese repo).
3. Framework Preset: **Vite** (se detecta solo por `vercel.json`). Build: `npm run build`. Output: `dist`.
4. **Environment Variables** (Production y Preview):
   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://ggpvrvwteusirfgrpluo.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | la clave pública del paso A.6 |
5. **Deploy**. Vercel te da una URL tipo `https://control-abastecimiento.vercel.app`.
6. Volver a Supabase → Authentication → URL Configuration → **Site URL** = la URL de Vercel
   (y agregarla en Redirect URLs). Sirve para los correos de cambio de contraseña.
7. Cada `git push` a `main` vuelve a publicar automáticamente.

## Comprobaciones de seguridad antes de usar en planta

- Con una cuenta `operador`: no puede guardar Parámetros, ni cambiar o vaciar la Programación, ni borrar revisiones.
- Sin sesión: no se ve ninguna pantalla ni dato.
- Buscar en el código publicado que no exista ninguna clave secreta:
  `grep -rE "service_role|sb_secret" dist/ src/` → no debe devolver nada.
