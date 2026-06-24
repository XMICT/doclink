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
// Si el contenido tiene grupos en el primer nivel, los convierte en subcarpetas
// colapsables (cada grupo → meta.json propio + rutas remapeadas).
// Si solo hay páginas sueltas, produce un meta.json plano.
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

  const opToSlug = new Map<string, string>();
  const groups: { slug: string; title: string; pages: string[] }[] = [];
  const rootPages: string[] = [];

  for (const item of content) {
    if (item.type === 'group') {
      const slug = slugify(item.title);
      // pages en meta.json son slugs sin extensión
      const pages = (item.content ?? []).filter(c => c.type === 'page').map(c => c.op!);
      pages.forEach(op => opToSlug.set(op, slug));
      groups.push({ slug, title: item.title, pages });
    } else if (item.type === 'page') {
      rootPages.push(item.op!);
    }
  }

  const files: SourceFile[] = srcFiles.map(f => {
    const fileName = (f.path as string).split('/').pop()!;
    const ext = fileName.endsWith('.mdx') ? '.mdx' : '';
    const opId = ext ? fileName.slice(0, -ext.length) : fileName;
    const slug = opToSlug.get(opId);
    return slug ? { ...f, path: `${base}/${slug}/${fileName}` } : f;
  });

  for (const g of groups) {
    files.push({ type: 'meta', path: `${base}/${g.slug}/meta.json`, data: { title: g.title, pages: g.pages } } as unknown as SourceFile);
  }

  files.push({
    type: 'meta',
    path: `${base}/meta.json`,
    data: { title: node.title, pages: [...rootPages, ...groups.map(g => g.slug)] },
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
