import { docs } from 'collections/server';
import fs from 'fs';
import path from 'path';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { openapi, openapiByModule, apiNodes, type ApiNode } from './openapi';

const docsSource = docs.toFumadocsSource();

type SourceFile = (typeof docsSource.files)[number];

const navCachePath = path.join(process.cwd(), '.openapi-cache', 'nav.json');
const pageTitles: Record<string, string> = fs.existsSync(navCachePath)
  ? (JSON.parse(fs.readFileSync(navCachePath, 'utf-8')).pageTitles ?? {})
  : {};

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Construye los archivos virtuales para un api manual. Las páginas permanecen
// en rutas planas (base/op.mdx → URL plana) y cada grupo recibe su meta.json.
function buildManualApiFiles(srcFiles: SourceFile[], node: ApiNode): SourceFile[] {
  const base = node.baseDir;
  const files: SourceFile[] = [...srcFiles]; // páginas no se remapean → URLs planas

  function addMeta(title: string, content: NonNullable<ApiNode['content']>, dir: string) {
    const pages: string[] = [];

    for (const item of content) {
      if (item.type === 'page') {
        pages.push(path.posix.relative(dir, path.posix.join(base, item.op)));
      } else {
        const slug = slugify(item.title);
        addMeta(item.title, item.content, path.posix.join(dir, slug));
        pages.push(slug);
      }
    }

    files.push({
      type: 'meta',
      path: path.posix.join(dir, 'meta.json'),
      data: { title, pages },
    } as unknown as SourceFile);
  }

  addMeta(node.title, node.content!, base);

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
  pageTree: {
    transformers: [{
      file(node, filePath) {
        if (!filePath) return node;
        const key = path.posix.normalize(filePath.replace(/\\/g, '/')).replace(/\.(md|mdx)$/, '');
        const title = pageTitles[key];
        return title ? { ...node, name: title } : node;
      },
    }],
  },
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
