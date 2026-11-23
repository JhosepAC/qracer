# Instrucciones de trabajo — QRacer

## Documentación que guía el desarrollo

La planificación en `docs/` es local y no se publica. Cuando exista, leer [docs/README.md](docs/README.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) y el contrato del área afectada. En un clon sin esa carpeta, usar [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) y las instrucciones vigentes del propietario; no asumir mecánicas que no se hayan definido. [docs/ROADMAP.md](docs/ROADMAP.md) registra localmente las fases y su estado. Las instrucciones del propietario prevalecen sobre recomendaciones de skills y herramientas.

## Reglas obligatorias

- Mantener `docs/` excluido de Git. No forzar su inclusión ni subir la planificación local.
- Dividir cada fase en PR de hasta 12 archivos modificados y 800 líneas de código/configuración. El lockfile generado se identifica aparte. Realizar varios commits coherentes por incremento.
- Usar trunk based development: `main` permanente y ramas cortas por incremento, integradas mediante PR/squash. No crear `develop` ni mantener una rama abierta durante una fase completa.
- Usar Conventional Commits en commits, títulos de PR y squash final. Seguir tipos y scopes de `docs/DEVELOPMENT.md`.
- Mantener coste de servicios USD 0. No añadir pasos obligatorios de pago, crédito temporal, TURN contratado o generación premium.
- Seguir las referencias y reglas de [docs/DESIGN.md](docs/DESIGN.md). No sustituir la estética arcade por un dashboard genérico ni incorporar marcas/modelos de las imágenes.
- Producir los elementos 3D apropiados con Blender mediante MCP cuando esté disponible, según [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md). No fingir una conexión que no existe ni instalar integraciones globales ajenas al trabajo solicitado.
- Mantener PC como autoridad de simulación, táctil/teclado como alternativas y pausa segura ante pérdida de mando.
- Añadir pruebas de valor para lógica, seguridad y flujos cambiados; respetar presupuestos de rendimiento. No escribir tests que solo repitan una edición de documentación.
- Marcar una fase como finalizada solo con tareas, entregables y criterio de salida comprobados; enlazar evidencia. No confundir documento de diseño con función implementada.
- No borrar, revertir o sobrescribir cambios del propietario para preparar una rama. No forzar `main` ni publicar automáticamente por una edición documental.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

El propietario ha solicitado usar CodeGraph. En F01, cuando existan módulos de código, verificar la ayuda de la versión instalada y habilitar el índice del proyecto; no indexar documentación vacía como prueba de integración. Si el índice falta o no cubre el cambio actual, explicar la limitación y usar búsquedas puntuales sin bloquear el trabajo.

## Skills

La skill existente está en [.agents/skills/find-skills/SKILL.md](.agents/skills/find-skills/SKILL.md). Usarla para localizar capacidades adicionales pertinentes, revisando fuente, contenido, licencia y dependencias antes de recomendarlas. Instalar una skill no forma parte automática de cada tarea ni sustituye las reglas de QRacer. Estado y selección en [docs/TOOLING.md](docs/TOOLING.md).
