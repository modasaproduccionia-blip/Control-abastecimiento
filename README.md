# Control de Abastecimiento | MODASA

App web para registrar la llegada de piezas por estación y bus (Línea de Acabados).
Migración de la versión publicada en Claude Artifacts a **Vite + Supabase + Vercel**, conservando diseño, logo, pantallas y funciones.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura del proyecto, respaldo intacto, build para Vercel, borrador SQL | ✅ |
| 2 | Ejecutar `001_esquema.sql` y `seed.sql` en Supabase, crear usuarios y roles | pendiente |
| 3 | Conectar la app a Supabase (sesión, roles, `marcar_pieza`, tiempo real) | pendiente |
| 4 | Pruebas con varias sesiones y publicación en Vercel | pendiente |

Hasta la fase 3 la app funciona en modo **"Solo en este equipo"** (guarda en el navegador), igual que el original abierto fuera de Claude.

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
