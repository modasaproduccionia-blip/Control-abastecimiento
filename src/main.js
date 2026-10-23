import './styles.css';

// En desarrollo (npm run dev) y sin datos guardados en este navegador,
// se precargan los catálogos y la programación L2 de datos/ para poder probar.
// En producción este bloque no se incluye.
const arrancar = () => import('./app.js');
if (import.meta.env.DEV) import('./dev-semilla.js').then(arrancar);
else arrancar();
