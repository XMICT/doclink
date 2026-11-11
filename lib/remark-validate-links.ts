import path from 'path';
import fs from 'fs';
import { visit } from 'unist-util-visit';
import type { Root, Link } from 'mdast';
import type { VFile } from 'vfile';

/**
 * Valida y normaliza en build los enlaces a archivos de documentación.
 *
 * Para cada enlace a un archivo `.md`/`.mdx` (relativo, p.ej.
 * `../compra/docs/introduccion.mdx#anchor`) acepta dos formas, en modo híbrido
 * mientras los repositorios hermanos migran:
 *
 *  1. **Ruta física** (preferida): relativa al archivo que contiene el enlace, tal
 *     como está en el repositorio hermano, incluyendo `docs/`. Se traduce a la
 *     ubicación que ese archivo tiene en `modules/` y se reescribe el enlace para
 *     que `createRelativeLink` → `source.resolveHref` lo resuelva en runtime.
 *  2. **Ruta lógica** (heredada): relativa a la ubicación en `modules/`, donde el
 *     segmento `docs/` no existe. Se acepta tal cual, sin reescribir.
 *
 * Si ambas resolvieran a archivos distintos, gana la física.
 *
 * Un enlace que no se puede resolver (el destino no existe, o existe pero no está en
 * la navegación) **no rompe el build**: se deja tal cual y se avisa con la ubicación
 * del enlace y, cuando se puede, la corrección.
 */

const FILE_LINK = /\.mdx?(#.*)?$/;

// ── Contexto: cómo quedó cada archivo tras el pipeline ────────────────────────

export interface LinkContext {
  /** ruta real del archivo en el backend → ruta de su symlink en modules/ */
  realToModules: Map<string, string>;
  /** directorios virtuales de fumadocs-openapi: no existen en disco */
  apiDirs: string[];
}

function collectSymlinks(dir: string, acc: Map<string, string>) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try { acc.set(fs.realpathSync(full), full); } catch { /* symlink roto */ }
    } else if (entry.isDirectory()) {
      collectSymlinks(full, acc);
    }
  }
}

export function buildLinkContext(modulesPath: string, navCachePath: string): LinkContext {
  const realToModules = new Map<string, string>();
  if (fs.existsSync(modulesPath)) collectSymlinks(modulesPath, realToModules);

  const apiDirs: string[] = [];
  if (fs.existsSync(navCachePath)) {
    const { apis } = JSON.parse(fs.readFileSync(navCachePath, 'utf-8')) as { apis?: { baseDir: string }[] };
    for (const api of apis ?? []) apiDirs.push(path.join(modulesPath, ...api.baseDir.split('/')));
  }
  return { realToModules, apiDirs };
}

// ── Resolución de un enlace ───────────────────────────────────────────────────

export type LinkResolution =
  | { kind: 'ok'; legacy?: string }      // legacy: ruta física equivalente de un enlace lógico
  | { kind: 'rewrite'; url: string }
  | { kind: 'warn'; reason: string };    // no resoluble: se avisa, no se rompe el build

const toPosix = (p: string) => p.split(path.sep).join('/');
const relativeUrl = (from: string, to: string) => {
  const rel = toPosix(path.relative(from, to));
  return rel.startsWith('.') ? rel : `./${rel}`;
};

/**
 * @param href     enlace tal como se escribió (con `#ancla` opcional)
 * @param filePath ruta **real** del archivo que contiene el enlace (debe estar en `ctx.realToModules`)
 */
export function resolveFileLink(href: string, filePath: string, ctx: LinkContext): LinkResolution {
  const hash   = href.indexOf('#');
  const target = hash === -1 ? href : href.slice(0, hash);
  const anchor = hash === -1 ? '' : href.slice(hash);

  const modulesDir = path.dirname(ctx.realToModules.get(filePath)!);
  const fileDir    = path.dirname(filePath);

  // 1) Ruta física: el destino real debe ser una página del nav (tener symlink en modules/).
  const physical     = path.resolve(fileDir, target);
  const physicalDest = ctx.realToModules.get(physical);
  if (physicalDest) {
    const url = relativeUrl(modulesDir, physicalDest);
    return url === target ? { kind: 'ok' } : { kind: 'rewrite', url: url + anchor };
  }

  // 2) Ruta lógica (heredada): relativa a modules/.
  const logical = path.resolve(modulesDir, target);
  if (ctx.apiDirs.some(d => logical === d || logical.startsWith(d + path.sep))) return { kind: 'ok' };
  if (fs.existsSync(logical)) {
    let real = logical;
    try { real = fs.realpathSync(logical); } catch { /* se conserva la ruta lógica */ }
    return { kind: 'ok', legacy: relativeUrl(fileDir, real) + anchor };
  }

  // 3) No se pudo resolver: explicar por qué y, si se puede, sugerir la corrección.
  if (fs.existsSync(physical)) {
    return { kind: 'warn', reason: 'el archivo existe pero no está en la navegación (agrégalo a un nav.json o quita el enlace)' };
  }

  for (const extra of ['../', '../../']) {
    const candidate = path.resolve(fileDir, extra + target);
    if (ctx.realToModules.has(candidate)) {
      return { kind: 'warn', reason: `no existe; ¿quisiste decir "${relativeUrl(fileDir, candidate)}${anchor}"?` };
    }
  }
  return { kind: 'warn', reason: 'no existe' };
}

// ── Plugin remark ─────────────────────────────────────────────────────────────

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

let defaultContext: LinkContext | undefined;
function getDefaultContext(): LinkContext {
  return (defaultContext ??= buildLinkContext(
    path.join(process.cwd(), 'modules'),
    path.join(process.cwd(), '.openapi-cache', 'nav.json'),
  ));
}

function backendRoot(): string {
  const repo = loadEnvLocal().BACKEND_REPO ?? process.env.BACKEND_REPO ?? 'backend';
  return path.resolve(process.cwd(), '..', repo);
}

// Los mensajes de vfile no se muestran en el build (fumadocs-mdx los descarta), así que
// los avisos se imprimen por consola, una vez por proceso y enlace.
const warned = new Set<string>();
function warnOnce(file: VFile, backendPath: string, line: number | undefined, href: string, reason: string) {
  const where = `${path.relative(backendPath, file.path)}${line ? `:${line}` : ''}`;
  const text = `⚠ [enlaces] ${where} "${href}": ${reason}`;
  if (warned.has(text)) return;
  warned.add(text);
  console.warn(text);
}

export function remarkValidateLinks(options: { context?: LinkContext; backendPath?: string } = {}) {
  return (tree: Root, file: VFile) => {
    if (!file.path) return;
    const ctx = options.context ?? getDefaultContext();
    if (!ctx.realToModules.has(file.path)) return;

    const backendPath = options.backendPath ?? backendRoot();
    visit(tree, 'link', (node: Link) => {
      const href = node.url;
      if (!href || !FILE_LINK.test(href)) return;
      if (/^[a-z]+:\/\//i.test(href)) return; // enlaces externos con esquema

      const result = resolveFileLink(href, file.path, ctx);
      if (result.kind === 'rewrite') node.url = result.url;
      else if (result.kind === 'warn') {
        file.message(result.reason, node.position, 'doclink:enlaces');
        warnOnce(file, backendPath, node.position?.start.line, href, result.reason);
      }
    });
  };
}
