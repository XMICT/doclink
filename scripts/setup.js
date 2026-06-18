import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { detectExtensions, expandSpec } from './openapi-expander.js';

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

// Construye pages[] del meta.json raíz con separadores por sección
function buildMetaPages(docsConfig, backendPath) {
  if (docsConfig.modules) return docsConfig.modules.map(m => m.id);
  return docsConfig.sections.flatMap(s => {
    if (s.dir) {
      // Lee el meta.json del directorio para conocer sus páginas
      const dirMeta = JSON.parse(
        fs.readFileSync(path.join(backendPath, s.dir, 'meta.json'), 'utf-8')
      );
      // Referencia directa: separador + páginas planas bajo él (sin folder intermedio)
      return [`---${s.title}---`, ...dirMeta.pages.map(p => `${s.id}/${p}`)];
    }
    if (s.modules) return [`---${s.title}---`, ...s.modules.map(m => m.id)];
    return [];
  });
}

const env = loadEnvLocal();
const backendRepo = env.BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
const backendPath = path.resolve(rootDir, '..', backendRepo);
const modulesPath = path.join(rootDir, 'modules');

if (!fs.existsSync(backendPath)) {
  console.error(`Error: backend repo not found at ${backendPath}`);
  process.exit(1);
}

const docsConfigPath = path.join(backendPath, 'docs.json');
if (!fs.existsSync(docsConfigPath)) {
  console.error(`Error: docs.json not found at ${docsConfigPath}`);
  process.exit(1);
}

const docsConfig = JSON.parse(fs.readFileSync(docsConfigPath, 'utf-8'));
const cacheDir = path.join(rootDir, '.openapi-cache');

function processOpenApi(moduleId) {
  const openapiDir  = path.join(backendPath, moduleId, 'docs', 'api');
  const openapiPath = path.join(openapiDir, 'openapi.yaml');
  if (!fs.existsSync(openapiPath)) return;

  const spec = yaml.load(fs.readFileSync(openapiPath, 'utf-8'));
  if (!detectExtensions(spec)) return;

  try {
    const expanded = expandSpec(spec, backendPath, openapiDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `${moduleId}.yaml`), yaml.dump(expanded, { noRefs: true }));
    console.log(`✓ openapi expandido: ${moduleId}`);
  } catch (err) {
    console.error(`✗ Error expandiendo openapi de ${moduleId}:`, err.message);
  }
}

fs.rmSync(modulesPath, { recursive: true, force: true });
fs.mkdirSync(modulesPath, { recursive: true });

for (const section of docsConfig.sections ?? []) {
  if (section.dir) {
    // Sección con directorio propio: backend/[dir]/ → modules/[id]/
    const target = path.resolve(backendPath, section.dir);
    const link = path.join(modulesPath, section.id);
    fs.symlinkSync(target, link);
    console.log(`✓ ${section.id}/ → ${target}`);
  }

  if (section.modules) {
    // Módulos: backend/[id]/docs/ → modules/[id]/
    for (const mod of section.modules) {
      const target = path.resolve(backendPath, mod.id, 'docs');
      const link = path.join(modulesPath, mod.id);
      fs.symlinkSync(target, link);
      console.log(`✓ ${mod.id}/ → ${target}`);
      processOpenApi(mod.id);
    }
  }
}

fs.writeFileSync(
  path.join(modulesPath, 'meta.json'),
  JSON.stringify({ pages: buildMetaPages(docsConfig, backendPath) }, null, 2) + '\n'
);
console.log('✓ modules/meta.json generado');
