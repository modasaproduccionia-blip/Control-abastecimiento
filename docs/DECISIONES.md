# Decisiones confirmadas

1. **Repositorio**: `control-abastecimiento`, separado de `control-de-linea`.
2. **Programación**: solo el administrador crea, edita o borra. Los operarios solo consultan.
3. **Usuarios**: cada operario tiene su propia cuenta. Se registra quién inició cada revisión (`creado_por`), quién marcó cada pieza (`items.<pieza>.por`) y quién hizo el último cambio (`actualizado_por`). Estos campos los pone el servidor.
4. **Acceso**: iniciar sesión es obligatorio para todas las pantallas, incluido Dashboard.
5. **Guardado de piezas**: con la función `marcar_pieza` (cambio atómico de una sola pieza, con bloqueo de fila) para evitar sobrescrituras entre tablets.
11. **Revisiones solo por funciones**: nadie (ni el administrador) inserta o edita directo la tabla `revisiones`. Se usa:
    - `marcar_pieza`: cualquier usuario con sesión; valida bus (en programación), estación (de su línea), pieza (del modelo, estación y tipo) y estado; la cantidad requerida sale de los parámetros.
    - `cerrar_revision` (Reportar / Terminar): cualquier usuario con sesión; se registra quién la cerró (`cerrado_por`).
    - `reabrir_revision`: solo quien inició la revisión o el administrador.
    - Borrar: solo el administrador.
12. **Sin TRUNCATE**: se quitan los permisos por defecto de Supabase (incluye TRUNCATE, que no respeta RLS) y se concede solo lo necesario por tabla.
13. **Seed seguro de repetir**: `seed.sql` solo inserta lo que falta; si los parámetros o la programación ya existen, no los toca e indica si tienen cambios.
6. **Roles**: `operador` (registra revisiones) y `admin` (parámetros, programación, borrar revisiones). Los roles solo se cambian desde el panel/SQL Editor de Supabase.
7. **Datos iniciales**: 88 piezas, estaciones, modelos, tipos de pieza, horario y refrigerio de `datos/config.json`; programación L2 de `datos/plan-L2.json`. **No se crea programación L1** hasta que exista.
8. **Arquitectura**: se conserva el código original (HTML/CSS/JS sin framework), empaquetado con Vite. Solo se reemplaza la capa de datos y la contraseña.
9. **Claves**: en el navegador solo la URL del proyecto y la clave pública (publishable/anon). La `service_role` nunca va en el código ni en el repositorio.
10. **Respaldo**: `respaldo/index-artifact.html` es copia exacta del original y no se edita. El Artifact publicado no se toca.
