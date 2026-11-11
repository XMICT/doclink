import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { remark } from 'remark';
import { VFile } from 'vfile';
import { buildLinkContext, remarkValidateLinks, resolveFileLink } from './remark-validate-links.ts';

// Replica lo que hace el pipeline: el backend tiene <modulo>/docs/*.mdx y modules/
// contiene symlinks sin el segmento `docs/`.
//
//   backend/a/docs/{intro,flujo}.mdx   → modules/a/{intro,flujo}.mdx
//   backend/b/docs/intro.mdx           → modules/b/intro.mdx
//   backend/docs/inicio/home.mdx       → modules/docs/inicio/home.mdx
//   backend/documentation/nota.md      (fuera del nav)
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doclink-links-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const backend = path.join(root, 'backend');
  const modules = path.join(root, 'modules');
  const pages = [
    ['a/docs/intro.mdx',        'a/intro.mdx'],
    ['a/docs/flujo.mdx',        'a/flujo.mdx'],
    ['b/docs/intro.mdx',        'b/intro.mdx'],
    ['docs/inicio/home.mdx',    'docs/inicio/home.mdx'],
  ];
  for (const [real, link] of pages) {
    const abs = path.join(backend, real);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '# página\n');
    fs.mkdirSync(path.dirname(path.join(modules, link)), { recursive: true });
    fs.symlinkSync(abs, path.join(modules, link));
  }
  fs.mkdirSync(path.join(backend, 'documentation'), { recursive: true });
  fs.writeFileSync(path.join(backend, 'documentation', 'nota.md'), '# nota\n');

  fs.mkdirSync(path.join(root, '.openapi-cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.openapi-cache', 'nav.json'), JSON.stringify({ apis: [{ baseDir: 'b/api' }] }));

  const ctx = buildLinkContext(modules, path.join(root, '.openapi-cache', 'nav.json'));
  return { backend, ctx, from: rel => path.join(backend, rel) };
}

test('ruta física hacia otro módulo se reescribe a su ubicación en modules/ y conserva el ancla', t => {
  const { ctx, from } = fixture(t);
  assert.deepEqual(
    resolveFileLink('../../b/docs/intro.mdx#estado', from('a/docs/intro.mdx'), ctx),
    { kind: 'rewrite', url: '../b/intro.mdx#estado' },
  );
});

test('ruta física desde una página raíz de docs/ hacia un módulo', t => {
  const { ctx, from } = fixture(t);
  assert.deepEqual(
    resolveFileLink('../../a/docs/flujo.mdx', from('docs/inicio/home.mdx'), ctx),
    { kind: 'rewrite', url: '../../a/flujo.mdx' },
  );
});

test('enlace al mismo directorio (igual en ambos esquemas) no se toca ni se marca como heredado', t => {
  const { ctx, from } = fixture(t);
  assert.deepEqual(resolveFileLink('./flujo.mdx', from('a/docs/intro.mdx'), ctx), { kind: 'ok' });
});

test('ruta lógica heredada sigue siendo válida y sugiere su equivalente físico', t => {
  const { ctx, from } = fixture(t);
  assert.deepEqual(
    resolveFileLink('../b/intro.mdx#x', from('a/docs/intro.mdx'), ctx),
    { kind: 'ok', legacy: '../../b/docs/intro.mdx#x' },
  );
});

test('enlace a una página virtual del playground sigue exento', t => {
  const { ctx, from } = fixture(t);
  assert.deepEqual(resolveFileLink('../b/api/crear.mdx', from('a/docs/intro.mdx'), ctx), { kind: 'ok' });
});

test('forma híbrida (un ../ de menos) avisa y sugiere la ruta física', t => {
  const { ctx, from } = fixture(t);
  const r = resolveFileLink('../b/docs/intro.mdx#estado', from('a/docs/intro.mdx'), ctx);
  assert.equal(r.kind, 'warn');
  assert.match(r.reason, /¿quisiste decir "\.\.\/\.\.\/b\/docs\/intro\.mdx#estado"\?/);
});

test('destino que existe pero está fuera del nav es un aviso, no un error', t => {
  const { ctx, from } = fixture(t);
  const r = resolveFileLink('../../documentation/nota.md', from('a/docs/intro.mdx'), ctx);
  assert.equal(r.kind, 'warn');
  assert.match(r.reason, /no está en la navegación/);
});

test('destino inexistente avisa', t => {
  const { ctx, from } = fixture(t);
  assert.deepEqual(
    resolveFileLink('./no-existe.mdx', from('a/docs/intro.mdx'), ctx),
    { kind: 'warn', reason: 'no existe' },
  );
});

test('el plugin reescribe los enlaces físicos y deja intactos los demás', async t => {
  const { backend, ctx, from } = fixture(t);
  const md = [
    '[físico](../../b/docs/intro.mdx#estado)',
    '[lógico](../b/intro.mdx)',
    '[local](./flujo.mdx)',
    '[externo](https://example.com/x.mdx)',
  ].join('\n\n');
  const out = await remark()
    .use(remarkValidateLinks, { context: ctx, backendPath: backend })
    .process(new VFile({ path: from('a/docs/intro.mdx'), value: md }));
  assert.equal(String(out), [
    '[físico](../b/intro.mdx#estado)',
    '[lógico](../b/intro.mdx)',
    '[local](./flujo.mdx)',
    '[externo](https://example.com/x.mdx)',
  ].join('\n\n') + '\n');
});

test('el plugin avisa de un enlace roto con archivo, línea y corrección, sin romper el build', async t => {
  const { backend, ctx, from } = fixture(t);
  const warn = t.mock.method(console, 'warn', () => {});
  const md = '# t\n\n[ok](./flujo.mdx)\n\n[mal](../b/docs/intro.mdx)\n';
  const file = new VFile({ path: from('a/docs/intro.mdx'), value: md });
  const out = await remark().use(remarkValidateLinks, { context: ctx, backendPath: backend }).process(file);

  assert.match(String(out), /\[mal\]\(\.\.\/b\/docs\/intro\.mdx\)/); // el enlace queda como está
  assert.equal(warn.mock.callCount(), 1);
  const text = warn.mock.calls[0].arguments[0];
  assert.match(text, /⚠ \[enlaces\] a\/docs\/intro\.mdx:5 "\.\.\/b\/docs\/intro\.mdx"/);
  assert.match(text, /¿quisiste decir "\.\.\/\.\.\/b\/docs\/intro\.mdx"\?/);
});

test('el plugin avisa de un destino fuera del nav sin romper el build ni tocar el enlace', async t => {
  const { backend, ctx, from } = fixture(t);
  const warn = t.mock.method(console, 'warn', () => {});
  const md = '# t\n\n[nota](../../documentation/nota.md)\n\n[otra vez](../../documentation/nota.md)\n';
  const file = new VFile({ path: from('a/docs/intro.mdx'), value: md });
  const out = await remark().use(remarkValidateLinks, { context: ctx, backendPath: backend }).process(file);

  assert.match(String(out), /\[nota\]\(\.\.\/\.\.\/documentation\/nota\.md\)/);
  assert.equal(file.messages.length, 2);
  assert.match(file.messages[0].reason, /no está en la navegación/);
  // Una vez por enlace distinto (línea), no por proceso repetido
  assert.equal(warn.mock.callCount(), 2);
  assert.match(warn.mock.calls[0].arguments[0], /⚠ \[enlaces\] a\/docs\/intro\.mdx:3 "\.\.\/\.\.\/documentation\/nota\.md"/);
});

test('archivos fuera del nav (sin symlink) no se validan', async t => {
  const { backend, ctx } = fixture(t);
  const out = await remark()
    .use(remarkValidateLinks, { context: ctx, backendPath: backend })
    .process(new VFile({ path: path.join(backend, 'documentation', 'nota.md'), value: '[x](./nada.mdx)\n' }));
  assert.equal(String(out), '[x](./nada.mdx)\n');
});
