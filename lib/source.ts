import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { openapi, openapiByModule, apiNodes, type ApiNode, type ApiManualNode } from './openapi';

const docsSource = docs.toFumadocsSource();

type SourceFile = (typeof docsSource.files)[number];

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Construye los archivos virtuales para un api manual.
// Las páginas permanecen en rutas planas (base/op.mdx → URL plana).
// Si hay grupos, se crean meta.json de subcarpeta con referencias "../op" —
// el mismo mecanismo que Fase 1 usa para subgrupos de nav: Fumadocs asigna
// la página al grupo en el sidebar sin alterar su URL.
function buildManualApiFiles(srcFiles: SourceFile[], node: ApiNode): SourceFile[] {
  const content = node.content!;
  const base = node.baseDir;

  const hasGroups = content.some(n => n.type === 'group');

  if (!hasGroups) {
    const pages = content.filter(n => n.type === 'page').map(n => (n as ApiManualNode).op!);
    return [
      ...srcFiles,
      { type: 'meta', path: `${base}/meta.json`, data: { title: node.title, pages } } as unknown as SourceFile,
    ];
  }

  const files: SourceFile[] = [...srcFiles]; // páginas no se remapean → URLs planas
  const rootPages: string[] = [];
  const groupSlugs: string[] = [];

  for (const item of content) {
    if (item.type === 'group') {
      const slug = slugify(item.title);
      const groupPages = (item.content ?? []).filter(c => c.type === 'page').map(c => `../${c.op!}`);
      files.push({
        type: 'meta',
        path: `${base}/${slug}/meta.json`,
        data: { title: item.title, pages: groupPages },
      } as unknown as SourceFile);
      groupSlugs.push(slug);
    } else if (item.type === 'page') {
      rootPages.push(item.op!);
    }
  }

  files.push({
    type: 'meta',
    path: `${base}/meta.json`,
    data: { title: node.title, pages: [...rootPages, ...groupSlugs] },
  } as unknown as SourceFile);

  return files;
}

const apiFiles: SourceFile[] = [];
for (const node of apiNodes) {
  const inst = openapiByModule[node.id];
  if (!inst) continue;

  const src = await inst.staticSource({ baseDir: node.baseDir, meta: node.mode === 'auto' });

  if (node.mode === 'manual' && node.content) {
    apiFiles.push(...buildManualApiFiles(src.files as SourceFile[], node));
  } else {
    apiFiles.push(...(src.files as SourceFile[]));
  }
}

export const source = loader({
  baseUrl: docsRoute,
  source: { files: [...docsSource.files, ...apiFiles] },
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
  const data = page.data as any;
  if (typeof data.getText === 'function') {
    const processed = await data.getText('processed');
    return `# ${page.data.title} (${page.url})\n\n${processed}`;
  }
  // OpenAPI virtual page: use description as content
  return `# ${page.data.title} (${page.url})\n\n${page.data.description ?? ''}`;
}
