# Control de Abastecimiento | MODASA

App web para registrar la llegada de piezas por estación y bus (Línea de Acabados).
Migración de la versión publicada en Claude Artifacts a **Vite + Supabase + Vercel**, conservando diseño, logo, pantallas y funciones.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura del proyecto, respaldo intacto, build para Vercel, borrador SQL | ✅ |
| 2 | Ejecutar `001_esquema.sql` y `seed.sql` en Supabase, crear usuarios y roles | en preparación / base ya cargada por el propietario |
| 3 | Conectar la app a Supabase (sesión, roles, `marcar_pieza`, tiempo real) | en implementación en la rama `integracion-supabase` |
| 4 | Pruebas con varias sesiones y publicación en Vercel | pendiente |

La rama `integracion-supabase` añade el cliente oficial de Supabase, inicio de sesión, lectura de datos compartidos y llamadas a las funciones seguras de revisiones. Falta configurar variables en Vercel y completar pruebas antes de publicar. No desplegar esta rama hasta terminar la verificación.

## Estructura

```
├─ respaldo/
│  ├─ index-artifact.html   Copia EXACTA del Artifact original (no editar)
│  └─ README-artifact.md    README original de la exportación
├─ index.html               Marcado de la app (igual al original)
├─ src/
│  ├─ main.js               Punto de entrada
│  ├─ app.js                Lógica y pantallas originales (sin cambios de lógica)
│  ├─ styles.css            Estilos originales
│  ├─ dev-semilla.js        Solo desarrollo: precarga datos/ si el navegador está vacío
│  └─ assets/logo-modasa.png
├─ datos/                   Exportación original (88 piezas, programación L2 de 85 buses)
├─ supabase/
│  ├─ migrations/001_esquema.sql   Tablas, funciones y políticas RLS (borrador, NO ejecutado)
│  └─ seed.sql                     Carga inicial generada desde datos/ (NO ejecutado)
├─ scripts/generar-seed.mjs  Regenera supabase/seed.sql
├─ docs/DECISIONES.md        Decisiones confirmadas
├─ docs/PUBLICAR.md          Guía paso a paso: Supabase + Vercel
├─ vercel.json · vite.config.js · package.json · .env.example · .nvmrc
```

## Variables de entorno

Configurar en Vercel (y en `.env.local` para desarrollo) únicamente:

- `VITE_SUPABASE_URL`: URL pública del proyecto.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable key (o anon key heredada).

Nunca colocar `service_role`, `sb_secret_...` ni la contraseña de la base de datos en el frontend.

## Probar localmente

Requisitos: Node 22.

```bash
npm install
npm run dev          # http://localhost:5173  (precarga 88 piezas y 85 buses L2)
npm run build        # genera dist/
npm run preview      # sirve dist/ en http://localhost:4173 (arranca vacía, como en producción)
```

- Para volver a empezar en desarrollo: en el navegador, DevTools → Application → Local Storage → borrar las claves `fv:*`.
- Contraseña local de Parámetros y Borrar datos (solo hasta la fase 3): `2026`.

## Respaldo

`respaldo/index-artifact.html` es idéntico byte a byte al `index.html` exportado
(SHA-256 `3238782b85bc30d2224f58ca064fedee5cad5ee27a43825751ab078c7767b86a`).
Se puede abrir directamente con doble clic. El Artifact publicado en Claude no se modifica.

```bash
sha256sum respaldo/index-artifact.html
```
