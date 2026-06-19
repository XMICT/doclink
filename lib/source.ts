import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { openapi, openapiByModule } from './openapi';
import fs from 'fs';
import path from 'path';

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

const backendRepo = loadEnvLocal().BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
const backendPath = path.resolve(process.cwd(), '..', backendRepo);
const docsConfig = JSON.parse(fs.readFileSync(path.join(backendPath, 'docs.json'), 'utf-8'));

const docsSource = docs.toFumadocsSource();

const apiSources = await Promise.all(
  getModules(docsConfig).map(m => {
    const inst = openapiByModule[m.id];
    if (!inst) return { files: [] };
    return inst.staticSource({ baseDir: `${m.id}/api`, meta: true });
  })
);
const allApiFiles = apiSources.flatMap(src => src.files);

export const source = loader({
  baseUrl: docsRoute,
  source: { files: [...docsSource.files, ...allApiFiles] },
  plugins: [lucideIconsPlugin(), openapi.loaderPlugin()],
});

export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];
  return {
    segments,
    url: `${docsImageRoute}/${segments.join('/')}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];
  return {
    segments,
    url: `${docsContentRoute}/${segments.join('/')}`,
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = page.data as any;
  if (typeof data.getText === 'function') {
    const processed = await data.getText('processed');
    return `# ${page.data.title} (${page.url})\n\n${processed}`;
  }
  // OpenAPI virtual page: use description as content
  return `# ${page.data.title} (${page.url})\n\n${page.data.description ?? ''}`;
}
