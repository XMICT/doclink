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

export interface ApiManualNode {
  type: 'group' | 'page';
  title: string;
  op?: string;
  content?: ApiManualNode[];
}

export interface ApiNode {
  id: string;
  title: string;
  spec: string;
  mode: 'auto' | 'manual';
  baseDir: string;
  content: ApiManualNode[] | null;
}

const env = loadEnvLocal();
export const apiUrl = env.API_URL ?? process.env.API_URL;
const cacheDir = path.join(process.cwd(), '.openapi-cache');

// Lista de nodos api resuelta por scripts/setup.js (corre antes de dev/build).
const navPath = path.join(cacheDir, 'nav.json');
export const apiNodes: ApiNode[] = fs.existsSync(navPath)
  ? (JSON.parse(fs.readFileSync(navPath, 'utf-8')).apis as ApiNode[])
  : [];

function makeLoader(specPath: string) {
  return () => {
    const doc = yaml.load(fs.readFileSync(specPath, 'utf-8')) as Record<string, unknown>;
    if (apiUrl && Array.isArray(doc.servers)) {
      (doc.servers as { url: string }[])[0].url = apiUrl;
    }
    return doc;
  };
}

const moduleSpecs = apiNodes.map(node => {
  const cacheFile = path.join(cacheDir, `${node.id}.yaml`);
  const specPath = fs.existsSync(cacheFile) ? cacheFile : node.spec;
  return { id: node.id, specPath, loader: makeLoader(specPath) };
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
