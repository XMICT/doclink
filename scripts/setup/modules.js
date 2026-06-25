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

// ── Recolección previa para cálculo de anchos de columna ─────────────────────

// Títulos de los nodos que aparecerán en la tabla de módulos (grupos y páginas raíz).
export function collectModuleTitles(tree) {
  return tree.sections.flatMap(s => s.content.filter(n => n.type !== 'api').map(n => n.title));
}

// ids de todos los specs api únicos del árbol (para la tabla OpenAPI).
export function collectApiIds(tree, backendPath) {
  const ids = [];
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

// ── Layout del árbol de navegación ───────────────────────────────────────────
// onModuleSync: callback({ title, id, fileCount, status }) llamado por grupo/página procesada.
// apis: array mutado in-place con los specs api encontrados (se procesan en index.js).

export function makeNavLayout({ backendPath, modulesPath, apis, onModuleSync }) {
  function registerApi(node) {
    const id = apiId(node.spec, backendPath);
    apis.push({ id, title: node.title, spec: node.spec, mode: node.mode, baseDir: `${id}/api`, content: node.content ?? null });
    return id;
  }

  function layoutGroup(group, forceDir = null) {
    const pages = [];
    let groupDir = forceDir;
    let fileCount = 0;

    const setDir = dir => {
      if (groupDir === null) { groupDir = dir; return; }
      if (dir !== groupDir) console.warn(`⚠ grupo "${group.title}": hijos en carpetas distintas (${groupDir} vs ${dir}). v1 soporta grupos co-localados; se usa ${groupDir}.`);
    };

    for (const child of group.content) {
      console.log(child.file);
      if (child.type === 'page') {
        // Si forceDir está set (subgrupo), crear symlink dentro de esa carpeta
        if (forceDir) {
          const { prefix, rest } = splitDocs(child.file, backendPath);
          const target = path.join(modulesPath, forceDir, rest[rest.length - 1]);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (!fs.existsSync(target)) fs.symlinkSync(child.file, target);
          pages.push(stripExt(rest[rest.length - 1]));
          fileCount++;
        } else {
          const { folderRel, name } = symlinkPage(child.file, backendPath, modulesPath);
          setDir(folderRel); pages.push(name); fileCount++;
        }
      } else if (child.type === 'api') {
        setDir(registerApi(child)); pages.push('api');
      } else if (child.type === 'group') {
        // Subgrupo: crear su carpeta DENTRO de la carpeta actual (groupDir)
        const subGroupSlug = child.title.toLowerCase().replace(/\s+/g, '-');
        // groupDir puede estar null si aún no hemos visto páginas; derivarlo del primer hijo del subgrupo
        let parentForSub = groupDir;
        if (parentForSub === null) {
          // Derivar de la primera página del subgrupo
          const firstPage = child.content.find(c => c.type === 'page');
          if (firstPage) {
            const { folderRel } = symlinkPage(firstPage.file, backendPath, modulesPath);
            parentForSub = folderRel;
          }
        }
        const subGroupDir = parentForSub ? `${parentForSub}/${subGroupSlug}` : subGroupSlug;
        layoutGroup(child, subGroupDir);
        setDir(parentForSub || '');
        pages.push(subGroupSlug);
      }
    }

    if (groupDir === null) groupDir = '';
    const metaDir = path.join(modulesPath, groupDir);
    fs.mkdirSync(metaDir, { recursive: true });
    const meta = { title: group.title, pages };
    if (group.icon) meta.icon = group.icon;
    fs.writeFileSync(path.join(metaDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

    onModuleSync({ title: group.title, id: groupDir || group.title, fileCount, status: 'synced' });
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
