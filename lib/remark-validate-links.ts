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
 * El href se resuelve contra la ubicación lógica del archivo en `modules/`,
 * NO contra su ruta física en el backend. Esto es necesario porque los
 * subgrupos colocan archivos en subcarpetas (ej. `modules/nextfuel/casos-de-uso/`)
 * que no coinciden con la ruta física. El mapa `path-map.json` generado por
 * setup.js mapea cada archivo físico a su directorio lógico.
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
const cacheDir = path.join(cwd, '.openapi-cache');

// Carga el mapa físico → lógico generado por setup.js
function loadPathMap(): Map<string, string> {
  const mapPath = path.join(cacheDir, 'path-map.json');
  if (!fs.existsSync(mapPath)) return new Map();
  const raw = JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as Record<string, string>;
  return new Map(Object.entries(raw));
}

const pathMap = loadPathMap();

// Devuelve el directorio lógico en modules/ donde está colocado un archivo físico.
// Usa el mapa generado por setup.js; si no está en el mapa, cae al cálculo por elisión de docs/.
function modulesDirOf(filePath: string): string | null {
  // Buscar en el pathMap (clave = ruta absoluta del archivo físico)
  const logicalDir = pathMap.get(filePath);
  if (logicalDir !== undefined) {
    return path.join(modulesPath, logicalDir);
  }
  // Fallback: calcular elidiendo docs/ (para archivos no registrados en el mapa)
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
