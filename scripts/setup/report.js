export function renderSyncReport(results, prunedCount) {
  if (!results.length && !prunedCount) return;

  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const palette = {
    reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  };
  const c = useColor ? palette : Object.fromEntries(Object.keys(palette).map(k => [k, '']));

  const statusMeta = {
    built:  { icon: '✓', label: 'reconstruido',   color: c.green },
    cached: { icon: '↻', label: 'en caché',       color: c.cyan },
    plain:  { icon: '○', label: 'sin marcadores', color: c.gray },
    failed: { icon: '✗', label: 'error',          color: c.red },
  };

  const idW = Math.max(8, ...results.map(r => r.id.length));
  const rule = c.dim + '─'.repeat(idW + 34) + c.reset;

  console.log('');
  console.log(`  ${c.bold}doclink${c.reset} ${c.dim}· sincronización OpenAPI${c.reset}`);
  console.log('  ' + rule);

  for (const r of results) {
    const m = statusMeta[r.status];
    const tail =
      r.status === 'built'   ? `${(r.ms / 1000).toFixed(1)}s` :
      r.status === 'cached'  ? 'sin cambios' :
      r.status === 'failed'  ? r.error : '';
    console.log(`  ${m.color}${m.icon}${c.reset}  ${c.bold}${r.id.padEnd(idW)}${c.reset}  ${m.color}${m.label.padEnd(15)}${c.reset}${c.dim}${tail}${c.reset}`);
  }

  console.log('  ' + rule);

  const n = s => results.filter(r => r.status === s).length;
  const totalMs = results.reduce((a, r) => a + (r.ms ?? 0), 0);
  const segs = [
    `${results.length} módulos`,
    n('built')  && `${c.green}${n('built')} reconstruido${c.reset}`,
    n('cached') && `${c.cyan}${n('cached')} en caché${c.reset}`,
    n('plain')  && `${c.gray}${n('plain')} sin marcadores${c.reset}`,
    n('failed') && `${c.red}${n('failed')} con error${c.reset}`,
    prunedCount && `${c.yellow}${prunedCount} podado${c.reset}`,
  ].filter(Boolean);
  console.log(`  ${c.dim}${segs.join(`${c.reset}${c.dim} · `)} · ${(totalMs / 1000).toFixed(1)}s${c.reset}`);
  console.log('');
}
