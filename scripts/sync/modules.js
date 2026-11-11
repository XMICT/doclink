import fs from 'fs';
import path from 'path';

// ── Helpers de rutas ──────────────────────────────────────────────────────────

// Divide una ruta absoluta en { prefix, rest } alrededor del segmento `docs`.
// backend/compra/docs/introduccion.mdx → prefix ['compra'], rest ['introduccion.mdx'].
function splitDocs(absFile, backendPath) {
  const rel   = path.relative(backendPath, absFile);
  const parts = rel.split(path.sep);
  const i     = parts.indexOf('docs');
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
  const rel = path.join(...prefix, ...rest.slice(0, -1));
  return { folderRel: rel === '.' ? '' : rel, name: stripExt(rest[rest.length - 1]) };
}

// id de módulo de un spec OpenAPI: backend/compra/docs/api/openapi.yaml → 'compra'.
export function apiId(specPath, backendPath) {
  return splitDocs(specPath, backendPath).prefix.join('/');
}

// ── Recolección previa para cálculo de anchos de columna ─────────────────────

export function collectModuleTitles(tree) {
  return tree.sections.flatMap(s => s.content.filter(n => n.type !== 'api').map(n => n.title));
}

export function collectApiIds(tree, backendPath) {
  const ids  = [];
  const seen = new Set();

  function walk(node) {
    if (node.type === 'api') {
      const id = apiId(node.spec, backendPath);
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  }

  tree.sections.forEach(s => s.content.forEach(walk));
  return ids;
}

export function collectPageTitles(tree, backendPath) {
  const titles = {};

  function walk(node) {
    if (node.type === 'page' && node.file) {
      const { prefix, rest } = splitDocs(node.file, backendPath);
      const filePath = path.posix.join(...prefix, ...rest).replace(/\.mdx?$/, '');
      titles[filePath] = node.title;
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  }

  tree.sections.forEach(section => section.content.forEach(walk));
  return titles;
}

// ── Layout del árbol de navegación ───────────────────────────────────────────

export function makeNavLayout({ backendPath, modulesPath, apis, onModuleSync }) {

  // Deriva la carpeta padre de un archivo sin crear el symlink.
  function folderRelOf(file) {
    const { prefix, rest } = splitDocs(file, backendPath);
    const rel = path.join(...prefix, ...rest.slice(0, -1));
    return rel === '.' ? '' : rel;
  }

  function registerApi(node) {
    const id = apiId(node.spec, backendPath);
    apis.push({ id, title: node.title, spec: node.spec, mode: node.mode, baseDir: `${id}/api`, content: node.content ?? null });
    return id;
  }

  function layoutGroup(group, forceDir = null) {
    const { title, icon, content } = group;
    const pages = [];
    let groupDir = forceDir;
    let fileCount = 0;

    const setDir = dir => {
      if (groupDir === null) groupDir = dir;
    };

    for (const child of content) {
      if (child.type === 'page') {
        const { folderRel, name } = symlinkPage(child.file, backendPath, modulesPath);
        setDir(folderRel);
        const logical = folderRel ? `${folderRel}/${name}` : name;
        pages.push(path.relative(groupDir, logical));
        fileCount++;
      } else if (child.type === 'api') {
        const id = registerApi(child);
        setDir(id);
        pages.push(path.relative(groupDir, `${id}/api`));
      } else if (child.type === 'group') {
        const subGroupSlug = child.title.toLowerCase().replace(/\s+/g, '-');
        // groupDir puede ser null si el grupo aún no procesó ninguna página propia.
        const firstPage = groupDir === null ? child.content.find(c => c.type === 'page') : null;
        const parentDir = groupDir ?? (firstPage ? folderRelOf(firstPage.file) : null);
        const subGroupDir = parentDir ? `${parentDir}/${subGroupSlug}` : subGroupSlug;
        layoutGroup(child, subGroupDir);
        setDir(parentDir ?? '');
        pages.push(subGroupSlug);
      }
    }

    if (groupDir === null) groupDir = '';
    const metaDir = path.join(modulesPath, groupDir);
    fs.mkdirSync(metaDir, { recursive: true });
    const meta = { title, pages, ...(icon ? { icon } : {}) };
    fs.writeFileSync(path.join(metaDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

    onModuleSync({ title, id: groupDir || title, fileCount, status: 'synced' });
    return groupDir;
  }

  function layoutNode(node) {
    switch (node.type) {
      case 'page': {
        const { folderRel, name } = symlinkPage(node.file, backendPath, modulesPath);
        onModuleSync({ title: node.title, id: name, fileCount: 1, status: 'synced' });
        return folderRel ? `${folderRel}/${name}` : name;
      }
      case 'group': return layoutGroup(node);
      case 'api':   return `${registerApi(node)}/api`;
      default: throw new Error(`Nodo de nivel superior no soportado: ${node.type}`);
    }
  }

  return { layoutNode };
}
