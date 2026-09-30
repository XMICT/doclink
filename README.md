# doclink

Este repositorio renderiza y presenta la documentación técnica del proyecto. Construido con [Fumadocs](https://fumadocs.dev) sobre Next.js.

**doclink es un renderizador puro**: no tiene contenido propio. Todo el MDX, YAML y configuración de navegación vive en el repositorio hermano (`backend`). doclink solo lee, enlaza y presenta ese contenido.

---

## Arquitectura

```
../
├── backend/                      ← fuente de verdad del contenido
│   ├── docs/
│   │   ├── index.json            ← árbol de navegación raíz (secciones + fragmentos)
│   │   └── *.mdx                 ← páginas globales
│   └── [modulo]/
│       └── docs/
│           ├── nav.json          ← fragmento de navegación del módulo
│           ├── *.mdx
│           └── api/
│               └── openapi.yaml
│
└── doclink/                      ← este repositorio
    ├── modules/                  ← generado por setup.js (gitignored)
    │   ├── meta.json             ← generado: secciones y orden del sidebar raíz
    │   └── [modulo]/             ← directorio real con symlinks por archivo
    │       ├── meta.json         ← generado: páginas y orden del grupo
    │       └── *.mdx → backend/  ← symlinks a los archivos fuente
    └── scripts/
        ├── nav-resolve.js        ← compone index.json + fragmentos, resuelve rutas
        └── setup.js              ← recorre el árbol, crea symlinks y meta.json
```

`modules/` está en `.gitignore`. Se regenera automáticamente antes de cada `dev` y `build`.

---

## Requisitos

- Node.js 18+
- El repositorio hermano debe estar en `../[BACKEND_REPO]` (default: `../backend`)

---

## Configuración inicial

### 1. Variables de entorno

Copia `.env.template` a `.env.local` y ajusta los valores:

```bash
cp .env.template .env.local
```

| Variable | Descripción | Ejemplo |
|---|---|---|
| `BACKEND_REPO` | Nombre de la carpeta del repositorio hermano | `backend` |
| `API_URL` | URL base de la API para el playground OpenAPI | `http://localhost:3095` |
| `LLM_GATEWAY_API_KEY` | Clave para el gateway de LLM (chat de IA) | — |

### 2. Instalar dependencias

```bash
npm install
```

### 3. Generar symlinks

```bash
npm run setup
```

Lee `../[BACKEND_REPO]/docs/index.json`, compone el árbol y crea los symlinks en `modules/`. Se ejecuta automáticamente antes de `dev` y `build`.

---

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Genera symlinks y arranca el servidor de desarrollo |
| `npm run build` | Genera symlinks y construye para producción |
| `npm run start` | Inicia el servidor de producción en el puerto 4000 |
| `npm run setup` | Solo regenera los symlinks (útil para depurar) |
| `npm run types:check` | Verifica tipos TypeScript |

---

## Añadir contenido al backend

### Estructura de navegación

La navegación se define en `backend/docs/index.json` como un árbol recursivo. Cada módulo puede tener su propio fragmento `nav.json` referenciado desde el raíz (o desde otro fragmento).

**Tipos de nodo:**

| Tipo | Descripción | `content` |
|---|---|---|
| `group` | Carpeta en el sidebar; no cambia la URL de sus hijos | array de nodos o fragmentos |
| `page` | Página MDX | ruta al archivo `.md/.mdx` |
| `api` (auto) | Todos los endpoints del openapi.yaml en su orden | ruta al `openapi.yaml` |
| `api` (manual) | Solo los endpoints listados, en el orden dado | `ref` = openapi.yaml + `content` = árbol de `operationId` |

Una entrada **string** en `content[]` es un fragmento: ruta a un `.json` que se inserta en su lugar. El fragmento puede ser un nodo único o un array de nodos.

En un nodo `page`, `content` es la ruta al archivo `.md`/`.mdx`, relativa al `nav.json` donde se declara la página. Por ejemplo, `"content": "./recorrido/introduccion.md"` apunta a `docs/recorrido/introduccion.md` si el `nav.json` está en `docs/`. El prefijo `./` es opcional, pero hace explícita esta ubicación; no debe confundirse con un string directo de `content[]`, que representa un fragmento JSON. Si un grupo contiene páginas en distintas carpetas, el pipeline conserva esas rutas relativas en el sidebar.

El `title` del nodo `page` en `nav.json` prevalece en el texto de la barra lateral. El título del frontmatter del archivo se conserva para el encabezado y los metadatos propios de la página.

### Agregar una página global

1. Crea `backend/docs/mi-pagina.mdx`
2. Agrégala al `content[]` de la sección correspondiente en `backend/docs/index.json`:
   ```json
   { "type": "page", "title": "Mi Página", "content": "mi-pagina.mdx" }
   ```

### Agregar un nuevo módulo

1. Crea la estructura en el backend:
   ```
   backend/mi-modulo/
   └── docs/
       ├── nav.json
       ├── intro.mdx
       └── api/
           └── openapi.yaml   (opcional)
   ```

2. Crea `backend/mi-modulo/docs/nav.json`:
   ```json
   {
     "type": "group",
     "title": "Mi Módulo",
     "icon": "Box",
     "content": [
       { "type": "page", "title": "Introducción", "content": "intro.mdx" },
       { "type": "api",  "title": "API",          "content": "api/openapi.yaml" }
     ]
   }
   ```

3. Referencia el fragmento desde `backend/docs/index.json`:
   ```json
   {
     "nav": {
       "title": "Docs",
       "sections": [
         {
           "title": "Mi Sección",
           "content": ["../mi-modulo/docs/nav.json"]
         }
       ]
     }
   }
   ```

4. Corre `npm run setup` (o `npm run dev`, que lo hace automáticamente)

Los íconos se escriben en PascalCase de [lucide.dev](https://lucide.dev): `"Box"`, `"Send"`, `"ShoppingCart"`.

### Referencias entre documentos

Usa rutas de archivo relativas al archivo fuente, no URLs absolutas:

```markdown
<!-- ✗ frágil: se rompe si cambia el slug -->
[Ver Compras](/docs/compra/introduccion)

<!-- ✓ estable: el build falla si el archivo no existe -->
[Ver Compras](../compra/docs/introduccion.mdx)
```

Los anchors se conservan: `[Estado](../compra/docs/estatus.mdx#concluida)`.

---

## Gramática del nav

```jsonc
// backend/docs/index.json — punto de entrada, solo compone secciones
{
  "nav": {
    "title": "Doclink",
    "sections": [
      {
        "title": "Fundamentos",
        "content": [
          { "type": "page", "title": "Introducción", "content": "index.mdx" }
        ]
      },
      {
        "title": "Compras y Gastos",
        "content": [
          "../compra/docs/nav.json",
          "../cxp/docs/nav.json"
        ]
      }
    ]
  }
}
```

```jsonc
// backend/compra/docs/nav.json — api en modo auto: expone todos los endpoints
{
  "type": "group",
  "title": "Compras",
  "icon": "ShoppingCart",
  "content": [
    { "type": "page", "title": "Introducción", "content": "introduccion.mdx" },
    { "type": "api",  "title": "API",          "content": "api/openapi.yaml" }
  ]
}
```

```jsonc
// backend/cxp/docs/nav.json — api en modo manual: solo los endpoints listados
{
  "type": "group",
  "title": "Cuentas por Pagar",
  "icon": "CreditCard",
  "content": [
    { "type": "page", "title": "Introducción", "content": "introduccion.mdx" },
    {
      "type": "api",
      "title": "API",
      "ref": "api/openapi.yaml",
      "content": [
        {
          "type": "group",
          "title": "Consultas",
          "content": [
            { "type": "page", "title": "Listar CxP",    "op": "listarCxP" },
            { "type": "page", "title": "Obtener CxP",   "op": "getCxPById" }
          ]
        }
      ]
    }
  ]
}
```

**Reglas:**
- Toda ruta (`content`, `ref`, fragmento) es **relativa al `.json` que la contiene** — el fragmento es portátil
- Una entrada string en `content[]` es siempre un fragmento `.json` (nodos son objetos)
- La URL de cada página se deriva de su ubicación en el backend, elidiendo el segmento `docs/`
  - `compra/docs/introduccion.mdx` → `/docs/compra/introduccion`
- Los `group` solo etiquetan el sidebar; no añaden segmento de URL

---

## Funcionalidades

- **Sidebar dinámico** generado desde `docs/index.json` — sin tocar código de doclink
- **Nav por fragmentos** — cada módulo es dueño de su `nav.json`; el raíz solo los compone
- **Validación de enlaces en build** — un `.mdx` destino inexistente rompe el build con línea y archivo
- **API auto/manual** — auto expone todos los endpoints; manual selecciona y agrupa por `operationId`
- **Playground OpenAPI interactivo** — proxy CORS integrado, URL configurable via `.env`
- **Diagramas Mermaid** — bloques ` ```mermaid ` se renderizan en cliente
- **Cards con íconos** — `<Card icon="NombreLucide" />` en MDX
- **Respuestas JSON formateadas** — pretty-print y truncado a 200 líneas
- **Búsqueda full-text** con FlexSearch
- **Chat de IA** integrado via LLM Gateway

---

## Stack

| Tecnología | Versión |
|---|---|
| Next.js | 16.2.9 |
| fumadocs-ui | 16.10.3 |
| fumadocs-mdx | 15.0.12 |
| fumadocs-openapi | 11.0.2 |
| React | 19 |
| Tailwind CSS | 4 |

---

## Licencia

MIT © Carlos Guardiola
