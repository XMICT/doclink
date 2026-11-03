# scripts/

Pipeline de build de doclink. Se ejecuta antes de que Next.js compile: lee el contenido del backend hermano, construye symlinks en `modules/` y expande los specs OpenAPI. Sin este pipeline, `modules/` está vacío y la app no tiene nada que mostrar.

## Punto de entrada

```
scripts/index.js   ← npm run setup / dev / build lo llama directamente
```

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `index.js` | Orquestador: coordina las tres fases del pipeline |
| `nav/resolve.js` | Lee `backend/docs/index.json` y devuelve un árbol de navegación unificado |
| `sync/modules.js` | Crea symlinks y genera `meta.json` por carpeta |
| `sync/report.js` | Output en tabla con spinner live (TTY) o streaming (CI) |
| `openapi/expander.js` | Expande marcadores custom dentro de specs OpenAPI |
| `openapi/model-schema.js` | Convierte definiciones de modelos Sequelize a schemas OpenAPI |
| `openapi/introspect.js` | Lanza subprocesos al backend para introspeccionar modelos y payloads |
| `openapi/converters.js` | Convierte descriptores Joi y schemas AJV al formato OpenAPI |
| `openapi/cache.js` | Fingerprinting e invalidación incremental del caché OpenAPI |

---

## Fase 1 — Resolución de navegación (`nav/resolve.js`)

Lee `<backendPath>/docs/index.json`. El archivo raíz declara secciones; cada sección puede contener nodos inline o referencias a fragmentos (`nav.json` de cada módulo).

### Tipos de nodo

```
group  → { type:'group', title, icon?, content: Node[] }
page   → { type:'page',  title, icon?, file: <abs> }          // prosa
         { type:'page',  title, icon?, op: <operationId> }    // dentro de api manual
api    → { type:'api', title, icon?, mode:'auto',   spec: <abs> }
         { type:'api', title, icon?, mode:'manual', spec: <abs>, content: Node[] }
```

### Fragmentos

Un string dentro de `content[]` es una ruta relativa a otro `.json`. Se carga e inserta en su lugar. Puede ser un nodo único o un array. La inclusión es recursiva; hay detección de ciclos.

### Salida

```js
{ title: string, sections: [{ title, icon?, content: Node[] }] }
```

Todas las rutas (`file`, `spec`) son **absolutas** al backend. El llamador no necesita conocer la ubicación física del backend.

---

## Fase 2 — Sincronización de archivos (`sync/modules.js`)

Recorre el árbol de nav y materializa `modules/` con symlinks y metadatos.

### `symlinkPage(absFile, backendPath, modulesPath)`

Divide la ruta en `prefix` (módulo) + `rest` (path dentro de `docs/`):

```
backend/compra/docs/introduccion.mdx
  → modules/compra/introduccion.mdx  (symlink)
  → devuelve { folderRel: 'compra', name: 'introduccion' }
```

### `makeNavLayout({ backendPath, modulesPath, apis, onModuleSync })`

Devuelve `{ layoutNode }`. Llamar `layoutNode(node)` por cada nodo del árbol:

- `page` → crea symlink en su ubicación natural (`modules/<módulo>/<nombre>.mdx`), devuelve path relativo para `meta.json`
- `group` → crea `meta.json` en su carpeta; gestiona subgrupos recursivamente
- `api` → registra el spec en el array `apis[]` (se procesa en fase 3), devuelve `'<id>/api'`

#### Subgrupos (`forceDir`)

Cuando un nodo `group` anidado se procesa, se activa `forceDir = '<módulo>/<slug-subgrupo>'`. En este contexto las páginas **no se mueven**: siguen en su ubicación natural. El `meta.json` del subgrupo las referencia con `../`:

```
backend/cxp/docs/listar.mdx  →  modules/cxp/listar.mdx  (symlink, no se mueve)

modules/cxp/consultas/meta.json:
  { "title": "Consultas", "pages": ["../listar", "../obtener"] }
```

Fumadocs asigna las páginas al nodo "Consultas" en el sidebar sin alterar su URL (`/docs/cxp/listar`).

Si el subgrupo contiene un nodo `api`, se calcula la ruta relativa desde `forceDir` hacia el `baseDir` de la API:

```js
pages.push(path.relative(forceDir, `${id}/api`));
// forceDir='cxp/sub', id='cxp'  →  '../api'
```

### `meta.json` raíz

Al terminar, `index.js` escribe `modules/meta.json` con todas las secciones como separadores de Fumadocs:

```json
{ "pages": ["---Compra---", "compra/introduccion", "compra/api", ...] }
```

---

## Fase 3 — Expansión OpenAPI con caché incremental (`index.js` + `openapi/expander.js`)

Todos los specs recolectados en `apis[]` se procesan **en paralelo** (`Promise.all`).

### Caché (`openapi/cache.js`)

Antes de expandir, se calcula un fingerprint SHA-256 que incluye:

1. El contenido raw del YAML del spec
2. Hash de todos los modelos Sequelize del backend (`models/*.js`)
3. Hash de las dependencias externas (`$ref` a archivos y `schema: "<ruta>"`)

Si el fingerprint coincide con `.openapi-cache/.manifest.json` y el `.yaml` expandido existe → se salta. Esto hace que `npm run setup` sea casi instantáneo en runs sin cambios.

Al final se poda `.openapi-cache/` eliminando YAMLs huérfanos (specs que ya no están en el árbol de nav).

### `openapi/expander.js` — Marcadores custom

El YAML fuente es OpenAPI estándar excepto por tres marcadores. El expander los resuelve y devuelve OpenAPI puro.

#### Marcador 1 — `parameters` con modelo Sequelize

```yaml
parameters:
  - model: Producto
    fields: [id, nombre, precio]
    exclude: [campoVirtual]
    in: query   # o path (default: query)
```

Genera un param OpenAPI por cada campo. Si `in: query`, añade también `body_filtro` (filtro avanzado en JSON). Si `in: path`, todos los params son `required: true`.

`fields` acepta strings o tuplas `[campo, alias]`.
`exclude` acepta lista de nombres o la palabra clave `"virtuals"` (excluye todos los campos VIRTUAL del modelo).

#### Marcador 2 — `schema` con `type: model`

```yaml
schema:
  type: model
  model: Producto
  include:
    - categoria           # asociación completa
    - model: proveedor
      fields: [id, nombre]
  exclude: [campoInterno]
```

Genera un schema `{ type: object, properties: {...} }` con:
- Campos propios del modelo (primero)
- Propiedades de asociaciones incluidas (al final), introspectando el modelo destino

#### Marcador 3 — `requestBody` con ruta a payload

```yaml
requestBody:
  content:
    application/json:
      schema: "./payloads/crear-producto.js"
```

Carga el archivo del backend y lo convierte a OpenAPI. Soporta dos formatos:

- **Joi**: llama a `.describe()` y convierte el resultado → `convertJoiDescribe()`
- **AJV**: toma el schema JSON Schema directamente → `convertAjvSchema()`

#### `$ref` externos

El walker también resuelve `$ref` a archivos externos (`./schemas/comun.yaml#/Pointer`): carga el YAML, navega el pointer JSON y expande el nodo destino.

Un `$ref` externo cuenta como marcador en `detectExtensions()`: un spec que solo los usa también se expande. Si no, se cargaría el original y fumadocs-openapi (que recibe el spec ya parseado, sin ruta de archivo) buscaría `./schemas.yaml` en la raíz de doclink.

### Introspección de modelos (`openapi/introspect.js`)

Cada vez que se necesita un modelo, `introspectSchema()` lanza un proceso Node hijo con `--input-type=commonjs` dentro del directorio del backend. El script hijo:

1. Stubea los drivers de BD (sqlite3, pg, mysql2…) para no necesitar conexión real
2. Carga todos los `models/*.js` y llama a `.associate()`
3. Usa `@alt3/sequelize-to-json-schemas` con `OpenApi3Strategy`
4. Resuelve `$ref` internos que genera la librería (UUID, DateTime, Date, Blob)
5. Limpia defaults inválidos (objetos vacíos de `UUIDV4`)
6. Separa `ownProperties` de `assocProperties`

El resultado se cachea en memoria (Map) por `backendPath + modelName` para no relanzar el proceso si el mismo modelo se usa en múltiples specs.

---

## Output del pipeline

```
.openapi-cache/
  nav.json          ← lista de specs { id, title, spec, mode, baseDir, content }
  <id>.yaml         ← spec expandido por módulo (ej: compra.yaml)
  .manifest.json    ← fingerprints para caché incremental

modules/
  meta.json         ← separadores de sección para Fumadocs
  <modulo>/
    meta.json       ← { title, pages: [...] } para Fumadocs
    *.mdx           ← symlinks a backend/<modulo>/docs/*.mdx
    api/            ← generado por fumadocs-openapi en tiempo de build
```

`lib/openapi.ts` lee `.openapi-cache/nav.json` para saber qué módulos tienen API y con qué spec (expandido si había marcadores, original si no).

---

## Comportamiento ante errores

- Backend no encontrado → `process.exit(1)` inmediato
- Fragmento de navegación no encontrado → lanza excepción (aborta el setup)
- Página MDX no encontrada → lanza excepción
- Spec OpenAPI con error de expansión → `status: 'failed'` en el reporter; el módulo se omite del caché pero el setup continúa
- Modelo Sequelize no encontrado → la asociación se omite silenciosamente

---

## Cómo extender

**Añadir un nuevo marcador**: agregar la detección en `detectExtensions()` y la resolución en `expandNode()` dentro de `openapi/expander.js`.

**Añadir un nuevo tipo de nodo de navegación**: agregar el `case` en `processNode()` de `nav/resolve.js` y el handler en `layoutNode()` / `layoutGroup()` de `sync/modules.js`.

**Cambiar la estrategia de caché**: solo `openapi/cache.js`. `specFingerprint()` es la función a modificar.
