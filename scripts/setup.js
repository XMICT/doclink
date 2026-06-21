import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { detectExtensions, expandSpec } from './openapi-expander.js';
import { resolveNav } from './nav-resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      })
  );
}

const env = loadEnvLocal();
const backendRepo = env.BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
const backendPath = path.resolve(rootDir, '..', backendRepo);
const modulesPath = path.join(rootDir, 'modules');
const cacheDir = path.join(rootDir, '.openapi-cache');

if (!fs.existsSync(backendPath)) {
  console.error(`Error: backend repo not found at ${backendPath}`);
  process.exit(1);
}

// ── Helpers de layout ────────────────────────────────────────────────────────

// Divide una ruta absoluta de archivo en { prefix, rest } alrededor del segmento
// `docs`. backend/compra/docs/introduccion.mdx → prefix ['compra'], rest ['introduccion.mdx'].
// backend/docs/index.mdx → prefix [], rest ['index.mdx'].
function splitDocs(absFile) {
  const rel = path.relative(backendPath, absFile);
  const parts = rel.split(path.sep);
  const i = parts.indexOf('docs');
  if (i === -1) {
    throw new Error(`Ruta de contenido sin carpeta docs/: ${rel}`);
  }
  return { prefix: parts.slice(0, i), rest: parts.slice(i + 1) };
}

const stripExt = name => name.replace(/\.mdx?$/, '');

// Crea el symlink de una página en modules/ calcando su ubicación de archivo.
// Devuelve { folderRel, name }: carpeta (relativa a modules/) y nombre de slug.
function symlinkPage(absFile) {
  const { prefix, rest } = splitDocs(absFile);
  const targetParts = [...prefix, ...rest];
  const target = path.join(modulesPath, ...targetParts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.symlinkSync(absFile, target);

  const folderRel = path.join(...prefix, ...rest.slice(0, -1)) || '';
  return { folderRel: folderRel === '.' ? '' : folderRel, name: stripExt(rest[rest.length - 1]) };
}

// id de módulo de un spec OpenAPI: backend/compra/docs/api/openapi.yaml → 'compra'.
function apiId(specPath) {
  return splitDocs(specPath).prefix.join('/');
}

// ── OpenAPI: expansión de marcadores al cache ────────────────────────────────

const processedSpecs = new Set();

function processOpenApi(specPath) {
  if (processedSpecs.has(specPath)) return;
  processedSpecs.add(specPath);

  const id = apiId(specPath);
  const openapiDir = path.dirname(specPath);
  const spec = yaml.load(fs.readFileSync(specPath, 'utf-8'));
  if (!detectExtensions(spec)) return;

  try {
    const expanded = expandSpec(spec, backendPath, openapiDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `${id}.yaml`), yaml.dump(expanded, { noRefs: true }));
    console.log(`✓ openapi expandido: ${id}`);
  } catch (err) {
    console.error(`✗ Error expandiendo openapi de ${id}:`, err.message);
  }
}

// ── Recorrido del árbol → symlinks + meta.json ───────────────────────────────

const apis = []; // { id, spec, mode, baseDir, content } para el runtime

function separatorOf(node) {
  return node.icon ? `---[${node.icon}]${node.title}---` : `---${node.title}---`;
}

function registerApi(node) {
  const id = apiId(node.spec);
  apis.push({
    id,
    title: node.title,
    spec: node.spec,
    mode: node.mode,
    baseDir: `${id}/api`,
    content: node.content ?? null,
  });
  processOpenApi(node.spec);
  return id;
}

// Coloca un grupo como carpeta en modules/ (calcando la ubicación de sus hijos)
// y escribe su meta.json. Devuelve la ref (carpeta relativa a modules/) para el padre.
function layoutGroup(group) {
  const pages = [];
  let groupDir = null;

  const setDir = dir => {
    if (groupDir === null) groupDir = dir;
    else if (groupDir !== dir) {
      console.warn(
        `⚠ grupo "${group.title}": hijos en carpetas distintas (${groupDir} vs ${dir}). ` +
        `v1 soporta grupos co-localados; se usa ${groupDir}.`
      );
    }
  };

  for (const child of group.content) {
    if (child.type === 'page') {
      const { folderRel, name } = symlinkPage(child.file);
      setDir(folderRel);
      pages.push(name);
    } else if (child.type === 'api') {
      const id = registerApi(child);
      setDir(id);
      pages.push('api');
    } else if (child.type === 'group') {
      // Subgrupo dentro de un grupo co-localado: separador + páginas planas.
      pages.push(separatorOf(child));
      for (const sub of child.content) {
        if (sub.type === 'page') {
          const { folderRel, name } = symlinkPage(sub.file);
          setDir(folderRel);
          pages.push(name);
        } else if (sub.type === 'api') {
          registerApi(sub);
          pages.push('api');
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

// Coloca un nodo de nivel superior (dentro de una sección) y devuelve su ref.
function layoutNode(node) {
  switch (node.type) {
    case 'page': {
      const { folderRel, name } = symlinkPage(node.file);
      return folderRel ? `${folderRel}/${name}` : name;
    }
    case 'group':
      return layoutGroup(node);
    case 'api': {
      const id = registerApi(node);
      return `${id}/api`;
    }
    default:
      throw new Error(`Nodo de nivel superior no soportado: ${node.type}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

fs.rmSync(modulesPath, { recursive: true, force: true });
fs.mkdirSync(modulesPath, { recursive: true });

const tree = resolveNav(backendPath);

const rootPages = [];
for (const section of tree.sections) {
  rootPages.push(separatorOf(section));
  for (const node of section.content) {
    rootPages.push(layoutNode(node));
  }
}

fs.writeFileSync(
  path.join(modulesPath, 'meta.json'),
  JSON.stringify({ pages: rootPages }, null, 2) + '\n'
);
console.log('✓ modules/meta.json generado');

fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(
  path.join(cacheDir, 'nav.json'),
  JSON.stringify({ apis }, null, 2) + '\n'
);
console.log(`✓ .openapi-cache/nav.json generado (${apis.length} nodos api)`);
