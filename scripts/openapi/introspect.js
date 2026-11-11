import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertAjvSchema, convertJoiDescribe } from './converters.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backend-worker.cjs');

// Caches almacenan Promises para evitar doble ejecución con llamadas concurrentes.
const schemaCache  = new Map();
const payloadCache = new Map();

// Sequelize emite advertencias no fatales (p.ej. "SQLite does not support 'TINYINT'
// with UNSIGNED or ZEROFILL...") vía console.warn durante la definición de modelos.
// Se separan del resto del stderr para mostrarlas como aviso en vez de como error.
const SEQUELIZE_WARNING_RE = /\(sequelize\) Warning: [^\n]*(?:\n>> Check: [^\n]*)?\n?/g;

function extractWarnings(stderr) {
  const warnings = [];
  stderr.replace(SEQUELIZE_WARNING_RE, match => { warnings.push(match.trim()); return ''; });
  return warnings;
}

// ── Worker persistente (uno por backend) ──────────────────────────────────────
// Un solo proceso hijo carga los modelos una vez y atiende todas las peticiones.
// Quien lo use debe llamar closeIntrospection() al terminar, o el proceso no sale.

const workers = new Map();

function getWorker(backendPath) {
  if (workers.has(backendPath)) return workers.get(backendPath);

  const child = fork(WORKER_PATH, [], {
    cwd: backendPath,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const worker = { child, pending: new Map(), nextId: 0, stderr: '' };

  child.stderr.on('data', d => { worker.stderr = (worker.stderr + d).slice(-4000); });
  child.on('message', ({ id, ok, data, error, stderr }) => {
    const req = worker.pending.get(id);
    if (!req) return;
    worker.pending.delete(id);
    const warnings = extractWarnings(stderr ?? '');
    if (ok) req.resolve({ data, warnings });
    else    req.reject(Object.assign(new Error(error), { warnings }));
  });
  child.on('exit', code => {
    workers.delete(backendPath);
    const err = new Error(worker.stderr.trim() || `worker de introspección terminó (exit ${code})`);
    for (const req of worker.pending.values()) req.reject(err);
    worker.pending.clear();
  });

  workers.set(backendPath, worker);
  return worker;
}

function request(backendPath, msg) {
  const worker = getWorker(backendPath);
  const id = worker.nextId++;
  return new Promise((resolve, reject) => {
    worker.pending.set(id, { resolve, reject });
    worker.child.send({ ...msg, id });
  });
}

// ── API pública ───────────────────────────────────────────────────────────────

export function closeIntrospection() {
  for (const { child } of workers.values()) child.disconnect();
  workers.clear();
}

export function introspectSchema(modelName, backendPath) {
  const cacheKey = `schema::${backendPath}::${modelName}`;
  if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey);

  const promise = request(backendPath, { type: 'model', name: modelName })
    .then(({ data, warnings }) => ({ ...data, warnings }));

  schemaCache.set(cacheKey, promise);
  return promise;
}

export function loadPayloadSchema(payloadPath, backendPath) {
  const cacheKey = `payload::${payloadPath}`;
  if (payloadCache.has(cacheKey)) return payloadCache.get(cacheKey);

  const promise = request(backendPath, { type: 'payload', path: payloadPath })
    .then(({ data: { format, data }, warnings }) => {
      const schema = format === 'joi' ? convertJoiDescribe(data) : convertAjvSchema(data);
      return { schema, warnings };
    });

  payloadCache.set(cacheKey, promise);
  return promise;
}
