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
    .compact .label, .compact .title { font-size:17px; }
    .compact textarea { font-size:14px; }
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
      else { this._out.innerHTML = ''; this._setStatus('', 'Listo para medir. Ctrl+Enter ejecuta en frío.'); }
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

      const rows = (t.queries || []).filter((q) => this._showInternal || q.type !== 'internal');
      if (!rows.length) { panel.innerHTML = '<div class="msg">La consulta no ha necesitado al Storage Engine.</div>'; return; }
      const typeName = { scan: 'Scan', batch: 'Batch', internal: 'Interna', cache: 'Caché', directquery: 'SQL' };
      panel.innerHTML = `<table>
        <thead><tr><th class="n">#</th><th>Tipo</th><th class="n">Inicio</th><th class="n">ms</th><th class="n">CPU</th><th class="n">Filas</th><th class="n">KB</th><th>xmSQL (clic para ver entero)</th></tr></thead>
        <tbody>${rows.map((q) => `<tr class="${q.callback ? 'callback' : ''} ${q.type === 'cache' ? 'cache' : ''}">
          <td class="n">${q.line}</td><td>${esc(typeName[q.type] || q.type)}${q.callback ? ' ⚠' : ''}${q.inBatch ? ' ↳' : ''}</td>
          <td class="n">${num(q.startOffsetMs)}</td><td class="n">${num(q.durationMs)}</td><td class="n">${num(q.cpuMs)}</td>
          <td class="n">${num(q.rows)}</td><td class="n">${num(q.kBytes)}</td>
          <td class="q"><div class="short">${esc(preview(q.query))}</div><div class="full">${esc(q.query)}</div></td></tr>`).join('')}</tbody></table>`;
      panel.querySelectorAll('td.q').forEach((td) => td.addEventListener('click', () => td.classList.toggle('open')));
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
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="box ${this.hasAttribute('compact') ? 'compact' : ''} fill">
          <div class="head"><span class="title">${esc(this.getAttribute('title') || 'VertiPaq · tamaño del modelo')}</span>
            <button data-run title="Lee tamaños y cardinalidades del modelo abierto">⟳ Analizar</button>
            <button data-snap class="warm" title="Guarda el estado actual como referencia">📷 Foto «${esc(this._snapName)}»</button>
            <button data-compare class="ghost" title="Compara con la foto guardada">⇄ Comparar</button>
          </div>
          <div class="status"></div>
          <div class="out"></div>
        </div>`;
      this._status = root.querySelector('.status');
      this._out = root.querySelector('.out');
      this._buttons = [...root.querySelectorAll('.head button')];
      root.querySelector('[data-run]').addEventListener('click', () => this.analyze());
      root.querySelector('[data-snap]').addEventListener('click', () => this.snapshot());
      root.querySelector('[data-compare]').addEventListener('click', () => { this._compare = !this._compare; this._render(); });
      isolateKeyboard(root);
      this._focus = (this.getAttribute('focus') || '').split(',').map((s) => s.trim()).filter(Boolean).map(parseColumnRef).filter(Boolean);
      const snap = readStore(KEY_SNAP, {})[this._snapName];
      this._status.innerHTML = `<span>Pulsa «Analizar» para leer el modelo abierto.${snap ? ` Hay una foto «${esc(this._snapName)}» del ${esc(when(snap.takenAt))}.` : ''}</span>`;
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
      const snap = readStore(KEY_SNAP, {})[this._snapName];
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
        ${snap ? `<span>foto «${esc(this._snapName)}»: ${esc(when(snap.takenAt))}</span>` : ''}`;
      this._out.innerHTML = `
        <div class="kpis">
          <div class="kpi se"><b>${bytes(s.totalSize)}</b><span>Tamaño del modelo</span></div>
          <div class="kpi"><b>${compare ? delta(s.totalSize, snap.totalSize) : num(s.tables.length)}</b><span>${compare ? 'Δ vs foto' : 'Tablas'}</span></div>
          <div class="kpi"><b>${num(s.columns.length)}</b><span>Columnas</span></div>
          <div class="kpi fe"><b title="${esc(largest ? `${largest.table}[${largest.column}]` : '')}">${esc(largest ? largest.column : '–')}</b><span>Columna más grande</span></div>
        </div>
        <div class="panel">
          <table>
            <thead><tr><th>Columna</th><th class="n">Filas</th><th class="n">Cardinalidad</th><th>Encoding</th><th class="n">Diccionario</th>
              <th class="n">Datos</th><th class="n">Jerarq.</th><th class="n">Total</th><th class="n">% modelo</th>${compare ? '<th class="n">Δ foto</th>' : ''}<th></th></tr></thead>
            <tbody>${shown.map((c) => `<tr class="${isFocus(c) ? 'focus' : ''}">
              <td>${isFocus(c) ? '★ ' : ''}${esc(c.table)}[${esc(c.column)}]</td><td class="n">${num(c.rows)}</td><td class="n">${num(c.cardinality)}</td>
              <td>${esc(c.encoding || '–')}</td><td class="n">${bytes(c.dictionarySize)}</td><td class="n">${bytes(c.dataSize)}</td>
              <td class="n">${bytes(c.hierarchiesSize)}</td><td class="n">${bytes(c.totalSize)}</td><td class="n">${num(Math.round(c.percentDatabase * 1000) / 10)}%</td>
              ${compare ? `<td class="n">${delta(c.totalSize, before.get(key(c))?.totalSize)}</td>` : ''}
              <td class="sizebar"><div class="sb" style="width:${Math.max(2, Math.round((c.totalSize / maxSize) * 100))}%"></div></td></tr>`).join('')}
              ${removed.map((c) => `<tr class="cache"><td>${esc(c.table)}[${esc(c.column)}]</td><td colspan="7">eliminada desde la foto</td><td></td>
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
