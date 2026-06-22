import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
const manifestPath = path.join(cacheDir, '.manifest.json');

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

// ── Cache incremental: fingerprint de las entradas de cada spec ──────────────
// Un spec se re-expande solo si cambió alguna de sus entradas: el propio YAML,
// los modelos Sequelize del backend, o los archivos externos que referencia
// (payloads Joi/AJV vía `schema: "<ruta>"` y `$ref: "./externo.yaml#/..."`).

let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* sin cache previo */ }
const newManifest = {};
const syncResults = []; // { id, status: 'built'|'cached'|'plain'|'failed', ms?, error? }

const sha256 = str => crypto.createHash('sha256').update(str).digest('hex');
const hashFileSafe = abs => { try { return sha256(fs.readFileSync(abs)); } catch { return 'missing'; } };

// Hash de todos los modelos del backend (cualquier marcador puede introspectarlos,
// y las asociaciones arrastran modelos vecinos → se hashean todos). Se calcula una vez.
let _modelsHash;
function modelsFingerprint() {
  if (_modelsHash !== undefined) return _modelsHash;
  const modelsDir = path.join(backendPath, 'models');
  if (!fs.existsSync(modelsDir)) return (_modelsHash = 'no-models');
  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.js') && !f.includes('.test.'))
    .sort();
  _modelsHash = sha256(files.map(f => `${f}:${hashFileSafe(path.join(modelsDir, f))}`).join('|'));
  return _modelsHash;
}

// Recolecta los archivos externos de los que depende un spec, resueltos igual que
// el expander (relativos a openapiDir).
// ponytail: solo un nivel de $ref externo; si aparecen refs transitivos, recursar aquí.
function collectSpecDeps(node, openapiDir, acc = new Set()) {
  if (Array.isArray(node)) { node.forEach(n => collectSpecDeps(n, openapiDir, acc)); return acc; }
  if (!node || typeof node !== 'object') return acc;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'schema' && typeof v === 'string') acc.add(path.resolve(openapiDir, v));
    else if (k === '$ref' && typeof v === 'string' && !v.startsWith('#')) acc.add(path.resolve(openapiDir, v.split('#')[0]));
    else collectSpecDeps(v, openapiDir, acc);
  }
  return acc;
}

function specFingerprint(specRaw, openapiDir, spec) {
  const deps = [...collectSpecDeps(spec, openapiDir)].sort();
  const depHash = deps.map(d => `${path.basename(d)}:${hashFileSafe(d)}`).join('|');
  return sha256(`${specRaw}::${modelsFingerprint()}::${depHash}`);
}

// ── OpenAPI: expansión de marcadores al cache ────────────────────────────────

const processedSpecs = new Set();

function processOpenApi(specPath) {
  if (processedSpecs.has(specPath)) return;
  processedSpecs.add(specPath);

  const id = apiId(specPath);
  const openapiDir = path.dirname(specPath);
  const specRaw = fs.readFileSync(specPath, 'utf-8');
  const spec = yaml.load(specRaw);

  if (!detectExtensions(spec)) {
    syncResults.push({ id, status: 'plain' });
    return;
  }

  const outPath = path.join(cacheDir, `${id}.yaml`);
  const fingerprint = specFingerprint(specRaw, openapiDir, spec);

  if (manifest[id] === fingerprint && fs.existsSync(outPath)) {
    newManifest[id] = fingerprint;
    syncResults.push({ id, status: 'cached' });
    return;
  }

  const started = Date.now();
  try {
    const expanded = expandSpec(spec, backendPath, openapiDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(outPath, yaml.dump(expanded, { noRefs: true }));
    newManifest[id] = fingerprint;
    syncResults.push({ id, status: 'built', ms: Date.now() - started });
  } catch (err) {
    syncResults.push({ id, status: 'failed', error: err.message });
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

// ── Poda: cache y manifest de specs que ya no existen (módulos eliminados) ────
let pruned = 0;
const known = new Set(Object.keys(newManifest));
for (const f of fs.readdirSync(cacheDir)) {
  if (!f.endsWith('.yaml')) continue;
  const id = f.replace(/\.yaml$/, '');
  if (!known.has(id)) { fs.rmSync(path.join(cacheDir, f)); pruned++; }
}
fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2) + '\n');

renderSyncReport(syncResults, pruned);

// ── Reporte visual de sincronización OpenAPI ─────────────────────────────────

function renderSyncReport(results, prunedCount) {
  if (!results.length && !prunedCount) return;

  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const palette = {
    reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  };
  const c = useColor ? palette : Object.fromEntries(Object.keys(palette).map(k => [k, '']));

  const meta = {
    built:  { icon: '✓', label: 'reconstruido',   color: c.green },
    cached: { icon: '↻', label: 'en caché',       color: c.cyan },
    plain:  { icon: '○', label: 'sin marcadores', color: c.gray },
    failed: { icon: '✗', label: 'error',          color: c.red },
  };

  const idW = Math.max(8, ...results.map(r => r.id.length));
  const rule = c.dim + '─'.repeat(idW + 34) + c.reset;

  console.log('');
  console.log(`  ${c.bold}doclink${c.reset} ${c.dim}· sincronización OpenAPI${c.reset}`);
  console.log('  ' + rule);
  for (const r of results) {
    const m = meta[r.status];
    const id = r.id.padEnd(idW);
    const label = m.label.padEnd(15);
    let tail = '';
    if (r.status === 'built')      tail = `${(r.ms / 1000).toFixed(1)}s`;
    else if (r.status === 'cached') tail = 'sin cambios';
    else if (r.status === 'failed') tail = r.error;
    console.log(`  ${m.color}${m.icon}${c.reset}  ${c.bold}${id}${c.reset}  ${m.color}${label}${c.reset}${c.dim}${tail}${c.reset}`);
  }
  console.log('  ' + rule);

  const n = s => results.filter(r => r.status === s).length;
  const totalMs = results.reduce((a, r) => a + (r.ms ?? 0), 0);
  const segs = [
    `${results.length} módulos`,
    n('built')  && `${c.green}${n('built')} reconstruido${c.reset}`,
    n('cached') && `${c.cyan}${n('cached')} en caché${c.reset}`,
    n('plain')  && `${c.gray}${n('plain')} sin marcadores${c.reset}`,
    n('failed') && `${c.red}${n('failed')} con error${c.reset}`,
    prunedCount && `${c.yellow}${prunedCount} podado${c.reset}`,
  ].filter(Boolean);
  console.log(`  ${c.dim}${segs.join(`${c.reset}${c.dim} · `)} · ${(totalMs / 1000).toFixed(1)}s${c.reset}`);
  console.log('');
}
