/*
 * Puente DAX · widgets para medir DAX dentro de las diapositivas
 *
 *   <dax-lab>          consulta (o varias variantes) con Server Timings: Total, FE, SE, CPU,
 *                      consultas SE, caché, callbacks, filas/KB y planes.
 *   <dax-benchmark>    la plantilla benchmark del workshop, rellenada sola.
 *   <dax-vertipaq>     tamaños y cardinalidades del modelo (VertiPaq Analyzer), con foto antes/después.
 *   <dax-model-check>  comprueba contra el modelo los nombres de window.PUENTE_DAX_MODELO
 *                      y, en el ensayo, ejecuta una vez cada demo de la página.
 *
 * Plantillas: el DAX puede usar {{Clave}}, que se sustituye por window.PUENTE_DAX_MODELO[Clave].
 * Así las demos se adaptan a cualquier modelo cambiando un único bloque de configuración.
 *
 * Variantes:
 *   <dax-lab label="AA">
 *     <dax-variant label="AA · v1">DEFINE … EVALUATE …</dax-variant>
 *     <dax-variant label="AA · v2" note="Necesita…" role="{{Rol.X}}">…</dax-variant>
 *   </dax-lab>
 *
 * Plan B si el puente no responde (por orden): grabación incrustada en la variante
 * (<script type="application/json" data-recorded>), window.PUENTE_DAX_RECORDINGS (grabaciones.js),
 * las mediciones en vivo guardadas en este navegador, y el atributo recorded="url".
 * Sin dependencias; funciona abierto como fichero o servido por el propio puente.
 */
(() => {
  'use strict';
  if (window.customElements.get('dax-lab')) return;

  const KEY_TOKEN = 'puenteDax.token';
  const KEY_BENCH = 'puenteDax.benchmark.v1';
  const KEY_REC = 'puenteDax.recordings.v1';
  const KEY_SNAP = 'puenteDax.vertipaq.snapshots.v1';
  const SCRIPT_SRC = document.currentScript ? document.currentScript.src : '';
  const tokens = new Map();

  // ─── Utilidades ────────────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('es-ES'));
  const ms = (n) => (n === null || n === undefined ? '–' : `${num(Math.round(n))} ms`);
  const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta';
  const preview = (xmSql) => String(xmSql || '').replace(/^\s*SET DC_KIND="[^"]*";\s*/i, '').replace(/\s+/g, ' ').trim();
  const when = (t) => (t ? new Date(t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '');

  function bytes(n) {
    if (n === null || n === undefined) return '–';
    if (n < 1024) return `${num(n)} B`;
    if (n < 1024 * 1024) return `${num(Math.round(n / 102.4) / 10)} KB`;
    return `${num(Math.round(n / (1024 * 1024) * 10) / 10)} MB`;
  }

  function dedent(text) {
    const lines = String(text).replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
    const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
    const indent = indents.length ? Math.min(...indents) : 0;
    return lines.map((l) => l.slice(indent)).join('\n');
  }

  // Texto propio del elemento (sin los <script> ni los elementos hijos).
  function ownText(el) {
    const dax = el.querySelector(':scope > script[type="text/dax"]');
    if (dax) return dax.textContent;
    return [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
  }

  function inlineRecording(el) {
    const s = el.querySelector(':scope > script[type="application/json"][data-recorded]');
    return s ? s.textContent : null;
  }

  function defaultBridge() {
    if (window.PUENTE_DAX_URL) return window.PUENTE_DAX_URL;
    try {
      const u = new URL(SCRIPT_SRC);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin; // el script vino del puente
    } catch { /* sin src */ }
    return 'http://127.0.0.1:5199';
  }

  function readStore(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento no disponible */ }
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }


  // Copia al portapapeles (con plan B por si el navegador lo bloquea) y avisa en el propio botón.
  async function copyText(text, button) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* sin permiso */ }
      ta.remove();
      if (!ok) { window.prompt('Copia el texto:', text); return; }
    }
    if (button) {
      const old = button.textContent;
      button.textContent = '✓ Copiado';
      setTimeout(() => { button.textContent = old; }, 1400);
    }
  }

  // Un plan de consulta tal como lo da el motor: una línea por operador, con sangría.
  // Devuelve { depth, op, records } para pintar la tabla Línea · Registros · Operador de DAX Studio.
  function planRows(text) {
    return String(text || '').split(/\r?\n/).filter((l) => l.trim()).map((raw, i) => {
      const indent = raw.match(/^[\t ]*/)[0];
      const depth = indent.includes('\t') ? indent.split('\t').length - 1 : Math.floor(indent.length / 4);
      const body = raw.trim();
      const rec = body.match(/#Records=(\d+)/);
      return { line: i + 1, depth, body, records: rec ? Number(rec[1]) : null };
    });
  }

  // Operadores del plan que merece la pena señalar al hablar del FE.
  const PLAN_FLAGS = [
    [/Callback/i, 'cb', 'callback'],
    [/Spool/i, 'sp', 'spool'],
    [/Cache|Vertipaq/i, 'se', 'SE'],
  ];

  // ¿La consulta xmSQL agrupa por (o solo menciona) la columna indicada con {{Clave}}?
  function watchColumn(key) {
    const text = has(key) ? String(model()[key]) : String(key);
    const m = text.match(/^\s*(?:'((?:[^']|'')+)'|([^\s'\[]+))?\s*\[([^\]]+)\]\s*$/);
    return m ? { table: (m[1] || m[2] || '').replace(/''/g, "'"), column: m[3] } : null;
  }
  function watchHit(xmSql, col) {
    if (!col || !xmSql) return null;
    const q = String(xmSql);
    const name = `(?:'?${col.table ? col.table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[^\\[\\s]*'}'?)?\\[${col.column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\(\\d+\\))?\\]`;
    const re = new RegExp(name, 'i');
    const sel = q.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
    if (sel && re.test(sel[1])) return 'group';
    return re.test(q) ? 'filter' : null;
  }

  // Texto listo para pegar en un LLM: pregunta, consulta, tiempos, xmSQL y planes.
  const LLM_PROMPT = `Eres un experto en rendimiento de DAX y del motor VertiPaq (Power BI / Analysis Services).
Te paso una consulta DAX con lo que ha medido el servidor (los mismos datos que Server Timings y Query Plan de DAX Studio).
Explícame, en español y para una sala que está aprendiendo:
1. Qué hace el Storage Engine (SE) y qué hace el Formula Engine (FE) en esta consulta, apoyándote en las consultas xmSQL y en el plan físico.
2. Dónde se va el tiempo y por qué (número de consultas SE, filas y KB que viajan al FE, callbacks, granularidad a la que baja el SE).
3. Si el plan lógico y el físico cuentan lo mismo y qué operadores merecen atención.
4. Qué cambiarías en el DAX o en el modelo, y cómo comprobar con una nueva traza que ha mejorado.
No inventes datos: si algo no se puede deducir de lo que te paso, dilo.`;

  function llmReport(label, dax, response, extra) {
    const t = response.timings;
    const rows = (t.queries || []).filter((q) => q.type !== 'internal');
    const fence = (lang, body) => '```' + lang + '\n' + String(body).replace(/\s+$/, '') + '\n```';
    const parts = [
      extra || LLM_PROMPT,
      `## Consulta DAX (${label})\n${fence('dax', dax)}`,
      `## Server Timings (${response.coldCache ? 'caché fría' : 'caché caliente'})\n` + [
        `- Total: ${t.totalMs} ms`,
        `- Formula Engine: ${t.formulaEngineMs} ms`,
        `- Storage Engine: ${t.storageEngineMs} ms (CPU ${t.storageEngineCpuMs} ms${t.parallelism ? `, paralelismo ×${Math.round(t.parallelism * 10) / 10}` : ''})`,
        `- Consultas SE: ${t.storageEngineQueries} · aciertos de caché: ${t.cacheHits} · callbacks: ${t.callbacks}`,
        `- Filas y KB que el SE entrega al FE: ${t.rows} filas · ${t.kBytes} KB`,
      ].join('\n'),
    ];
    if (rows.length) {
      parts.push('## Consultas del Storage Engine (xmSQL)\n' + rows.map((q, i) =>
        `### SE ${i + 1} · ${q.type}${q.callback ? ' · CALLBACK' : ''} · ${q.durationMs} ms · CPU ${q.cpuMs} ms · ${q.rows ?? '?'} filas · ${q.kBytes ?? '?'} KB\n${fence('sql', preview(q.query))}`).join('\n\n'));
    }
    if (t.logicalPlan) parts.push(`## Plan lógico\n${fence('', t.logicalPlan)}`);
    if (t.physicalPlan) parts.push(`## Plan físico\n${fence('', t.physicalPlan)}`);
    if (!t.logicalPlan && !t.physicalPlan) parts.push('(No se pidió el plan: marca la casilla «plan» y vuelve a medir para incluirlo.)');
    return parts.join('\n\n');
  }

  // ─── Plantillas {{Clave}} contra window.PUENTE_DAX_MODELO ──────────────────
  const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const model = () => window.PUENTE_DAX_MODELO || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(model(), key);
  const resolve = (text) => String(text ?? '').replace(TEMPLATE, (all, key) => (has(key) ? String(model()[key]) : all));
  const unresolved = (text) => [...new Set([...String(text ?? '').matchAll(TEMPLATE)].map((m) => m[1]))];
  const missingKeys = (v) => unresolved([v.template, v.role, v.user].map(resolve).join('\n'));

  // ─── Llamadas al puente ────────────────────────────────────────────────────
  async function tokenFor(base, explicit) {
    if (explicit) return explicit;
    if (tokens.has(base)) return tokens.get(base);
    if (new URL(base).origin === window.location.origin) {
      try {
        const r = await fetch(`${base}/api/session-token`);
        if (r.ok) { const j = await r.json(); tokens.set(base, j.token); return j.token; }
      } catch { /* seguimos */ }
    }
    const stored = readStore(KEY_TOKEN, null);
    if (stored) { tokens.set(base, stored); return stored; }
    return '';
  }

  async function callApi(base, path, body, explicitToken) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await tokenFor(base, explicitToken);
      const res = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0 && !explicitToken) {
        const typed = window.prompt('Token del Puente DAX (aparece en la consola del puente):');
        if (!typed) throw new Error('Se necesita el token del puente.');
        tokens.set(base, typed.trim());
        writeStore(KEY_TOKEN, typed.trim());
        continue;
      }
      let data = null;
      try { data = await res.json(); } catch { /* sin cuerpo */ }
      if (!res.ok) throw new Error((data && data.error) || `El puente respondió ${res.status}`);
      return data;
    }
    throw new Error('Token rechazado por el puente.');
  }

  // ─── Grabaciones: cada medición en vivo queda guardada como plan B ─────────
  function saveRecording(label, entry) {
    const all = readStore(KEY_REC, {});
    all[label] = { ...entry, recordedAt: Date.now() };
    writeStore(KEY_REC, all);
  }

  function findRecording(label, inline) {
    if (inline) { try { return JSON.parse(inline); } catch { /* grabación incrustada no válida */ } }
    const shipped = window.PUENTE_DAX_RECORDINGS && window.PUENTE_DAX_RECORDINGS[label];
    if (shipped) return shipped;
    return readStore(KEY_REC, {})[label] || null;
  }

  function exportRecordings() {
    const merged = { ...(window.PUENTE_DAX_RECORDINGS || {}), ...readStore(KEY_REC, {}) };
    const js = '// Grabaciones del Puente DAX: plan B si el puente no responde durante la charla.\n' +
      '// Guarda este fichero junto a la presentación con el nombre grabaciones.js.\n' +
      `// Generado el ${new Date().toLocaleString('es-ES')} · ${Object.keys(merged).length} mediciones.\n` +
      `window.PUENTE_DAX_RECORDINGS = ${JSON.stringify(merged)};\n`;
    download('grabaciones.js', js, 'text/javascript');
    return Object.keys(merged).length;
  }

  // ─── Plantilla benchmark compartida ────────────────────────────────────────
  function publish(label, response, mode, bench) {
    const board = readStore(KEY_BENCH, {});
    const e = board[label] || {};
    const t = response.timings;
    const fill = (x) => {
      e.fe = x.formulaEngineMs; e.se = x.storageEngineMs; e.seQueries = x.storageEngineQueries;
      e.rows = x.rows; e.kb = x.kBytes; e.callbacks = x.callbacks;
    };
    if (mode === 'bench' && bench) {
      if (bench.summary.cold) e.coldMs = bench.summary.cold.medianTotalMs;
      if (bench.summary.warm) e.warmMs = bench.summary.warm.medianTotalMs;
      if (bench.firstCold) fill(bench.firstCold.timings);
    } else if (response.coldCache) {
      e.coldMs = t.totalMs; fill(t);
    } else {
      e.warmMs = t.totalMs;
    }
    e.source = response.source;
    e.at = Date.now();
    board[label] = e;
    writeStore(KEY_BENCH, board);
    window.dispatchEvent(new CustomEvent('dax-lab:measured', { detail: { label, response, mode } }));
  }

  // Teclado: lo que se escribe en los campos no mueve las diapositivas, pero tras pulsar un botón
  // las flechas y el espacio vuelven a la presentación.
  function isolateKeyboard(root, onCtrlEnter) {
    root.addEventListener('keydown', (e) => {
      const target = e.composedPath()[0];
      const typing = target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text'));
      if (typing) {
        if (e.key === 'Escape') { target.blur(); e.stopPropagation(); return; }
        if (onCtrlEnter && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onCtrlEnter(); }
        e.stopPropagation();
        return;
      }
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'INPUT') && (e.key === ' ' || e.key === 'Enter')) e.stopPropagation();
    });
    root.addEventListener('click', (e) => {
      const target = e.composedPath()[0];
      const el = target && target.closest ? target.closest('button, input[type=checkbox]') : null;
      if (el) setTimeout(() => el.blur(), 0);
    });
  }

  // ─── Estilos (heredan las variables del tema de las diapositivas) ──────────
  const CSS = `
    :host { display:block; font-family:var(--font-body,'IBM Plex Sans',sans-serif); color:var(--fg,#d6efe3); font-size:16px;
      --dl-se:var(--se,#3dfc8f); --dl-fe:var(--fe,#ffb347); --dl-cb:var(--cb,#ff5c6c); --dl-info:var(--info,#5fd4ff);
      --dl-muted:var(--muted,#7fa595); --dl-line:rgba(61,252,143,.22); --dl-mono:var(--font-mono,'IBM Plex Mono',monospace); }
    .box { background:rgba(2,10,7,.94); border:1px solid var(--dl-line); border-radius:14px; overflow:hidden; text-align:left; height:100%; display:flex; flex-direction:column; }
    .head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--dl-line); flex-wrap:wrap; }
    .label, .title { font-family:var(--font-title,var(--dl-mono)); font-weight:700; font-size:19px; margin-right:auto; color:#f2fff8; }
    button { font:600 14px var(--dl-mono); color:var(--dl-se); background:transparent; border:1px solid var(--dl-se); border-radius:8px; padding:6px 11px; cursor:pointer; }
    button:hover { background:rgba(61,252,143,.12); }
    button.warm { color:var(--dl-info); border-color:var(--dl-info); }
    button.ghost { color:var(--dl-muted); border-color:rgba(127,165,149,.5); }
    button[disabled] { opacity:.4; cursor:wait; }
    label.opt { font:13px var(--dl-mono); color:var(--dl-muted); display:flex; align-items:center; gap:4px; cursor:pointer; }
    .variants { display:flex; gap:6px; flex-wrap:wrap; padding:8px 14px; border-bottom:1px solid var(--dl-line); }
    .pill { font:600 13px var(--dl-mono); color:var(--dl-muted); border:1px solid rgba(127,165,149,.45); border-radius:999px; padding:4px 11px; }
    .pill.on { color:#04100b; background:var(--dl-se); border-color:var(--dl-se); }
    .pill .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--dl-se); margin-left:6px; vertical-align:middle; }
    .pill.on .dot { background:#04100b; }
    .pill.todo { border-style:dashed; }
    .note { padding:6px 14px; font:13px var(--dl-mono); color:var(--dl-fe); border-bottom:1px solid var(--dl-line); }
    textarea { display:block; width:100%; box-sizing:border-box; min-height:var(--dl-editor-height,120px); height:var(--dl-editor-height,120px); background:#020a07; color:#cfe9dc;
      border:0; border-bottom:1px solid var(--dl-line); font:15px/1.5 var(--dl-mono); padding:12px 14px; resize:vertical; outline:none; tab-size:4; }
    .status { display:flex; gap:10px; align-items:center; padding:8px 14px 0; font:13px var(--dl-mono); color:var(--dl-muted); min-height:22px; flex-wrap:wrap; }
    .badge { font:600 12px var(--dl-mono); letter-spacing:.12em; padding:2px 8px; border-radius:999px; border:1px solid currentColor; }
    .live { color:var(--dl-se); } .mock { color:var(--dl-fe); } .recorded { color:var(--dl-info); } .err { color:var(--dl-cb); } .ok { color:var(--dl-se); }
    .spin { width:12px; height:12px; border:2px solid var(--dl-se); border-right-color:transparent; border-radius:50%; animation:r .8s linear infinite; }
    @keyframes r { to { transform:rotate(360deg); } }
    .out { flex:1; min-height:0; display:flex; flex-direction:column; }
    .bar { display:flex; height:18px; margin:10px 14px 2px; border-radius:9px; overflow:hidden; background:rgba(255,255,255,.05); flex:none; }
    .bar div { transition:width .5s ease; } .bar .fe { background:var(--dl-fe); } .bar .se { background:var(--dl-se); }
    .legend { display:flex; justify-content:space-between; padding:0 14px; font:12px var(--dl-mono); color:var(--dl-muted); }
    .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; padding:10px 14px 4px; flex:none; }
    .kpi { background:rgba(61,252,143,.05); border:1px solid var(--dl-line); border-radius:10px; padding:7px 10px; min-width:0; }
    .kpi b { display:block; font:600 21px var(--dl-mono); color:#f2fff8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .kpi span { font:11px var(--dl-mono); color:var(--dl-muted); letter-spacing:.1em; text-transform:uppercase; }
    .kpi.fe b { color:var(--dl-fe); } .kpi.se b { color:var(--dl-se); } .kpi.cb { border-color:var(--dl-cb); } .kpi.cb b { color:var(--dl-cb); }
    .tabs { display:flex; gap:2px; padding:8px 14px 0; border-bottom:1px solid var(--dl-line); align-items:flex-end; flex:none; }
    .tab { border:1px solid transparent; border-bottom:0; border-radius:8px 8px 0 0; color:var(--dl-muted); padding:5px 10px; }
    .tab.on { color:#f2fff8; border-color:var(--dl-line); background:rgba(61,252,143,.06); }
    .tabs .opt { margin-left:auto; padding-bottom:5px; }
    .panel { max-height:var(--dl-panel-height,220px); overflow:auto; padding:6px 14px 12px; }
    .fill .panel { max-height:none; flex:1; min-height:0; }
    table { width:100%; border-collapse:collapse; font:13px var(--dl-mono); }
    th { text-align:left; color:var(--dl-muted); font-weight:500; padding:5px 6px; border-bottom:1px solid var(--dl-line); position:sticky; top:0; background:#04100b; }
    td { padding:4px 6px; border-bottom:1px solid rgba(61,252,143,.08); vertical-align:top; }
    td.n, th.n { text-align:right; white-space:nowrap; }
    tr.callback td { color:var(--dl-cb); font-weight:700; }
    tr.cache td { color:var(--dl-muted); }
    tr.focus td { background:rgba(95,212,255,.08); }
    tr.focus td:first-child { box-shadow:inset 3px 0 0 var(--dl-info); }
    td.q { width:52%; max-width:0; cursor:pointer; }
    td.q .short { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    td.q .full { display:none; white-space:pre-wrap; }
    td.q.open .short { display:none; } td.q.open .full { display:block; }
    td.sizebar { width:22%; }
    .sb { height:10px; border-radius:5px; background:linear-gradient(90deg,var(--dl-se),rgba(61,252,143,.25)); }
    .up { color:var(--dl-cb); } .down { color:var(--dl-se); }
    pre.plan { font:13px/1.45 var(--dl-mono); white-space:pre; margin:0; color:#cfe9dc; }
    .msg { padding:10px 14px; font-size:14px; color:var(--dl-muted); }
    .msg.err { color:var(--dl-cb); }
    .bench { padding:4px 14px 0; flex:none; }
    .hidden { display:none !important; }
    .tools { display:flex; gap:8px; align-items:center; padding:2px 0 8px; flex-wrap:wrap; }
    .tools .hint { font:12px var(--dl-mono); color:var(--dl-muted); margin-right:auto; }
    button.llm { color:#04100b; background:var(--dl-info); border-color:var(--dl-info); }
    button.llm:hover { background:#8fe2ff; }
    .tl { position:relative; margin:6px 0 10px; border:1px solid var(--dl-line); border-radius:10px; padding:8px 10px 10px; background:rgba(255,179,71,.05); }
    .tl .lane { position:relative; height:14px; margin-top:4px; border-radius:7px; background:repeating-linear-gradient(90deg,rgba(255,179,71,.18) 0 6px,rgba(255,179,71,.08) 6px 12px); }
    .tl .seg { position:absolute; top:0; bottom:0; border-radius:7px; background:var(--dl-se); min-width:3px; }
    .tl .seg.cb { background:var(--dl-cb); } .tl .seg.cache { background:var(--dl-muted); }
    .tl .cap { font:11px var(--dl-mono); color:var(--dl-muted); display:flex; justify-content:space-between; }
    .tl .cap i { font-style:normal; color:var(--dl-fe); }
    .watch { font:12px var(--dl-mono); color:var(--dl-fe); padding:2px 0 8px; }
    .watch b { color:var(--dl-cb); }
    span.grain { font:600 11px var(--dl-mono); border:1px solid var(--dl-cb); color:var(--dl-cb); border-radius:999px; padding:0 6px; margin-right:6px; white-space:nowrap; }
    span.grain.f { border-color:var(--dl-muted); color:var(--dl-muted); }
    table.plant td.ln, table.plant th.ln { width:34px; text-align:right; color:var(--dl-muted); }
    table.plant td.rc { width:70px; text-align:right; color:var(--dl-info); }
    table.plant td.op { white-space:pre; }
    table.plant tr.cb td.op { color:var(--dl-cb); font-weight:700; }
    table.plant tr.sp td.op { color:var(--dl-fe); }
    table.plant tr.se td.op { color:var(--dl-se); }
    .fe-note { font:13px/1.5 var(--dl-mono); color:var(--dl-muted); padding:2px 0 8px; }
    .fe-note b { color:var(--dl-fe); }
    .compact .label, .compact .title { font-size:17px; }
    .compact textarea { font-size:14px; }
    .box.big .kpis { grid-template-columns:repeat(2,1fr); gap:10px; padding:12px 14px 6px; }
    .box.big .kpi { padding:10px 14px; }
    .box.big .kpi b { font-size:34px; }
    .box.big .kpi span { font-size:12px; letter-spacing:.08em; }
    .compact .kpis { grid-template-columns:repeat(8,1fr); gap:6px; }
    .compact .kpi { padding:5px 7px; }
    .compact .kpi b { font-size:16px; }
    .compact .kpi span { font-size:9.5px; letter-spacing:.05em; }
    .compact button { font-size:13px; padding:5px 9px; }
  `;

  function sourceBadge(source, at) {
    const text = { live: 'EN VIVO', mock: 'SIMULADO', recorded: 'GRABADO' }[source] || source;
    return `<span class="badge ${esc(source)}">${esc(text)}</span>${source === 'recorded' && at ? `<span>${esc(when(at))}</span>` : ''}`;
  }

  // Variantes declaradas en un <dax-lab> (o la propia consulta si no tiene <dax-variant>).
  function variantsOf(lab) {
    const children = [...lab.querySelectorAll(':scope > dax-variant')];
    const source = children.length ? children : [lab];
    return source.map((el) => ({
      label: (el === lab ? lab.getAttribute('label') : el.getAttribute('label')) || 'Consulta DAX',
      template: dedent(el === lab && lab.getAttribute('dax') ? lab.getAttribute('dax') : ownText(el)),
      role: el.getAttribute('role'),
      user: el.getAttribute('user'),
      note: el.getAttribute('note'),
      inline: inlineRecording(el),
      text: null,
      last: null,
    }));
  }

  // ─── <dax-lab> ─────────────────────────────────────────────────────────────
  class DaxLab extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this._variants = variantsOf(this);
      this._variants.forEach((v) => { v.text = resolve(v.template); });
      this._active = -1;
      this._tab = 'se';
      this._showInternal = false;

      const root = this.attachShadow({ mode: 'open' });
      for (const [attr, prop] of [['editor-height', '--dl-editor-height'], ['panel-height', '--dl-panel-height']]) {
        if (this.getAttribute(attr)) this.style.setProperty(prop, this.getAttribute(attr));
      }
      root.innerHTML = `
        <style>${CSS}</style>
        <div class="box ${this.hasAttribute('compact') ? 'compact' : ''} ${this.hasAttribute('fill') ? 'fill' : ''}">
          <div class="head">
            <span class="label"></span>
            <button data-run="cold" title="Limpia la caché y ejecuta (Ctrl+Enter)">▶ Frío</button>
            <button data-run="warm" class="warm" title="Ejecuta sin limpiar la caché">▶ Caliente</button>
            <button data-run="bench" class="ghost" title="Varias ejecuciones en frío y en caliente">⏱ Benchmark</button>
            <label class="opt"><input type="checkbox" data-plan> plan</label>
            <button data-llm class="llm hidden" title="Copia consulta, tiempos, xmSQL y planes en un texto listo para pegar en un LLM">🤖 Copiar para LLM</button>
            <button data-save class="ghost" title="Guardar la medición como JSON">⤓</button>
          </div>
          <div class="variants ${this._variants.length > 1 ? '' : 'hidden'}"></div>
          <div class="note hidden"></div>
          <textarea spellcheck="false"></textarea>
          <div class="status"></div>
          <div class="out"></div>
        </div>`;
      root.querySelector('.label').textContent = this.getAttribute('label') || this._variants[0].label;
      this._editor = root.querySelector('textarea');
      this._status = root.querySelector('.status');
      this._out = root.querySelector('.out');
      this._note = root.querySelector('.note');
      this._pills = root.querySelector('.variants');
      this._plan = root.querySelector('[data-plan]');
      this._plan.checked = this.hasAttribute('plan');
      this._buttons = [...root.querySelectorAll('.head button')];
      root.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => this.run(b.dataset.run)));
      root.querySelector('[data-save]').addEventListener('click', () => this.save());
      this._llm = root.querySelector('[data-llm]');
      this._llm.addEventListener('click', () => this.copyForLlm());
      isolateKeyboard(root, () => this.run('cold'));

      this._pills.innerHTML = this._variants.map((v, i) =>
        `<button class="pill ${missingKeys(v).length ? 'todo' : ''}" data-i="${i}" title="${esc(v.note || v.label)}">${esc(v.label)}<span class="dot hidden"></span></button>`).join('');
      this._pills.querySelectorAll('.pill').forEach((p) => p.addEventListener('click', () => this.select(Number(p.dataset.i))));
      this.select(0);
    }

    get bridge() { return (this.getAttribute('bridge') || defaultBridge()).replace(/\/$/, ''); }
    get variant() { return this._variants[this._active]; }

    select(index) {
      if (this._variants[this._active]) this._variants[this._active].text = this._editor.value;
      this._active = index;
      const v = this.variant;
      this._editor.value = v.text;
      this._pills.querySelectorAll('.pill').forEach((p, i) => p.classList.toggle('on', i === index));
      const missing = missingKeys(v);
      const noteText = [v.note, missing.length ? `Falta en PUENTE_DAX_MODELO: ${missing.join(', ')}` : ''].filter(Boolean).join(' · ');
      this._note.textContent = noteText;
      this._note.classList.toggle('hidden', !noteText);
      if (v.last) this._render(v.last.response, v.last.bench, v.last.recordedAt);
      else { this._out.innerHTML = ''; this._llm.classList.add('hidden'); this._setStatus('', 'Listo para medir. Ctrl+Enter ejecuta en frío.'); }
    }

    async run(mode) {
      const v = this.variant;
      v.text = this._editor.value;
      const dax = resolve(v.text).trim();
      if (!dax) return;
      const missing = unresolved(dax);
      if (missing.length) {
        await this._fallback(new Error(`Falta configurar en PUENTE_DAX_MODELO: ${missing.join(', ')}`));
        return;
      }
      const role = v.role ? resolve(v.role) : null;
      const user = v.user ? resolve(v.user) : null;
      this._busy(true, mode);
      try {
        if (mode === 'bench') {
          const bench = await callApi(this.bridge, '/api/benchmark',
            { dax, cold: Number(this.getAttribute('cold')) || 3, warm: Number(this.getAttribute('warm')) || 3 },
            this.getAttribute('token'));
          const shown = bench.firstCold || bench.lastWarm;
          this._done(v, dax, shown, bench, 'bench');
        } else {
          const response = await callApi(this.bridge, '/api/query', {
            dax, clearCache: mode === 'cold', includePlan: this._plan.checked,
            maxRows: Number(this.getAttribute('rows')) || 20, role, effectiveUser: user,
          }, this.getAttribute('token'));
          this._done(v, dax, response, null, mode);
        }
      } catch (err) {
        await this._fallback(err);
      } finally {
        this._busy(false);
      }
    }

    _done(v, dax, response, bench, mode) {
      v.last = { response, bench, recordedAt: null };
      this._render(response, bench);
      publish(v.label, response, mode, bench);
      if (response.source === 'live') saveRecording(v.label, { label: v.label, dax, response, benchmark: bench });
      const dot = this._pills.querySelectorAll('.pill .dot')[this._active];
      if (dot) dot.classList.remove('hidden');
    }

    async _fallback(err) {
      const v = this.variant;
      let rec = findRecording(v.label, v.inline);
      if (!rec && this.getAttribute('recorded')) {
        try { rec = await (await fetch(this.getAttribute('recorded'))).json(); } catch { /* sin grabación */ }
      }
      if (rec && (rec.response || rec.timings)) {
        const response = { ...(rec.response || rec), source: 'recorded' };
        v.last = { response, bench: rec.benchmark || null, recordedAt: rec.recordedAt };
        this._render(response, rec.benchmark || null, rec.recordedAt);
        this._status.innerHTML = `${sourceBadge('recorded', rec.recordedAt)}
          <span class="err">Puente no disponible (${esc(err.message)}). Se muestra la medición grabada.</span>`;
        return;
      }
      const hint = err instanceof TypeError
        ? `No hay respuesta de ${this.bridge}. ¿Está arrancado el Puente DAX (Herramientas externas de Power BI Desktop)?`
        : err.message;
      this._setStatus('err', hint);
    }

    save() {
      const v = this.variant;
      if (!v.last) { this._setStatus('err', 'Aún no hay ninguna medición que guardar.'); return; }
      const payload = { label: v.label, dax: resolve(v.text), response: v.last.response, benchmark: v.last.bench };
      download(`${slug(v.label)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    }

    copyForLlm() {
      const v = this.variant;
      if (!v.last) { this._setStatus('err', 'Aún no hay ninguna medición que copiar.'); return; }
      const extra = this.getAttribute('llm-prompt');
      copyText(llmReport(v.label, resolve(v.text), v.last.response, extra), this._llm);
    }

    _busy(on, mode) {
      this._buttons.forEach((b) => { b.disabled = on; });
      if (on) {
        const what = { cold: 'Limpiando caché y ejecutando…', warm: 'Ejecutando con caché caliente…', bench: 'Benchmark en curso…' }[mode];
        this._status.innerHTML = `<span class="spin"></span><span>${esc(what)}</span>`;
      }
    }

    _setStatus(kind, text) {
      this._status.innerHTML = kind === 'err' ? `<span class="badge err">ERROR</span><span class="err">${esc(text)}</span>` : `<span>${esc(text)}</span>`;
      if (kind === 'err') this._out.innerHTML = '';
    }

    _render(response, bench, recordedAt) {
      const t = response.timings;
      const total = Math.max(t.totalMs, 1);
      const fePct = Math.round((t.formulaEngineMs / total) * 100);
      const sePct = 100 - fePct;
      const measured = response.measuredAt ? new Date(response.measuredAt).toLocaleTimeString('es-ES') : '';
      this._status.innerHTML = `${sourceBadge(response.source, recordedAt)}
        <span>${response.coldCache ? 'caché fría' : 'caché caliente'}</span><span>${esc(response.source === 'recorded' ? '' : measured)}</span>`;

      const par = t.parallelism ? ` ×${num(t.parallelism)}` : '';
      const hasPlan = Boolean(t.logicalPlan || t.physicalPlan);
      const hasMetrics = Boolean(t.executionMetrics);
      if (this._tab === 'plan' && !hasPlan) this._tab = 'se';
      if (this._tab === 'met' && !hasMetrics) this._tab = 'se';

      this._out.innerHTML = `
        <div class="bar" title="FE ${fePct}% · SE ${sePct}%"><div class="fe" style="width:${fePct}%"></div><div class="se" style="width:${sePct}%"></div></div>
        <div class="legend"><span>FE ${fePct}%</span><span>SE ${sePct}%</span></div>
        <div class="kpis">
          <div class="kpi"><b>${ms(t.totalMs)}</b><span>Total</span></div>
          <div class="kpi fe"><b>${ms(t.formulaEngineMs)}</b><span>FE</span></div>
          <div class="kpi se"><b>${ms(t.storageEngineMs)}</b><span>SE</span></div>
          <div class="kpi"><b>${ms(t.storageEngineCpuMs)}<small>${esc(par)}</small></b><span>SE CPU · paralelismo</span></div>
          <div class="kpi"><b>${num(t.storageEngineQueries)}</b><span>Consultas SE</span></div>
          <div class="kpi"><b>${num(t.cacheHits)}</b><span>Aciertos caché</span></div>
          <div class="kpi ${t.callbacks ? 'cb' : ''}"><b>${num(t.callbacks)}</b><span>Callbacks</span></div>
          <div class="kpi"><b>${num(t.rows)} · ${num(t.kBytes)}</b><span>Filas · KB</span></div>
        </div>
        ${bench ? this._benchHtml(bench) : ''}
        <div class="tabs">
          <button class="tab" data-tab="se">Storage Engine</button>
          <button class="tab" data-tab="fe">Formula Engine</button>
          <button class="tab ${hasPlan ? '' : 'hidden'}" data-tab="plan">Plan</button>
          <button class="tab" data-tab="res">Resultado</button>
          <button class="tab ${hasMetrics ? '' : 'hidden'}" data-tab="met">Métricas</button>
          <label class="opt"><input type="checkbox" data-internal ${this._showInternal ? 'checked' : ''}> internas</label>
        </div>
        <div class="panel"></div>`;

      this._response = response;
      this._llm.classList.remove('hidden');
      this._out.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this._renderPanel(); }));
      this._out.querySelector('[data-internal]').addEventListener('change', (e) => { this._showInternal = e.target.checked; this._renderPanel(); });
      this._renderPanel();
    }

    _benchHtml(bench) {
      const row = (name, s) => (s ? `<tr><td>${name}</td><td class="n">${num(s.runs)}</td><td class="n">${ms(s.medianTotalMs)}</td>
        <td class="n">${ms(s.medianFormulaEngineMs)}</td><td class="n">${ms(s.medianStorageEngineMs)}</td><td class="n">${ms(s.minTotalMs)} – ${ms(s.maxTotalMs)}</td></tr>` : '');
      return `<div class="bench"><table>
        <thead><tr><th>Benchmark</th><th class="n">Ejec.</th><th class="n">Mediana</th><th class="n">FE</th><th class="n">SE</th><th class="n">Rango</th></tr></thead>
        <tbody>${row('Frío', bench.summary.cold)}${row('Caliente', bench.summary.warm)}</tbody></table></div>`;
    }

    _renderPanel() {
      const t = this._response.timings;
      const panel = this._out.querySelector('.panel');
      this._out.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this._tab));
      const wire = (sel, fn) => panel.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => fn(el, e)));

      if (this._tab === 'res') {
        const r = this._response.result;
        panel.innerHTML = `<table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${r.rows.map((row) => `<tr>${row.map((v) => `<td class="${typeof v === 'number' ? 'n' : ''}">${esc(typeof v === 'number' ? num(v) : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
          <div class="msg">${num(r.rowCount)} filas${r.truncated ? ` · se muestran ${num(r.rows.length)}` : ''}</div>`;
        return;
      }
      if (this._tab === 'plan') {
        const block = (title, id, text) => (text ? `<div class="tools"><span class="hint">${title}</span><button class="ghost" data-copy="${id}">Copiar</button></div>${this._planTable(text)}` : '');
        panel.innerHTML = `<div class="tools"><span class="hint">El plan lógico dice «qué»; el físico, «cómo»: el que se lleva al LLM.</span><button class="ghost" data-copy="both">Copiar los dos planes</button></div>
          ${block('Plan físico', 'physical', t.physicalPlan)}${block('Plan lógico', 'logical', t.logicalPlan)}`;
        wire('[data-copy]', (el) => copyText({ physical: t.physicalPlan, logical: t.logicalPlan,
          both: [t.logicalPlan && `-- Plan lógico\n${t.logicalPlan}`, t.physicalPlan && `-- Plan físico\n${t.physicalPlan}`].filter(Boolean).join('\n\n') }[el.dataset.copy] || '', el));
        return;
      }
      if (this._tab === 'met') {
        let pretty = t.executionMetrics;
        try { pretty = JSON.stringify(JSON.parse(t.executionMetrics), null, 2); } catch { /* texto tal cual */ }
        panel.innerHTML = `<pre class="plan">${esc(pretty)}</pre>`;
        return;
      }
      if (this._tab === 'fe') { this._renderFormulaEngine(panel, t); return; }

      // Storage Engine: lo que DAX Studio enseña en Server Timings
      const rows = (t.queries || []).filter((q) => this._showInternal || q.type !== 'internal');
      if (!rows.length) { panel.innerHTML = '<div class="msg">La consulta no ha necesitado al Storage Engine.</div>'; return; }
      const typeName = { scan: 'Scan', batch: 'Batch', internal: 'Interna', cache: 'Caché', directquery: 'SQL' };
      const watchKey = this.getAttribute('watch');
      const col = watchKey ? watchColumn(watchKey) : null;
      const hits = rows.map((q) => (q.type === 'cache' ? null : watchHit(q.query, col)));
      const grouped = hits.filter((h) => h === 'group').length;
      const real = rows.filter((q) => q.type !== 'cache').length;
      const watchLine = col ? `<div class="watch">¿Baja a <b>${esc(col.table ? `${col.table}[${col.column}]` : col.column)}</b>? ${
        grouped ? `<b>Sí:</b> ${grouped} de ${real} consultas SE agrupan por esa columna.` : `No: ninguna de las ${real} consultas SE agrupa por esa columna.`}</div>` : '';
      panel.innerHTML = `${watchLine}<div class="tools"><span class="hint">Clic en una fila para ver el xmSQL entero.</span>
        <button class="ghost" data-copy="all">Copiar todo el xmSQL</button></div><table>
        <thead><tr><th class="n">#</th><th>Tipo</th><th class="n">Inicio</th><th class="n">ms</th><th class="n">CPU</th><th class="n">Filas</th><th class="n">KB</th><th>xmSQL</th></tr></thead>
        <tbody>${rows.map((q, i) => `<tr class="${q.callback ? 'callback' : ''} ${q.type === 'cache' ? 'cache' : ''}">
          <td class="n">${q.line}</td><td>${esc(typeName[q.type] || q.type)}${q.callback ? ' ⚠' : ''}${q.inBatch ? ' ↳' : ''}</td>
          <td class="n">${num(q.startOffsetMs)}</td><td class="n">${num(q.durationMs)}</td><td class="n">${num(q.cpuMs)}</td>
          <td class="n">${num(q.rows)}</td><td class="n">${num(q.kBytes)}</td>
          <td class="q" data-i="${i}"><div class="short">${hits[i] ? `<span class="grain ${hits[i] === 'group' ? '' : 'f'}">${hits[i] === 'group' ? 'AGRUPA' : 'FILTRA'}</span>` : ''}${esc(preview(q.query))}</div><div class="full">${esc(q.query)}</div></td></tr>`).join('')}</tbody></table>`;
      wire('td.q', (td) => td.classList.toggle('open'));
      wire('[data-copy]', (el) => copyText(rows.map((q, i) => `-- SE ${i + 1} · ${q.type} · ${q.durationMs} ms · ${q.rows ?? '?'} filas\n${preview(q.query)}`).join('\n\n'), el));
    }

    // Plan como tabla Línea · Registros · Operador (la vista Query Plan de DAX Studio).
    _planTable(text) {
      const rows = planRows(text);
      return `<table class="plant"><thead><tr><th class="ln">#</th><th class="rc">Registros</th><th>Operador</th></tr></thead><tbody>${rows.map((r) => {
        const flag = PLAN_FLAGS.find(([re]) => re.test(r.body));
        return `<tr class="${flag ? flag[1] : ''}"><td class="ln">${r.line}</td><td class="rc">${r.records === null ? '' : num(r.records)}</td>
          <td class="op">${esc('  '.repeat(r.depth) + r.body.replace(/\s+/g, ' '))}</td></tr>`;
      }).join('')}</tbody></table>`;
    }

    // Formula Engine: no emite eventos; su tiempo son los huecos en los que no corre ningún SE.
    _renderFormulaEngine(panel, t) {
      const total = Math.max(t.totalMs, 1);
      const real = (t.queries || []).filter((q) => q.type !== 'internal' && !q.inBatch);
      const seg = real.map((q) => {
        const left = Math.min(100, (q.startOffsetMs / total) * 100);
        const width = Math.max(0.6, Math.min(100 - left, (q.durationMs / total) * 100));
        return `<div class="seg ${q.callback ? 'cb' : ''} ${q.type === 'cache' ? 'cache' : ''}" style="left:${left}%;width:${width}%" title="SE ${q.line} · ${q.durationMs} ms"></div>`;
      }).join('');
      const sePct = Math.round((t.storageEngineMs / total) * 100);
      const fePct = Math.round((t.formulaEngineMs / total) * 100);
      const planRowsList = t.physicalPlan ? planRows(t.physicalPlan) : [];
      const flagged = planRowsList.filter((r) => PLAN_FLAGS.some(([re, k]) => k !== 'se' && re.test(r.body)));
      const ops = {};
      planRowsList.forEach((r) => { const op = r.body.split(':')[0].replace(/<.*$/, '').trim(); ops[op] = (ops[op] || 0) + 1; });
      const top = Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 8);
      panel.innerHTML = `
        <div class="fe-note">El FE <b>no emite eventos</b>: su tiempo son los <b>huecos</b> (zona naranja) en los que ningún SE trabaja.
          Aquí: FE <b>${ms(t.formulaEngineMs)}</b> (${fePct}%) y SE <b>${ms(t.storageEngineMs)}</b> (${sePct}%).
          ${t.callbacks ? `<b>${t.callbacks} callback${t.callbacks > 1 ? 's' : ''}</b>: el SE vuelve al FE fila a fila.` : 'Sin callbacks.'}</div>
        <div class="tl"><div class="cap"><span>0 ms</span><i>FE = lo naranja</i><span>${ms(t.totalMs)}</span></div><div class="lane">${seg}</div></div>
        ${t.physicalPlan ? `<div class="tools"><span class="hint">${top.map(([k, n]) => `${esc(k)} ×${n}`).join(' · ')}</span><button class="ghost" data-copy="plan">Copiar plan físico</button></div>
          ${flagged.length ? this._planTable(flagged.map((r) => '\t'.repeat(r.depth) + r.body).join('\n')) : '<div class="msg">El plan físico no tiene callbacks ni spools.</div>'}`
          : '<div class="msg">Marca la casilla «plan» y vuelve a medir para ver el plan físico y los operadores del FE.</div>'}`;
      panel.querySelectorAll('[data-copy]').forEach((el) => el.addEventListener('click', () => copyText(t.physicalPlan || '', el)));
    }
  }

  // ─── <dax-benchmark> ───────────────────────────────────────────────────────
  class DaxBenchmark extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this._filters = (this.getAttribute('filter') || '').split('|').map((f) => f.trim()).filter(Boolean);
      this._compact = this.hasAttribute('compact');
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS} td.mark { color:var(--dl-fe); font-size:11px; }</style>
        <div class="box ${this._compact ? 'compact' : ''}">
          <div class="head"><span class="title">${esc(this.getAttribute('title') || 'Plantilla benchmark')}</span>
            <button data-copy class="ghost" title="Copiar como tabla (pegar en Excel)">Copiar</button>
            <button data-clear class="ghost" title="Vaciar las filas de esta tabla">Vaciar</button>
            <button data-export class="ghost ${this.hasAttribute('export') ? '' : 'hidden'}" title="Descargar grabaciones.js (plan B)">⤓ grabaciones.js</button></div>
          <div class="panel" style="max-height:none;flex:1"></div>
        </div>`;
      root.querySelector('[data-copy]').addEventListener('click', () => this.copy());
      root.querySelector('[data-clear]').addEventListener('click', () => this.clear());
      root.querySelector('[data-export]').addEventListener('click', () => {
        const n = exportRecordings();
        this._panel.insertAdjacentHTML('afterbegin', `<div class="msg ok">Exportadas ${num(n)} mediciones en grabaciones.js.</div>`);
      });
      isolateKeyboard(root);
      this._panel = root.querySelector('.panel');
      this._onMeasured = () => this.render();
      window.addEventListener('dax-lab:measured', this._onMeasured);
      window.addEventListener('storage', this._onMeasured);
      this.render();
    }

    disconnectedCallback() {
      window.removeEventListener('dax-lab:measured', this._onMeasured);
      window.removeEventListener('storage', this._onMeasured);
    }

    matches(label) { return !this._filters.length || this._filters.some((f) => label.startsWith(f)); }

    entries() {
      return Object.entries(readStore(KEY_BENCH, {})).filter(([label]) => this.matches(label)).sort((a, b) => a[1].at - b[1].at);
    }

    clear() {
      const board = readStore(KEY_BENCH, {});
      Object.keys(board).filter((label) => this.matches(label)).forEach((label) => delete board[label]);
      writeStore(KEY_BENCH, board);
      window.dispatchEvent(new CustomEvent('dax-lab:measured', { detail: {} }));
    }

    render() {
      const list = this.entries();
      if (!list.length) {
        this._panel.innerHTML = '<div class="msg">Ejecuta las variantes y aparecerán aquí para compararlas.</div>';
        return;
      }
      const note = { mock: 'simulado', recorded: 'grabado' };
      const head = this._compact
        ? '<th>Variante</th><th class="n">Frío</th><th class="n">Cal.</th><th class="n">SE</th><th class="n">Nº SE</th><th>CB</th>'
        : '<th>Variante</th><th class="n">Frío ms</th><th class="n">Caliente ms</th><th class="n">FE ms</th><th class="n">SE ms</th><th class="n">Nº SE</th><th class="n">Filas</th><th class="n">KB</th><th>Callback</th><th></th>';
      const row = ([label, e]) => {
        const cb = e.callbacks ? 'sí' : (e.callbacks === 0 ? 'no' : '–');
        const shortLabel = this._filters.length ? label.replace(/^[^·]*·\s*/, '') : label;
        return this._compact
          ? `<tr class="${e.callbacks ? 'callback' : ''}" title="${esc(note[e.source] || '')}"><td>${esc(shortLabel)}</td><td class="n">${num(e.coldMs)}</td><td class="n">${num(e.warmMs)}</td><td class="n">${num(e.se)}</td><td class="n">${num(e.seQueries)}</td><td>${cb}</td></tr>`
          : `<tr class="${e.callbacks ? 'callback' : ''}"><td>${esc(label)}</td><td class="n">${num(e.coldMs)}</td><td class="n">${num(e.warmMs)}</td><td class="n">${num(e.fe)}</td>
            <td class="n">${num(e.se)}</td><td class="n">${num(e.seQueries)}</td><td class="n">${num(e.rows)}</td><td class="n">${num(e.kb)}</td>
            <td>${cb}</td><td class="mark">${esc(note[e.source] || '')}</td></tr>`;
      };
      this._panel.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${list.map(row).join('')}</tbody></table>`;
    }

    async copy() {
      const head = ['Variante', 'Frío ms', 'Caliente ms', 'FE ms', 'SE ms', 'Nº SE', 'Filas', 'KB', 'Callback'];
      const lines = [head.join('\t')].concat(this.entries().map(([label, e]) =>
        [label, e.coldMs, e.warmMs, e.fe, e.se, e.seQueries, e.rows, e.kb, e.callbacks ? 'sí' : 'no'].map((v) => v ?? '').join('\t')));
      try { await navigator.clipboard.writeText(lines.join('\n')); } catch { window.prompt('Copia la tabla:', lines.join('\n')); }
    }
  }

  // ─── <dax-vertipaq> ────────────────────────────────────────────────────────
  // focus="Ventas.Pedido, {{Ventas.Importe}}, 'Date'[CalendarYear]" resalta columnas concretas.
  // big: indicadores grandes (también en compact). compare-with="id": «Comparar» enfrenta este modelo con el de
  // otro <dax-vertipaq> de la página (sin foto); compare-label="ANTES" da nombre a la referencia.
  // no-compare: sin botones de foto ni de comparación (el modelo de referencia).
  function parseColumnRef(ref) {
    const value = has(ref.trim()) ? String(model()[ref.trim()]) : resolve(ref.trim());
    const m = value.match(/^'?(.*?)'?\[(.+)\]$/);
    return m ? { table: m[1], column: m[2], text: value } : null;
  }

  class DaxVertipaq extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this._label = this.getAttribute('label') || 'vertipaq';
      this._snapName = this.getAttribute('snapshot') || 'foto';
      this._compare = false;
      const withOther = this.hasAttribute('compare-with');
      const noCompare = this.hasAttribute('no-compare');
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="box ${this.hasAttribute('compact') ? 'compact' : ''} ${this.hasAttribute('big') ? 'big' : ''} fill">
          <div class="head"><span class="title">${esc(this.getAttribute('title') || 'VertiPaq · tamaño del modelo')}</span>
            <button data-run title="Lee tamaños y cardinalidades del modelo abierto">⟳ Analizar</button>
            ${withOther || noCompare ? '' : `<button data-snap class="warm" title="Guarda el estado actual como referencia">📷 Foto «${esc(this._snapName)}»</button>`}
            ${noCompare ? '' : `<button data-compare class="ghost" title="${withOther ? 'Compara con el otro modelo' : 'Compara con la foto guardada'}">⇄ Comparar</button>`}
          </div>
          <div class="status"></div>
          <div class="out"></div>
        </div>`;
      this._status = root.querySelector('.status');
      this._out = root.querySelector('.out');
      this._buttons = [...root.querySelectorAll('.head button')];
      root.querySelector('[data-run]').addEventListener('click', () => this.analyze());
      const snapButton = root.querySelector('[data-snap]');
      if (snapButton) snapButton.addEventListener('click', () => this.snapshot());
      const compareButton = root.querySelector('[data-compare]');
      if (compareButton) compareButton.addEventListener('click', () => { this._compare = !this._compare; this._render(); });
      isolateKeyboard(root);
      this._focus = (this.getAttribute('focus') || '').split(',').map((s) => s.trim()).filter(Boolean).map(parseColumnRef).filter(Boolean);
      const snap = withOther || noCompare ? null : readStore(KEY_SNAP, {})[this._snapName];
      this._status.innerHTML = `<span>Pulsa «Analizar» para leer el modelo abierto.${withOther ? ` Después, «Comparar» lo enfrenta con ${esc(this.getAttribute('compare-label') || 'el otro modelo')}.` : ''}${snap ? ` Hay una foto «${esc(this._snapName)}» del ${esc(when(snap.takenAt))}.` : ''}</span>`;
    }

    // Referencia de la comparación: el análisis de otro widget (compare-with) o la foto guardada.
    _baseline() {
      const id = this.getAttribute('compare-with');
      if (!id) return { snap: readStore(KEY_SNAP, {})[this._snapName], name: `foto «${this._snapName}»`, short: 'foto' };
      const other = document.getElementById(id);
      const label = this.getAttribute('compare-label') || 'otro modelo';
      const s = other && other._stats;
      return { snap: s ? { columns: s.columns, totalSize: s.totalSize, takenAt: s.measuredAt } : null, name: label, short: label, other: true };
    }

    get bridge() { return (this.getAttribute('bridge') || defaultBridge()).replace(/\/$/, ''); }

    async analyze() {
      this._buttons.forEach((b) => { b.disabled = true; });
      this._status.innerHTML = '<span class="spin"></span><span>Leyendo el modelo (VertiPaq Analyzer)…</span>';
      try {
        const stats = await callApi(this.bridge, `/api/model-stats${this.hasAttribute('exact') ? '?exact=true' : ''}`, null, this.getAttribute('token'));
        this._stats = stats;
        this._recordedAt = null;
        if (stats.source === 'live') saveRecording(this._label, { label: this._label, stats });
        this._render();
      } catch (err) {
        const rec = findRecording(this._label, inlineRecording(this));
        if (rec && rec.stats) {
          this._stats = { ...rec.stats, source: 'recorded' };
          this._recordedAt = rec.recordedAt;
          this._render();
          this._status.insertAdjacentHTML('beforeend', `<span class="err">Puente no disponible (${esc(err.message)}).</span>`);
        } else {
          this._status.innerHTML = `<span class="badge err">ERROR</span><span class="err">${esc(err.message)}</span>`;
        }
      } finally {
        this._buttons.forEach((b) => { b.disabled = false; });
      }
    }

    snapshot() {
      if (!this._stats) { this._status.innerHTML = '<span class="err">Analiza primero el modelo.</span>'; return; }
      const all = readStore(KEY_SNAP, {});
      all[this._snapName] = { ...this._stats, takenAt: Date.now() };
      writeStore(KEY_SNAP, all);
      this._render();
    }

    _render() {
      const s = this._stats;
      if (!s) return;
      const base = this._baseline();
      const snap = base.snap;
      const missingBase = this._compare && !snap && base.other;
      if (missingBase) this._compare = false;
      const compare = this._compare && snap;
      const key = (c) => `${c.table}\u0000${c.column}`;
      const before = new Map((snap?.columns || []).map((c) => [key(c), c]));
      const isFocus = (c) => this._focus.some((f) => f.table === c.table && f.column === c.column);
      const top = Number(this.getAttribute('top')) || 10;
      const tableFilter = (this.getAttribute('table') || '').split('|').map((t) => t.trim()).filter(Boolean);
      const pool = s.columns.filter((c) => !tableFilter.length || tableFilter.includes(c.table));
      const shown = [...pool.filter(isFocus), ...pool.filter((c) => !isFocus(c)).slice(0, top)];
      const removed = compare ? (snap.columns || []).filter((c) => !s.columns.some((x) => key(x) === key(c))).slice(0, 5) : [];
      const maxSize = Math.max(...shown.map((c) => c.totalSize), 1);
      const delta = (now, old) => {
        if (old === undefined) return '<span class="up">nueva</span>';
        const d = now - old;
        if (!d) return '=';
        return `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${bytes(Math.abs(d))}</span>`;
      };
      const largest = s.columns[0];

      this._status.innerHTML = `${sourceBadge(s.source, this._recordedAt)}<span>${esc(s.database)} · ${esc(when(s.measuredAt))}</span>
        ${snap && !base.other ? `<span>foto «${esc(this._snapName)}»: ${esc(when(snap.takenAt))}</span>` : ''}
        ${missingBase ? `<span class="err">Analiza primero ${esc(base.name)} para poder comparar.</span>` : ''}
        ${compare && base.other ? `<span>comparado con ${esc(base.name)}</span>` : ''}`;
      this._out.innerHTML = `
        <div class="kpis">
          <div class="kpi se"><b>${bytes(s.totalSize)}</b><span>Tamaño del modelo</span></div>
          <div class="kpi"><b>${compare ? delta(s.totalSize, snap.totalSize) : num(s.tables.length)}</b><span>${compare ? `Δ vs ${esc(base.short)}` : 'Tablas'}</span></div>
          <div class="kpi"><b>${num(s.columns.length)}</b><span>Columnas</span></div>
          <div class="kpi fe"><b title="${esc(largest ? `${largest.table}[${largest.column}]` : '')}">${esc(largest ? largest.column : '–')}</b><span>Columna más grande</span></div>
        </div>
        <div class="panel">
          <table>
            <thead><tr><th>Columna</th><th class="n">Filas</th><th class="n">Cardinalidad</th><th>Encoding</th><th class="n">Diccionario</th>
              <th class="n">Datos</th><th class="n">Jerarq.</th><th class="n">Total</th><th class="n">% modelo</th>${compare ? `<th class="n">Δ ${esc(base.short)}</th>` : ''}<th></th></tr></thead>
            <tbody>${shown.map((c) => `<tr class="${isFocus(c) ? 'focus' : ''}">
              <td>${isFocus(c) ? '★ ' : ''}${esc(c.table)}[${esc(c.column)}]</td><td class="n">${num(c.rows)}</td><td class="n">${num(c.cardinality)}</td>
              <td>${esc(c.encoding || '–')}</td><td class="n">${bytes(c.dictionarySize)}</td><td class="n">${bytes(c.dataSize)}</td>
              <td class="n">${bytes(c.hierarchiesSize)}</td><td class="n">${bytes(c.totalSize)}</td><td class="n">${num(Math.round(c.percentDatabase * 1000) / 10)}%</td>
              ${compare ? `<td class="n">${delta(c.totalSize, before.get(key(c))?.totalSize)}</td>` : ''}
              <td class="sizebar"><div class="sb" style="width:${Math.max(2, Math.round((c.totalSize / maxSize) * 100))}%"></div></td></tr>`).join('')}
              ${removed.map((c) => `<tr class="cache"><td>${esc(c.table)}[${esc(c.column)}]</td><td colspan="7">${base.other ? 'eliminada respecto a ' + esc(base.name) : 'eliminada desde la foto'}</td><td></td>
                <td class="n"><span class="down">−${bytes(c.totalSize)}</span></td><td></td></tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }
  }

  // ─── <dax-model-check>: ¿existen en el modelo los nombres de la configuración? ─
  function classify(key, value) {
    const v = String(value).trim();
    if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(v)) return { type: 'número' };
    if (/^".*"$/.test(v)) return { type: 'texto' };
    if (key.startsWith('Calendario')) return { type: 'calendario' };
    if (key.startsWith('Rol.')) return { type: 'rol', dax: 'EVALUATE ROW ( "ok", 1 )', role: v };
    if (/^\[[^\]]+\]$/.test(v)) return { type: 'medida', dax: `EVALUATE ROW ( "v", ${v} )` };
    if (/\]$/.test(v) && v.includes('[')) return { type: 'columna', dax: `EVALUATE ROW ( "n", COUNTROWS ( VALUES ( ${v} ) ) )` };
    return { type: 'tabla', dax: `EVALUATE ROW ( "n", COUNTROWS ( ${v} ) )` };
  }

  class DaxModelCheck extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="box fill">
          <div class="head"><span class="title">${esc(this.getAttribute('title') || 'Comprobación del modelo')}</span>
            <button data-run>▶ Comprobar</button>
            <button data-demos class="warm" title="Ejecuta una vez cada variante de las diapositivas (sin traza)">▶ Probar demos</button></div>
          <div class="status"><span>Comprueba que cada nombre de PUENTE_DAX_MODELO existe en el modelo abierto.</span></div>
          <div class="panel"></div>
        </div>`;
      this._status = root.querySelector('.status');
      this._panel = root.querySelector('.panel');
      this._button = root.querySelector('[data-run]');
      this._demosButton = root.querySelector('[data-demos]');
      this._button.addEventListener('click', () => this.check());
      this._demosButton.addEventListener('click', () => this.checkDemos());
      isolateKeyboard(root);
      this._rows = Object.entries(model()).map(([key, value]) => ({ key, value, ...classify(key, value), state: '', detail: '' }));
      this._demos = null;
      this.render();
    }

    get bridge() { return (this.getAttribute('bridge') || defaultBridge()).replace(/\/$/, ''); }

    render() {
      const icon = { ok: '<span class="ok">✓</span>', err: '<span class="err">✗</span>', skip: '<span>·</span>', run: '<span class="spin"></span>' };
      const demos = this._demos ? `<table>
        <thead><tr><th>Demo (diapositiva)</th><th>Variante</th><th></th><th>Detalle</th></tr></thead>
        <tbody>${this._demos.map((r) => `<tr class="${r.state === 'err' ? 'callback' : r.state === 'skip' ? 'cache' : ''}"><td>${esc(r.slide)}</td>
          <td>${esc(r.label)}</td><td>${icon[r.state] || ''}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table>` : '';
      this._panel.innerHTML = `${demos}<table>
        <thead><tr><th>Clave</th><th>Valor en tu modelo</th><th>Tipo</th><th></th><th>Detalle</th></tr></thead>
        <tbody>${this._rows.map((r) => `<tr class="${r.state === 'err' ? 'callback' : ''}"><td>${esc(r.key)}</td><td>${esc(r.value)}</td>
          <td>${esc(r.type)}</td><td>${icon[r.state] || ''}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table>`;
    }

    // Ensayo: cada variante de cada <dax-lab> de la página, una vez y sin traza.
    async checkDemos() {
      this._demosButton.disabled = true;
      this._demos = [];
      for (const lab of document.querySelectorAll('dax-lab')) {
        const section = lab.closest('[data-lab]');
        const slide = (section && section.getAttribute('data-lab')) || lab.getAttribute('label') || 'Consulta DAX';
        for (const v of variantsOf(lab)) this._demos.push({ slide, ...v, state: '', detail: '' });
      }
      let ok = 0, bad = 0, skipped = 0;
      for (const r of this._demos) {
        const dax = resolve(r.template).trim();
        const missing = missingKeys(r);
        if (/^\s*EVALUATE\s+ROW\s*\(\s*"Pendiente"/im.test(dax)) { r.state = 'skip'; r.detail = 'pendiente: pega aquí tu consulta'; skipped++; continue; }
        if (missing.length) { r.state = 'skip'; r.detail = `falta en PUENTE_DAX_MODELO: ${missing.join(', ')}`; skipped++; continue; }
        r.state = 'run'; this.render();
        try {
          const res = await callApi(this.bridge, '/api/query', {
            dax, trace: false, clearCache: false, maxRows: 1,
            role: r.role ? resolve(r.role) : null, effectiveUser: r.user ? resolve(r.user) : null,
          }, this.getAttribute('token'));
          r.state = 'ok'; ok++;
          r.detail = `${num(res.result ? res.result.rowCount : 0)} filas · ${ms(res.timings.totalMs)}${res.source === 'mock' ? ' (simulado)' : ''}`;
        } catch (err) {
          r.state = 'err'; bad++;
          r.detail = err.message;
        }
        this.render();
      }
      this.render();
      this._status.innerHTML = `<span class="${bad ? 'err' : 'ok'}">Demos: ${ok} correctas · ${bad} con error · ${skipped} sin configurar</span>`;
      this._demosButton.disabled = false;
    }

    async check() {
      this._button.disabled = true;
      let ok = 0, bad = 0;
      for (const r of this._rows) {
        if (!r.dax) { r.state = 'skip'; r.detail = r.type === 'calendario' ? 'se comprueba en su demo' : 'literal'; continue; }
        r.state = 'run'; this.render();
        try {
          const res = await callApi(this.bridge, '/api/query',
            { dax: r.dax, trace: false, clearCache: false, maxRows: 1, role: r.role || null }, this.getAttribute('token'));
          r.state = 'ok'; ok++;
          const value = res.result && res.result.rows[0] ? res.result.rows[0][0] : '';
          r.detail = r.type === 'rol' ? 'el rol existe' : r.type === 'medida' ? `valor ${num(value)}` : `${num(value)} ${r.type === 'tabla' ? 'filas' : 'valores'}`;
          if (res.source === 'mock') r.detail += ' (simulado)';
        } catch (err) {
          r.state = 'err'; bad++;
          r.detail = err.message;
        }
        this.render();
      }
      this._status.innerHTML = `<span class="${bad ? 'err' : 'ok'}">${ok} correctas · ${bad} con error</span>`;
      this._button.disabled = false;
    }
  }

  window.customElements.define('dax-lab', DaxLab);
  window.customElements.define('dax-benchmark', DaxBenchmark);
  window.customElements.define('dax-vertipaq', DaxVertipaq);
  window.customElements.define('dax-model-check', DaxModelCheck);
})();
