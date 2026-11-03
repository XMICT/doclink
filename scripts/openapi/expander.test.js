import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { expandSpec } from './expander.js';

test('expande los $ref externos de cualquier sección de components, no solo de schemas', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclink-expander-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'schemas.yaml'), 'Detalle:\n  type: object\n  properties:\n    id:\n      type: string\n');

  const spec = {
    openapi: '3.0.0',
    components: {
      schemas:   { Cotizacion: { $ref: './schemas.yaml#/Detalle' } },
      responses: {
        Agregado: {
          description: 'Agregado',
          content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: './schemas.yaml#/Detalle' } } } } },
        },
      },
    },
    paths: {},
  };

  const { spec: out } = await expandSpec(spec, dir, dir);

  const detalle = { type: 'object', properties: { id: { type: 'string' } } };
  assert.deepEqual(out.components.schemas.Cotizacion, detalle);
  assert.deepEqual(out.components.responses.Agregado.content['application/json'].schema.properties.data, detalle);
  assert.equal(JSON.stringify(out).includes('schemas.yaml'), false, 'no debe quedar ningún $ref a archivos externos');
});
