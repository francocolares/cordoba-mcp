# cordoba-mcp

## Estilo de código

El código tiene que ser autodescriptivo. No dejes comentarios internos: ni
explicativos, ni de sección, ni `TODO`, ni bloques de JSDoc/TSDoc. Si un
fragmento necesita un comentario para entenderse, el arreglo es renombrar,
extraer una función con nombre propio o simplificar la lógica — no anotarla.

Excepciones, únicamente donde el comentario es sintaxis funcional y no prosa:
directivas (`@ts-expect-error`, `biome-ignore`, `eslint-disable`), pragmas, y
el frontmatter o metadatos que un formato exige.

Si borrás código que tenía comentarios, no los reinstales en el reemplazo.

## Documentación

No escribas ni amplíes documentación por iniciativa propia. Nada de archivos
`.md` nuevos, resúmenes de cambios, notas de diseño, changelogs ni guías,
salvo que yo lo pida explícitamente en el pedido. Cuando termines una tarea,
el resultado se cuenta en el chat, no en un archivo.

Esto incluye no crear `plan.md`, `NOTES.md`, `ARCHITECTURE.md` ni equivalentes
como subproducto del trabajo.

## README.md

El README es capa de presentación pública del proyecto, no documentación
técnica. No agregues detalles de implementación: estructura interna de
carpetas, nombres de módulos o funciones, esquemas de datos, variables de
entorno, pasos de build, decisiones de arquitectura ni registros de cambios.
No lo toques como efecto secundario de otra tarea: sólo cuando yo pida un
cambio al README, y limitado a lo que pedí.
