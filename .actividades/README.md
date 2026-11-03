# .actividades

Registro de las actividades del proyecto en forma de grafo.

| Archivo | Contenido |
|---|---|
| `grafo.json` | Fuente de verdad: nodos (actividades y épicas) y aristas (relaciones) |
| `schema.json` | JSON Schema del grafo; da autocompletado y validación en el editor |
| `docs/` | Análisis o notas largas, enlazadas desde el campo `docs` de cada nodo |

## Validar y consultar

```bash
npm run actividades              # valida el grafo y muestra el árbol de lo que no está liberado
npm run actividades -- --todas   # incluye también lo liberado o descartado
npm run actividades -- --github  # compara el estado de cada PR con GitHub (requiere gh)
```

El script (`scripts/actividades/index.js`) revisa tres cosas:

- **Errores** (termina con código 1): campos, enums y formatos contra `schema.json`, IDs duplicados, aristas rotas y commits que no existen.
- **Avisos de coherencia y de git:** actividades sin épica, en revisión sin PR, liberadas con commits que no están en `main`, o en release cuyos commits ya llegaron a `main`.
- **Avisos de GitHub** (con `--github`): estados que no coinciden con su PR y PRs sin actividad registrada.

## Nodos

- `DL-xxx`: una actividad (un fix, feat, refact…). El ID nunca se reutiliza.
- `EP-xx`: una épica que agrupa actividades.

Ciclo de `estado`, siguiendo el flujo de ramas `dev → release → main`:

```
pendiente → en-curso → en-revision → en-release → liberada
                                   ↘ descartada
```

## Aristas

Dirigidas `de → a`:

| `tipo` | Significado |
|---|---|
| `parte-de` | La actividad pertenece a la épica |
| `depende-de` | Necesita que `a` exista primero |
| `corrige` | Arregla un defecto introducido por `a` |
| `reemplaza` | Deja obsoleto a `a` |
| `relacionada` | Comparten contexto, sin dependencia |

## Convención con git

El ID conecta la actividad con su rama y sus commits, usando el formato con ticket de `COMMIT_STYLE.md`. La rama se llama solo con el folio (sin prefijo de tipo ni slug) y se crea a partir de `origin/release`; el tipo de la actividad ya queda en el título del commit y en el campo `tipo` del nodo:

```
rama:    DL-023
commit:  DL-023 Escenario desde la perspectiva del usuario
         - fix(scope) Se soluciona …
```

El campo `rama` del nodo lleva el folio. Las actividades anteriores a esta convención conservan el nombre que tuvo su rama.
