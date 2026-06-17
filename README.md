# doclink

Este repositorio es el encargado de renderizar y presentar la documentación técnica del proyecto. Construido con [Fumadocs](https://fumadocs.dev) sobre Next.js.

**doclink es un renderizador puro**: no tiene contenido propio. Todo el MDX, YAML y configuración de navegación vive en un repositorio hermano (el backend). doclink solo lee, enlaza y presenta ese contenido.

---

## Arquitectura

```
../
├── backend/                 ← fuente de verdad del contenido
│   ├── docs.json            ← define secciones y módulos
│   ├── docs/                ← páginas globales
│   │   ├── meta.json
│   │   └── index.mdx
│   └── [modulo]/
│       └── docs/
│           ├── meta.json
│           ├── *.mdx
│           └── api/
│               └── openapi.yaml
│
└── doclink/                 ← este repositorio
    ├── modules/             ← generado por setup.js (gitignored)
    │   ├── meta.json        ← generado
    │   ├── [seccion]/       ← symlink → ../backend/docs/
    │   └── [modulo]/        ← symlink → ../backend/[modulo]/docs/
    └── scripts/
        └── setup.js         ← crea los symlinks y el meta.json raíz
```

`modules/` está en `.gitignore`. Se regenera automáticamente antes de cada `dev` y `build`.

---

## Requisitos

- Node.js 18+
- El repositorio con el contenido debe estar en una carpeta hermana (por defecto `../backend`)

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

Lee `../[BACKEND_REPO]/docs.json` y crea los symlinks en `modules/`. Se ejecuta automáticamente antes de `dev` y `build`.

---

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Genera symlinks y arranca el servidor de desarrollo |
| `npm run build` | Genera symlinks y construye para producción |
| `npm run start` | Inicia el servidor de producción en el puerto 4000 |
| `npm run setup` | Solo genera los symlinks (útil para depurar) |
| `npm run types:check` | Verifica tipos TypeScript |

---

## Añadir contenido al backend

### Agregar una página global

Las páginas que no pertenecen a ningún módulo van en `backend/docs/`:

1. Crea el archivo `backend/docs/mi-pagina.mdx`
2. Agrégalo a `backend/docs/meta.json` en el array `pages`

### Agregar un nuevo módulo

1. Crea la estructura en el backend:
   ```
   backend/mi-modulo/
   └── docs/
       ├── meta.json
       ├── intro.mdx
       └── api/
           └── openapi.yaml   (opcional)
   ```
2. Registra el módulo en `backend/docs.json`:
   ```json
   {
     "sections": [
       {
         "id": "mi-seccion",
         "title": "Mi Sección",
         "modules": [
           { "id": "mi-modulo", "title": "Mi Módulo", "icon": "Box" }
         ]
       }
     ]
   }
   ```
3. Corre `npm run setup` (o simplemente `npm run dev`, que lo hace automáticamente)

El ícono se resuelve directamente como nombre PascalCase de [lucide.dev](https://lucide.dev), por ejemplo `"Box"`, `"Send"`, `"ClipboardList"`.

---

## Estructura de `docs.json`

```json
{
  "title": "Docs",
  "sections": [
    {
      "id": "fundamentos",
      "title": "Fundamentos",
      "dir": "docs"
    },
    {
      "id": "mi-seccion",
      "title": "Mi Sección",
      "modules": [
        { "id": "mi-modulo", "title": "Mi Módulo", "icon": "Box" }
      ]
    }
  ]
}
```

- **`dir`**: apunta a un directorio del backend con páginas MDX planas. Las páginas aparecen directamente bajo la sección en el sidebar.
- **`modules`**: lista de módulos con su propio `docs/` en el backend. Cada módulo puede tener páginas MDX y un spec OpenAPI.

---

## Funcionalidades

- **Sidebar dinámico** generado desde `docs.json` — sin tocar código de doclink
- **Diagramas Mermaid** — bloques ` ```mermaid ` se renderizan automáticamente
- **Cards con íconos** — componente `<Card icon="NombreLucide" />` en MDX
- **Playground OpenAPI interactivo** — con proxy CORS integrado y URL configurable via `.env`
- **Respuestas JSON formateadas** — pretty-print automático y truncado a 200 líneas
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