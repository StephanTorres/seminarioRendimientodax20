/*
 * Puente DAX · widgets <dax-lab> y <dax-benchmark>
 *
 * Miden consultas DAX contra Power BI Desktop a través del Puente DAX y enseñan lo mismo
 * que la pestaña Server Timings de DAX Studio: Total, FE, SE, CPU del SE, consultas SE,
 * aciertos de caché, callbacks, filas/KB y, opcionalmente, los planes de consulta.
 *
 * Uso en una diapositiva:
 *   <script src="http://127.0.0.1:5199/lab/dax-lab.js"></script>
 *   <dax-lab label="AA v1" recorded="grabaciones/aa-v1.json">
 *     EVALUATE ...
 *   </dax-lab>
 *   <dax-benchmark></dax-benchmark>
 *
 * Atributos de <dax-lab>: label, bridge, token, recorded, rows, cold, warm, plan.
 * Plan B sin puente: atributo recorded="medicion.json" (páginas servidas por HTTP) o una
 * grabación incrustada <script type="application/json" data-recorded>…</script> (también file://).
 * Sin dependencias; funciona abierto como fichero o servido por el propio puente.
 */
(() => {
  'use strict';
  if (window.customElements.get('dax-lab')) return;

  const STORAGE_TOKEN = 'puenteDax.token';
  const STORAGE_BENCH = 'puenteDax.benchmark.v1';
  const SCRIPT_SRC = document.currentScript ? document.currentScript.src : '';
  const tokens = new Map();

  // ─── Utilidades ────────────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('es-ES'));
  const ms = (n) => (n === null || n === undefined ? '–' : `${num(Math.round(n))} ms`);
  const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta';

  // Vista previa de una línea: sin el SET DC_KIND inicial y con los espacios compactados.
  const preview = (xmSql) => String(xmSql || '').replace(/^\s*SET DC_KIND="[^"]*";\s*/i, '').replace(/\s+/g, ' ').trim();

  function dedent(text) {
    const lines = String(text).replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
    const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
    const indent = indents.length ? Math.min(...indents) : 0;
    return lines.map((l) => l.slice(indent)).join('\n');
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
    const stored = readStore(STORAGE_TOKEN, null);
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
        writeStore(STORAGE_TOKEN, typed.trim());
        continue;
      }
      let data = null;
      try { data = await res.json(); } catch { /* sin cuerpo */ }
      if (!res.ok) throw new Error((data && data.error) || `El puente respondió ${res.status}`);
      return data;
    }
    throw new Error('Token rechazado por el puente.');
  }

  // ─── Plantilla benchmark compartida ────────────────────────────────────────
  function publish(label, response, mode, bench) {
    const board = readStore(STORAGE_BENCH, {});
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
    writeStore(STORAGE_BENCH, board);
    window.dispatchEvent(new CustomEvent('dax-lab:measured', { detail: { label, response, mode } }));
  }

  // ─── Estilos (heredan las variables del tema de las diapositivas) ──────────
  const CSS = `
    :host { display:block; font-family:var(--font-body,'IBM Plex Sans',sans-serif); color:var(--fg,#d6efe3); font-size:16px;
      --dl-se:var(--se,#3dfc8f); --dl-fe:var(--fe,#ffb347); --dl-cb:var(--cb,#ff5c6c); --dl-info:var(--info,#5fd4ff);
      --dl-muted:var(--muted,#7fa595); --dl-line:rgba(61,252,143,.22); --dl-mono:var(--font-mono,'IBM Plex Mono',monospace); }
    .box { background:rgba(2,10,7,.94); border:1px solid var(--dl-line); border-radius:14px; overflow:hidden; text-align:left; }
    .head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--dl-line); flex-wrap:wrap; }
    .label { font-family:var(--font-title,var(--dl-mono)); font-weight:700; font-size:19px; margin-right:auto; color:#f2fff8; }
    button { font:600 14px var(--dl-mono); color:var(--dl-se); background:transparent; border:1px solid var(--dl-se); border-radius:8px; padding:6px 11px; cursor:pointer; }
    button:hover { background:rgba(61,252,143,.12); }
    button.warm { color:var(--dl-info); border-color:var(--dl-info); }
    button.ghost { color:var(--dl-muted); border-color:rgba(127,165,149,.5); }
    button[disabled] { opacity:.4; cursor:wait; }
    label.opt { font:13px var(--dl-mono); color:var(--dl-muted); display:flex; align-items:center; gap:4px; cursor:pointer; }
    textarea { display:block; width:100%; box-sizing:border-box; min-height:var(--dl-editor-height,120px); background:#020a07; color:#cfe9dc;
      border:0; border-bottom:1px solid var(--dl-line); font:15px/1.5 var(--dl-mono); padding:12px 14px; resize:vertical; outline:none; tab-size:4; }
    .status { display:flex; gap:10px; align-items:center; padding:8px 14px 0; font:13px var(--dl-mono); color:var(--dl-muted); min-height:22px; }
    .badge { font:600 12px var(--dl-mono); letter-spacing:.12em; padding:2px 8px; border-radius:999px; border:1px solid currentColor; }
    .live { color:var(--dl-se); } .mock { color:var(--dl-fe); } .recorded { color:var(--dl-info); } .err { color:var(--dl-cb); }
    .spin { width:12px; height:12px; border:2px solid var(--dl-se); border-right-color:transparent; border-radius:50%; animation:r .8s linear infinite; }
    @keyframes r { to { transform:rotate(360deg); } }
    .bar { display:flex; height:18px; margin:10px 14px 2px; border-radius:9px; overflow:hidden; background:rgba(255,255,255,.05); }
    .bar div { transition:width .5s ease; } .bar .fe { background:var(--dl-fe); } .bar .se { background:var(--dl-se); }
    .legend { display:flex; justify-content:space-between; padding:0 14px; font:12px var(--dl-mono); color:var(--dl-muted); }
    .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; padding:10px 14px 4px; }
    .kpi { background:rgba(61,252,143,.05); border:1px solid var(--dl-line); border-radius:10px; padding:7px 10px; }
    .kpi b { display:block; font:600 21px var(--dl-mono); color:#f2fff8; }
    .kpi span { font:11px var(--dl-mono); color:var(--dl-muted); letter-spacing:.1em; text-transform:uppercase; }
    .kpi.fe b { color:var(--dl-fe); } .kpi.se b { color:var(--dl-se); } .kpi.cb { border-color:var(--dl-cb); } .kpi.cb b { color:var(--dl-cb); }
    .tabs { display:flex; gap:2px; padding:8px 14px 0; border-bottom:1px solid var(--dl-line); align-items:flex-end; }
    .tab { border:1px solid transparent; border-bottom:0; border-radius:8px 8px 0 0; color:var(--dl-muted); padding:5px 10px; }
    .tab.on { color:#f2fff8; border-color:var(--dl-line); background:rgba(61,252,143,.06); }
    .tabs .opt { margin-left:auto; padding-bottom:5px; }
    .panel { max-height:var(--dl-panel-height,220px); overflow:auto; padding:6px 14px 12px; }
    table { width:100%; border-collapse:collapse; font:13px var(--dl-mono); }
    th { text-align:left; color:var(--dl-muted); font-weight:500; padding:5px 6px; border-bottom:1px solid var(--dl-line); position:sticky; top:0; background:#04100b; }
    td { padding:4px 6px; border-bottom:1px solid rgba(61,252,143,.08); vertical-align:top; }
    td.n, th.n { text-align:right; white-space:nowrap; }
    tr.callback td { color:var(--dl-cb); font-weight:700; }
    tr.cache td { color:var(--dl-muted); }
    td.q { width:52%; max-width:0; cursor:pointer; }
    td.q .short { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    td.q .full { display:none; white-space:pre-wrap; }
    td.q.open .short { display:none; } td.q.open .full { display:block; }
    pre.plan { font:13px/1.45 var(--dl-mono); white-space:pre; margin:0; color:#cfe9dc; }
    .msg { padding:10px 14px; font-size:14px; color:var(--dl-muted); }
    .msg.err { color:var(--dl-cb); }
    .bench { padding:4px 14px 0; }
    .hidden { display:none !important; }
  `;

  // ─── <dax-lab> ─────────────────────────────────────────────────────────────
  class DaxLab extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      // DAX: atributo dax, <script type="text/dax"> o el texto del elemento.
      // Grabación incrustada (plan B que funciona incluso abriendo la slide como fichero):
      //   <script type="application/json" data-recorded>{ …lo que guarda el botón ⤓… }</script>
      const source = this.querySelector('script[type="text/dax"]');
      const inline = this.querySelector('script[type="application/json"][data-recorded]');
      const ownText = [...this.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
      const dax = dedent(this.getAttribute('dax') || (source ? source.textContent : ownText) || '');
      this._recordedInline = inline ? inline.textContent : null;
      this.textContent = '';
      this._tab = 'se';
      this._showInternal = false;

      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>${CSS}</style>
        <div class="box">
          <div class="head">
            <span class="label"></span>
            <button data-run="cold" title="Limpia la caché y ejecuta (Ctrl+Enter)">▶ Frío</button>
            <button data-run="warm" class="warm" title="Ejecuta sin limpiar la caché">▶ Caliente</button>
            <button data-run="bench" class="ghost" title="Varias ejecuciones en frío y en caliente">⏱ Benchmark</button>
            <label class="opt"><input type="checkbox" data-plan> plan</label>
            <button data-save class="ghost" title="Guardar la última medición como grabación (JSON)">⤓</button>
          </div>
          <textarea spellcheck="false"></textarea>
          <div class="status"></div>
          <div class="out"></div>
        </div>`;
      root.querySelector('.label').textContent = this.getAttribute('label') || 'Consulta DAX';
      this._editor = root.querySelector('textarea');
      this._editor.value = dax;
      this._status = root.querySelector('.status');
      this._out = root.querySelector('.out');
      this._plan = root.querySelector('[data-plan]');
      this._plan.checked = this.hasAttribute('plan');
      this._buttons = [...root.querySelectorAll('button')];
      root.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => this.run(b.dataset.run)));
      root.querySelector('[data-save]').addEventListener('click', () => this.save());

      // Que el teclado del widget no mueva las diapositivas; Esc devuelve el control a la presentación.
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { root.activeElement && root.activeElement.blur(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run('cold'); }
        e.stopPropagation();
      });
      this._setStatus('', 'Listo para medir. Ctrl+Enter ejecuta en frío.');
    }

    get bridge() { return (this.getAttribute('bridge') || defaultBridge()).replace(/\/$/, ''); }
    get label() { return this.getAttribute('label') || 'Consulta DAX'; }

    async run(mode) {
      const dax = this._editor.value.trim();
      if (!dax) return;
      this._busy(true, mode);
      try {
        if (mode === 'bench') {
          const bench = await callApi(this.bridge, '/api/benchmark',
            { dax, cold: Number(this.getAttribute('cold')) || 3, warm: Number(this.getAttribute('warm')) || 3 },
            this.getAttribute('token'));
          const shown = bench.firstCold || bench.lastWarm;
          this._last = { label: this.label, dax, response: shown, benchmark: bench };
          this._render(shown, bench);
          publish(this.label, shown, 'bench', bench);
        } else {
          const response = await callApi(this.bridge, '/api/query',
            { dax, clearCache: mode === 'cold', includePlan: this._plan.checked, maxRows: Number(this.getAttribute('rows')) || 20 },
            this.getAttribute('token'));
          this._last = { label: this.label, dax, response };
          this._render(response, null);
          publish(this.label, response, mode, null);
        }
      } catch (err) {
        await this._fallback(err);
      } finally {
        this._busy(false);
      }
    }

    // Plan B en directo: si el puente no responde, se enseña la medición grabada.
    async _fallback(err) {
      const recorded = this.getAttribute('recorded');
      if (recorded || this._recordedInline) {
        try {
          // fetch() de un fichero local no funciona en una página abierta como file://: por eso la versión incrustada.
          const json = this._recordedInline ? JSON.parse(this._recordedInline) : await (await fetch(recorded)).json();
          const response = { ...(json.response || json), source: 'recorded' };
          this._render(response, json.benchmark || null);
          this._status.innerHTML = `<span class="badge recorded">GRABADO</span>
            <span class="err">Puente no disponible (${esc(err.message)}). Se muestra la medición grabada.</span>`;
          return;
        } catch { /* sin grabación utilizable */ }
      }
      const hint = err instanceof TypeError
        ? `No hay respuesta de ${this.bridge}. ¿Está arrancado el Puente DAX (External Tools de Power BI Desktop o PuenteDax.exe)?`
        : err.message;
      this._setStatus('err', hint);
    }

    save() {
      if (!this._last) { this._setStatus('err', 'Aún no hay ninguna medición que guardar.'); return; }
      const blob = new Blob([JSON.stringify(this._last, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug(this.label)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

    _render(response, bench) {
      const t = response.timings;
      const total = Math.max(t.totalMs, 1);
      const fePct = Math.round((t.formulaEngineMs / total) * 100);
      const sePct = 100 - fePct;
      const sourceText = { live: 'EN VIVO', mock: 'SIMULADO', recorded: 'GRABADO' }[response.source] || response.source;
      const when = response.measuredAt ? new Date(response.measuredAt).toLocaleTimeString('es-ES') : '';
      this._status.innerHTML = `<span class="badge ${esc(response.source)}">${esc(sourceText)}</span>
        <span>${response.coldCache ? 'caché fría' : 'caché caliente'}</span><span>${esc(when)}</span>`;

      const par = t.parallelism ? ` ×${num(t.parallelism)}` : '';
      const benchHtml = bench ? this._benchHtml(bench) : '';
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
        ${benchHtml}
        <div class="tabs">
          <button class="tab" data-tab="se">Consultas SE</button>
          <button class="tab" data-tab="res">Resultado</button>
          <button class="tab ${hasPlan ? '' : 'hidden'}" data-tab="plan">Plan</button>
          <button class="tab ${hasMetrics ? '' : 'hidden'}" data-tab="met">Métricas</button>
          <label class="opt"><input type="checkbox" data-internal ${this._showInternal ? 'checked' : ''}> internas</label>
        </div>
        <div class="panel"></div>`;

      this._response = response;
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

      if (this._tab === 'res') {
        const r = this._response.result;
        panel.innerHTML = `<table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${r.rows.map((row) => `<tr>${row.map((v) => `<td class="${typeof v === 'number' ? 'n' : ''}">${esc(typeof v === 'number' ? num(v) : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
          <div class="msg">${num(r.rowCount)} filas${r.truncated ? ` · se muestran ${num(r.rows.length)}` : ''}</div>`;
        return;
      }
      if (this._tab === 'plan') {
        panel.innerHTML = `${t.logicalPlan ? `<div class="msg">Plan lógico</div><pre class="plan">${esc(t.logicalPlan)}</pre>` : ''}
          ${t.physicalPlan ? `<div class="msg">Plan físico</div><pre class="plan">${esc(t.physicalPlan)}</pre>` : ''}`;
        return;
      }
      if (this._tab === 'met') {
        let pretty = t.executionMetrics;
        try { pretty = JSON.stringify(JSON.parse(t.executionMetrics), null, 2); } catch { /* texto tal cual */ }
        panel.innerHTML = `<pre class="plan">${esc(pretty)}</pre>`;
        return;
      }

      const rows = t.queries.filter((q) => this._showInternal || q.type !== 'internal');
      if (!rows.length) { panel.innerHTML = '<div class="msg">La consulta no ha necesitado al Storage Engine.</div>'; return; }
      const typeName = { scan: 'Scan', batch: 'Batch', internal: 'Interna', cache: 'Caché', directquery: 'SQL' };
      panel.innerHTML = `<table>
        <thead><tr><th class="n">#</th><th>Tipo</th><th class="n">Inicio</th><th class="n">ms</th><th class="n">CPU</th><th class="n">Filas</th><th class="n">KB</th><th>xmSQL (clic para ver entero)</th></tr></thead>
        <tbody>${rows.map((q) => `<tr class="${q.callback ? 'callback' : ''} ${q.type === 'cache' ? 'cache' : ''}">
          <td class="n">${q.line}</td><td>${esc(typeName[q.type] || q.type)}${q.callback ? ' ⚠' : ''}${q.inBatch ? ' ↳' : ''}</td>
          <td class="n">${num(q.startOffsetMs)}</td><td class="n">${num(q.durationMs)}</td><td class="n">${num(q.cpuMs)}</td>
          <td class="n">${num(q.rows)}</td><td class="n">${num(q.kBytes)}</td><td class="q"><div class="short">${esc(preview(q.query))}</div><div class="full">${esc(q.query)}</div></td></tr>`).join('')}</tbody></table>`;
      panel.querySelectorAll('td.q').forEach((td) => td.addEventListener('click', () => td.classList.toggle('open')));
    }
  }

  // ─── <dax-benchmark>: la plantilla del workshop, rellenada sola ────────────
  class DaxBenchmark extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}
          .title { font-family:var(--font-title,var(--dl-mono)); font-weight:700; font-size:19px; margin-right:auto; color:#f2fff8; }
          td.mark { color:var(--dl-fe); font-size:11px; }
        </style>
        <div class="box">
          <div class="head"><span class="title">Plantilla benchmark</span>
            <button data-copy class="ghost" title="Copiar como tabla (pegar en Excel)">Copiar</button>
            <button data-clear class="ghost">Vaciar</button></div>
          <div class="panel" style="max-height:none"></div>
        </div>`;
      root.querySelector('[data-copy]').addEventListener('click', () => this.copy());
      root.querySelector('[data-clear]').addEventListener('click', () => { writeStore(STORAGE_BENCH, {}); this.render(); });
      root.addEventListener('keydown', (e) => e.stopPropagation());
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

    entries() {
      return Object.entries(readStore(STORAGE_BENCH, {})).sort((a, b) => a[1].at - b[1].at);
    }

    render() {
      const list = this.entries();
      if (!list.length) {
        this._panel.innerHTML = '<div class="msg">Ejecuta cualquier consulta y aparecerá aquí.</div>';
        return;
      }
      const note = { mock: 'simulado', recorded: 'grabado' };
      this._panel.innerHTML = `<table>
        <thead><tr><th>Variante</th><th class="n">Frío ms</th><th class="n">Caliente ms</th><th class="n">FE ms</th><th class="n">SE ms</th>
          <th class="n">Nº SE</th><th class="n">Filas</th><th class="n">KB</th><th>Callback</th><th></th></tr></thead>
        <tbody>${list.map(([label, e]) => `<tr class="${e.callbacks ? 'callback' : ''}">
          <td>${esc(label)}</td><td class="n">${num(e.coldMs)}</td><td class="n">${num(e.warmMs)}</td><td class="n">${num(e.fe)}</td>
          <td class="n">${num(e.se)}</td><td class="n">${num(e.seQueries)}</td><td class="n">${num(e.rows)}</td><td class="n">${num(e.kb)}</td>
          <td>${e.callbacks ? 'sí' : (e.callbacks === 0 ? 'no' : '–')}</td><td class="mark">${esc(note[e.source] || '')}</td></tr>`).join('')}</tbody></table>`;
    }

    async copy() {
      const head = ['Variante', 'Frío ms', 'Caliente ms', 'FE ms', 'SE ms', 'Nº SE', 'Filas', 'KB', 'Callback'];
      const lines = [head.join('\t')].concat(this.entries().map(([label, e]) =>
        [label, e.coldMs, e.warmMs, e.fe, e.se, e.seQueries, e.rows, e.kb, e.callbacks ? 'sí' : 'no'].map((v) => v ?? '').join('\t')));
      try { await navigator.clipboard.writeText(lines.join('\n')); } catch { window.prompt('Copia la tabla:', lines.join('\n')); }
    }
  }

  window.customElements.define('dax-lab', DaxLab);
  window.customElements.define('dax-benchmark', DaxBenchmark);
})();
