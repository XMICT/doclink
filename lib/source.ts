import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { openapi, openapiByModule, apiNodes, type ApiNode, type ApiManualNode } from './openapi';

const docsSource = docs.toFumadocsSource();

type SourceFile = (typeof docsSource.files)[number];

// Construye los archivos virtuales para un api manual.
// Las URLs son planas (api/operationId) sin importar la estructura de grupos en nav.json.
// Los grupos solo organizan el nav.json del backend; aquí se aplanan en un solo meta.json.
function buildManualApiFiles(srcFiles: SourceFile[], node: ApiNode): SourceFile[] {
  const content = node.content!;
  const base = node.baseDir;

  // Recopilar todos los operationIds en orden, sin importar si están en grupos o sueltos
  const pages: string[] = [];
  function collectOps(items: ApiManualNode[]) {
    for (const item of items) {
      if (item.type === 'page' && item.op) pages.push(item.op);
      if (item.type === 'group' && item.content) collectOps(item.content);
    }
  }
  collectOps(content);

  return [
    ...srcFiles,
    { type: 'meta', path: `${base}/meta.json`, data: { title: node.title, pages } } as unknown as SourceFile,
  ];
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
