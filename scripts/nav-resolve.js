import fs from 'fs';
import path from 'path';

/**
 * Compone el árbol de navegación a partir de `backend/docs/index.json`.
 *
 * - Una entrada string dentro de un `content[]` es una referencia a otro `.json`
 *   (fragmento): se carga e inserta en lugar. El fragmento puede ser un nodo
 *   único o un array de nodos. La inclusión es recursiva, con corte de ciclos.
 * - Regla de rutas: toda ruta (`content`, `ref`, fragmento) es relativa al
 *   archivo `.json` que la contiene. La salida normaliza cada ruta a una ruta
 *   absoluta del backend.
 *
 * Tipos de nodo resueltos:
 *  - group: { type:'group', title, icon?, content: Node[] }
 *  - page:  { type:'page',  title, icon?, file: <abs> }            (página de prosa)
 *           { type:'page',  title, icon?, op:   <operationId> }    (dentro de un api manual)
 *  - api:   { type:'api', title, icon?, mode:'auto',   spec: <abs> }
 *           { type:'api', title, icon?, mode:'manual', spec: <abs>, content: Node[] }
 */

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function processNode(node, baseDir, inApi, stack) {
  if (!node || typeof node !== 'object') {
    throw new Error(`Nodo de navegación inválido en ${baseDir}: ${JSON.stringify(node)}`);
  }

  const out = { type: node.type, title: node.title };
  if (node.icon) out.icon = node.icon;

  switch (node.type) {
    case 'page': {
      if (typeof node.content !== 'string') {
        throw new Error(`page "${node.title}" requiere content string (archivo u operationId)`);
      }
      if (inApi) {
        out.op = node.content; // operationId, no es ruta
      } else {
        out.file = path.resolve(baseDir, node.content);
        if (!fs.existsSync(out.file)) {
          throw new Error(`page "${node.title}" → archivo no encontrado: ${out.file}`);
        }
      }
      return out;
    }

    case 'group': {
      out.content = processContent(node.content, baseDir, inApi, stack);
      return out;
    }

    case 'api': {
      if (typeof node.content === 'string') {
        // Modo auto: content = ruta al openapi.yaml
        out.mode = 'auto';
        out.spec = path.resolve(baseDir, node.content);
      } else {
        // Modo manual: ref = openapi.yaml, content = árbol de operationId
        if (typeof node.ref !== 'string' || !Array.isArray(node.content)) {
          throw new Error(`api manual "${node.title}" requiere ref (string) y content (array)`);
        }
        out.mode = 'manual';
        out.spec = path.resolve(baseDir, node.ref);
        out.content = processContent(node.content, baseDir, true, stack);
      }
      if (!fs.existsSync(out.spec)) {
        throw new Error(`api "${node.title}" → spec no encontrado: ${out.spec}`);
      }
      return out;
    }

    default:
      throw new Error(`Tipo de nodo desconocido: "${node.type}" (en ${baseDir})`);
  }
}

function processContent(content, baseDir, inApi, stack) {
  if (!Array.isArray(content)) {
    throw new Error(`content debe ser un array (en ${baseDir})`);
  }

  const result = [];
  for (const item of content) {
    if (typeof item === 'string') {
      // Fragmento: ruta a otro .json, relativa al archivo actual
      const fragPath = path.resolve(baseDir, item);
      if (stack.includes(fragPath)) {
        throw new Error(`Ciclo de fragmentos detectado: ${[...stack, fragPath].join(' → ')}`);
      }
      if (!fs.existsSync(fragPath)) {
        throw new Error(`Fragmento no encontrado: ${fragPath}`);
      }
      const fragment = readJson(fragPath);
      const fragBase = path.dirname(fragPath);
      const nodes = Array.isArray(fragment) ? fragment : [fragment];
      const nextStack = [...stack, fragPath];
      for (const node of nodes) {
        result.push(processNode(node, fragBase, inApi, nextStack));
      }
    } else {
      result.push(processNode(item, baseDir, inApi, stack));
    }
  }
  return result;
}

/**
 * @param {string} backendPath ruta absoluta al repo hermano (backend)
 * @returns {{ title: string, sections: Array }}
 */
export function resolveNav(backendPath) {
  const indexPath = path.join(backendPath, 'docs', 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`No se encontró el archivo de navegación: ${indexPath}`);
  }

  const root = readJson(indexPath);
  const nav = root.nav ?? root;
  if (!Array.isArray(nav.sections)) {
    throw new Error(`index.json debe tener nav.sections (array)`);
  }

  const baseDir = path.dirname(indexPath);
  const sections = nav.sections.map(section => {
    const out = { title: section.title };
    if (section.icon) out.icon = section.icon;
    out.content = processContent(section.content ?? [], baseDir, false, [indexPath]);
    return out;
  });

  return { title: nav.title ?? 'Docs', sections };
}
