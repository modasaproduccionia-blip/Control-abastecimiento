// Solo desarrollo: carga datos/ en el modo "Solo en este equipo" si el navegador está vacío.
// Usa las mismas claves de localStorage que la app original (prefijo "fv:").
import config from '../datos/config.json';
import planL2 from '../datos/plan-L2.json';

try {
  if (!localStorage.getItem('fv:app/config')) localStorage.setItem('fv:app/config', JSON.stringify(config));
  if (!localStorage.getItem('fv:plan/L2')) localStorage.setItem('fv:plan/L2', JSON.stringify(planL2));
} catch (e) {
  // sin localStorage (modo privado): la app arranca vacía, igual que el original
}
