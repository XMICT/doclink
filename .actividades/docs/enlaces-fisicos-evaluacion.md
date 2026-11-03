# Evaluación: enlaces entre páginas solo con rutas físicas

Actividad: DL-025. Estado: **modo híbrido implementado** (2026-11-03). Pendiente: migrar los repos hermanos y pasar a estricto.

## Problema

Un autor del repo hermano escribe `[texto](ruta.mdx)` y doclink valida y resuelve esa ruta contra el árbol **lógico** de `modules/`, no contra el sistema de archivos del repo hermano. En el árbol lógico el segmento `docs/` desaparece (`backend/compra/docs/flujo.mdx` vive en `modules/compra/flujo.mdx`), así que la ruta correcta para el validador no coincide con la que ve el autor en su editor.

Hoy conviven tres formas de escribir el mismo enlace, y solo la segunda pasa el validador:

| Forma | Ejemplo desde `poliza/docs/flujo.mdx` | Resultado |
|---|---|---|
| Física | `../../poliza_ajuste_redondeo/docs/introduccion.mdx` | Rota el build |
| Lógica | `../poliza_ajuste_redondeo/introduccion.mdx` | Pasa |
| Híbrida (la que pide la plantilla del hermano) | `../poliza_ajuste_redondeo/docs/introduccion.mdx` | Rota el build |

## Datos (medidos el 2026-11-03 contra `revisiones`)

Alcance: los 500 enlaces markdown a `.md`/`.mdx` que hay en las 219 páginas del nav.

| Categoría | Enlaces |
|---|---|
| Resuelven igual en ambos esquemas (`./x.mdx`, mismo módulo) | 273 |
| Solo lógicos (`../otro_modulo/x.mdx`) | 210 |
| **Rotos hoy** | **17, en 13 archivos** |
| ↳ físicos hacia una página del nav (`../../mod/docs/x.mdx`) | 9 |
| ↳ físicos hacia `documentation/*.md`, que está fuera del nav | 6 |
| ↳ híbridos con un `../` de menos | 2 |

- Ningún enlace resuelve a dos archivos distintos según el esquema (0 de 483 válidos), así que la ambigüedad no es un problema real hoy.
- El build lista 26 errores de enlace porque cada uno de los 13 archivos se reporta dos veces.
- Los 17 enlaces rotos son intentos de ruta física. Los autores ya escriben físico por instinto y el build los empuja a la forma lógica.
- Quedan fuera de este cambio: los 896 `href` JSX (`<Card href="/docs/...">`) y los enlaces markdown a páginas del playground (`/docs/poliza/api/...`). Son URLs, no referencias a archivos.
- 18 de 237 `.mdx` del backend no están en el nav (`af_depreciacion`, `authorization`, `pago_cliente`…). No se compilan, así que sus enlaces no se validan.

### Origen de la confusión

`revisiones/.claude/commands/documentar-modulos.md` (línea ~943) es el generador de las páginas y define la convención. Su ejemplo para otro módulo es `[Requisiciones](../requisicion/docs/introduccion.mdx)`: la forma híbrida, que falla. Mientras no se corrija, cada página nueva generada puede traer un enlace roto.

## Qué significa "solo físicas"

Todo enlace markdown a un `.md`/`.mdx` se escribe **relativo al archivo que lo contiene, tal como están en el repo hermano**, incluyendo `docs/`:

```markdown
[permisos](./permisos.mdx)
[Requisiciones](../../requisicion/docs/introduccion.mdx)
[estado Autorizado](../../compra/docs/flujo.mdx#autorizado)
```

La regla se puede comprobar con el editor: la ruta funciona con ctrl+clic y en la vista previa de GitHub.

## Evaluación

### Qué se gana

- Una sola regla verificable sin conocer el pipeline de doclink.
- El IDE navega los enlaces y actualiza las rutas al mover o renombrar un archivo.
- La vista previa en GitHub del repo hermano resuelve los enlaces.
- Desaparece la clase de error híbrido (2 casos hoy, y el generador los reproduce).
- Los enlaces dejan de depender de cómo doclink acomode `modules/`.

### Qué cuesta

- **Rutas más largas** entre módulos: `../../compra/docs/flujo.mdx` en lugar de `../compra/flujo.mdx`.
- **Código nuevo en doclink.** Hoy el validador solo comprueba; la ruta física no existe en `modules/`, así que hay que traducirla a la lógica antes de que `createRelativeLink` la resuelva en runtime.
- **Migración de 210 enlaces** en el repo hermano, más la plantilla del generador.
- **Coordinación entre repos.** Si doclink exige físico antes de que el hermano migre, el build se rompe con 210 errores.
- **Destinos fuera del nav** (`documentation/*.md`): no tienen URL, así que no se pueden enlazar. Hay que incorporarlos al nav o quitar el enlace.

### Alternativas descartadas o relegadas

| Opción | Valoración |
|---|---|
| A. Mantener lo lógico y documentarlo mejor | Corrige el síntoma (la plantilla) pero deja la regla dependiente del pipeline y sin ayuda del editor. |
| B. Solo físico, estricto (**recomendada**) | Una convención, errores con pista de corrección. Exige migrar. |
| C. Aceptar ambos | Técnicamente seguro (0 ambigüedades) y permite migrar sin coordinación, pero mantiene dos convenciones, que es lo que se quiere eliminar. Solo tiene sentido como etapa transitoria. |

## Diseño propuesto (opción B)

Todo ocurre en `lib/remark-validate-links.ts`; no cambia el pipeline `scripts/` ni el runtime.

1. **Mapa destino → ubicación lógica.** El validador ya construye `symlinkDirMap` (ruta real → carpeta del symlink en `modules/`). Se amplía a ruta real → ruta completa del symlink.
2. **Resolver** el `href` contra el directorio del archivo real (`file.path`, que ya es la ruta real porque `resolve.symlinks = true`).
3. **Traducir y reescribir.** Si el destino está en el mapa, se sustituye `node.url` por la ruta relativa entre las ubicaciones lógicas de origen y destino (conservando `#ancla`). `createRelativeLink` y `source.resolveHref` siguen funcionando sin cambios y `getLLMText` emite el mismo enlace que hoy.
4. **Errores con pista**, de más a menos específico:
   - El destino existe pero no está en el nav → «agrégalo a un `nav.json` o quita el enlace».
   - La ruta sale válida como lógica → «usa la ruta física: `../../mod/docs/x.mdx`» (calculada).
   - Falta o sobra un `../` y existe un archivo con ese nombre → sugerir la ruta real.
   - No existe → como hoy.
5. **Páginas virtuales del playground** (`isApiPage`): se mantienen exentas. No tienen archivo físico; se enlazan por URL absoluta, como ya hacen hoy.

## Riesgos a verificar al implementar

- **Caché de Turbopack.** El resultado del plugin pasa a depender de la estructura de `modules/` y no solo del contenido del archivo. El validador actual ya tiene esa dependencia, pero ahora además reescribe. Hay que confirmar en `next dev` que cambiar el nav invalida la caché.
- **`file.path` de páginas con nombre repetido** en dos carpetas: el mapa usa ruta real, que es única.
- **Orden de despliegue** (ver pendientes).

## Plan

1. Reescribir el plugin (pasos 1–5) en doclink.
2. Pruebas del plugin con un backend de fixtures: físico válido, destino fuera del nav, híbrido, lógico antiguo, ancla, página virtual. (El repo no tiene suite; las pruebas irían junto al plugin, como `scripts/nav/resolve-layout.test.js`.)
3. Codemod `scripts/links/migrar.js` con `--dry-run` por defecto: convierte los 210 enlaces lógicos a físicos usando el mapa de symlinks. Escribe en el repo hermano, por eso solo con confirmación.
4. Actualizar `documentar-modulos.md` (repo hermano): ejemplo físico correcto y nota de que `docs/` forma parte de la ruta.
5. Actualizar `CLAUDE.md` y `scripts/CLAUDE.md` si cambia algo del pipeline (no se espera).

## Decisión tomada: modo híbrido en la transición

Se elige la opción C como etapa transitoria, mientras los repos hermanos adaptan sus enlaces. Implementado en `lib/remark-validate-links.ts`:

| Enlace | Comportamiento |
|---|---|
| Ruta física hacia una página del nav | Válida. Se reescribe a la ubicación lógica en `modules/` y se conserva el `#ancla` |
| Ruta lógica heredada (`../mod/x.mdx`) | Válida y sin cambios, sin aviso (fumadocs-mdx no muestra los mensajes de `vfile`) |
| Resuelve a dos archivos distintos | Gana la física |
| Página virtual del playground | Exenta, como antes |
| Destino que existe pero no está en el nav | **Aviso**: `⚠ [enlaces] <archivo>:<línea> "<href>": el archivo existe pero no está en la navegación…`. El enlace se deja como está |
| Forma híbrida (un `../` de menos) | **Aviso** con la ruta física sugerida |
| No existe | **Aviso** |

**Ningún problema de enlaces rompe el build**: el plugin no lanza errores, solo avisa por consola (los mensajes de `vfile` los descarta fumadocs-mdx) con archivo, línea y, cuando se puede, la corrección.

`resolveFileLink()` devuelve `legacy` (la ruta física equivalente) cuando un enlace es lógico. Está pensado para un futuro auditor o codemod y para el paso a estricto: bastará con convertir ese caso en error.

Verificación (2026-11-03): 12 pruebas nuevas en `lib/remark-validate-links.test.mjs` (`node --test lib/remark-validate-links.test.mjs`); `tsc --noEmit` sin errores; `next build` contra `revisiones`: en la rama `release` termina con éxito; en `dev` los problemas de enlaces salen como 8 avisos (6 destinos fuera del nav y 2 formas híbridas con la ruta sugerida) y el único fallo es un error de sintaxis MDX ajeno a los enlaces (`producto/docs/flujo.mdx:215`, `</Accordions>` sin su `<Accordion>`). Cada aviso se imprime dos veces porque cada página se compila dos veces.

## Pendientes

1. **Destinos fuera del nav** (`documentation/*.md`, 6 enlaces en 5 páginas): agregarlos al nav como páginas o quitar los enlaces. Son avisos, pero en el sitio el enlace queda apuntando a un archivo que no es una página (404 al hacer clic).
2. **Corregir los 2 enlaces híbridos y migrar los 210 enlaces lógicos** del repo hermano a físicos y corregir `documentar-modulos.md` (línea ~943), cuyo ejemplo `../requisicion/docs/introduccion.mdx` es la forma híbrida que falla. Con el modo híbrido no hay prisa, pero hoy no hay forma de listar los enlaces heredados salvo llamar a `resolveFileLink`.
3. **Pasar a estricto** cuando no queden enlaces heredados.
