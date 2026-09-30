/* ═══════════════════════════════════════════════════════════
   ARCGEN · ui.js — rendering, syntax highlighting, canvases,
   toasts, preview bridge (FPS HUD), download packaging.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const S = Arc.State;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* ───────── tokeniser: lightweight, per-language ───────── */
  const KW = {
    js: 'const let var function return if else for while do new class extends this import export from default async await try catch throw typeof instanceof of in break continue switch case delete null undefined true false yield static get set super do'.split(' '),
    cs: 'using namespace public private protected internal sealed class struct interface override virtual abstract readonly static void int float double bool string var new return if else for foreach while switch case default this null true false get set require serializefield explicit implicit enum event delegate async await yield lock try catch finally const'.split(' '),
    cpp: 'include define namespace class public private protected virtual override void int float bool auto const constexpr struct enum template typename using new delete return if else for while switch case nullptr true false static inline explicit friend operator this sizeof'.split(' '),
    java: 'package import public private protected static final class interface extends implements void int float double boolean String new return if else for while switch case this null true false try catch throw synchronized volatile transient abstract native enum'.split(' '),
    py: 'def class return if elif else for while in not and or is None True False import from as with try except finally raise lambda yield global nonlocal pass break continue assert async await self'.split(' '),
    gd: 'extends func var const if elif else for while in return pass break continue signal onready export self true false null and or not class_name static match'.split(' '),
    rs: 'pub fn let mut const struct impl enum trait use mod crate self super where for while loop if else match return as dyn ref move unsafe extern async await type Box Vec'.split(' '),
    lua: 'local function end if then else elseif for while do repeat until return and or not nil true false in self require pairs ipairs'.split(' '),
    glsl: 'uniform attribute varying precision highp mediump lowp float vec2 vec3 vec4 mat2 mat3 mat4 sampler2D void int bool main discard in out const'.split(' '),
    html: 'html head body div span link script meta title style canvas section header footer main nav button input label'.split(' '),
    css: '', json: 'true false null'.split(' ')
  };

  function langOf(path) {
    if (/\.html?$/i.test(path)) return 'html';
    if (/\.css$/i.test(path)) return 'css';
    if (/\.(json|webmanifest)$/i.test(path)) return 'json';
    if (/\.md$/.test(path) || /\.gitignore$/.test(path) || /^Makefile$/.test(path)) return 'text';
    if (/\.(js|mjs)$/i.test(path)) return 'js';
    if (/\.cs$/i.test(path)) return 'cs';
    if (/\.(cpp|cc|h|hpp)$/i.test(path)) return 'cpp';
    if (/\.java$/i.test(path)) return 'java';
    if (/\.py$/i.test(path)) return 'py';
    if (/\.gd$/i.test(path)) return 'gd';
    if (/\.rs$/i.test(path)) return 'rs';
    if (/\.lua$/i.test(path)) return 'lua';
    if (/\.glsl$|\.vert$|\.frag$/i.test(path)) return 'glsl';
    return 'text';
  }

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function highlight(src, lang) {
    const kws = KW[lang] || [];
    const rx = (() => {
      switch (lang) {
        case 'html': return /(<!--[\s\S]*?-->|<\/?[\w-]+|[\w-]+(?==)|"[^"]*"|'[^']*'|>)/g;
        case 'css':  return /(\/\*[\s\S]*?\*\/|@[\w-]+|[#.][\w-]+|:[\w-]+|"[^"]*"|--[\w-]+)/g;
        case 'py':   return /("""[\s\S]*?"""|#[^\n]*|f?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+\.?\d*\b|\b(?:def|class)\b)/g;
        case 'lua':  return /(--\[\[[\s\S]*?\]\]|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
        case 'json': return /("(?:\\.|[^"\\])*")/g;
        case 'text': return /(^(?:#{1,6} .*|\s*[-*] .*)$)/gm;
        default:     return /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?:^|[^:\\])"[^"\n]*"|'[^'\n]*'|\b\d[\d._xXabcdefABCDEF]*\b)/g;
      }
    })();

    let out = '', last = 0, m;
    const kwRx = kws.length ? new RegExp('^(' + kws.join('|') + ')$') : null;

    while ((m = rx.exec(src))) {
      out += mark(src.slice(last, m.index), kwRx, lang);
      const t = m[0];
      let cls = 'tk-str';
      if (/^\/\*|^\/\/|^--|^#(?![0-9a-fA-F]{3,6}|!)/.test(t) || /^<!--/.test(t)) cls = 'tk-com';
      else if (/^["']/.test(t) || /^f?"/.test(t)) cls = 'tk-str';
      else if (/^\d/.test(t)) cls = 'tk-num';
      else if (/^@|^[#.]/.test(t) && lang === 'css') cls = 'tk-key';
      else if (/^<\/?[\w-]+/.test(t) && lang === 'html') cls = 'tk-type';
      else if (/^(def|class|func|fn|sub)$/.test(t.trim())) cls = 'tk-key';
      else if (lang === 'text') cls = 'tk-fn';
      out += '<span class="' + cls + '">' + esc(t) + '</span>';
      last = m.index + t.length;
    }
    out += mark(src.slice(last), kwRx, lang);
    return out;

    function mark(chunk, kwRx, lg) {
      if (!kwRx) return esc(chunk);
      return esc(chunk).replace(/([A-Za-z_][\w]*)/g, (w) => {
        if (kwRx.test(w)) return '<span class="tk-key">' + w + '</span>';
        if (lg === 'glsl' && /^(vec[234]|mat[234]|float|int|bool)$/.test(w)) return '<span class="tk-type">' + w + '</span>';
        return /^(GLSL)$/.test(w) ? w : w;
      }).replace(/\b([A-Z][A-Za-z0-9_]{2,})\b/g, '<span class="tk-type">$1</span>')
        .replace(/([a-zA-Z_]\w*)\(/g, '<span class="tk-fn">$1</span>(');
    }
  }

  /* ───────── console stream ───────── */
  const whoMap = { sys: 'SYS', plan: 'PLANNER', code: 'CODER', file: 'FILES', term: 'TERM', comp: 'COMPILER', ok: 'OK', warn: 'WARN', err: 'ERROR' };
  function logLine(kind, msg, who) {
    const el = $('#console'); if (!el) return;
    const row = document.createElement('div');
    row.className = 'line ' + kind;
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    row.innerHTML = '<span class="ts">' + ts + '</span>' +
      '<span class="who">' + (who || whoMap[kind] || kind.toUpperCase()) + '</span>' +
      '<span class="msg"></span>';
    row.querySelector('.msg').textContent = msg;
    el.appendChild(row);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 500) el.removeChild(el.firstChild);
  }

  /* typewriter variant for streamed "code" narration */
  function typeLine(kind, text, speed) {
    return new Promise(res => {
      const el = $('#console');
      const row = document.createElement('div');
      row.className = 'line ' + kind;
      row.innerHTML = '<span class="ts">' + new Date().toLocaleTimeString('en-GB', { hour12: false }) + '</span>' +
        '<span class="who">' + (whoMap[kind] || kind.toUpperCase()) + '</span><span class="msg"></span><span class="caret"></span>';
      el.appendChild(row);
      const msg = row.querySelector('.msg');
      const step = Math.max(1, Math.round(text.length / 42));
      let i = 0;
      const iv = setInterval(() => {
        i += step;
        msg.textContent = text.slice(0, i);
        el.scrollTop = el.scrollHeight;
        if (i >= text.length) { clearInterval(iv); row.querySelector('.caret').remove(); res(); }
      }, speed || 14);
    });
  }

  /* ───────── pipeline widget ───────── */
  function renderPipeline() {
    const ol = $('#pipeList'); ol.innerHTML = '';
    S.PIPELINE.forEach((st, i) => {
      const li = document.createElement('li');
      li.dataset.id = st.id;
      li.innerHTML = '<span class="num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="lbl">' + st.label + '</span><span class="st">queued</span>';
      ol.appendChild(li);
    });
  }
  function pipeSet(id, mode) {
    const li = $('#pipeList li[data-id="' + id + '"]'); if (!li) return;
    li.classList.toggle('is-run', mode === 'run');
    li.classList.toggle('is-done', mode === 'done');
    li.querySelector('.st').textContent = mode === 'run' ? 'running' : mode === 'done' ? 'done' : 'queued';
    const done = $$('#pipeList li.is-done').length;
    $('#pipePct').textContent = Math.round(done / S.PIPELINE.length * 100) + '%';
  }

  /* ───────── tool rail ───────── */
  function renderTools() {
    const ul = $('#toolList'); ul.innerHTML = '';
    S.TOOLS.forEach(t => {
      const li = document.createElement('li');
      li.dataset.id = t.id;
      li.innerHTML = '<span class="tool-ico">' + t.icon + '</span>' +
        '<span><span class="tool-name">' + t.name + '</span><span class="tool-role">' + t.role + '</span></span>' +
        '<span class="tool-led"></span>';
      ul.appendChild(li);
    });
  }
  function toolLive(id, live) {
    $$(`#toolList li`).forEach(li => {
      if (li.dataset.id !== id) return;
      li.classList.toggle('is-live', !!live);
      if (!live) li.classList.add('is-ok');
    });
  }

  /* ───────── language picker & quick tags ───────── */
  function renderLangPicker() {
    const box = $('#langPicker'); box.innerHTML = '';
    ['js', 'html', 'css', 'cs', 'cpp', 'java', 'py'].forEach(id => {
      const l = S.LANGS.find(x => x.id === id);
      const b = document.createElement('button');
      b.className = 'lang-btn' + (S.lang === id ? ' is-on' : '');
      b.textContent = l.label; b.title = l.note;
      b.onclick = () => { S.lang = id; renderLangPicker(); S.save(); toast('primary target → ' + l.label); };
      box.appendChild(b);
    });
  }

  function renderQuickTags() {
    const box = $('#quickTags'); box.innerHTML = '';
    S.QUICK_TAGS.forEach(t => {
      const b = document.createElement('button');
      b.className = 'qtag'; b.textContent = '+ ' + t;
      b.onclick = () => {
        const inp = $('#promptInput');
        inp.value = (inp.value.trim() + ' ' + t).trim();
        inp.focus();
      };
      box.appendChild(b);
    });
  }

  /* ───────── file tree + editor ───────── */
  function renderTree() {
    const tree = $('#fileTree'), build = S.build;
    tree.innerHTML = '';
    if (!build) { tree.innerHTML = '<div class="tree-dir">// no builds yet</div>'; renderEditor(null); return; }

    const groups = {};
    Object.keys(build.files).forEach(p => {
      const top = p.includes('/') ? p.split('/')[0] + '/' : 'root';
      (groups[top] = groups[top] || []).push(p);
    });
    Object.keys(groups).sort().forEach(g => {
      const d = document.createElement('div');
      d.className = 'tree-dir'; d.textContent = g === 'root' ? '·' : g;
      tree.appendChild(d);
      groups[g].sort().forEach(p => {
        const f = document.createElement('div');
        f.className = 'tree-file' + (S.activeFile === p ? ' is-sel' : '');
        const ext = p.split('.').pop().toUpperCase();
        f.innerHTML = '<span>' + p.split('/').pop() + '</span>' +
          '<span class="bytes">' + (build.files[p].length / 1024).toFixed(1) + 'k</span>' +
          '<span class="ext">' + ext + '</span>';
        f.onclick = () => { S.activeFile = p; renderTree(); renderEditor(p); };
        tree.appendChild(f);
      });
    });
    renderEditor(S.activeFile);
    renderBuildTabs();
    renderExportRows();
    $('#btnDownload').disabled = false;
    $('#btnCompile').disabled = false;
  }

  function renderBuildTabs() {
    const seg = $('#buildTabs'); seg.innerHTML = '';
    S.builds.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.className = i === S.activeBuild ? 'is-on' : '';
      btn.textContent = b.short || ('#' + (i + 1));
      btn.onclick = () => { S.activeBuild = i; S.activeFile = Object.keys(b.files)[0]; renderTree(); loadPreview(); S.save(); };
      seg.appendChild(btn);
    });
  }

  function renderEditor(path) {
    const code = $('#editorCode'), b = S.build;
    if (!path || !b || !b.files[path]) { code.innerHTML = '<span class="tk-com">// select a generated file…</span>'; $('#editorPath').textContent = '—'; $('#editorLang').textContent = '—'; return; }
    $('#editorPath').textContent = path;
    const lg = langOf(path);
    $('#editorLang').textContent = lg.toUpperCase();
    const src = b.files[path];
    code.innerHTML = highlight(src.length > 60000 ? src.slice(0, 60000) + '\n\n/* … truncated in viewer — full text ships in the zip … */' : src, lg);
  }

  function renderExportRows() {
    const box = $('#exportRows'), b = S.build;
    if (!b) { box.innerHTML = ''; return; }
    const bytes = S.totalBytes();
    const lines = Object.values(b.files).reduce((n, t) => n + t.split('\n').length, 0);
    box.innerHTML = [
      ['project', b.name],
      ['files', Object.keys(b.files).length],
      ['source lines', lines.toLocaleString()],
      ['unpacked', (bytes / 1024).toFixed(1) + ' KB'],
      ['runtime', 'arcgen-canvas-2d'],
      ['persona', b.personaDigest || '—']
    ].map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('');
  }

  /* ───────── preview ───────── */
  function singleFileHTML(build) {
    const f = build.files;
    return (f['index.html'] || '')
      .replace('<link rel="stylesheet" href="css/hud.css" />', '<style>\n' + (f['css/hud.css'] || '') + '\n</style>')
      .replace('<script src="js/game.js"></script>', '<script>\n' + (f['js/game.js'] || '') + '\n</script>');
  }

  function loadPreview() {
    const b = S.build, frame = $('#gameFrame'), empty = $('#screenEmpty');
    if (!b) { frame.style.display = 'none'; empty.style.display = ''; return; }
    const html = singleFileHTML(b);
    frame.srcdoc = html;
    frame.style.display = 'block'; empty.style.display = 'none';
    $('#previewTitle').textContent = b.title || b.name;
    $('#previewSub').textContent = (b.genreLabel || '') + ' · seed ' + b.seed + ' · ' + Object.keys(b.files).length + ' files';
    applyViewport();
  }

  function applyViewport() {
    const [w, h] = ($('#viewportSel').value || '960x540').split('x');
    const f = $('#gameFrame');
    f.style.width = w + 'px'; f.style.height = h + 'px';
  }

  /* perf bridge from sandboxed iframe */
  addEventListener('message', e => {
    const d = e.data;
    if (!d || d.arcgen !== 'perf') return;
    $('#hudFps').textContent = d.fps;
    $('#hudMs').textContent = d.ms + ' ms';
    $('#hudSprites').textContent = d.sprites;
    fpsPush(d.fps);
  });

  let fpsHist = [];
  function fpsPush(v) {
    fpsHist.push(v); if (fpsHist.length > 60) fpsHist.shift();
    const c = $('#fpsGraph'); if (!c) return;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.strokeStyle = 'rgba(122,162,255,.18)'; x.beginPath(); x.moveTo(0, c.height - 1); x.lineTo(c.width, c.height - 1); x.stroke();
    const max = 70;
    x.beginPath(); x.lineWidth = 1.6; x.strokeStyle = '#35f2d7';
    fpsHist.forEach((v, i) => {
      const px = i / 59 * c.width, py = c.height - Math.min(1, v / max) * (c.height - 3) - 1;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.stroke();
    x.fillStyle = 'rgba(255,181,71,.75)'; x.font = '9px monospace';
    x.fillText('60fps', c.width - 34, 9);
  }

  /* ───────── persona UI ───────── */
  function renderPersona() {
    const ta = $('#personaInput');
    ta.value = S.persona;
    $('#personaCount').textContent = S.persona.length + ' chars';
    const dl = $('#personaDeltas');
    const inf = /retro|pixel|crt/i.test(S.persona) ? 'CRT/pixel lock ON' : 'vector crisp';
    dl.innerHTML = [
      ['juice coefficient', (/shake|particle|juice/i.test(S.persona) ? 1.5 : 1).toFixed(2)],
      ['render bias', inf],
      ['prose allowed', 'no'],
      ['dependency budget', '0 external'],
      ['self-review passes', '3']
    ].map(([k, v]) => '<li><span>' + k + '</span><b>' + v + '</b></li>').join('');
  }

  function renderPresets() {
    const box = $('#personaPresets'); box.innerHTML = '';
    S.PERSONA_PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'preset';
      b.innerHTML = '<b>' + p.name + '</b><span>' + p.tag + '</span>';
      b.onclick = () => { S.persona = p.text; renderPersona(); toast('preset loaded: ' + p.name); };
      box.appendChild(b);
    });
  }

  function renderGuards() {
    const box = $('#guardSwitches'); box.innerHTML = '';
    const defs = [
      ['noNetwork', 'block network egress'],
      ['noEval', 'block dynamic code execution'],
      ['fixedTimestep', 'force fixed timestep'],
      ['bundleLimit', 'hard 64 KB bundle limit']
    ];
    defs.forEach(([k, label]) => {
      const l = document.createElement('label');
      l.className = 'switch';
      l.innerHTML = '<input type="checkbox"' + (S.guards[k] ? ' checked' : '') + ' /><i></i><span>' + label + '</span>';
      l.querySelector('input').onchange = e => { S.guards[k] = e.target.checked; S.save(); toast(label + ' → ' + (e.target.checked ? 'armed' : 'disarmed')); };
      box.appendChild(l);
    });
  }

  /* ───────── bench view canvases ───────── */
  function gauge(canvas, value, min, max, color, label) {
    const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    x.clearRect(0, 0, W, H);
    const cx0 = W / 2, cy = H * 0.86, rad = Math.min(W / 2 - 14, H * 0.78);
    const a0 = Math.PI * 0.86, a1 = Math.PI * 2.14;
    // track
    x.lineCap = 'round'; x.lineWidth = 12;
    x.strokeStyle = 'rgba(122,162,255,.14)';
    x.beginPath(); x.arc(cx0, cy, rad, a0, a1); x.stroke();
    // fill
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const grad = x.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#8b6bff'); grad.addColorStop(1, color);
    x.strokeStyle = grad;
    x.beginPath(); x.arc(cx0, cy, rad, a0, a0 + (a1 - a0) * t); x.stroke();
    // ticks
    x.lineWidth = 1; x.strokeStyle = 'rgba(122,162,255,.28)';
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * i / 10;
      x.beginPath();
      x.moveTo(cx0 + Math.cos(a) * (rad - 14), cy + Math.sin(a) * (rad - 14));
      x.lineTo(cx0 + Math.cos(a) * (rad - 22), cy + Math.sin(a) * (rad - 22));
      x.stroke();
    }
    // needle
    const na = a0 + (a1 - a0) * t;
    x.strokeStyle = color; x.lineWidth = 2;
    x.beginPath(); x.moveTo(cx0, cy); x.lineTo(cx0 + Math.cos(na) * (rad - 26), cy + Math.sin(na) * (rad - 26)); x.stroke();
    x.fillStyle = color; x.beginPath(); x.arc(cx0, cy, 4, 0, 7); x.fill();
    // labels
    x.fillStyle = '#5d6b8c'; x.font = '9px monospace'; x.textAlign = 'center';
    x.fillText(min, cx0 + Math.cos(a0) * (rad + 2), cy + Math.sin(a0) * (rad + 12));
    x.fillText(max, cx0 + Math.cos(a1) * (rad + 2), cy + Math.sin(a1) * (rad + 12));
    x.fillText(label, cx0, cy - rad * 0.42);
  }

  function radar(canvas, data) {
    const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const cx0 = W / 2, cy0 = H / 2 + 6, R = Math.min(W, H) / 2 - 30;
    x.clearRect(0, 0, W, H);
    const n = data.length;
    // rings
    for (let r = 1; r <= 4; r++) {
      x.beginPath(); x.strokeStyle = 'rgba(122,162,255,' + (r === 4 ? .3 : .12) + ')'; x.lineWidth = 1;
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + i / n * Math.PI * 2;
        const rr = R * r / 4;
        const px = cx0 + Math.cos(a) * rr, py = cy0 + Math.sin(a) * rr;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.stroke();
    }
    // spokes + labels
    x.fillStyle = '#5d6b8c'; x.font = '9px monospace';
    data.forEach((d, i) => {
      const a = -Math.PI / 2 + i / n * Math.PI * 2;
      x.beginPath(); x.strokeStyle = 'rgba(122,162,255,.14)';
      x.moveTo(cx0, cy0); x.lineTo(cx0 + Math.cos(a) * R, cy0 + Math.sin(a) * R); x.stroke();
      x.textAlign = Math.cos(a) > .3 ? 'left' : Math.cos(a) < -.3 ? 'right' : 'center';
      x.fillText(d.k, cx0 + Math.cos(a) * (R + 8), cy0 + Math.sin(a) * (R + 8) + 3);
    });
    // polygon
    x.beginPath();
    data.forEach((d, i) => {
      const a = -Math.PI / 2 + i / n * Math.PI * 2, rr = R * d.v / 100;
      const px = cx0 + Math.cos(a) * rr, py = cy0 + Math.sin(a) * rr;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.closePath();
    x.fillStyle = 'rgba(53,242,215,.16)'; x.fill();
    x.strokeStyle = '#35f2d7'; x.lineWidth = 1.8; x.stroke();
    data.forEach((d, i) => {
      const a = -Math.PI / 2 + i / n * Math.PI * 2, rr = R * d.v / 100;
      x.fillStyle = '#ff3d81'; x.beginPath();
      x.arc(cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr, 2.6, 0, 7); x.fill();
    });
  }

  function renderBench() {
    const s = S.SPEC;
    gauge($('#gaugeTops'), s.topsNominal, 3000, 5000, '#35f2d7', 'TOPS');
    gauge($('#gaugeAcc'), s.accNominal, 80, 100, '#8b6bff', 'ACCURACY %');
    radar($('#radarCanvas'), S.RADAR);
    $('#topsBig').textContent = s.topsNominal;
    $('#accBig').textContent = s.accNominal + '%';
    $('#topsHead').textContent = '+' + (s.topsNominal - s.topsMin) + ' TB/s';
    $('#accHead').textContent = '+' + (s.accNominal - s.accMin).toFixed(1) + 'pt';
    $('#chipTops').textContent = s.topsNominal;
    $('#chipAcc').textContent = s.accNominal;
    $('#tttCompute').textContent = s.topsNominal + ' TOPS sustained';

    $('#benchBody').innerHTML = S.BENCH.map(b => {
      const d = b.score - s.accMin;
      return '<tr><td>' + b.suite + '</td><td>' + b.domain + '</td>' +
        '<td><span class="score-bar"><i style="--v:' + b.score + '%"></i>' + b.score.toFixed(1) + '</span></td>' +
        '<td class="delta">' + (d >= 0 ? '+' : '') + d.toFixed(1) + '</td>' +
        '<td class="' + (b.score >= s.accMin ? 'pass' : '') + '">' + (b.score >= s.accMin ? '✓ certified' : '✗ below min') + '</td></tr>';
    }).join('');

    $('#langGrid').innerHTML = S.LANGS.map(l =>
      '<div class="lang-card"><b><i class="dot" style="background:' + l.color + '"></i>' + l.label + '</b><span>' + l.note + '</span></div>').join('');

    $('#radarLegend').innerHTML = S.RADAR.map((d, i) =>
      '<span><i style="background:' + ['#35f2d7', '#8b6bff', '#ff3d81', '#ffb547', '#a8ff3e', '#6ec6ff'][i % 6] + '"></i>' + d.k + ' ' + d.v + '</span>').join('');
  }

  /* ───────── compile targets ───────── */
  function renderCompileTargets() {
    const box = $('#compileTargets'); box.innerHTML = '';
    [['web', 1], ['unity', 0], ['unreal', 0], ['godot', 0], ['libgdx', 0], ['wasm', 0]].forEach(([t, on]) => {
      const b = document.createElement('button');
      b.className = 'ctarget' + (on ? ' is-on' : '');
      b.textContent = t;
      b.onclick = () => { $$('.ctarget').forEach(x => x.classList.remove('is-on')); b.classList.add('is-on'); };
      box.appendChild(b);
    });
  }

  function renderDiags(diags) {
    const box = $('#diagBox');
    if (!diags) { box.innerHTML = '<em>no diagnostics</em>'; return; }
    box.innerHTML = diags.slice(0, 40).map(d =>
      '<div class="d"><span class="lv ' + ({ error: 'e', warn: 'w', info: 'i', ok: 'o' })[d.level] + '">' +
      d.level.toUpperCase().slice(0, 4) + '</span><span>' + d.path + (d.line ? ':' + d.line : '') + ' — ' +
      d.msg.replace(/</g, '&lt;') + '</span></div>').join('');
    box.scrollTop = 0;
  }

  /* ───────── toast ───────── */
  function toast(msg, kind) {
    const host = $('#toastHost');
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 320); }, 2600);
  }

  /* ───────── TTT living canvas ───────── */
  function startTTT() {
    const c = $('#tttCanvas'); if (!c) return;
    const x = c.getContext('2d');
    const N = 24, nodes = [];
    for (let i = 0; i < N; i++) nodes.push({ a: Math.random() * 7, r: 0.2 + Math.random() * 0.8, sp: 0.002 + Math.random() * 0.006, e: i % 8 });
    let tick = 0;
    (function draw() {
      requestAnimationFrame(draw);
      if (document.hidden) return;
      const W = c.width, H = c.height, cx0 = W / 2, cy0 = H / 2;
      x.clearRect(0, 0, W, H);
      x.fillStyle = '#070b14'; x.fillRect(0, 0, W, H);
      tick++;
      // expert clusters
      for (let e = 0; e < 8; e++) {
        const a = e / 8 * Math.PI * 2 + tick * 0.0016;
        const px = cx0 + Math.cos(a) * (W * 0.32), py = cy0 + Math.sin(a) * (H * 0.34);
        x.strokeStyle = 'rgba(122,162,255,.16)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(cx0, cy0); x.lineTo(px, py); x.stroke();
        const hot = S.status === 'working' && (tick >> 4) % 8 === e;
        x.fillStyle = hot ? 'rgba(255,181,71,.9)' : 'rgba(53,242,215,.55)';
        x.beginPath(); x.arc(px, py, hot ? 4.5 : 3, 0, 7); x.fill();
      }
      // token pulses travelling outward during generation
      nodes.forEach((n, i) => {
        n.a += n.sp;
        const rad = (0.18 + ((tick * 0.004 + i * 0.13) % 1) * 0.8) * (S.status === 'working' ? 1 : 0.6);
        const px = cx0 + Math.cos(n.a) * W * 0.42 * rad;
        const py = cy0 + Math.sin(n.a) * H * 0.44 * rad;
        x.fillStyle = 'rgba(139,107,255,' + (0.25 + n.r * 0.5) + ')';
        x.fillRect(px, py, 2, 2);
      });
      // core
      const pulse = S.status === 'working' ? 6 + Math.sin(tick * 0.2) * 2.5 : 5;
      x.fillStyle = '#35f2d7'; x.shadowColor = '#35f2d7'; x.shadowBlur = 14;
      x.beginPath(); x.arc(cx0, cy0, pulse, 0, 7); x.fill();
      x.shadowBlur = 0;
      x.fillStyle = 'rgba(147,163,196,.6)'; x.font = '8px monospace'; x.textAlign = 'left';
      x.fillText('experts 8/128 active', 6, 12);
      x.fillText(S.status === 'working' ? 'adapting…' : 'idle', 6, H - 6);
    })();
  }

  /* ───────── status orb ───────── */
  function syncStatus() {
    const orb = $('#statusOrb');
    orb.dataset.state = S.status;
    orb.querySelector('span').textContent = S.status.toUpperCase();
  }

  global.Arc = global.Arc || {};
  global.Arc.UI = {
    $, $$, logLine, typeLine, renderPipeline, pipeSet, renderTools, toolLive,
    renderLangPicker, renderQuickTags, renderTree, renderEditor, renderPersona,
    renderPresets, renderGuards, renderBench, renderCompileTargets, renderDiags,
    loadPreview, applyViewport, singleFileHTML, highlight, langOf, toast, syncStatus,
    startTTT, gauge, radar
  };
})(window);
