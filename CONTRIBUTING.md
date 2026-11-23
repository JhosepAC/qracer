# Contribuir a QRacer

## Entorno

Usar Node 24.21.0 y pnpm 12.14.0. Instalar con `pnpm install --frozen-lockfile`.
Las versiones están fijadas; no regenerar dependencias con `latest`.
`docs/` contiene planificación local y está excluido de Git por decisión del propietario.

## Cambios pequeños

- `main` es la única rama permanente. Crear ramas cortas como `feat/f01-web-entries`.
- Una rama entrega un incremento revisable; no una fase completa. Integrar frecuentemente.
- Cada PR modifica **como máximo 12 archivos**, incluidos archivos añadidos o borrados.
- Modificar como máximo 800 líneas por PR; el lockfile generado se identifica aparte. Separar refactors y features.
- Identificar lockfiles generados y cambios de dependencias; no mezclarlos con miles de líneas de producto.
- Hacer varios commits coherentes con Conventional Commits; evitar un único commit gigante.
- Revisar diff, checks y evidencia antes de integrar mediante squash; no forzar `main`.

Preferir incrementos secuenciales: crear cada rama desde `main` después de integrar
la anterior. Un PR aprobado que se fusiona en una rama ya integrada no lleva sus
cambios a `main`. Si se usa una pila excepcional, rebasar los commits propios del
hijo sobre `origin/main`, cambiar su base y revisar de nuevo el diff tras cada squash.
Nunca fusionar en un padre obsoleto ni forzar `main`.

## Conventional Commits

Formato: `tipo(scope): descripción breve en inglés`. Tipos permitidos:
`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert`.
Scopes habituales: `ui`, `game`, `controller`, `protocol`, `relay`, `assets`, `tooling`.
Un cambio incompatible usa `!` o footer `BREAKING CHANGE:` y explica su migración.
Los títulos de PR y el squash final también deben cumplir esta convención.

## Comprobaciones

Ejecutar los scripts disponibles del workspace para lint, formato, tipos, pruebas,
build y presupuestos. No declarar una prueba física, benchmark o MCP como validado
sin ejecutarlo. El hook local ayuda; CI valida también los commits y límites del PR.
No ejecutar código de PR externos con secretos de despliegue.

## Diseño y seguridad

El móvil debe permanecer ligero y separado del renderer. No importar Three.js en el mando.
Usar interfaces semánticas y controles de respaldo. No subir credenciales, certificados,
logs de sensores, assets sin licencia o recursos premium obligatorios.
Blender/CodeGraph son herramientas de desarrollo, no requisitos para jugar.
La licencia MIT del código no reemplaza licencias de dependencias ni de assets.
