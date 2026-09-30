import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveNav } from './resolve.js';
import { collectPageTitles, makeNavLayout } from '../sync/modules.js';

test('resolves nav page titles and paths and preserves directories in group metadata', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclink-nav-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const backendPath = path.join(tempDir, 'backend');
  const modulesPath = path.join(tempDir, 'modules');
  const docsPath = path.join(backendPath, 'evaluaciones', 'docs');
  fs.mkdirSync(path.join(backendPath, 'docs'), { recursive: true });

  const files = [
    'recorrido/introduccion.md',
    'procesos/flujo.md',
    'catalogo/areas.md',
  ];
  for (const file of files) {
    const filePath = path.join(docsPath, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `# ${file}\n`);
  }

  fs.writeFileSync(path.join(backendPath, 'docs', 'index.json'), JSON.stringify({
    nav: {
      sections: [{ title: 'Evaluaciones', content: ['../evaluaciones/docs/nav.json'] }],
    },
  }));
  fs.writeFileSync(path.join(docsPath, 'nav.json'), JSON.stringify({
    type: 'group',
    title: 'Recorrido',
    content: [
      { type: 'page', title: 'Cómo usar', content: './recorrido/introduccion.md' },
      { type: 'page', title: 'Flujo', content: './procesos/flujo.md' },
      {
        type: 'group',
        title: 'Catálogo',
        content: [{ type: 'page', title: 'Áreas', content: './catalogo/areas.md' }],
      },
    ],
  }));

  const tree = resolveNav(backendPath);
  const group = tree.sections[0].content[0];
  assert.equal(group.content[0].file, path.join(docsPath, 'recorrido', 'introduccion.md'));
  assert.equal(group.content[1].file, path.join(docsPath, 'procesos', 'flujo.md'));
  assert.deepEqual(collectPageTitles(tree, backendPath), {
    'evaluaciones/recorrido/introduccion': 'Cómo usar',
    'evaluaciones/procesos/flujo': 'Flujo',
    'evaluaciones/catalogo/areas': 'Áreas',
  });

  const { layoutNode } = makeNavLayout({
    backendPath,
    modulesPath,
    apis: [],
    onModuleSync: () => {},
  });
  layoutNode(group);

  const groupMeta = JSON.parse(fs.readFileSync(
    path.join(modulesPath, 'evaluaciones', 'recorrido', 'meta.json'),
    'utf8',
  ));
  assert.deepEqual(groupMeta.pages, ['introduccion', '../procesos/flujo', 'catálogo']);

  const subgroupMeta = JSON.parse(fs.readFileSync(
    path.join(modulesPath, 'evaluaciones', 'recorrido', 'catálogo', 'meta.json'),
    'utf8',
  ));
  assert.deepEqual(subgroupMeta.pages, ['../../catalogo/areas']);
});
