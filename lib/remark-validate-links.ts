import path from 'path';
import fs from 'fs';
import { visit } from 'unist-util-visit';
import type { Root, Link } from 'mdast';
import type { VFile } from 'vfile';

/**
 * Valida en build los enlaces a archivos de documentación.
 *
 * Para cada enlace a un archivo `.md`/`.mdx` (relativo, p.ej.
 * `../compra/introduccion.mdx#anchor`), comprueba que el destino existe.
 *
 * Importante: el href se resuelve igual que en runtime (`createRelativeLink` →
 * `source.resolveHref`), es decir contra la ruta **lógica de `modules/`** (con el
 * segmento `docs/` elidido), no contra la ruta física del archivo en el backend.
 * Por eso traducimos la ruta física del MDX a su equivalente en `modules/` antes
 * de resolver. Si el destino no existe, rompe el build con la ubicación del enlace.
 */

const FILE_LINK = /\.mdx?(#.*)?$/;

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

const cwd = process.cwd();
const backendRepo = loadEnvLocal().BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
const backendPath = path.resolve(cwd, '..', backendRepo);
const modulesPath = path.join(cwd, 'modules');

// Traduce la ruta física de un MDX del backend a su directorio lógico en modules/
// (calcando carpetas, elidiendo `docs/`). Devuelve null si no aplica.
function modulesDirOf(filePath: string): string | null {
  const rel = path.relative(backendPath, filePath);
  if (rel.startsWith('..')) return null;
  const parts = rel.split(path.sep);
  const i = parts.indexOf('docs');
  if (i === -1) return null;
  const prefix = parts.slice(0, i);
  const rest = parts.slice(i + 1);
  return path.join(modulesPath, ...prefix, ...rest.slice(0, -1));
}

export function remarkValidateLinks() {
  return (tree: Root, file: VFile) => {
    if (!file.path) return;
    const baseDir = modulesDirOf(file.path);
    if (!baseDir) return;

    const broken: string[] = [];
    visit(tree, 'link', (node: Link) => {
      const href = node.url;
      if (!href || !FILE_LINK.test(href)) return;
      if (/^[a-z]+:\/\//i.test(href)) return; // enlaces externos con esquema

      const target = href.split('#')[0];
      const resolved = path.resolve(baseDir, target);
      if (!fs.existsSync(resolved)) {
        const line = node.position?.start.line;
        broken.push(`  → "${href}"${line ? ` (línea ${line})` : ''}`);
      }
    });

    if (broken.length > 0) {
      throw new Error(
        `Enlaces rotos en ${path.relative(backendPath, file.path)}:\n${broken.join('\n')}`
      );
    }
  };
}
