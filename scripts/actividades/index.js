// Valida .actividades/grafo.json y muestra un resumen del estado del proyecto.
//
//   npm run actividades                → validación + resumen
//   npm run actividades -- --todas     → incluye las actividades liberadas en el árbol
//   npm run actividades -- --github    → además compara el estado de cada PR con GitHub (requiere gh)
//
// Termina con código 1 si hay errores; los avisos no fallan.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT          = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ACTIVIDADES   = path.join(ROOT, '.actividades');
const GRAFO_PATH    = path.join(ACTIVIDADES, 'grafo.json');
const SCHEMA_PATH   = path.join(ACTIVIDADES, 'schema.json');

const ESTADO = {
  PENDIENTE:   'pendiente',
  EN_CURSO:    'en-curso',
  EN_REVISION: 'en-revision',
  EN_RELEASE:  'en-release',
  LIBERADA:    'liberada',
  DESCARTADA:  'descartada',
};
const TIPO_EPICA        = 'epica';
const ARISTA_PARTE_DE   = 'parte-de';
const RAMAS_PRODUCCION  = ['origin/main', 'main'];
const GH_LIMITE_PRS     = 500;

// Estado esperado de la actividad según el estado de su PR en GitHub.
const ESTADOS_SEGUN_PR = {
  OPEN:           [ESTADO.EN_CURSO, ESTADO.EN_REVISION],
  CLOSED:         [ESTADO.DESCARTADA],
  MERGED_main:    [ESTADO.LIBERADA],
  MERGED_release: [ESTADO.EN_RELEASE, ESTADO.LIBERADA],
};

const ICONO_ESTADO = {
  [ESTADO.PENDIENTE]:   { icono: '·', color: 'gray'   },
  [ESTADO.EN_CURSO]:    { icono: '◐', color: 'yellow' },
  [ESTADO.EN_REVISION]: { icono: '◑', color: 'cyan'   },
  [ESTADO.EN_RELEASE]:  { icono: '◕', color: 'blue'   },
  [ESTADO.LIBERADA]:    { icono: '●', color: 'green'  },
  [ESTADO.DESCARTADA]:  { icono: '✗', color: 'gray'   },
};

const usarColor = process.stdout.isTTY && !process.env.NO_COLOR;
const PALETA = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', blue: '\x1b[34m', red: '\x1b[31m', gray: '\x1b[90m',
};
const c = usarColor ? PALETA : Object.fromEntries(Object.keys(PALETA).map(k => [k, '']));

// ── Git / GitHub ──────────────────────────────────────────────────────────────

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

const existeCommit = hash => git(['cat-file', '-e', `${hash}^{commit}`]) !== null;
const estaEnRama   = (hash, rama) => git(['merge-base', '--is-ancestor', hash, rama]) !== null;
const ramaProduccion = RAMAS_PRODUCCION.find(rama => git(['rev-parse', '--verify', '--quiet', rama]) !== null);

function obtenerPrsDeGithub() {
  try {
    const salida = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'all', '--limit', String(GH_LIMITE_PRS), '--json', 'number,state,baseRefName,title'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(salida.toString());
  } catch (error) {
    throw `No se pudo consultar GitHub con gh. ${error.stderr?.toString().trim() || error.message}`;
  }
}

// ── Validaciones ──────────────────────────────────────────────────────────────

function validarEstructura(grafo, schema) {
  const errores = [];
  const defNodo   = schema.$defs.nodo;
  const defArista = schema.$defs.arista;
  const patronFecha   = new RegExp(schema.$defs.fecha.pattern);
  const patronId      = new RegExp(defNodo.properties.id.pattern);
  const patronVersion = new RegExp(defNodo.properties.version.pattern);
  const patronCommit  = new RegExp(defNodo.properties.commits.items.pattern);
  const camposNodo    = new Set(Object.keys(defNodo.properties));

  const ids = new Set();
  for (const nodo of grafo.nodos) {
    const etiqueta = nodo.id ?? '(nodo sin id)';

    for (const campo of defNodo.required) {
      if (nodo[campo] === undefined) errores.push(`${etiqueta}: falta el campo «${campo}»`);
    }
    for (const campo of Object.keys(nodo)) {
      if (!camposNodo.has(campo)) errores.push(`${etiqueta}: campo desconocido «${campo}»`);
    }
    if (ids.has(nodo.id)) errores.push(`${etiqueta}: el id está duplicado`);
    ids.add(nodo.id);

    if (nodo.id && !patronId.test(nodo.id)) errores.push(`${etiqueta}: el id no cumple el formato DL-xxx / EP-xx`);
    if (nodo.tipo && !defNodo.properties.tipo.enum.includes(nodo.tipo)) errores.push(`${etiqueta}: tipo «${nodo.tipo}» no válido`);
    if (nodo.estado && !defNodo.properties.estado.enum.includes(nodo.estado)) errores.push(`${etiqueta}: estado «${nodo.estado}» no válido`);
    if (nodo.version && !patronVersion.test(nodo.version)) errores.push(`${etiqueta}: versión «${nodo.version}» no válida`);

    for (const campo of ['inicio', 'cierre']) {
      if (nodo[campo] && !patronFecha.test(nodo[campo])) errores.push(`${etiqueta}: ${campo} «${nodo[campo]}» no es una fecha AAAA-MM-DD`);
    }
    if (nodo.inicio && nodo.cierre && nodo.cierre < nodo.inicio) errores.push(`${etiqueta}: la fecha de cierre es anterior a la de inicio`);

    for (const hash of nodo.commits ?? []) {
      if (!patronCommit.test(hash)) errores.push(`${etiqueta}: commit «${hash}» no es un hash válido`);
    }
    for (const doc of nodo.docs ?? []) {
      if (!fs.existsSync(path.join(ACTIVIDADES, doc))) errores.push(`${etiqueta}: no existe el documento ${doc}`);
    }
  }

  const nodosPorId = new Map(grafo.nodos.map(nodo => [nodo.id, nodo]));
  const aristasVistas = new Set();
  for (const arista of grafo.aristas) {
    const { de, a, tipo } = arista;
    const etiqueta = `arista ${de} → ${a}`;

    for (const campo of defArista.required) {
      if (arista[campo] === undefined) errores.push(`${etiqueta}: falta el campo «${campo}»`);
    }
    if (!defArista.properties.tipo.enum.includes(tipo)) errores.push(`${etiqueta}: tipo «${tipo}» no válido`);
    if (!nodosPorId.has(de)) errores.push(`${etiqueta}: el nodo ${de} no existe`);
    if (!nodosPorId.has(a))  errores.push(`${etiqueta}: el nodo ${a} no existe`);
    if (de === a) errores.push(`${etiqueta}: un nodo no puede relacionarse consigo mismo`);

    const clave = `${de}|${a}|${tipo}`;
    if (aristasVistas.has(clave)) errores.push(`${etiqueta}: la relación «${tipo}» está duplicada`);
    aristasVistas.add(clave);

    if (tipo === ARISTA_PARTE_DE && nodosPorId.get(a)?.tipo !== TIPO_EPICA) {
      errores.push(`${etiqueta}: «parte-de» debe apuntar a una épica`);
    }
  }

  return errores;
}

function validarCoherencia(grafo, epicaDe) {
  const avisos = [];

  for (const nodo of grafo.nodos) {
    if (nodo.tipo === TIPO_EPICA) continue;
    const { id, estado, pr, cierre } = nodo;

    const epicas = epicaDe.get(id) ?? [];
    if (epicas.length === 0) avisos.push(`${id}: no pertenece a ninguna épica`);
    if (epicas.length > 1)   avisos.push(`${id}: pertenece a varias épicas (${epicas.join(', ')})`);

    if (estado === ESTADO.EN_REVISION && !pr) avisos.push(`${id}: está en revisión pero no tiene PR propio`);
    if ([ESTADO.EN_RELEASE, ESTADO.LIBERADA].includes(estado) && !cierre) avisos.push(`${id}: está ${estado} pero no tiene fecha de cierre`);
  }

  const hijosPorEpica = new Map();
  for (const [hijo, epicas] of epicaDe) {
    for (const epica of epicas) {
      if (!hijosPorEpica.has(epica)) hijosPorEpica.set(epica, []);
      hijosPorEpica.get(epica).push(hijo);
    }
  }
  const nodosPorId = new Map(grafo.nodos.map(nodo => [nodo.id, nodo]));
  for (const epica of grafo.nodos.filter(nodo => nodo.tipo === TIPO_EPICA)) {
    const pendientes = (hijosPorEpica.get(epica.id) ?? [])
      .filter(hijo => ![ESTADO.LIBERADA, ESTADO.DESCARTADA].includes(nodosPorId.get(hijo).estado));
    if (epica.estado === ESTADO.LIBERADA && pendientes.length > 0) {
      avisos.push(`${epica.id}: está liberada pero tiene actividades sin liberar (${pendientes.join(', ')})`);
    }
  }

  return avisos;
}

function validarGit(grafo) {
  const errores = [];
  const avisos  = [];
  if (!ramaProduccion) avisos.push(`No se encontró la rama ${RAMAS_PRODUCCION.join(' ni ')}; se omite la comparación con producción`);

  for (const { id, estado, commits = [] } of grafo.nodos) {
    const inexistentes = commits.filter(hash => !existeCommit(hash));
    for (const hash of inexistentes) errores.push(`${id}: el commit ${hash} no existe en el repositorio`);
    if (!ramaProduccion || inexistentes.length > 0 || commits.length === 0) continue;

    const fueraDeProduccion = commits.filter(hash => !estaEnRama(hash, ramaProduccion));
    if (estado === ESTADO.LIBERADA && fueraDeProduccion.length > 0) {
      avisos.push(`${id}: está liberada pero ${fueraDeProduccion.join(', ')} no está en ${ramaProduccion}`);
    }
    if (estado === ESTADO.EN_RELEASE && fueraDeProduccion.length === 0) {
      avisos.push(`${id}: todos sus commits ya están en ${ramaProduccion}; puede marcarse como liberada`);
    }
  }

  return { errores, avisos };
}

function validarGithub(grafo) {
  const avisos = [];
  const prs = obtenerPrsDeGithub();
  const prsPorNumero = new Map(prs.map(pr => [pr.number, pr]));
  const prsRegistrados = new Set(grafo.nodos.map(nodo => nodo.pr).filter(Boolean));

  for (const { id, estado, pr: numero } of grafo.nodos) {
    if (!numero) continue;
    const pr = prsPorNumero.get(numero);
    if (!pr) {
      avisos.push(`${id}: el PR #${numero} no existe en GitHub`);
      continue;
    }
    const clave = pr.state === 'MERGED' ? `MERGED_${pr.baseRefName}` : pr.state;
    const esperados = ESTADOS_SEGUN_PR[clave];
    if (esperados && !esperados.includes(estado)) {
      const estadoPr = pr.state === 'MERGED' ? `integrado en ${pr.baseRefName}` : pr.state.toLowerCase();
      avisos.push(`${id}: el PR #${numero} está ${estadoPr}, se esperaba estado ${esperados.join(' o ')} (actual: ${estado})`);
    }
  }

  for (const pr of prs.filter(pr => !prsRegistrados.has(pr.number))) {
    avisos.push(`PR #${pr.number} (${pr.state.toLowerCase()}) no tiene actividad: ${pr.title}`);
  }

  return avisos;
}

// ── Resumen ───────────────────────────────────────────────────────────────────

function formatearEstado(estado) {
  const { icono, color } = ICONO_ESTADO[estado] ?? { icono: '?', color: 'red' };
  return `${c[color]}${icono} ${estado.padEnd(11)}${c.reset}`;
}

function formatearActividad({ id, tipo, estado, pr, titulo }) {
  const referenciaPr = pr ? `#${pr}` : '';
  return `${c.bold}${id}${c.reset} ${tipo.padEnd(7)} ${formatearEstado(estado)} ${c.dim}${referenciaPr.padEnd(4)}${c.reset} ${titulo}`;
}

function imprimirResumen(grafo, epicaDe, { mostrarTodas }) {
  const actividades = grafo.nodos.filter(nodo => nodo.tipo !== TIPO_EPICA);
  const epicas      = grafo.nodos.filter(nodo => nodo.tipo === TIPO_EPICA);
  const estaOculta  = nodo => !mostrarTodas && [ESTADO.LIBERADA, ESTADO.DESCARTADA].includes(nodo.estado);

  console.log(`\n${c.bold}Actividades de ${grafo.proyecto}${c.reset} ${c.dim}· actualizado ${grafo.actualizado}${c.reset}`);
  console.log(`${c.dim}${actividades.length} actividades · ${epicas.length} épicas · ${grafo.aristas.length} relaciones${c.reset}\n`);

  for (const estado of Object.values(ESTADO)) {
    const total = actividades.filter(nodo => nodo.estado === estado).length;
    if (total > 0) console.log(`  ${formatearEstado(estado)} ${String(total).padStart(3)}`);
  }

  const grupos = [
    ...epicas.map(epica => ({ encabezado: `${epica.id} ${epica.titulo}`, epica, hijos: actividades.filter(nodo => epicaDe.get(nodo.id)?.includes(epica.id)) })),
    { encabezado: 'Sin épica', hijos: actividades.filter(nodo => !epicaDe.has(nodo.id)) },
  ].filter(grupo => grupo.hijos.length > 0 || grupo.epica);

  console.log('');
  for (const { encabezado, epica, hijos } of grupos) {
    const visibles = hijos.filter(nodo => !estaOculta(nodo));
    const ocultas  = hijos.length - visibles.length;
    const estadoEpica = epica ? ` ${formatearEstado(epica.estado)}` : '';
    console.log(`${c.bold}${encabezado}${c.reset}${estadoEpica}`);

    const lineas = visibles.map(formatearActividad);
    if (ocultas > 0) lineas.push(`${c.dim}${ocultas} liberadas o descartadas (--todas para verlas)${c.reset}`);
    lineas.forEach((linea, i) => console.log(`  ${i === lineas.length - 1 ? '└─' : '├─'} ${linea}`));
    console.log('');
  }
}

function imprimirLista(titulo, color, elementos) {
  if (elementos.length === 0) return;
  console.log(`${c[color]}${c.bold}${titulo} (${elementos.length})${c.reset}`);
  for (const elemento of elementos) console.log(`  ${c[color]}•${c.reset} ${elemento}`);
  console.log('');
}

// ── Punto de entrada ──────────────────────────────────────────────────────────

function main() {
  const argumentos   = new Set(process.argv.slice(2));
  const mostrarTodas = argumentos.has('--todas');
  const conGithub    = argumentos.has('--github');

  let grafo;
  let schema;
  try {
    grafo  = JSON.parse(fs.readFileSync(GRAFO_PATH, 'utf8'));
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (error) {
    console.error(`${c.red}No se pudo leer el grafo de actividades. ${error.message}${c.reset}`);
    process.exit(1);
  }

  // Actividad → épicas a las que pertenece. Las aristas «parte-de» mal dirigidas
  // ya se reportan como error en validarEstructura, aquí solo se ignoran.
  const idsEpicas = new Set(grafo.nodos.filter(nodo => nodo.tipo === TIPO_EPICA).map(nodo => nodo.id));
  const epicaDe = new Map();
  for (const { de, a, tipo } of grafo.aristas) {
    if (tipo !== ARISTA_PARTE_DE || !idsEpicas.has(a)) continue;
    if (!epicaDe.has(de)) epicaDe.set(de, []);
    epicaDe.get(de).push(a);
  }

  const erroresEstructura = validarEstructura(grafo, schema);
  const resultadoGit      = validarGit(grafo);
  const errores = [...erroresEstructura, ...resultadoGit.errores];
  const avisos  = [...validarCoherencia(grafo, epicaDe), ...resultadoGit.avisos];

  if (conGithub) {
    try {
      avisos.push(...validarGithub(grafo));
    } catch (error) {
      avisos.push(String(error));
    }
  }

  imprimirResumen(grafo, epicaDe, { mostrarTodas });
  imprimirLista('Avisos', 'yellow', avisos);
  imprimirLista('Errores', 'red', errores);

  if (errores.length > 0) process.exit(1);
  console.log(`${c.green}✓ El grafo es válido${c.reset}${conGithub ? '' : ` ${c.dim}(usa --github para comparar con los PRs)${c.reset}`}\n`);
}

main();
