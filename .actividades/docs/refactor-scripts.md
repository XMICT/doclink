# Refactorización: módulo `scripts/`

## Estado general

| Fase | Estado |
|---|---|
| Reorganización de archivos | ✅ Completado |
| Reescritura de código | ✅ Completado |

---

## Estructura: actual → objetivo

```
ACTUAL                              OBJETIVO
─────────────────────────────────── ────────────────────────────────────
scripts/                            scripts/
  setup/                              index.js
    index.js                ──────►     (orquestador, sube un nivel)
    modules.js              ──┐
    cache.js                  │       sync/
    report.js               ──┘         modules.js
                                         report.js
  nav-resolve.js            ──────►   nav/
                                         resolve.js
                                           + separatorOf (viene de modules)
  openapi-expander.js       ──────►   openapi/
                                         expander.js
  utils/                                 model-schema.js
    introspect.js           ──┐            + buildModelParams (viene de expander)
    payload-converters.js   ──┤          converters.js
    model-schema.js         ──┘          introspect.js
                                         cache.js (viene de setup/cache)
```

### Por qué cada movimiento

| Cambio | Razón |
|---|---|
| `setup/index.js` → `index.js` | El punto de entrada no tiene por qué estar anidado en una subcarpeta |
| `setup/cache.js` → `openapi/cache.js` | `specFingerprint` entiende la estructura del spec OpenAPI (`$ref`, marcadores) — pertenece al dominio OpenAPI |
| `setup/modules.js` → `sync/modules.js` | Responsabilidad: sincronizar archivos. La carpeta `sync/` lo dice con claridad |
| `setup/report.js` → `sync/report.js` | Reporte del proceso de sincronización |
| `utils/` → `openapi/` | Todos los utils son específicos de la expansión OpenAPI, no utilitarios generales |
| `utils/payload-converters.js` → `openapi/converters.js` | Nombre más corto y directo |
| `nav-resolve.js` → `nav/resolve.js` | La carpeta `nav/` agrupa todo lo relacionado con la resolución del árbol de navegación |
| `separatorOf` de `modules.js` → `nav/resolve.js` | Formatea un nodo del árbol de navegación → pertenece al módulo de nav |
| `buildModelParams` de `expander.js` → `openapi/model-schema.js` | Es un resolvedor de marcador de modelo, igual que `expandModelSchema` y `expandFieldSchema` |

---

## Checklist por archivo

### `scripts/index.js` (era `setup/index.js`)

- ✅ Mover archivo a `scripts/index.js`
- ✅ Actualizar imports (`./cache` → `./openapi/cache`, `./modules` → `./sync/modules`, etc.)
- ✅ Importar `separatorOf` desde `./nav/resolve.js` en vez de `./sync/modules.js`
- ✅ `parseLine` helper local en `loadEnvLocal`

---

### `scripts/nav/resolve.js` (era `nav-resolve.js`)

- ✅ Mover a `scripts/nav/resolve.js`
- ✅ `separatorOf` movido aquí desde `modules.js`
- ✅ Spread condicional para `icon` en `processNode`
- ✅ Spread condicional para `icon` en `resolveNav` secciones

---

### `scripts/sync/modules.js` (era `setup/modules.js`)

- ✅ Mover a `scripts/sync/modules.js`
- ✅ Eliminar export de `separatorOf` (movido a `nav/resolve.js`)
- ✅ `folderRelOf(file)` — función pura sin side effect para derivar el directorio padre
- ✅ `symlinkToDir(file, dir)` — encapsula el patrón repetido del branch `forceDir`
- ✅ `layoutGroup` simplificado usando los dos helpers

---

### `scripts/sync/report.js` (era `setup/report.js`)

- ✅ Mover a `scripts/sync/report.js`
- ✅ `handleDone` closure en vez de `this.done` overwrite
- ✅ `STATUS_META` constante de módulo (fuera del factory, no se recrea en cada llamada)

---

### `scripts/openapi/expander.js` (era `openapi-expander.js`)

- ✅ Mover a `scripts/openapi/expander.js`
- ✅ Imports actualizados
- ✅ `buildModelParams` movido a `openapi/model-schema.js`
- ✅ Predicados nombrados al inicio: `isExternalRef`, `isModelSchema`, `isFieldMarker`, `isModelParam`
- ✅ `resolveExternalRef(ref, ctx)` extraído
- ✅ `expandObject(node, ctx)` extraído
- ✅ `expandNode` queda como dispatcher limpio con early returns
- ✅ `detectExtensions` usa los mismos predicados que el walker

---

### `scripts/openapi/model-schema.js` (era `utils/model-schema.js`)

- ✅ Mover a `scripts/openapi/model-schema.js`
- ✅ `buildModelParams` recibido desde `expander.js`
- ✅ `expandModelSchema` usa chain funcional (`Object.fromEntries` + spread) en vez de loop + `Object.assign`
- ✅ Spread condicional para `required`, `description`, `example` en el retorno

---

### `scripts/openapi/converters.js` (era `utils/payload-converters.js`)

- ✅ Renombrar/mover a `scripts/openapi/converters.js`

---

### `scripts/openapi/introspect.js` (era `utils/introspect.js`)

- ✅ Mover a `scripts/openapi/introspect.js`
- ✅ Import actualizado a `./converters.js`

---

### `scripts/openapi/cache.js` (era `setup/cache.js`)

- ✅ Mover a `scripts/openapi/cache.js`
- ✅ `hashFileSafe` expandido a función legible

---

## Verificación

```
npm run setup  →  17 módulos · 47 archivos sincronizados
                  10 módulos en caché · 0.0s
```
