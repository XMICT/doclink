export function createReporter(moduleTitles, apiIds) {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const palette = {
    reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  };
  const c = useColor ? palette : Object.fromEntries(Object.keys(palette).map(k => [k, '']));

  const modW = Math.max(8, ...moduleTitles.map(t => t.length));
  const apiW = Math.max(8, ...apiIds.map(id => id.length));

  const modResults = [];
  const apiResults = [];

  // ── Helpers de línea ──────────────────────────────────────────────────────

  function printRule(width) {
    console.log('  ' + c.dim + '─'.repeat(width + 34) + c.reset);
  }

  function printModuleLine(r) {
    const tail = r.fileCount === 1 ? '1 archivo' : `${r.fileCount} archivos`;
    console.log(`  ${c.green}✓${c.reset}  ${c.bold}${r.title.padEnd(modW)}${c.reset}  ${c.green}${'sincronizado'.padEnd(15)}${c.reset}${c.dim}${tail}${c.reset}`);
  }

  function printApiLine(r) {
    const statusMeta = {
      built:  { icon: '✓', label: 'reconstruido',   color: c.green },
      cached: { icon: '↻', label: 'en caché',       color: c.cyan },
      plain:  { icon: '○', label: 'sin marcadores', color: c.gray },
      failed: { icon: '✗', label: 'error',          color: c.red },
    };
    const m = statusMeta[r.status];
    const tail =
      r.status === 'built'  ? `${(r.ms / 1000).toFixed(1)}s` :
      r.status === 'cached' ? 'sin cambios' :
      r.status === 'failed' ? r.error : '';
    console.log(`  ${m.color}${m.icon}${c.reset}  ${c.bold}${r.id.padEnd(apiW)}${c.reset}  ${m.color}${m.label.padEnd(15)}${c.reset}${c.dim}${tail}${c.reset}`);
  }

  // ── API pública ───────────────────────────────────────────────────────────

  return {
    startModulesTable() {
      console.log('');
      console.log(`  ${c.bold}doclink${c.reset} ${c.dim}· módulos sincronizados${c.reset}`);
      printRule(modW);
    },

    moduleDone(result) {
      modResults.push(result);
      printModuleLine(result);
    },

    endModulesTable() {
      printRule(modW);
      const totalFiles = modResults.reduce((a, r) => a + (r.fileCount ?? 0), 0);
      console.log(`  ${c.dim}${modResults.length} módulos · ${totalFiles} archivos sincronizados${c.reset}`);
    },

    startOpenApiTable() {
      console.log('');
      console.log(`  ${c.bold}doclink${c.reset} ${c.dim}· sincronización OpenAPI${c.reset}`);
      printRule(apiW);
    },

    done(result) {
      apiResults.push(result);
      printApiLine(result);
    },

    endOpenApiTable(pruned) {
      if (!apiResults.length) return;
      printRule(apiW);
      const n = s => apiResults.filter(r => r.status === s).length;
      const totalMs = apiResults.reduce((a, r) => a + (r.ms ?? 0), 0);
      const segs = [
        `${apiResults.length} módulos`,
        n('built')  && `${c.green}${n('built')} reconstruido${c.reset}`,
        n('cached') && `${c.cyan}${n('cached')} en caché${c.reset}`,
        n('plain')  && `${c.gray}${n('plain')} sin marcadores${c.reset}`,
        n('failed') && `${c.red}${n('failed')} con error${c.reset}`,
        pruned      && `${c.yellow}${pruned} podado${c.reset}`,
      ].filter(Boolean);
      console.log(`  ${c.dim}${segs.join(`${c.reset}${c.dim} · `)} · ${(totalMs / 1000).toFixed(1)}s${c.reset}`);
      console.log('');
    },
  };
}
