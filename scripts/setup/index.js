import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { detectExtensions, expandSpec } from '../openapi-expander.js';
import { resolveNav } from '../nav-resolve.js';
import { specFingerprint, loadManifest, saveManifest, pruneCache } from './cache.js';
import { apiId, separatorOf, collectModuleTitles, collectApiIds, makeNavLayout } from './modules.js';
import { createReporter } from './report.js';

// ── Configuración ─────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

function loadEnvLocal() {
  const envPath = path.join(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

const env = loadEnvLocal();
const backendRepo = env.BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
const backendPath = path.resolve(rootDir, '..', backendRepo);
const modulesPath = path.join(rootDir, 'modules');
const cacheDir    = path.join(rootDir, '.openapi-cache');
const manifestPath = path.join(cacheDir, '.manifest.json');

if (!fs.existsSync(backendPath)) {
  console.error(`Error: backend repo not found at ${backendPath}`);
  process.exit(1);
}

// ── Estado del proceso ────────────────────────────────────────────────────────

const apis = [];
const processedSpecs = new Set();
const manifest = loadManifest(manifestPath);
const newManifest = {};

// ── Árbol de navegación + reporter ───────────────────────────────────────────

fs.rmSync(modulesPath, { recursive: true, force: true });
fs.mkdirSync(modulesPath, { recursive: true });

const tree = resolveNav(backendPath);
const reporter = createReporter(collectModuleTitles(tree), collectApiIds(tree, backendPath));

// ── Fase 1: sincronización de archivos ────────────────────────────────────────
// Crea symlinks y meta.json por módulo. Los specs OpenAPI se registran en apis[]
// pero no se procesan aún — eso ocurre en la fase 2.

reporter.startModulesTable();

const { layoutNode } = makeNavLayout({
  backendPath, modulesPath, apis,
  onModuleSync: result => reporter.moduleDone(result),
});

const rootPages = [];
for (const section of tree.sections) {
  rootPages.push(separatorOf(section));
  for (const node of section.content) rootPages.push(layoutNode(node));
}

fs.writeFileSync(path.join(modulesPath, 'meta.json'), JSON.stringify({ pages: rootPages }, null, 2) + '\n');
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(path.join(cacheDir, 'nav.json'), JSON.stringify({ apis }, null, 2) + '\n');

reporter.endModulesTable();

// ── Fase 2: expansión OpenAPI con caché incremental (paralela) ───────────────
// Todos los specs se procesan concurrentemente; reporter.done() refleja cada
// resultado en tiempo real conforme terminan.

async function processOpenApi(specPath) {
  if (processedSpecs.has(specPath)) return;
  processedSpecs.add(specPath);

  const id = apiId(specPath, backendPath);
  const openapiDir = path.dirname(specPath);
  const specRaw = fs.readFileSync(specPath, 'utf-8');
  const spec = yaml.load(specRaw);

  if (!detectExtensions(spec)) {
    reporter.done({ id, status: 'plain' });
    return;
  }

  const outPath = path.join(cacheDir, `${id}.yaml`);
  const fingerprint = specFingerprint(specRaw, openapiDir, spec, backendPath);

  if (manifest[id] === fingerprint && fs.existsSync(outPath)) {
    newManifest[id] = fingerprint;
    reporter.done({ id, status: 'cached' });
    return;
  }

  const started = Date.now();
  try {
    const expanded = await expandSpec(spec, backendPath, openapiDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(outPath, yaml.dump(expanded, { noRefs: true }));
    newManifest[id] = fingerprint;
    reporter.done({ id, status: 'built', ms: Date.now() - started });
  } catch (err) {
    reporter.done({ id, status: 'failed', error: err.message });
  }
}

reporter.startOpenApiTable();
await Promise.all([...new Set(apis.map(a => a.spec))].map(processOpenApi));

const pruned = pruneCache(cacheDir, Object.keys(newManifest));
saveManifest(manifestPath, newManifest);

reporter.endOpenApiTable(pruned);
