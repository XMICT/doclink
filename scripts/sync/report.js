const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

const STATUS_META = {
  built:  { icon: '✓', label: 'reconstruido',   colorKey: 'green' },
  cached: { icon: '↻', label: 'en caché',       colorKey: 'cyan'  },
  plain:  { icon: '○', label: 'sin marcadores', colorKey: 'gray'  },
  failed: { icon: '✗', label: 'error',          colorKey: 'red'   },
};

export function createReporter(moduleTitles, apiIds) {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const isTTY    = !!process.stdout.isTTY;
  const palette  = {
    reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  };
  const c = useColor ? palette : Object.fromEntries(Object.keys(palette).map(k => [k, '']));

  const modW = Math.max(8, ...moduleTitles.map(t => t.length));
  const apiW = Math.max(8, ...apiIds.map(id => id.length));

  const modResults = [];
  const apiResults = [];

  let handleDone  = result => { apiResults.push(result); };
  let handleStart = () => {};

  // ── Helpers de render ─────────────────────────────────────────────────────

  function printRule(width) {
    console.log('  ' + c.dim + '─'.repeat(width + 34) + c.reset);
  }

  // Reemplaza la línea en el índice i dentro del bloque de N líneas del OpenAPI live.
  // El cursor siempre queda en la posición "home": inicio de línea después de la última.
  function updateLine(i, N, content) {
    const up = N - i;
    process.stdout.write(`\x1b[${up}A\r\x1b[K${content}\x1b[${up}B\r`);
  }

  function apiLineContent(r) {
    const { icon, label, colorKey } = STATUS_META[r.status];
    const color = c[colorKey];
    const tail =
      r.status === 'built'  ? `${(r.ms / 1000).toFixed(1)}s` :
      r.status === 'cached' ? 'sin cambios' :
      r.status === 'failed' ? r.error : '';
    const n = r.warnings?.length ?? 0;
    const warnTail = n ? ` ${c.yellow}⚠ ${n} aviso${n > 1 ? 's' : ''}${c.reset}` : '';
    return `  ${color}${icon}${c.reset}  ${c.bold}${r.id.padEnd(apiW)}${c.reset}  ${color}${label.padEnd(15)}${c.reset}${c.dim}${tail}${c.reset}${warnTail}`;
  }

  function queueLineContent(id) {
    return `  ${c.dim}·${c.reset}  ${c.bold}${id.padEnd(apiW)}${c.reset}  ${c.dim}${'en cola'.padEnd(15)}${c.reset}`;
  }

  function processingLineContent(id, frame) {
    return `  ${c.dim}${SPINNER[frame]}${c.reset}  ${c.bold}${id.padEnd(apiW)}${c.reset}  ${c.yellow}${'procesando'.padEnd(15)}${c.reset}`;
  }

  // ── Tabla de módulos sincronizados ────────────────────────────────────────

  return {
    startModulesTable() {
      console.log('');
      console.log(`  ${c.bold}doclink${c.reset} ${c.dim}· módulos sincronizados${c.reset}`);
      printRule(modW);
    },

    moduleDone(result) {
      modResults.push(result);
      const tail = result.fileCount === 1 ? '1 archivo' : `${result.fileCount} archivos`;
      console.log(`  ${c.green}✓${c.reset}  ${c.bold}${result.title.padEnd(modW)}${c.reset}  ${c.green}${'sincronizado'.padEnd(15)}${c.reset}${c.dim}${tail}${c.reset}`);
    },

    endModulesTable() {
      printRule(modW);
      const totalFiles = modResults.reduce((a, r) => a + (r.fileCount ?? 0), 0);
      console.log(`  ${c.dim}${modResults.length} módulos · ${totalFiles} archivos sincronizados${c.reset}`);
    },

    // ── Tabla OpenAPI con live update ─────────────────────────────────────────

    startOpenApiTable() {
      console.log('');
      console.log(`  ${c.bold}doclink${c.reset} ${c.dim}· sincronización OpenAPI${c.reset}`);
      printRule(apiW);

      const N = apiIds.length;
      if (!N) return;

      const pending     = new Set(apiIds);
      const indexMap    = Object.fromEntries(apiIds.map((id, i) => [id, i]));
      let activeId     = null;
      let spinnerFrame = 0;
      let interval     = null;

      if (isTTY) {
        for (const id of apiIds) console.log(queueLineContent(id));

        interval = setInterval(() => {
          if (!activeId || !pending.has(activeId)) return;
          spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
          updateLine(indexMap[activeId], N, processingLineContent(activeId, spinnerFrame));
        }, 80);

        handleStart = id => {
          if (!pending.has(id)) return;
          activeId = id;
          spinnerFrame = 0;
          updateLine(indexMap[id], N, processingLineContent(id, spinnerFrame));
        };

        handleDone = result => {
          apiResults.push(result);
          pending.delete(result.id);
          if (activeId === result.id) activeId = null;
          updateLine(indexMap[result.id], N, apiLineContent(result));
          if (pending.size === 0) clearInterval(interval);
        };
      } else {
        handleStart = () => {};
        handleDone = result => {
          apiResults.push(result);
          console.log(apiLineContent(result));
        };
      }
    },

    start(id) { handleStart(id); },
    done(result) { handleDone(result); },

    endOpenApiTable(pruned) {
      if (!apiIds.length) return;
      printRule(apiW);
      const n = s => apiResults.filter(r => r.status === s).length;
      const totalMs = apiResults.reduce((a, r) => a + (r.ms ?? 0), 0);
      const withWarnings = apiResults.filter(r => r.warnings?.length);
      const segs = [
        `${apiResults.length} módulos`,
        n('built')  && `${c.green}${n('built')} reconstruido${c.reset}`,
        n('cached') && `${c.cyan}${n('cached')} en caché${c.reset}`,
        n('plain')  && `${c.gray}${n('plain')} sin marcadores${c.reset}`,
        n('failed') && `${c.red}${n('failed')} con error${c.reset}`,
        withWarnings.length && `${c.yellow}${withWarnings.length} con avisos${c.reset}`,
        pruned      && `${c.yellow}${pruned} podado${c.reset}`,
      ].filter(Boolean);
      console.log(`  ${c.dim}${segs.join(`${c.reset}${c.dim} · `)} · ${(totalMs / 1000).toFixed(1)}s${c.reset}`);

      if (withWarnings.length) {
        console.log('');
        for (const r of withWarnings) {
          for (const w of r.warnings) {
            console.log(`  ${c.yellow}⚠${c.reset}  ${c.dim}${r.id}:${c.reset} ${w.split('\n')[0]}`);
          }
        }
      }
      console.log('');
    },
  };
}
