# Control de Abastecimiento | MODASA

Copia exacta de la versión publicada en Claude Artifacts al 23-Oct-2026.

## Estructura

```
control-abastecimiento/
├── index.html            Aplicación completa (HTML, CSS, JavaScript y logo MODASA incrustado)
├── README.md             Este archivo
└── datos/
    ├── config.json       Parámetros: 88 piezas ZEUS5, estaciones L1/L2, modelos, tipos de pieza, horario y refrigerio
    ├── plan-L2.json      Programación L2 (85 buses)
    └── revisiones.json   Revisiones registradas (vacío: se borraron las de prueba y aún no hay nuevas)
```

`index.html` no depende de otros archivos locales. Solo usa Google Fonts (Barlow y Barlow Condensed) desde internet; sin conexión usa una fuente de respaldo.

## Base de datos actual (Claude Artifacts)

En Artifacts los datos viven en una base compartida con esta forma:

| Ruta              | Archivo exportado        | Contenido |
|-------------------|--------------------------|-----------|
| `app/config`      | `datos/config.json`      | `{ stations, pieces, models, areas, schedule, breaks, logo? }` |
| `plan/L1`         | (no existe todavía)      | `{ buses: [...], updatedAt }` |
| `plan/L2`         | `datos/plan-L2.json`     | `{ buses: [...], updatedAt }` |
| `checks/<id>`     | `datos/revisiones.json`  | Un documento por bus + estación + tipo: `{ busId, op, cliente, line, model, station, area, start, end, items, updatedAt }` |

El código de acceso a datos está concentrado en `index.html`, en las funciones `init()`, `persist()`, `saveCfg()`, `savePlan()`, `saveCheck()` y `wipeChecks()`. Ese es el único bloque que habrá que adaptar para Supabase.

## Abrirla fuera de Claude

Al abrir `index.html` directamente en el navegador, la app no encuentra la base de Artifacts y entra en modo **"Solo en este equipo"** (guarda en el navegador). En ese modo arranca vacía: los datos de la carpeta `datos/` se cargarán en Supabase en el siguiente paso.

Para probarla con un servidor local (recomendado):

```
cd control-abastecimiento
npx serve .
```
o
```
python -m http.server 8080
```
y abre http://localhost:8080

Contraseña de Parámetros y de Borrar datos: `2026` (constante `PARAMS_PW` en `index.html`).
