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

// Mapa: ruta real del backend → directorio del symlink en modules/.
// Refleja exactamente dónde quedó cada archivo tras el pipeline (incluye ../  de subgrupos).
const symlinkDirMap = new Map<string, string>();
function buildSymlinkMap(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try { symlinkDirMap.set(fs.realpathSync(full), path.dirname(full)); } catch { /* symlink roto */ }
    } else if (entry.isDirectory()) {
      buildSymlinkMap(full);
    }
  }
}
if (fs.existsSync(modulesPath)) buildSymlinkMap(modulesPath);

function modulesDirOf(filePath: string): string | null {
  return symlinkDirMap.get(filePath) ?? null;
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
