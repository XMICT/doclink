# Bug: resolución de enlaces entre páginas de primer nivel y subgrupos

## Contexto

El pipeline (`scripts/`) lee el árbol de navegación del backend hermano, crea
symlinks en `modules/` y genera los archivos `meta.json` que Fumadocs usa para
construir el sidebar y los URLs de cada página.

El bug es silencioso: no lanza excepción ni aviso en consola, pero produce una
estructura de `modules/` y/o un `meta.json` que hace que los enlaces entre
páginas de primer nivel y páginas dentro de subgrupos no resuelvan al destino
correcto.

---

## Datos de entrada reales (backend hermano)

### `backend/docs/index.json` — raíz del árbol

```json
{
  "nav": {
    "title": "NERP Docs",
    "sections": [
      {
        "title": "Inicio",
        "content": [
          { "type": "page", "title": "Bienvenida",         "content": "index.mdx" },
          { "type": "page", "title": "Mapa del sistema",   "content": "mapa-del-sistema.mdx" },
          { "type": "page", "title": "Cómo usar los docs", "content": "como-usar.mdx" }
        ]
      },
      {
        "title": "Compras y Gastos",
        "content": [
          { "type": "page", "title": "Introducción", "content": "compras-y-gastos/introduccion.mdx" },
          "../requisicion/docs/nav.json",
          "../compra/docs/nav.json",
          "../gasto/docs/nav.json"
        ]
      }
    ]
  }
}
```

Los fragmentos (strings en `content[]`) son rutas relativas a otro `.json`.
El `baseDir` de la raíz es `backend/docs/`.

### `backend/compra/docs/nav.json` — fragmento de un módulo

```json
{
  "type": "group",
  "title": "Compras",
  "icon": "ShoppingCart",
  "content": [
    { "type": "page", "title": "Introducción", "content": "introduccion.mdx" },
    { "type": "page", "title": "Flujo",        "content": "flujo.mdx" },
    { "type": "page", "title": "Estados",      "content": "estatus.mdx" },
    { "type": "page", "title": "Permisos",     "content": "permisos.mdx" },
    { "type": "api",  "title": "API",          "content": "api/openapi.yaml" }
  ]
}
```

Este fragmento tiene su propio `baseDir`: `backend/compra/docs/`.

### `backend/api_accesos_externos/docs/nav.json` — grupo con subgrupo real

```json
{
  "type": "group",
  "title": "Nextfuel",
  "content": [
    { "type": "page", "title": "Introducción",  "content": "introduccion.mdx" },
    { "type": "page", "title": "Configuración", "content": "configuracion.mdx" },
    { "type": "page", "title": "Guía práctica", "content": "guia-practica.mdx" },
    {
      "type": "group",
      "title": "Casos de uso",
      "content": [
        { "type": "page", "title": "Envío de ventas",      "content": "envio-ventas.mdx" },
        { "type": "page", "title": "Depósito bancario",    "content": "deposito-bancario.mdx" },
        { "type": "page", "title": "Compra de combustible","content": "compra-combustible.mdx" }
      ]
    },
    { "type": "api", "title": "API", "ref": "api/openapi.yaml", "content": [...] }
  ]
}
```

Aquí hay un `group` dentro de otro `group` — el escenario donde el bug aparece.

---

## Cómo lo procesa `nav/resolve.js`

`resolveNav` lee `index.json`, itera `sections` y llama a `processContent`.
Cada string en `content[]` es un fragmento: se carga, se usa su `dirname`
como nuevo `baseDir` y se inserta en el árbol.

**Resultado para la página de primer nivel (sección "Compras y Gastos"):**

```
baseDir = backend/docs/
node.content = "compras-y-gastos/introduccion.mdx"
→ file = path.resolve('backend/docs/', 'compras-y-gastos/introduccion.mdx')
       = /abs/backend/docs/compras-y-gastos/introduccion.mdx
```

**Resultado para el fragmento `compra/docs/nav.json`:**

```
fragPath = path.resolve('backend/docs/', '../compra/docs/nav.json')
         = /abs/backend/compra/docs/nav.json
fragBase = /abs/backend/compra/docs/
→ page "Introducción": file = /abs/backend/compra/docs/introduccion.mdx
→ page "Flujo":        file = /abs/backend/compra/docs/flujo.mdx
```

Los `file` de ambos grupos quedan como rutas absolutas al backend. El llamador
no sabe qué fragmento cargó cada nodo — solo recibe el árbol ya resuelto.

---

## Cómo lo procesa `sync/modules.js`

### Función clave: `splitDocs`

Divide una ruta absoluta en `prefix` (segmentos antes de `docs/`) y `rest`
(segmentos después de `docs/`):

```
/abs/backend/compra/docs/introduccion.mdx
  → rel  = 'compra/docs/introduccion.mdx'
  → i    = 1  (índice de 'docs')
  → prefix = ['compra']
  → rest   = ['introduccion.mdx']

/abs/backend/docs/compras-y-gastos/introduccion.mdx
  → rel  = 'docs/compras-y-gastos/introduccion.mdx'
  → i    = 0  (índice de 'docs')
  → prefix = []           ← VACÍO: el archivo vive en la raíz de docs/
  → rest   = ['compras-y-gastos', 'introduccion.mdx']
```

### Trazas de `layoutNode`

#### Caso 1 — página de primer nivel (Introducción de sección)

```js
// node = { type:'page', file: '/abs/backend/docs/compras-y-gastos/introduccion.mdx' }
symlinkPage(file, backendPath, modulesPath)
  prefix = []
  rest   = ['compras-y-gastos', 'introduccion.mdx']
  target = modules/compras-y-gastos/introduccion.mdx  ← symlink creado aquí
  rel    = path.join('compras-y-gastos')              ← prefix vacío, solo rest[0..-2]
         = 'compras-y-gastos'
  → { folderRel: 'compras-y-gastos', name: 'introduccion' }

layoutNode devuelve: 'compras-y-gastos/introduccion'
```

Este valor va al array `rootPages` → escrito en `modules/meta.json`.

**Observación clave:** `modules/compras-y-gastos/` se crea con solo el symlink.
No hay `meta.json` en esa carpeta porque ningún `layoutGroup` la gestiona.

#### Caso 2 — grupo de módulo (`compra`)

```js
// node = { type:'group', title:'Compras', content:[...] }
layoutGroup(node, forceDir=null)

  // Primer hijo: page 'introduccion.mdx'
  symlinkPage('/abs/backend/compra/docs/introduccion.mdx', ...)
    prefix = ['compra'], rest = ['introduccion.mdx']
    target = modules/compra/introduccion.mdx
    rel    = 'compra'
    → { folderRel: 'compra', name: 'introduccion' }
  setDir('compra')  →  groupDir = 'compra'
  pages.push('introduccion')

  // Más páginas → pages = ['introduccion', 'flujo', 'estatus', 'permisos']

  // API node
  registerApi(...)  →  pages.push('api')

// Al terminar:
groupDir = 'compra'
meta.json escrito en modules/compra/meta.json:
  { "title": "Compras", "pages": ["introduccion", "flujo", "estatus", "permisos", "api"] }

layoutNode devuelve: 'compra'   ← solo el nombre del módulo
```

#### Caso 3 — grupo con subgrupo (`api_accesos_externos`)

```js
layoutGroup({ title:'Nextfuel', content:[intro, config, guia, subgroup, api] }, null)

  // Páginas directas del grupo principal:
  symlinkPage('...docs/introduccion.mdx') → { folderRel:'api_accesos_externos', name:'introduccion' }
  setDir('api_accesos_externos')
  pages = ['introduccion', 'configuracion', 'guia-practica']

  // Subgrupo "Casos de uso":
  subGroupSlug = 'casos-de-uso'
  groupDir ya es 'api_accesos_externos' (no null)
  parentDir = 'api_accesos_externos'
  subGroupDir = 'api_accesos_externos/casos-de-uso'

  layoutGroup({ title:'Casos de uso', content:[...] }, forceDir='api_accesos_externos/casos-de-uso')
    // forceDir activo → usa symlinkToDir para cada página:
    symlinkToDir('...docs/envio-ventas.mdx', 'api_accesos_externos/casos-de-uso')
      rest     = ['envio-ventas.mdx']
      filename = 'envio-ventas.mdx'
      target   = modules/api_accesos_externos/casos-de-uso/envio-ventas.mdx
      → devuelve 'envio-ventas'
    // similar para deposito-bancario, compra-combustible...
    pages = ['envio-ventas', 'deposito-bancario', 'compra-combustible']
    meta.json en modules/api_accesos_externos/casos-de-uso/meta.json:
      { "title": "Casos de uso", "pages": ["envio-ventas", "deposito-bancario", "compra-combustible"] }

  pages.push('casos-de-uso')
  // API node → pages.push('api')

groupDir = 'api_accesos_externos'
meta.json en modules/api_accesos_externos/meta.json:
  { "title": "Nextfuel", "pages": ["introduccion","configuracion","guia-practica","casos-de-uso","api"] }

layoutNode devuelve: 'api_accesos_externos'
```

---

## Estructura generada en `modules/`

```
modules/
  meta.json                       ← raíz (escrito por index.js)
  index.mdx                       ← symlink (página inicio)
  mapa-del-sistema.mdx            ← symlink (página inicio)
  como-usar.mdx                   ← symlink (página inicio)

  compras-y-gastos/               ← creada por symlinkPage, SIN meta.json
    introduccion.mdx              ← symlink → backend/docs/compras-y-gastos/

  compra/                         ← creada por layoutGroup, CON meta.json
    meta.json                     ← { title, pages:[...] }
    introduccion.mdx
    flujo.mdx
    estatus.mdx
    permisos.mdx
    api/  ← generado por fumadocs-openapi en tiempo de build

  api_accesos_externos/           ← CON meta.json
    meta.json                     ← { title:'Nextfuel', pages:[..., 'casos-de-uso', 'api'] }
    introduccion.mdx
    configuracion.mdx
    guia-practica.mdx
    casos-de-uso/                 ← subgrupo, CON meta.json
      meta.json                   ← { title:'Casos de uso', pages:[...] }
      envio-ventas.mdx
      deposito-bancario.mdx
      compra-combustible.mdx
    api/
```

### `modules/meta.json` (root) resultante real

```json
{
  "pages": [
    "---Inicio---",
    "index",
    "mapa-del-sistema",
    "como-usar",
    "---Compras y Gastos---",
    "compras-y-gastos/introduccion",
    "requisicion",
    "cotiza_prov",
    "compra",
    "gasto",
    "cxp",
    "pago_prov"
  ]
}
```

---

## Dónde aparece el bug

### Tipo A — página de primer nivel sin meta.json propio

La entrada `"compras-y-gastos/introduccion"` en el root `meta.json` es una
referencia cross-folder: apunta a un archivo dentro de una subcarpeta que
**no tiene `meta.json`**.

Fumadocs registra la página con URL `/docs/compras-y-gastos/introduccion`. ✓

Cuando desde esa página se intenta enlazar a `/docs/compra/introduccion`
(sibling en la sección), el link funciona en el navegador. Pero si Fumadocs
genera breadcrumbs o navegación prev/next usando el árbol de `meta.json`, el
contexto de la página de primer nivel y el de las páginas dentro del grupo
`"compra"` son estructuralmente distintos:

- `"compras-y-gastos/introduccion"` está en el root `meta.json`
- Las páginas de `"compra"` están en `modules/compra/meta.json`

No comparten ningún nodo padre en el árbol de Fumadocs. Los links generados
automáticamente (breadcrumb, prev/next) no pueden cruzar ese límite
correctamente.

### Tipo B — `symlinkToDir` aplana subdirectorios

Cuando un subgrupo recibe `forceDir`, `symlinkToDir` coloca el archivo en
`modules/<dir>/<filename>` ignorando cualquier subdirectorio intermedio:

```
backend/.../docs/sub/pagina.mdx  →  modules/grupo/sub-slug/pagina.mdx
```

Si `pagina.mdx` contiene un enlace relativo escrito asumiendo su ubicación
original en `docs/sub/`, ese enlace rompe silenciosamente al ser servido
desde `modules/grupo/sub-slug/`. No hay error en build; el link produce 404.

### Tipo C — cross-folder ref en root meta.json vs. entrada de grupo

El root `meta.json` tiene simultáneamente:

```json
"compras-y-gastos/introduccion",   ← página directa dentro de una carpeta
"compra",                          ← carpeta de grupo con su propio meta.json
```

La carpeta `compras-y-gastos/` existe en `modules/` pero no tiene `meta.json`.
La carpeta `compra/` sí tiene `meta.json`. Fumadocs maneja estos dos casos de
forma diferente al resolver la navegación: el primero no tiene título de grupo,
el segundo sí. Un enlace generado desde `introduccion` hacia cualquier página
de `compra` puede apuntar a un fragmento de navegación que Fumadocs no asocia
como descendiente de la misma sección.

---

## Resumen de módulos y líneas involucradas

| Archivo | Función | Línea aprox. | Descripción del problema |
|---|---|---|---|
| `sync/modules.js` | `symlinkPage` | 19–25 | `folderRel` vacío cuando `prefix=[]` — no hay `meta.json` para esa carpeta |
| `sync/modules.js` | `symlinkToDir` | 67–74 | Solo toma `filename`, descarta subdirectorio intermedio |
| `sync/modules.js` | `layoutNode` (case `page`) | 130–133 | Devuelve `folderRel/name` al root meta sin crear `meta.json` en esa carpeta |
| `index.js` | generación de `rootPages` | 71–75 | Mezcla referencias directas (`"compras-y-gastos/intro"`) con grupos (`"compra"`) en el mismo array |

---

## Escenario 2 — Páginas de playground API dentro de subgrupos

### Descripción

El sistema debe poder acceder desde páginas de primer nivel a páginas del
playground de API que viven dentro de subgrupos del árbol de navegación.
Hay dos sub-problemas independientes:

#### Sub-problema A — `pages.push('api')` no respeta `forceDir`

Cuando un nodo `api` aparece dentro de un subgrupo (`forceDir` activo), el pipeline hace:

```js
} else if (child.type === 'api') {
  setDir(registerApi(child));
  pages.push('api');
}
```

La referencia `'api'` se interpreta **relativa a la ubicación del `meta.json`**
del subgrupo. Si el subgrupo está en `modules/cxp/sub/meta.json`, Fumadocs
resuelve `'api'` → `cxp/sub/api/`, que no existe. La API real está en
`cxp/api/`.

**Traza concreta** (hipotético: api dentro de `casos-de-uso`):

```
forceDir = 'api_accesos_externos/casos-de-uso'
pages.push('api')
→ meta.json: { pages: ['envio-ventas', 'api'] }
→ Fumadocs resuelve 'api' → api_accesos_externos/casos-de-uso/api/   ← INCORRECTO
→ API real en api_accesos_externos/api/                               ← CORRECTO
```

**Fix (consistente con la Fase 1 del fix de páginas)**:

```js
} else if (child.type === 'api') {
  const id = registerApi(child);
  if (forceDir) {
    pages.push(path.relative(forceDir, `${id}/api`));
  } else {
    setDir(id);
    pages.push('api');
  }
}
```

Así `path.relative('api_accesos_externos/casos-de-uso', 'api_accesos_externos/api')` → `'../api'`.

#### Sub-problema B — Validator rechaza links a páginas virtuales

Las páginas del playground OpenAPI son archivos **virtuales**: `fumadocs-openapi`
los genera en memoria a partir de los specs expandidos. No existen en disco
bajo `modules/`.

`remarkValidateLinks` hace `fs.existsSync(resolved)` sobre el path resuelto.
Para cualquier link `.mdx` que apunte a una página API (e.g.,
`./api/consultas/listarCxP.mdx`), el check devuelve `false` → build rompe
con error de enlace roto, aunque el link sea correcto en runtime.

**Traza concreta** (desde `cxp/introduccion.mdx` → API page):

```
href = './api/consultas/listarCxP.mdx'
baseDir = symlinkDirMap.get('backend/cxp/docs/introduccion.mdx') = 'modules/cxp'
resolved = path.resolve('modules/cxp', './api/consultas/listarCxP.mdx')
         = '/…/modules/cxp/api/consultas/listarCxP.mdx'
fs.existsSync(resolved) → false   ← página virtual, no existe en disco
→ Error: enlaces rotos en cxp/docs/introduccion.mdx
```

**Fix**: cargar los `baseDir` de las APIs desde `.openapi-cache/nav.json` al
inicializar el plugin. Si el link resuelto cae bajo algún directorio de API,
omitir la validación por `existsSync`.

```ts
const apiDirs = new Set<string>();
const navCachePath = path.join(cwd, '.openapi-cache', 'nav.json');
if (fs.existsSync(navCachePath)) {
  const { apis } = JSON.parse(fs.readFileSync(navCachePath, 'utf-8'));
  for (const api of (apis ?? [])) {
    apiDirs.add(path.join(modulesPath, ...api.baseDir.split('/')));
  }
}

// En el visitor:
const isApiPage = [...apiDirs].some(d => resolved === d || resolved.startsWith(d + path.sep));
if (!isApiPage && !fs.existsSync(resolved)) { /* reportar */ }
```

### Archivos afectados (Escenario 2)

| Archivo | Función | Problema |
|---|---|---|
| `sync/modules.js` | `layoutGroup` (rama `api`) | Empuja `'api'` sin calcular path relativo desde `forceDir` |
| `lib/remark-validate-links.ts` | visitor `link` | `existsSync` falla para páginas virtuales de fumadocs-openapi |
