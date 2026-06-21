# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Genera symlinks y arranca el servidor en http://localhost:3000
npm run build        # Genera symlinks y construye para producción
npm run start        # Inicia el servidor de producción en el puerto 4000
npm run setup        # Solo regenera los symlinks y meta.json (sin servidor)
npm run types:check  # Verifica tipos TypeScript (fumadocs-mdx + next typegen + tsc)
```

No hay suite de tests en este repositorio.

## Architecture

**doclink es un renderizador puro**: no tiene contenido propio. Todo el MDX, YAML y configuración de navegación vive en un repositorio hermano (`../backend` por defecto, configurable via `BACKEND_REPO`). doclink solo lee, enlaza y presenta ese contenido.

### Flujo de arranque

1. `scripts/setup.js` lee `../[BACKEND_REPO]/docs.json` y crea symlinks en `modules/` apuntando a los directorios de docs del backend.
2. `modules/` está en `.gitignore` y se regenera en cada `dev`/`build`.
3. `source.config.ts` define la colección Fumadocs MDX apuntando a `modules/`.
4. `lib/source.ts` es el hub central: inicializa el `loader` de Fumadocs combinando las páginas MDX con páginas virtuales OpenAPI, y exporta `getPageImage`, `getPageMarkdownUrl` y `getLLMText`.
5. `lib/openapi.ts` lee los archivos `openapi.yaml` de cada módulo del backend usando `fumadocs-openapi`.

### Symlinks y webpack

`next.config.mjs` establece `config.resolve.symlinks = true` y `outputFileTracingRoot` al directorio padre del repo. Esto es imprescindible para que webpack resuelva los symlinks de `modules/` hacia el backend hermano.

### Marcadores OpenAPI custom (`scripts/openapi-expander.js`)

`setup.js` llama a `openapi-expander.js` para expandir los YAML de cada módulo. El expander resuelve tres marcadores que reutilizan los modelos Sequelize y payloads Joi/AJV del backend:

- `parameters: [{ model, fields, exclude, in? }]` — inyecta parámetros query/path desde un modelo Sequelize.
- `schema: { type: model, model, include, exclude }` — genera un schema inline introspectando el modelo.
- `requestBody: { schema: "<ruta>" }` — carga y convierte un payload Joi o AJV del backend.
- `type: catalog` — expande un campo enum declarado en `x-enums`.

El expander ejecuta scripts Node directamente en el contexto del backend via `execSync`.

### Capas arquitectónicas

| Capa | Archivos |
|---|---|
| **UI** | `app/(home)/`, `app/docs/layout.tsx`, `app/layout.tsx`, `app/global.css`, `app/not-found.tsx` |
| **API / Rutas** | `app/api/`, `app/og/`, `app/llms*/`, `app/docs/[[...slug]]/page.tsx` |
| **Componentes** | `components/` — AI search panel, MDX registry, Mermaid, OpenAPI playground |
| **Servicios** | `lib/` — fuente Fumadocs, config OpenAPI, constantes, layout options, proxy |
| **Build** | `scripts/`, `next.config.mjs`, `source.config.ts`, `postcss.config.mjs` |

### Proxy y negociación de contenido (`proxy.ts`)

`proxy.ts` exporta una función (no un `middleware.ts` estándar) que se usa como middleware de Next.js. Redirige rutas con sufijo `.md` al endpoint `/llms.mdx/docs/...` y, si el cliente prefiere Markdown (`Accept: text/markdown`), reescribe la ruta a su equivalente MDX.

### Chat con IA (`app/api/chat/route.ts` + `components/ai/search.tsx`)

El endpoint POST `/api/chat` busca páginas relevantes usando `getLLMText` de `lib/source.ts` y hace streaming de la respuesta via `@llmgateway/ai-sdk-provider`. Requiere `LLM_GATEWAY_API_KEY` en `.env.local`.

## Environment

Copiar `.env.template` a `.env.local`:

| Variable | Descripción |
|---|---|
| `BACKEND_REPO` | Nombre de la carpeta hermana con el contenido (default: `backend`) |
| `API_URL` | URL base para el playground OpenAPI interactivo |
| `LLM_GATEWAY_API_KEY` | Clave para el gateway LLM del chat de IA |

El backend debe existir en `../<BACKEND_REPO>/` con un `docs.json` en su raíz.
