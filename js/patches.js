/* ═══════════════════════════════════════════════════════════
   ARCGEN · patches.js — iterative modification stack
   Turns a natural-language adjustment request ("make the player
   faster", "add a double jump") into a deterministic patch set that
   is applied to the ALREADY-GENERATED game files, then recompiled.

   The whole tool stack participates:
     planner  → intent parse + affected-file scoping
     coder    → surgical code edits (CFG knobs, runtime injections)
     files    → new/updated files in the project tree
     terminal → apply / revert through virtual fs commands
     compiler → post-patch validation gate (auto-revert on failure)

   Fully local: rule-based intent grammar + seeded RNG, zero APIs.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const S = Arc.State;

  /* ── helpers ─────────────────────────────────────────────── */
  const num = v => String(parseFloat(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function findFile(rx) {
    const b = S.build; if (!b) return null;
    return Object.keys(b.files).find(p => rx.test(p)) || null;
  }

  /* Replace exactly one occurrence of `from` with `to`.
     Returns null when ambiguous or missing (patch then fails safely). */
  function sub1(text, from, to) {
    const first = text.indexOf(from);
    if (first < 0) return null;
    if (text.indexOf(from, first + 1) >= 0) return null;   // ambiguous
    return text.slice(0, first) + to + text.slice(first + from.length);
  }

  /* Replace every CFG value line for a key. Robust against minified spacing. */
  function setCfg(src, key, valExpr) {
    const rx = new RegExp('(\\b' + key + '\\s*:\\s*)([^,\\n}\\r]+)');
    if (!rx.test(src)) return null;
    return src.replace(rx, (m, pre) => pre + valExpr);
  }

  function getCfg(src, key) {
    const m = new RegExp('\\b' + key + '\\s*:\\s*([-+0-9.eE]+)').exec(src);
    return m ? parseFloat(m[1]) : null;
  }

  /* insert a block right before an anchor string (single unique anchor) */
  function insertBefore(src, anchor, block) {
    const i = src.indexOf(anchor);
    if (i < 0) return null;
    return src.slice(0, i) + block + src.slice(i);
  }

  /* insert a block right after the end of an anchor string */
  function insertAfter(src, anchor, block) {
    const i = src.indexOf(anchor);
    if (i < 0) return null;
    const j = i + anchor.length;
    return src.slice(0, j) + block + src.slice(j);
  }

  /* ── knob vocabulary (synonyms → CFG key + scaling) ──────── */
  const KNOBS = [
    { key: 'PLAYER_SPEED',  aliases: ['speed', 'move speed', 'movement', 'player speed', 'run speed', 'walk speed'], lo: 60, hi: 1200, mode: 'mul' },
    { key: 'FIRE_COOLDOWN', aliases: ['fire rate', 'shoot rate', 'rof', 'rate of fire', 'cooldown', 'fire cooldown'], lo: 0.03, hi: 1.4, mode: 'inv' },
    { key: 'BULLET_SPEED',  aliases: ['bullet speed', 'projectile speed', 'shot speed', 'ball speed'], lo: 120, hi: 1800, mode: 'mul' },
    { key: 'ENEMY_BASE',    aliases: ['enemy speed', 'enemy base', 'creep speed', 'spawn speed'], lo: 10, hi: 400, mode: 'mul' },
    { key: 'SHAKE',         aliases: ['screen shake', 'shake', 'juice', 'impact feel', 'camera shake'], lo: 0, hi: 4, mode: 'mul' }
  ];
  const WAVES = { aliases: ['wave', 'waves', 'level', 'levels', 'difficulty curve length'], lo: 1, hi: 40 };

  /* fuzzy alias match against the request text */
  function matchKnob(t) {
    let best = null, bl = 0;
    for (const k of KNOBS) for (const a of k.aliases) {
      if (t.includes(a) && a.length > bl) { best = k; bl = a.length; }
    }
    if (best) return best;
    if (/\bspeed\b|\bfast(er)?\b|\bslow(er)?\b/.test(t)) return KNOBS[0];
    if (/\bshoot(s|ing)?\b|\bfir(e|es|ing)\b|\bgun\b|\bweapon\b/.test(t)) return KNOBS[1];
    if (/\bdifficult(y)?\b|\bharder\b|\beasier\b|\bhardest\b/.test(t)) return KNOBS[3];
    return null;
  }

  /* direction + magnitude from words or explicit numbers */
  function deltaOf(t, mode) {
    const up = /\b(increase|raise|boost|more|faster|higher|up|stronger|harder|huge|max|double|triple)\b/.test(t) &&
               !/\b(decrease|less|lower|slower|reduced?|weaker|easier)\b/.test(t);
    const down = /\b(decrease|reduce|lower|less|slower|weaker|easier|min|half)\b/.test(t) &&
                 !/\bincrease\b/.test(t);
    let f = up ? 1.35 : down ? 0.7 : 0;
    /* explicit target: "set speed 400" / "speed = 400" / "to 400" */
    let m = /\b(?:set|to|=)\s*(\d+(?:\.\d+)?)\b/.exec(t);
    let explicit = m ? parseFloat(m[1]) : null;
    /* relative % */
    m = /(\d+(?:\.\d+)?)\s*%/.exec(t);
    let pct = m ? parseFloat(m[1]) / 100 : null;
    if (/double/.test(t)) pct = 1; if (/triple/.test(t)) pct = 2; if (/\bhalf\b/.test(t)) pct = -0.5;
    return { dir: up ? 1 : down ? -1 : 0, factor: f, explicit, pct };
  }

  function colorFrom(t, fallbackPal) {
    const NAMED = { red: '#ff5c5c', blue: '#6ec6ff', green: '#a8ff3e', yellow: '#ffd24a', purple: '#8b6bff', pink: '#ff3d81', orange: '#ff8f5c', cyan: '#35f2d7', white: '#f8f8f8', gold: '#ffb547' };
    let m = /#([0-9a-f]{6})\b/i.exec(t);
    if (m) return '#' + m[1].toLowerCase();
    m = /\b(red|blue|green|yellow|purple|pink|orange|cyan|white|gold)\b/i.exec(t);
    if (m) return NAMED[m[1].toLowerCase()];
    return fallbackPal;
  }

  /* ── feature injections (self-contained JS snippets) ───────
     Each block is an IIFE so it can never collide with runtime
     identifiers. The generated runtime exposes: CFG, state,
     player, bullets, enemies, particles, pickups, bricks, ball,
     paddle, mouse, keys, rnd/rr/ri/clamp/lerp, sfx, boom, shake,
     say, startRun, hurt, update, render, frame.
     Every block carries a unique marker comment used by the
     idempotence check and the removal pass. ──────────────────── */

  const DOUBLE_JUMP = `
(function(){ /* PATCH:double-jump */
let extra = 1, armed = false;
const kd = e => {
  if (e.repeat || state.scene !== 'play') return;
  if (!/^(Space|KeyW|ArrowUp|KeyZ)$/.test(e.code)) return;
  if (armed && extra > 0) { extra--; player.inv = Math.max(player.inv, .3);
    boom(player.x, player.y + 12, CFG.PAL[1], 10, .7); sfx(720, .06, 'square', .12); }
  if (/^(Space|KeyW|ArrowUp|KeyZ)$/.test(e.code)) armed = false;
};
const ku = e => { if (/^(Space|KeyW|ArrowUp|KeyZ)$/.test(e.code)) armed = true; };
addEventListener('keydown', kd); addEventListener('keyup', ku);
const sr = startRun; startRun = function () { extra = 1; armed = false; sr(); };
})();
`;

  const WALL_JUMP = `
(function(){ /* PATCH:wall-jump */
addEventListener('keydown', e => {
  if (e.repeat || state.scene !== 'play') return;
  const L = player.x < 30, R = player.x > CFG.W - 30;
  if (L || R) { player.inv = Math.max(player.inv, .35);
    boom(player.x, player.y, CFG.PAL[2], 12, .7); sfx(520, .05, 'triangle', .12);
    shake(4); }
});
})();
`;

  const DASH = `
(function(){ /* PATCH:dash-burst */
let cd = 0, dur = 0, dir = 1, vx = 0;
addEventListener('keydown', e => {
  if (e.repeat || !(e.code === 'ShiftLeft' || e.code === 'ShiftRight')) return;
  if (state.scene !== 'play' || cd > 0) return;
  cd = .8; dur = .16;
  dir = (keys.KeyD || keys.ArrowRight) ? 1 : (keys.KeyA || keys.ArrowLeft) ? -1 : dir;
  vx = dir * 900; player.inv = Math.max(player.inv, .25);
  boom(player.x, player.y, CFG.PAL[0], 16, .9); sfx(220, .12, 'sawtooth', .1);
});
const up = update;
update = function (dt) {
  up(dt);
  cd = Math.max(0, cd - dt);
  if (dur > 0) { dur -= dt; player.x = clamp(player.x + vx * dt, 14, CFG.W - 14); }
};
})();
`;

  const SLOWMO = `
(function(){ /* PATCH:slowmo-matrix */
let acc = 0;
const up = update;
update = function (dt) {
  if (state.lives === 1 && state.scene === 'play') {
    acc += dt;
    if (acc >= (1 / 60) * 2) { acc = 0; up((1 / 60)); }   /* half-speed sim */
  } else { acc = 0; up(dt); }
};
const rd = render;
render = function () {
  if (state.lives === 1) { cx.save(); cx.globalAlpha = .96; rd(); cx.restore();
    cx.fillStyle = 'rgba(255,61,129,.08)'; cx.fillRect(0, 0, CFG.W, CFG.H); }
  else rd();
};
})();
`;

  const PAUSE = `
(function(){ /* PATCH:pause-menu */
addEventListener('keydown', e => {
  if (e.code === 'Escape' && state.scene === 'play') {
    state.paused = !state.paused;
    say(state.paused ? 'PAUSED' : 'RESUME', state.paused ? 'Esc to continue' : '');
  }
});
})();
`;

  const RESTART = `
(function(){ /* PATCH:instant-restart */
addEventListener('keydown', e => {
  if (e.code === 'KeyR' && state.scene !== 'menu') { startRun(); sfx(880, .05, 'square', .12); }
});
})();
`;

  const MOBILE = `
<!-- PATCH:mobile-dpad -->
<div id="pad" style="position:absolute;inset:auto 0 0 0;display:flex;justify-content:space-between;padding:10px 14px;pointer-events:none;font-family:monospace">
  <div style="display:flex;gap:8px;pointer-events:auto">
    <button data-k="ArrowLeft" style="width:52px;height:52px;border-radius:50%;border:1px solid #35f2d7;background:rgba(7,11,20,.6);color:#35f2d7;font-size:20px">◀</button>
    <button data-k="ArrowRight" style="width:52px;height:52px;border-radius:50%;border:1px solid #35f2d7;background:rgba(7,11,20,.6);color:#35f2d7;font-size:20px">▶</button>
  </div>
  <button data-k="Space" style="width:58px;height:58px;border-radius:50%;border:1px solid #ff3d81;background:rgba(7,11,20,.6);color:#ff3d81;font-size:15px;pointer-events:auto">●</button>
</div>
<script>
(function(){var p=document.getElementById('pad');if(!p)return;p.querySelectorAll('button').forEach(function(b){
var k=b.dataset.k;var dn=function(ev){ev.preventDefault();window.dispatchEvent(new KeyboardEvent('keydown',{code:k}));};
var up=function(ev){ev.preventDefault();window.dispatchEvent(new KeyboardEvent('keyup',{code:k}));};
b.addEventListener('touchstart',dn,{passive:false});b.addEventListener('touchend',up,{passive:false});
b.addEventListener('mousedown',dn);b.addEventListener('mouseup',up);});})();
</script>
<!-- /PATCH:mobile-dpad -->
`;

  const GAMEPAD = `
(function(){ /* PATCH:gamepad-poll */
const prev = {};
const map = { 0: 'Space', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 9: 'KeyR', 8: 'Escape' };
setInterval(() => {
  const gp = (navigator.getGamepads && navigator.getGamepads()[0]);
  if (!gp) return;
  gp.buttons.forEach((b, i) => {
    const code = map[i]; if (!code) return;
    const now = b.pressed || b.value > .5;
    if (now && !prev[i]) dispatchEvent(new KeyboardEvent('keydown', { code }));
    if (!now && prev[i]) dispatchEvent(new KeyboardEvent('keyup', { code }));
    prev[i] = now;
  });
}, 16);
})();
`;

  const CRT = `
(function(){ /* PATCH:crt-scanlines */
const rd = render;
render = function () {
  rd();
  cx.save(); cx.globalAlpha = .12; cx.fillStyle = '#000';
  for (let y = 0; y < CFG.H; y += 3) cx.fillRect(0, y, CFG.W, 1);
  cx.globalAlpha = .05; cx.fillStyle = CFG.PAL[0];
  cx.fillRect(0, (state.t * 40) % CFG.H, CFG.W, 2);
  cx.restore();
};
})();
`;

  const CHIPTUNE = `
(function(){ /* PATCH:chiptune-groove */
let n = 0;
const scale = [110, 130.8, 146.8, 164.8, 196, 220];
setInterval(() => {
  n++;
  if (state.scene !== 'play') return;
  if (n % 8 === 0) sfx(scale[(rnd() * scale.length) | 0], .14, 'triangle', .05);
  if (n % 4 === 2) sfx(scale[(n >> 2) % scale.length] * 2, .05, 'square', .03);
}, 125);
})();
`;

  const BGM = `
(function(){ /* PATCH:arpeggio-bgm */
let step = 0;
const arp = [262, 330, 392, 523, 392, 330];
setInterval(() => {
  if (state.scene !== 'play') return;
  sfx(arp[step++ % arp.length] * (state.wave > 4 ? 2 : 1), .09, 'sine', .04);
}, 210);
})();
`;

  const MINIMAP = `
(function(){ /* PATCH:entity-minimap */
const rd = render;
render = function () {
  rd();
  if (!player) return;
  cx.save();
  cx.globalAlpha = .8; cx.strokeStyle = CFG.PAL[1]; cx.lineWidth = 1;
  cx.strokeRect(CFG.W - 112, 10, 100, 56);
  const sx = 100 / CFG.W, sy = 56 / CFG.H;
  cx.fillStyle = '#fff'; cx.fillRect(CFG.W - 112 + player.x * sx, 10 + player.y * sy, 2, 2);
  (enemies || []).forEach(e => { cx.fillStyle = CFG.PAL[3] || '#ff3d81'; cx.fillRect(CFG.W - 112 + e.x * sx, 10 + e.y * sy, 2, 2); });
  cx.restore();
};
})();
`;

  const SAVE_STATE = `
(function(){ /* PATCH:run-autosave */
try {
  const sv = JSON.parse(localStorage.getItem('arcgen.run') || 'null');
  if (sv && sv.score) setTimeout(() => { startRun(); state.score = sv.score | 0; state.wave = Math.max(1, sv.wave | 0); }, 60);
} catch (e) {}
setInterval(() => {
  if (state.scene === 'play') { try { localStorage.setItem('arcgen.run', JSON.stringify({ score: state.score, wave: state.wave })); } catch (e) {} }
  else { try { localStorage.removeItem('arcgen.run'); } catch (e) {} }
}, 3000);
})();
`;

  const BLOOD = `
(function(){ /* PATCH:particle-density */
const old = boom;
boom = function (x, y, col, n, power) { old(x, y, col, Math.round((n || 10) * 1.8), (power || 1) * 1.25); };
})();
`;

  const TRAIL = `
(function(){ /* PATCH:motion-trail */
const buf = [];
const up = update;
update = function (dt) {
  up(dt);
  if (player) { buf.push({ x: player.x, y: player.y, a: 1 }); if (buf.length > 24) buf.shift(); }
  buf.forEach(p => p.a -= dt * 3);
};
const rd = render;
render = function () {
  rd();
  cx.save();
  buf.forEach(p => { if (p.a > 0) { cx.globalAlpha = p.a * .35; cx.fillStyle = CFG.PAL[0]; cx.beginPath(); cx.arc(p.x, p.y, 5 * p.a, 0, 7); cx.fill(); } });
  cx.restore();
};
})();
`;

  const GHOST = `
(function(){ /* PATCH:ghost-replay */
const rec = [];
const up = update;
update = function (dt) {
  up(dt);
  if (state.scene === 'play' && player) { rec.push({ x: player.x, y: player.y }); if (rec.length > 3600) rec.shift(); }
};
let gf = 0;
const rd = render;
render = function () {
  rd();
  if (rec.length > 60 && state.scene === 'play') {
    const g = rec[gf++ % rec.length];
    cx.save(); cx.globalAlpha = .25; cx.fillStyle = CFG.PAL[2];
    cx.beginPath(); cx.arc(g.x, g.y, 8, 0, 7); cx.fill(); cx.restore();
  }
};
})();
`;

  /* ── feature vocabulary → injection descriptors ──────────── */
  const FEATURES = [
    { id: 'double-jump',     rx: /\bdouble ?jump/,                file: 'js', code: DOUBLE_JUMP, marker: 'PATCH:double-jump',   label: 'runtime: double-jump module' },
    { id: 'wall-jump',       rx: /\bwall ?jump/,                  file: 'js', code: WALL_JUMP,   marker: 'PATCH:wall-jump',     label: 'runtime: wall-jump module' },
    { id: 'dash',            rx: /\bdash(ing|es|ed)?\b/,          file: 'js', code: DASH,        marker: 'PATCH:dash-burst',    label: 'runtime: dash burst + i-frames' },
    { id: 'slowmo',          rx: /\bslow[- ]?(mo|motion|matrix)/, file: 'js', code: SLOWMO,      marker: 'PATCH:slowmo-matrix', label: 'runtime: slow-motion at 1 life' },
    { id: 'pause',           rx: /\bpause\b/,                     file: 'js', code: PAUSE,       marker: 'PATCH:pause-menu',    label: 'runtime: pause menu (Esc)' },
    { id: 'restart',         rx: /\brestart\b|\binstant retry\b|\bquick retry\b/, file: 'js', code: RESTART, marker: 'PATCH:instant-restart', label: 'runtime: instant restart (R)' },
    { id: 'mobile-controls', rx: /\bmobile\b|\btouch control[s]?\b|\bon-screen\b|\bd-pad\b|\bdpad\b/, file: 'html', code: MOBILE, marker: 'PATCH:mobile-dpad', label: 'shell: mobile touch d-pad' },
    { id: 'gamepad',         rx: /\bgame ?pad\b|\bcontroller\b/,  file: 'js', code: GAMEPAD,     marker: 'PATCH:gamepad-poll',  label: 'runtime: gamepad polling' },
    { id: 'crt',             rx: /\bcrt\b|\bscan ?lines?/,        file: 'js', code: CRT,         marker: 'PATCH:crt-scanlines', label: 'runtime: CRT scanline overlay' },
    { id: 'chiptune',        rx: /\bchiptune\b|\bbass\b|\bgroove\b/, file: 'js', code: CHIPTUNE, marker: 'PATCH:chiptune-groove', label: 'audio: chiptune bass groove' },
    { id: 'music',           rx: /\bmusic\b|\bsoundtrack\b|\bbgm\b/, file: 'js', code: BGM,      marker: 'PATCH:arpeggio-bgm',  label: 'audio: procedural arpeggio BGM' },
    { id: 'minimap',         rx: /\bmini ?map\b|\boverlay map\b/, file: 'js', code: MINIMAP,     marker: 'PATCH:entity-minimap', label: 'HUD: entity minimap' },
    { id: 'autosave',        rx: /\bautosave\b|\bsave (the )?(run|state|progress)\b/, file: 'js', code: SAVE_STATE, marker: 'PATCH:run-autosave', label: 'data: run autosave' },
    { id: 'more-particles',  rx: /\bmore (particles|explosions|effects|fx|juice)\b|\bheavier (fx|explosions)|particles?\b(?=[^\n]*\bmore\b)/, file: 'js', code: BLOOD, marker: 'PATCH:particle-density', label: 'FX: particle density ×1.8' },
    { id: 'trail',           rx: /\btrail\b/,                     file: 'js', code: TRAIL,       marker: 'PATCH:motion-trail',  label: 'FX: motion trail' },
    { id: 'ghost-replay',    rx: /\bghost(s| replay| runs?)?\b/,  file: 'js', code: GHOST,       marker: 'PATCH:ghost-replay',  label: 'runtime: ghost replay' }
  ];

  const REMOVE_RX = /\b(remove|delete|disable|drop|get rid of|without)\b/;

  /* palette swap across css/hud.css + inlined <style> in index.html + game CFG.PAL.
     `push` is analyze()'s per-path op accumulator. */
  /* NOTE: every branch reads its starting point from the per-path working
     copy (ops) instead of the pristine b.files — otherwise a later edit on
     the same path would clobber earlier merged ops (e.g. an injected feature
     silently dropped when a recolour follows it in one directive). */
  function buildPalettePatch(t, push, files, ops) {
    const col = colorFrom(t);
    if (!col) return false;
    let touched = false;
    const pal = (S.plan && S.plan.palette) || ['#35f2d7'];
    const recolour = src => {
      let s = src.split(pal[0]).join(col);
      s = s.replace(/--accent\s*:\s*[^;]+;/, '--accent: ' + col + ';');
      return s;
    };
    const cssPath = findFile(/(^|\/)css\/hud\.css$/);
    if (cssPath) {
      const base = wc(files, ops, cssPath);
      const css = recolour(base);
      if (css !== base) { push(cssPath, css, 'css: accent recoloured to ' + col); touched = true; }
    }
    /* new builds inline the HUD stylesheet inside index.html — recolour it too */
    const htmlPath = findFile(/(^|\/)index\.html$/);
    if (htmlPath) {
      const base = wc(files, ops, htmlPath);
      const html = recolour(base);
      if (html !== base) { push(htmlPath, html, 'shell: inline HUD style recoloured to ' + col); touched = true; }
    }
    const jsPath = findFile(/(^|\/)js\/game\.js$/);
    if (jsPath) {
      const js = wc(files, ops, jsPath);   // stacked: keeps any feature already injected this pass
      const m = /PAL:\s*\[([^\]]*)\]/.exec(js);
      if (m) {
        const arr = m[1].split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length && arr[0] !== "'" + col + "'") {
          arr[0] = "'" + col + "'";
          push(jsPath, js.replace(m[0], 'PAL: [' + arr.join(', ') + ']'), 'runtime: CFG.PAL[0] → ' + col);
          touched = true;
        }
      }
    }
    return touched;
  }

  /* ── self-heal diagnostics (problem-report directives) ──────
     When the user reports a SYMPTOM ("black screen", "game won't
     start", "no sound") instead of naming a feature/knob, we run
     deterministic checks against the live build and emit concrete
     repair ops. Fully local: static inspection + vm-based runtime
     smoke test of the generated script. */
  const SYMPTOM_RX = /\b(black|blank|white)\s+screen\b|\bdark\s+screen\b|\bscreen\s+(?:is|stays?|shows?)\s*(?:black|blank|nothing|dark)|won'?t\s+(?:start|load|run|render)|doesn'?t\s+(?:start|load|run|work|render|show)|no\s+(?:sound|audio|music)|can'?t\s+see|nothing\s+(?:shows|happens|renders)|freeze[sd]?|frozen|crash(?:es|ed)?|error(?:s)?\s+(?:on|in)\s+(?:the\s+)?(?:console|screen)|broken|unplayable|not\s+(?:loading|running|working|visible)/i;

  /* Runtime smoke test: evaluate the emitted game script in a stubbed
     DOM. Catches ReferenceError / TypeError that produce a black canvas.
     Returns { crash, error } — never throws. */
  function smokeTest(src) {
    try {
      if (typeof window !== 'undefined' && typeof window.document === 'object') return { crash: false }; // browser: preview iframe is the real test
      let vm = null;
      try { if (typeof require === 'function') vm = require('vm'); } catch (e) { vm = null; }
      if (!vm) return { crash: false };   // no node vm available — skip smoke test, static checks still run
      const noop = () => {};
      const ctxStub = { fillRect: noop, clearRect: noop, drawImage: noop, save: noop, restore: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, fillText: noop, measureText: () => ({ width: 10 }), translate: noop, scale: noop, rotate: noop, closePath: noop, rect: noop, strokeRect: noop, setTransform: noop };
      const mkEl = () => ({ getContext: () => ctxStub, style: {}, classList: { add: noop, remove: noop, toggle: noop }, textContent: '', innerHTML: '', width: 960, height: 540, addEventListener: noop, appendChild: noop, querySelectorAll: () => [], dataset: {} });
      const document = { getElementById: mkEl, createElement: mkEl, body: mkEl(), addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] };
      const win = { document, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, navigator: { getGamepads: () => [] }, requestAnimationFrame: noop, setTimeout: noop, setInterval: noop, addEventListener: noop, dispatchEvent: noop, AudioContext: undefined, matchMedia: () => ({ matches: false }) };
      win.window = win;
      const sandbox = new Proxy(win, { has: () => true, get: (o, p) => (p in o ? o[p] : undefined), set: (o, p, v) => { o[p] = v; return true; } });
      vm.createContext(sandbox);
      vm.runInContext('(function(){' + src + '\n})();', sandbox, { timeout: 2500 });
      if (typeof sandbox.frame === 'function') for (let i = 0; i < 130; i++) sandbox.frame(i * 16.7);
      return { crash: false };
    } catch (e) {
      return { crash: true, error: (e && e.constructor ? e.constructor.name + ': ' : '') + (e && e.message ? e.message : String(e)) };
    }
  }

  /* Build the repair op list for a symptom directive. Mutates pushOp/notes.
     Returns true when at least one genuine problem was found & repaired. */
  function diagnose(t, push, notes, b, jsPath, htmlPath, cssPath) {
    let healed = false;
    const wantsAudio = /no\s+(sound|audio|music)|silent/.test(t);
    const wantsVisual = !wantsAudio;   // black/blank/broken/crash reports default to visual pipeline checks

    /* D1 · runtime missing entirely from the tree */
    if (wantsVisual && !jsPath) {
      notes.push('runtime js/game.js missing from project — regenerating core modules');
      healCore(push, b, notes);
      return true;
    }

    if (jsPath) {
      const src = b.files[jsPath] || '';

      /* D2 · canvas binding fault (classic black-screen cause) */
      if (wantsVisual && /getElementById\(\s*["'](?:(?!["'])[^"']*)["']\s*\)/.test(src)) {
        const bound = /getElementById\(\s*["']game["']\s*\)/.test(src);
        if (!bound) {
          const fixed = src.replace(/getElementById\(\s*["'][^"']*["']\s*\)(?=[\s\S]{0,80}?getContext)/, "getElementById('game')");
          if (fixed !== src) { push(jsPath, fixed, 'self-heal: canvas binding → #game'); notes.push('⚠ canvas element binding was broken — rewired to #game'); healed = true; }
        }
      }

      /* D3 · syntax/runtime crash detection via headless smoke test */
      if (wantsVisual) {
        const st = smokeTest(src);
        if (st.crash) {
          notes.push('⚠ runtime smoke test crashed (' + st.error.slice(0, 90) + ') — regenerating clean runtime');
          const fresh = Arc.Generators.genGameJS(S.plan);
          push(jsPath, fresh, 'self-heal: runtime regenerated after smoke-test crash');
          healed = true;
        }
      }

      /* D4 · audio guard: bare AudioContext without webkit fallback */
      if (wantsAudio && /\bnew AudioContext\(/.test(src) && !/webkitAudioContext/.test(src)) {
        const fixed = src.replace(/new AudioContext\(/g, "new (window.AudioContext || window.webkitAudioContext)(");
        push(jsPath, fixed, 'self-heal: audio context webkit fallback'); notes.push('⚠ audio context lacked Safari fallback — guarded'); healed = true;
      }
    }

    if (htmlPath) {
      const h = b.files[htmlPath] || '';

      /* D5 · shell must carry styling (inline <style> or hud.css link) */
      const styled = /<style[\s>]/i.test(h) || /<link[^>]+hud\.css/i.test(h);
      if (wantsVisual && !styled) {
        const cssSrc = cssPath ? (b.files[cssPath] || '') : (Arc.Generators.genHudCSS(S.plan));
        const fixed = h.replace(/<\/head>/i, '<style>\n' + cssSrc + '\n</style></head>');
        if (fixed !== h) { push(htmlPath, fixed, 'self-heal: HUD stylesheet inlined into shell'); notes.push('⚠ shell had no styling — HUD stylesheet inlined'); healed = true; }
      }

      /* D6 · runtime tag present (srcdoc preview can only inline what exists) */
      const hasRt = /<script[^>]+src=["']js\/game\.js["']/.test(h) || /requestAnimationFrame/.test(h);
      if (wantsVisual && !hasRt && jsPath) {
        const fixed = h.replace('</body>', '<script src="js/game.js"></script>\n</body>');
        if (fixed !== h) { push(htmlPath, fixed, 'self-heal: runtime <script> re-linked in shell'); notes.push('⚠ shell was not loading the runtime — <script> re-linked'); healed = true; }
      }

      /* D7 · canvas element exists in the stage */
      if (wantsVisual && !/<canvas/i.test(h)) {
        const g = (S.plan && S.plan.genreLabel) || {};
        const cvHtml = '\n<main class="stage"><canvas id="game" width="' + ((S.plan && S.plan.W) || 960) + '" height="' + ((S.plan && S.plan.H) || 540) + '"></canvas><div id="banner" class="banner"></div></main>\n';
        const fixed = h.replace(/<\/body>/, cvHtml + '</body>');
        push(htmlPath, fixed, 'self-heal: canvas stage re-injected'); notes.push('⚠ shell had no <canvas> — stage re-injected'); healed = true;
      }
    }

    /* D8 · nothing statically wrong → full regeneration sweep (fresh core
       files from the current plan; removes any accumulated bad patches) */
    if (!healed) {
      notes.push('static audit clean — running full regeneration sweep from the stored spec');
      healCore(push, b, notes);
      healed = true;
    }
    return healed;
  }

  /* Regenerate the playable web core (index.html, js/game.js, css/hud.css)
     straight from the stored plan — the AI's own generators, deterministic. */
  function healCore(push, b, notes) {
    const plan = S.plan;
    if (!plan || !global.Arc || !Arc.Generators) { notes.push('generators unavailable — cannot regenerate'); return; }
    try {
      push('index.html', Arc.Generators.genIndexHTML(plan), 'regen: index.html from spec');
      push('js/game.js', Arc.Generators.genGameJS(plan), 'regen: js/game.js from spec');
      push('css/hud.css', Arc.Generators.genHudCSS(plan), 'regen: css/hud.css from spec');
      notes.push('✓ core shell + runtime + stylesheet rebuilt from the stored game spec');
    } catch (e) { notes.push('regeneration fault: ' + e.message); }
  }

  /* ───────────────────────── main entry ───────────────────────── */
  /* Working copy of a file inside this analysis pass. Chained edits
     on the same path accumulate instead of clobbering each other. */
  function wc(files, ops, path) {
    const o = ops.filter(x => x.path === path);
    return o.length ? o[o.length - 1].to : files[path];
  }

  /* Analyse a directive WITHOUT mutating state (dry run). */
  function analyze(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
    const b = S.build;
    if (!b || !S.plan) return { ok: false, error: 'no active build — generate a game first' };

    const ops = [];          // per-path merged {path, from, to, whys[]}
    const notes = [];        // human-readable change list
    let newTitle = null;
    let matchedAny = false;

    const jsPath = findFile(/(^|\/)js\/game\.js$/);
    const htmlPath = findFile(/(^|\/)index\.html$/);
    const cssPath = findFile(/(^|\/)css\/hud\.css$/);
    const gddPath = findFile(/(^|\/)gdd\.md$/);
    const neg = REMOVE_RX.test(t);

    function pushOp(path, to, why) {
      const ex = ops.find(o => o.path === path);
      if (ex) { ex.to = to; ex.whys.push(why); }
      else ops.push({ path, from: b.files[path] !== undefined ? b.files[path] : null, to, whys: [why] });
    }

    /* 0 · symptom reports ("black screen", "won't start", "no sound")
       route into the self-heal diagnostic pipeline instead of being
       rejected as unrecognized directives. */
    let diagnostic = false;
    if (SYMPTOM_RX.test(t)) {
      const before = ops.length;
      matchedAny = diagnose(t, pushOp, notes, b, jsPath, htmlPath, cssPath);
      if (matchedAny) diagnostic = true;
      else notes.push('symptom noted but no repairable fault found — describe it again or try feature/knob words');
      void before;
    }

    /* 1 · features (add / remove) */
    for (const f of FEATURES) {
      if (!f.rx.test(t)) continue;
      matchedAny = true;
      const path = f.file === 'html' ? htmlPath : jsPath;
      if (!path) { notes.push('target file missing for ' + f.id); continue; }
      const src = wc(b.files, ops, path);
      const has = src.includes(f.marker);
      if (neg) {
        if (!has) { notes.push('nothing to remove — `' + f.id + '` not present'); continue; }
        let cut;
        if (f.file === 'html') {
          const a = src.indexOf('<!-- PATCH:mobile-dpad -->');
          const z = src.indexOf('<!-- /PATCH:mobile-dpad -->');
          cut = (a >= 0 && z > a) ? src.slice(0, a) + src.slice(z + '<!-- /PATCH:mobile-dpad -->'.length) : null;
        } else {
          const a = src.indexOf('/* ' + f.marker + ' */');
          /* block starts at the IIFE opener one line above the marker */
          const open = src.lastIndexOf('(function(){', a);
          const closeTok = '\n})();\n';
          const c = a >= 0 ? src.indexOf(closeTok, a) : -1;
          cut = (open >= 0 && c > open) ? src.slice(0, open) + src.slice(c + closeTok.length) : null;
        }
        if (cut === null) { notes.push('could not excise `' + f.id + '` safely'); continue; }
        pushOp(path, cut, 'removed feature: ' + f.id);
        notes.push('− removed feature: ' + f.id);
        continue;
      }
      if (has) { notes.push('already present: ' + f.id); continue; }
      let out;
      if (f.file === 'html') {
        out = insertBefore(src, '<script src="js/game.js"></script>', f.code + '\n');
        if (out === null) out = insertBefore(src, '</body>', f.code + '\n');
      } else {
        out = insertBefore(src, 'function frame(now)', f.code + '\n');
        if (out === null) out = insertBefore(src, 'requestAnimationFrame(frame)', f.code + '\n');
      }
      if (out === null) { notes.push('could not locate injection anchor for ' + f.id); continue; }
      pushOp(path, out, f.label);
      notes.push('+ ' + f.label);
    }

    /* 2 · numeric knobs */
    const knob = matchKnob(t);
    if (knob && !neg && jsPath) {
      const d = deltaOf(t);
      if (d.dir !== 0 || d.explicit != null || d.pct != null) {
        matchedAny = true;
        const src = wc(b.files, ops, jsPath);
        const cur = getCfg(src, knob.key);
        if (cur == null) notes.push('knob ' + knob.key + ' not found in runtime');
        else {
          let next;
          if (d.explicit != null) next = d.explicit;
          else if (d.pct != null) next = cur * (1 + (d.dir >= 0 ? d.pct : -d.pct));
          else if (knob.mode === 'inv') next = d.dir > 0 ? cur * 0.7 : cur * 1.4;
          else next = cur * d.factor;
          next = clamp(next, knob.lo, knob.hi);
          const out = setCfg(src, knob.key, num(+next.toFixed(4)));
          if (out === null) notes.push('knob ' + knob.key + ' not tunable');
          else {
            pushOp(jsPath, out, 'tuning: ' + knob.key + ' ' + cur + ' → ' + +next.toFixed(3));
            notes.push('tuned ' + knob.key.toLowerCase().replace(/_/g, ' ') + ': ' + cur + ' → ' + +next.toFixed(3));
          }
        }
      }
    }

    /* waves / difficulty count */
    if (jsPath && (/\bwaves?\b/.test(t) || /\blevels?\b/.test(t) || /\bdifficult(y)?\b/.test(t))) {
      const m = /(\d+)\s*waves?/.exec(t) || /waves?\s*(?:to|=)\s*(\d+)/.exec(t);
      const d = deltaOf(t);
      const src = wc(b.files, ops, jsPath);
      const cur = getCfg(src, 'WAVES');
      if (cur != null && (m || d.dir !== 0)) {
        matchedAny = true;
        const next = clamp(m ? +m[1] : cur + d.dir * 2, WAVES.lo, WAVES.hi);
        const out = setCfg(src, 'WAVES', num(next));
        if (out !== null) {
          pushOp(jsPath, out, 'tuning: WAVES ' + cur + ' → ' + next);
          notes.push('wave count: ' + cur + ' → ' + next);
        }
      }
    }

    /* 3 · palette / theme colour */
    if (/\bcolou?r(ed|our)?\b|\btheme\b|\bpalette\b|\bpastel\b|\b(?:red|blue|green|yellow|purple|pink|orange|cyan|white|gold|magenta|teal|crimson|scarlet|indigo|violet|turquoise|emerald)\b|#[0-9a-f]{3,8}\b/i.test(t) && !neg) {
      if (buildPalettePatch(t, pushOp, b.files, ops)) { matchedAny = true; notes.push('palette recolour applied (css + inline shell style + runtime CFG.PAL)'); }
    }

    /* 4 · fps / resolution */
    if (jsPath) {
      let m = /(\d{2,3})\s*fps/.exec(t);
      if (m) {
        matchedAny = true;
        const src = wc(b.files, ops, jsPath);
        const step = (1 / clamp(+m[1], 24, 144)).toFixed(6).replace(/0+$/, '');
        const out = setCfg(src, 'STEP', step);
        if (out !== null) { pushOp(jsPath, out, 'timestep → 1/' + m[1]); notes.push('fixed timestep → 1/' + m[1] + 's'); }
      }
      m = /(\d{3,4})\s*[x×]\s*(\d{3,4})/.exec(t);
      if (m) {
        matchedAny = true;
        const src = wc(b.files, ops, jsPath);
        let out = setCfg(src, 'W', m[1]);
        if (out) { const s2 = setCfg(out, 'H', m[2]); if (s2) out = s2; }
        if (out) { pushOp(jsPath, out, 'stage resized to ' + m[1] + '×' + m[2]); notes.push('stage resized to ' + m[1] + '×' + m[2]); }
      }
    }

    /* 5 · title rename */
    let m = /\b(?:call it|rename(?:d|s)? (?:it |the game )?to|title(?:d)? (?:it )?|name(?:d)? it)\s+["“']?([^"”'\n]{2,40})["”']?/.exec(t);
    if (m && !neg) {
      matchedAny = true;
      const nt = m[1].trim().replace(/[\s"”']+$/, '').replace(/\b\w/g, c => c.toUpperCase());
      const old = S.plan.title;
      if (htmlPath) pushOp(htmlPath, wc(b.files, ops, htmlPath).split(old).join(nt), 'shell: title → “' + nt + '”');
      if (jsPath) pushOp(jsPath, wc(b.files, ops, jsPath).split(old).join(nt), 'runtime: banner title → “' + nt + '”');
      notes.push('title → “' + nt + '”');
      newTitle = nt;
    }

    /* finalise ops: attach GDD changelog for any real change */
    if (ops.length && gddPath) {
      const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const entry = '\n\n## Patch log · ' + stamp + '\n' +
        ops.map(o => '- ' + o.whys.join(' · ')).join('\n') +
        '\n_directive: “' + String(text).trim() + '”_\n';
      ops.push({ path: gddPath, from: b.files[gddPath], to: b.files[gddPath] + entry, whys: ['docs: GDD patch log updated'] });
    }

    const finalOps = ops.map(o => ({ path: o.path, from: o.from, to: o.to, why: o.whys.join(' · ') }));

    return {
      ok: true,
      ops: finalOps,
      notes,
      matched: matchedAny,
      diagnostic,
      directive: String(text).trim(),
      newTitle,
      files: finalOps.map(o => o.path)
    };
  }

  /* Apply analysed ops to the live build (mutates S.build.files).
     Returns a snapshot usable by revert(). */
  function apply(an) {
    const b = S.build;
    const backup = {};
    an.ops.forEach(o => { backup[o.path] = (o.from === null || o.from === undefined) ? null : b.files[o.path]; });
    an.ops.forEach(o => { b.files[o.path] = o.to; });
    b.patched = (b.patched || 0) + 1;
    b.lastPatch = { at: Date.now(), directive: an.directive, ops: an.ops.map(o => o.why), files: an.files };
    if (!b.history) b.history = [];
    b.history.push({ at: Date.now(), directive: an.directive, titleBefore: S.plan.title, backup });
    if (b.history.length > 24) b.history.shift();          // cap snapshots
    if (an.newTitle) S.plan.title = an.newTitle;
    S.save();
    return backup;
  }

  /* Revert the most recent patch. */
  function undo() {
    const b = S.build;
    if (!b || !b.history || !b.history.length) return null;
    const snap = b.history.pop();
    Object.entries(snap.backup).forEach(([p, txt]) => { if (txt === null) delete b.files[p]; else b.files[p] = txt; });
    if (S.plan && snap.titleBefore) S.plan.title = snap.titleBefore;
    b.lastPatch = { at: Date.now(), directive: 'revert', ops: ['reverted: ' + (snap.directive || 'patch')], files: Object.keys(snap.backup) };
    S.save();
    return snap;
  }

  /* Revert every recorded patch (newest → oldest). */
  function undoAll() {
    let n = 0;
    while (undo()) n++;
    return n;
  }

  /* True when the active build has at least one revertible patch snapshot. */
  function hasHistory() {
    const b = S.build;
    return !!(b && Array.isArray(b.history) && b.history.length);
  }

  global.Arc = global.Arc || {};
  global.Arc.Patches = { analyze, apply, undo, undoAll, hasHistory, FEATURES, KNOBS };
})(window);
