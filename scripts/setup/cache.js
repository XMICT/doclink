import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ── Helpers internos ──────────────────────────────────────────────────────────

const sha256 = str => crypto.createHash('sha256').update(str).digest('hex');
const hashFileSafe = abs => { try { return sha256(fs.readFileSync(abs)); } catch { return 'missing'; } };

// Se calcula una vez: cualquier marcador puede introspeccionar cualquier modelo,
// y las asociaciones arrastran vecinos, así que se hashean todos.
let _modelsHash;
function modelsFingerprint(backendPath) {
  if (_modelsHash !== undefined) return _modelsHash;
  const modelsDir = path.join(backendPath, 'models');
  if (!fs.existsSync(modelsDir)) return (_modelsHash = 'no-models');
  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.js') && !f.includes('.test.'))
    .sort();
  _modelsHash = sha256(files.map(f => `${f}:${hashFileSafe(path.join(modelsDir, f))}`).join('|'));
  return _modelsHash;
}

// ponytail: solo un nivel de $ref externo; si aparecen refs transitivos, recursar aquí.
function collectSpecDeps(node, openapiDir, acc = new Set()) {
  if (Array.isArray(node)) { node.forEach(n => collectSpecDeps(n, openapiDir, acc)); return acc; }
  if (!node || typeof node !== 'object') return acc;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'schema' && typeof v === 'string') acc.add(path.resolve(openapiDir, v));
    else if (k === '$ref' && typeof v === 'string' && !v.startsWith('#')) acc.add(path.resolve(openapiDir, v.split('#')[0]));
    else collectSpecDeps(v, openapiDir, acc);
  }
  return acc;
}

// ── API pública ───────────────────────────────────────────────────────────────

export function specFingerprint(specRaw, openapiDir, spec, backendPath) {
  const deps = [...collectSpecDeps(spec, openapiDir)].sort();
  const depHash = deps.map(d => `${path.basename(d)}:${hashFileSafe(d)}`).join('|');
  return sha256(`${specRaw}::${modelsFingerprint(backendPath)}::${depHash}`);
}

export function loadManifest(manifestPath) {
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { return {}; }
}

export function saveManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

export function pruneCache(cacheDir, knownIds) {
  const known = new Set(knownIds);
  let count = 0;
  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.endsWith('.yaml')) continue;
    const id = f.replace(/\.yaml$/, '');
    if (!known.has(id)) { fs.rmSync(path.join(cacheDir, f)); count++; }
  }
  return count;
}
