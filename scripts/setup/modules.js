import fs from 'fs';
import path from 'path';

// ── Helpers de rutas ──────────────────────────────────────────────────────────

// Divide una ruta absoluta de archivo en { prefix, rest } alrededor del segmento `docs`.
// backend/compra/docs/introduccion.mdx → prefix ['compra'], rest ['introduccion.mdx'].
function splitDocs(absFile, backendPath) {
  const rel = path.relative(backendPath, absFile);
  const parts = rel.split(path.sep);
  const i = parts.indexOf('docs');
  if (i === -1) throw new Error(`Ruta de contenido sin carpeta docs/: ${rel}`);
  return { prefix: parts.slice(0, i), rest: parts.slice(i + 1) };
}

const stripExt = name => name.replace(/\.mdx?$/, '');

// Crea el symlink de una página en modules/ calcando su ubicación de archivo.
export function symlinkPage(absFile, backendPath, modulesPath) {
  const { prefix, rest } = splitDocs(absFile, backendPath);
  const target = path.join(modulesPath, ...prefix, ...rest);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.symlinkSync(absFile, target);
  const folderRel = path.join(...prefix, ...rest.slice(0, -1)) || '';
  return { folderRel: folderRel === '.' ? '' : folderRel, name: stripExt(rest[rest.length - 1]) };
}

// id de módulo de un spec OpenAPI: backend/compra/docs/api/openapi.yaml → 'compra'.
export function apiId(specPath, backendPath) {
  return splitDocs(specPath, backendPath).prefix.join('/');
}

export function separatorOf(node) {
  return node.icon ? `---[${node.icon}]${node.title}---` : `---${node.title}---`;
}

// ── Layout del árbol de navegación ───────────────────────────────────────────
// processOpenApi y apis se inyectan para evitar dependencia circular con index.js.

export function makeNavLayout({ backendPath, modulesPath, processOpenApi, apis }) {
  function registerApi(node) {
    const id = apiId(node.spec, backendPath);
    apis.push({ id, title: node.title, spec: node.spec, mode: node.mode, baseDir: `${id}/api`, content: node.content ?? null });
    processOpenApi(node.spec);
    return id;
  }

  function layoutGroup(group) {
    const pages = [];
    let groupDir = null;

    const setDir = dir => {
      if (groupDir === null) { groupDir = dir; return; }
      if (groupDir !== dir) console.warn(`⚠ grupo "${group.title}": hijos en carpetas distintas (${groupDir} vs ${dir}). v1 soporta grupos co-localados; se usa ${groupDir}.`);
    };

    for (const child of group.content) {
      if (child.type === 'page') {
        const { folderRel, name } = symlinkPage(child.file, backendPath, modulesPath);
        setDir(folderRel); pages.push(name);
      } else if (child.type === 'api') {
        setDir(registerApi(child)); pages.push('api');
      } else if (child.type === 'group') {
        pages.push(separatorOf(child));
        for (const sub of child.content) {
          if (sub.type === 'page') {
            const { folderRel, name } = symlinkPage(sub.file, backendPath, modulesPath);
            setDir(folderRel); pages.push(name);
          } else if (sub.type === 'api') {
            registerApi(sub); pages.push('api');
          }
        }
      }
    }

    if (groupDir === null) groupDir = '';
    const metaDir = path.join(modulesPath, groupDir);
    fs.mkdirSync(metaDir, { recursive: true });
    const meta = { title: group.title, pages };
    if (group.icon) meta.icon = group.icon;
    fs.writeFileSync(path.join(metaDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    return groupDir;
  }

  function layoutNode(node) {
    switch (node.type) {
      case 'page': {
        const { folderRel, name } = symlinkPage(node.file, backendPath, modulesPath);
        return folderRel ? `${folderRel}/${name}` : name;
      }
      case 'group': return layoutGroup(node);
      case 'api':   return `${registerApi(node)}/api`;
      default: throw new Error(`Nodo de nivel superior no soportado: ${node.type}`);
    }
  }

  return { layoutNode };
}
