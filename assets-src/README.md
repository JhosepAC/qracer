# Dirección y producción 3D

Requisito del propietario: vehículos y paisajes **modernos, detallados y avanzados**.
La simplificación de perfiles de rendimiento conserva silueta, composición y lectura;
no convierte geometría de prueba en arte final. El coche de bloques de F01 es provisional.

## Calidad verificable

- Vehículos: carrocería con superficies curvas y proporciones coherentes, pasos de rueda,
  paneles, ópticas, parrillas, neumáticos, llantas, frenos y acristalamiento diferenciados.
- Escenarios: relieve y capas de profundidad, asfalto trabajado, señalización, barreras,
  arquitectura modular con detalles, vegetación variada y transiciones visuales cuidadas.
- Materiales: PBR consistente, rugosidad/metal, normales y detalles horneados donde convenga;
  sin sustituir modelado o texturas por bloom excesivo.
- Luz: sombras acotadas, profundidad atmosférica y acabado coherente en movimiento.
- Validación: vistas múltiples en Blender, exportación real en Three.js, recuento de
  triángulos/materiales y benchmark. Más polígonos por sí solos no demuestran calidad.

En F02 se produce una muestra representativa para medir viabilidad. Los tres ambientes,
modelos definitivos y acabado completo siguen perteneciendo a F06/F08. El prototipo
debe representar la carga objetivo; no se obtiene una aprobación de rendimiento midiendo
solo cubos que después serán reemplazados por escenas mucho más costosas.

Guardar fuentes editables y scripts de producción con procedencia/licencias.
Los GLB procesados van al frontend; Blender, MCP y skills no son dependencias del jugador.
No usar generadores premium o créditos temporales para producir recursos obligatorios.

## Skills seleccionadas para autoría

Las skills de terceros se instalan solo en el proyecto y no se versionan sus copias.
`skills-lock.json` registra los hashes. Revisar cambios antes de actualizar; su contenido
no modifica las decisiones del producto ni autoriza ejecutar scripts sin revisión.

```sh
npx skills install --agent codex --frozen-lockfile
```

Selección revisada el 22/11/2026:

| Fuente | Skills | Revisión de origen examinada |
| --- | --- | --- |
| CloudAI-X/threejs-skills | threejs-performance | 0e181866f095b5f06d005133876e926515390d95 |
| EL4CTEO/blender-skills | blender-core, blender-hardsurface-modeling, blender-environment-kits, blender-game-optimization, blender-asset-qa | 1a1cc6c49312f9f370aae86f52b7b907f29c94f6 |

Licencias de ambos repositorios: MIT. Directorio: [Three.js](https://skills.sh/cloudai-x/threejs-skills/threejs-performance),
[Blender Core](https://skills.sh/el4cteo/blender-skills/blender-core).
Adopción observada: Three.js performance 8,8K instalaciones y repositorio 4.345 estrellas;
Blender Core 1,2K instalaciones y repositorio 2.706 estrellas. Environment kits tiene menor
adopción (aproximadamente 575 instalaciones); se seleccionó por pertinencia y revisión
de código, no por popularidad. Los números son orientativos y cambian con el tiempo.
