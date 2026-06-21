import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { openapi, openapiByModule, apiNodes, type ApiManualNode } from './openapi';

const docsSource = docs.toFumadocsSource();

type SourceFile = (typeof docsSource.files)[number];

// Modo manual: aplana el árbol de operationId a `pages[]` de fumadocs,
// usando separadores para los grupos. Los endpoints no listados quedan fuera.
function flattenApi(content: ApiManualNode[]): string[] {
  const pages: string[] = [];
  for (const node of content) {
    if (node.type === 'group') {
      pages.push(`---${node.title}---`);
      if (node.content) pages.push(...flattenApi(node.content));
    } else if (node.type === 'page' && node.op) {
      pages.push(node.op);
    }
  }
  return pages;
}

const apiFiles: SourceFile[] = [];
for (const node of apiNodes) {
  const inst = openapiByModule[node.id];
  if (!inst) continue;

  if (node.mode === 'manual' && node.content) {
    // Sin meta auto: lo construimos nosotros para seleccionar/ordenar.
    const src = await inst.staticSource({ baseDir: node.baseDir, meta: false });
    apiFiles.push(...(src.files as SourceFile[]));
    apiFiles.push({
      type: 'meta',
      path: `${node.baseDir}/meta.json`,
      data: { title: node.title, pages: flattenApi(node.content) },
    } as unknown as SourceFile);
  } else {
    // Modo auto: todos los endpoints en el orden del archivo.
    const src = await inst.staticSource({ baseDir: node.baseDir, meta: true });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = page.data as any;
  if (typeof data.getText === 'function') {
    const processed = await data.getText('processed');
    return `# ${page.data.title} (${page.url})\n\n${processed}`;
  }
  // OpenAPI virtual page: use description as content
  return `# ${page.data.title} (${page.url})\n\n${page.data.description ?? ''}`;
}
