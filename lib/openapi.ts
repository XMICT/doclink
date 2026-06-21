import { createOpenAPI } from 'fumadocs-openapi/server';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

function loadEnvLocal(): Record<string, string> {
  const envPath = path.join(process.cwd(), '.env.local');
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

function getModules(docsConfig: { modules?: { id: string }[]; sections?: { modules?: { id: string }[] }[] }) {
  if (docsConfig.modules) return docsConfig.modules;
  return docsConfig.sections!.filter(s => s.modules).flatMap(s => s.modules!);
}

const env = loadEnvLocal();
const backendRepo = env.BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
const apiUrl = env.API_URL ?? process.env.API_URL;
const backendPath = path.resolve(process.cwd(), '..', backendRepo);
const docsConfig = JSON.parse(fs.readFileSync(path.join(backendPath, 'docs.json'), 'utf-8'));

function makeLoader(specPath: string) {
  return () => {
    const doc = yaml.load(fs.readFileSync(specPath, 'utf-8')) as Record<string, unknown>;
    if (apiUrl && Array.isArray(doc.servers)) {
      (doc.servers as { url: string }[])[0].url = apiUrl;
    }
    return doc;
  };
}

const moduleSpecs = getModules(docsConfig).map(m => {
  const cacheFile = path.join(process.cwd(), '.openapi-cache', `${m.id}.yaml`);
  const backendFile = path.join(backendPath, m.id, 'docs', 'api', 'openapi.yaml');
  const specPath = fs.existsSync(cacheFile) ? cacheFile : backendFile;
  return { id: m.id, specPath, loader: makeLoader(specPath) };
});

// Instancia compartida: usada por createProxy() y loaderPlugin()
export const openapi = createOpenAPI({
  input: Object.fromEntries(moduleSpecs.map(m => [m.id, m.loader])),
  proxyUrl: '/api/openapi-proxy',
});

// Instancias por módulo: cada una contiene solo su propio schema,
// para que staticSource() no mezcle endpoints entre módulos.
export const openapiByModule: Record<string, ReturnType<typeof createOpenAPI>> =
  Object.fromEntries(
    moduleSpecs
      .filter(m => fs.existsSync(m.specPath))
      .map(m => [
        m.id,
        createOpenAPI({
          input: { [m.id]: m.loader },
          proxyUrl: '/api/openapi-proxy',
        }),
      ])
  );
