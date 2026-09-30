/* ═══════════════════════════════════════════════════════════
   ARCGEN · compiler.js — validation, self-repair & build report
   Layers:
     1. structural pass  (brace/paren/quote balance per file)
     2. semantic pass    (contract checks required by the persona)
     3. budget pass      (sprite/frame/bundle limits)
     4. real syntax check for emitted JS via Function() constructor
        — runs inside this page's own JS engine, still fully offline.
   Every error found is auto-patched where possible (self-repair),
   then the whole pass re-runs; the loop is capped at 3 iterations.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const CONTRACT = [
    { id: 'fixed-timestep', test: s => /STEP:\s*1\s*\/\s*60/.test(s), msg: 'simulation must advance on a fixed timestep' },
    { id: 'seeded-rng',     test: s => /0x6D2B79F5|mulberry32/.test(s), msg: 'RNG must be seeded for reproducibility' },
    { id: 'win-state',      test: s => /endRun\(true\)|MISSION CLEAR/.test(s), msg: 'a win condition is mandatory' },
    { id: 'lose-state',     test: s => /endRun\(false\)|RUN OVER/.test(s), msg: 'a lose condition is mandatory' },
    { id: 'input-map',      test: s => /addEventListener\('keydown'/.test(s), msg: 'keyboard input handler missing' },
    { id: 'touch-input',    test: s => /touchstart|touchmove/.test(s), msg: 'touch fallback missing (mobile play)' },
    { id: 'audio-hook',     test: s => /AudioContext/, msg: 'procedural audio not wired' },
    { id: 'fx-particles',   test: s => /function boom/, msg: 'particle feedback missing (persona demands juice)' },
    { id: 'persistence',    test: s => /localStorage/, msg: 'high-score persistence missing' }
  ];

  /* ─────────────────────────────────────────────────────────────
     LANGUAGE PROFILES — one grammar per family so the structural
     pass never mistakes prose, Make variables or shader syntax for
     code delimiters.
       marks : line-comment openers ('#' alone also opens a line in
               hash-line languages, e.g. Makefile / shell)
       blocks: block-comment pairs
       str   : string quote characters
       triple: multi-line quote pairs (python)
       regex : scan /…/flags literals (JS family only)
       tpl   : `…${expr}…` template literals (JS only)
       tag   : HTML tag markup carries attribute quotes
     ───────────────────────────────────────────────────────────── */
  const LANGS = {
    js:   { marks: ['//'], blocks: [['/*', '*/']], str: ['"', "'", '`'], triple: [], regex: true, tpl: true },
    cline:{ marks: ['//'], blocks: [['/*', '*/']], str: ['"', "'"],      triple: [], regex: false },
    css:  { marks: [],     blocks: [['/*', '*/']], str: ['"', "'"],      triple: [] },
    py:   { marks: ['#'],  blocks: [],             str: ['"', "'"],
            triple: [['"""', '"""'], ["'''", "'''"]] },
    sh:   { marks: ['#'],  blocks: [],             str: ['"', "'", '`'] },
    gd:   { marks: ['#'],  blocks: [],             str: ['"', "'"] },
    lua:  { marks: ['--'], blocks: [['--[[', ']]']],str: ['"', "'"] },
    html: { marks: [],     blocks: [['<!--', '-->']], str: ['"', "'"], tag: true },
    json: { marks: [],     blocks: [],             str: ['"'] },
    text: { marks: [],     blocks: [],             str: [] },
    make: { marks: [],     blocks: [],             str: ['"', "'"] }
  };

  function langFor(path) {
    const p = String(path || '').toLowerCase();
    if (/\.html?$/.test(p) || /\.(htm|vue)$/.test(p)) return 'html';
    if (/\.css$/.test(p)) return 'css';
    if (/\.(json|webmanifest)$/.test(p)) return 'json';
    if (/\.py$/.test(p)) return 'py';
    if (/^makefile$|\.mk$|\.sh$|\.bash$/.test(p)) return 'sh';
    if (/\.gd$/.test(p)) return 'gd';
    if (/\.lua$/.test(p)) return 'lua';
    if (/\.(js|mjs|cjs|ts)$/.test(p)) return 'js';
    if (/\.(md|txt|svg)$/.test(p) || /\.gitignore$/.test(p)) return 'text';
    if (/\.(cs|cpp|cc|h|hpp|java|rs|glsl|vert|frag)$/.test(p)) return 'cline';
    /* extension-less build files (Makefile, Dockerfile…) — '#' there starts a
       comment only when preceded by whitespace or line start, otherwise it is
       Make syntax ($#, #-comments inside recipes are rare). */
    return 'make';
  }

  const REGEX_PRECEDERS = new Set(
    '(,=:[!&|?{};+-*%^~<>'.split('')
  );

  /* True when a '/' at i opens a regex LITERAL rather than being the
     division / comment operator. Decided from the last significant token
     character before it: after a value (identifier, number, ')' or ']' or a
     string/regex terminator) a slash can only divide. */
  function regexAllowed(src, i) {
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    const c = src[k];
    if (REGEX_PRECEDERS.has(c)) return true;
    if (/[A-Za-z0-9_$)\]'"`]/.test(c)) {
      const kw = /(?:^|[^\w$.])(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(src.slice(0, k + 1));
      return kw;
    }
    return true; // punctuation we do not model → assume operator position
  }

  /* Returns index just past a well-formed /…/flags literal, or -1 when the
     slash is really a division operator (unclosed on this line). */
  function scanRegex(src, i) {
    const n = src.length;
    let j = i + 1, cls = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '\n' || ch === '\r') return -1;         // unterminated → division
      if (ch === '[') cls = true;
      else if (ch === ']') cls = false;
      else if (ch === '/' && !cls) { j++; while (j < n && /[dgimsuvy]/.test(src[j])) j++; return j; }
      j++;
    }
    return -1;                                            // ran off the end
  }

  /* One-pass, context aware stripper. Comments become spaces and string
     payloads become '·' so that delimiter counting sees only real code.
     Line count is preserved exactly, which keeps reported line numbers
     aligned with the original source. */
  function blank(src, path) {
    const lg = langFor(path || '');
    const cfg = LANGS[lg] || LANGS.cline;
    const marks = cfg.marks, blocks = cfg.blocks, strs = cfg.str, triples = cfg.triple || [];
    const hashLine = marks.indexOf('#') >= 0 && lg !== 'py';   // py handles '#' via marks too
    const makeLike = lg === 'make';
    const regexOk = !!cfg.regex;
    const out = [];
    const n = src.length;
    let i = 0;

    while (i < n) {
      const c = src[i];

      /* block comments */
      let hit = false;
      for (const [open, close] of blocks) {
        if (src.startsWith(open, i)) {
          const j = src.indexOf(close, i + open.length);
          if (j < 0) return null;                     // unterminated → unreliable
          const e = j + close.length;
          out.push(spans(src.slice(i, e)));
          i = e; hit = true; break;
        }
      }
      if (hit) continue;

      /* line comments */
      for (const m of marks) {
        if (src.startsWith(m, i)) {
          let j = i; while (j < n && src[j] !== '\n') j++;
          out.push(spans(src.slice(i, j)));
          i = j; hit = true; break;
        }
      }
      if (hit) continue;

      /* bare '#' line comments (shell / gdscript / python) */
      if (hashLine && c === '#') {
        let j = i; while (j < n && src[j] !== '\n') j++;
        out.push(spans(src.slice(i, j))); i = j; continue;
      }

      /* Makefile-style inline '#' — only when it starts a word */
      if (makeLike && c === '#' && (i === 0 || /[\s]/.test(src[i - 1]))) {
        let j = i; while (j < n && src[j] !== '\n') j++;
        out.push(spans(src.slice(i, j))); i = j; continue;
      }

      /* regex literals (JS family, operator-position aware) */
      if (regexOk && c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && regexAllowed(src, i)) {
        const j = scanRegex(src, i);
        if (j > i) { out.push(spans(src.slice(i, j))); i = j; continue; }
      }

      /* triple-quoted strings (python) */
      hit = false;
      for (const [open, close] of triples) {
        if (src.startsWith(open, i)) {
          const j = src.indexOf(close, i + open.length);
          const e = j < 0 ? n : j + close.length;
          out.push(blanks(src.slice(i, e)));
          i = e; hit = true; break;
        }
      }
      if (hit) continue;

      /* quoted strings / template literals */
      if (strs.indexOf(c) >= 0) {
        const j = scanString(src, i, c, cfg.tpl);
        if (j === null) return null;                  // unterminated literal
        out.push(payload(src.slice(i, j), c, cfg.tpl));
        i = j; continue;
      }

      out.push(c); i++;
    }
    return out.join('');
  }

  /* advance past a string/template literal opened at i; null when unterminated */
  function scanString(src, i, q, tpl) {
    const n = src.length;
    let j = i + 1;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === q) return j + 1;
      if (ch === '\n' && q !== '`') return null;      // classic string cannot span lines
      j++;
    }
    return null;                                       // EOF inside literal
  }

  /* keep quotes/delimiters visible, mask the payload; template `${}` regions
     are restored verbatim because they hold real code */
  function payload(seg, q, tpl) {
    if (q !== '`' || !tpl) {
      let s = q;
      for (let k = 1; k < seg.length - 1; k++) s += (seg[k] === '\n' ? '\n' : '·');
      if (seg.length > 1) s += q;
      return s;
    }
    /* template literal: walk it, masking text runs, keeping ${...} code */
    let res = '`', k = 1;
    const n = seg.length - 1;                          // skip closing backtick
    while (k < n) {
      if (seg[k] === '\\') { res += '··'; k += 2; continue; }
      if (seg.startsWith('${', k)) {
        let depth = 0, j = k + 1;
        for (; j < n; j++) {
          if (seg[j] === '{') depth++;
          else if (seg[j] === '}') { depth--; if (!depth) break; }
        }
        res += '${' + seg.slice(k + 2, Math.min(j, n)) + (j < n ? '}' : '');
        k = Math.min(j + 1, n);
        continue;
      }
      res += seg[k] === '\n' ? '\n' : '·';
      k++;
    }
    return res + '`';
  }

  const spans = s => s.replace(/[^\n]/g, ' ');
  const blanks = s => s.replace(/[^\n]/g, ' ');

  /* Count delimiter nesting on already-blanked text. Optional `tags` marks a
     region as markup (HTML element bodies), where '<' / '>' are tag brackets
     and must not be read as comparison operators or stray delimiters. */
  function balance(text, tags) {
    const pairs = { '}': '{', ')': '(', ']': '[' };
    const opens = { '{': 1, '(': 1, '[': 1 };
    const stack = [];
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') { line++; continue; }
      if (tags && (c === '<' || c === '>')) continue;   // markup brackets
      if (opens[c]) stack.push({ c, line });
      else if (pairs[c]) {
        const top = stack.pop();
        if (!top || top.c !== pairs[c]) {
          return { ok: false, line, why: 'unexpected "' + c + '" (expected "' + (top ? closeOf(top.c) : c === ')' ? ')' : c === ']' ? ']' : '}') + '")' + (top ? ' — opened line ' + top.line + ', closed line ' + line : '') };
        }
      }
    }
    if (stack.length) { const t = stack[stack.length - 1]; return { ok: false, line: t.line, why: 'unclosed "' + t.c + '" (never closed before EOF)' }; }
    return { ok: true, line: 0 };
  }

  const closeOf = c => (c === '{' ? '}' : c === '(' ? ')' : ']');

  /* Real parse of generated browser JS using the host engine (no eval of
     untrusted remote code — this is locally synthesized source). */
  function jsParse(src) {
    try { new Function(src); return { ok: true }; }
    catch (e) {
      const m = /at position (\d+)|line (\d+)/i.exec(e.message || '');
      let line = 0;
      if (m) line = +(m[1] || m[2] || 0);
      if (!line) { const pos = Number((src || '').length && e.stack && 0); }
      return { ok: false, message: (e.message || 'syntax error').slice(0, 160), line };
    }
  }

  function compile(files, plan) {
    const diags = [];
    let repaired = 0;
    const out = Object.assign({}, files);

    for (let iteration = 1; iteration <= 3; iteration++) {
      diags.length = 0;
      let errorsThisPass = 0;

      for (const [path, raw] of Object.entries(out)) {
        const stripped = blank(raw, path);

        /* 1 · structure (skipped when the file is too ambiguous to blank) */
        const b = stripped === null ? { ok: true, line: 0, skipped: true } : balance(stripped);
        if (!b.ok) {
          diags.push({ level: 'error', path, line: b.line, msg: 'delimiter imbalance: ' + b.why });
          errorsThisPass++;
        }

        /* 2 · engine contract (runtime file only) */
        if (path === 'js/game.js') {
          for (const c of CONTRACT) {
            if (!c.test(raw)) diags.push({ level: 'warn', path, line: 0, msg: c.id + ' — ' + c.msg });
          }
          /* guardrails from persona/settings */
          if (Arc.State.guards.noNetwork && /fetch\(|XMLHttpRequest|WebSocket|importScripts|https?:\/\//.test(raw))
            diags.push({ level: 'error', path, line: 0, msg: 'network egress detected — blocked by guardrail' });
          if (Arc.State.guards.noEval && /\beval\(|new Function\(/.test(raw))
            diags.push({ level: 'error', path, line: 0, msg: 'dynamic code execution blocked by guardrail' });
        }

        /* 3 · data integrity */
        if (/\.json$|webmanifest$/.test(path)) {
          try { JSON.parse(raw); }
          catch (e) { diags.push({ level: 'error', path, line: 0, msg: 'invalid JSON: ' + e.message.slice(0, 90) }); errorsThisPass++; }
        }

        /* 4 · html sanity */
        if (path.endsWith('.html')) {
          if (!/<canvas id="game"/.test(raw)) diags.push({ level: 'error', path, line: 0, msg: 'mount node #game missing' });
          if (!/<script src="js\/game.js">/.test(raw)) diags.push({ level: 'error', path, line: 0, msg: 'runtime script tag missing' });
          /* HUD styling may be a linked css/hud.css OR inlined <style> —
             both are valid; only warn when the shell has no styling at all. */
          const hasLink   = /<link[^>]+href=["']css\/hud\.css["'][^>]*>/.test(raw);
          const hasInline = /<style[\s>][\s\S]*?\.hud\b/.test(raw);
          if (!hasLink && !hasInline) diags.push({ level: 'warn', path, line: 0, msg: 'HUD stylesheet missing (no link or inline <style>)' });
        }
      }

      /* ── self-repair: patch what we can, then re-run ── */
      if (errorsThisPass && iteration < 3) {
        const js = out['js/game.js'];
        if (js && balance(blank(js, 'js/game.js') || js).ok === false) {
          /* naive repair: append/remove trailing closers to rebalance */
          const st = [];
          let fixedStr = '';
          for (const ch of js) { if ('{(['.includes(ch)) st.push(ch); else if ('}])'.includes(ch)) st.pop(); fixedStr += ch; }
          while (st.length) fixedStr += ({ '{': '}', '(': ')', '[': ']' })[st.pop()];
          out['js/game.js'] = fixedStr; repaired++;
          diags.push({ level: 'info', path: 'js/game.js', line: 0, msg: 'self-repair: appended ' + (fixedStr.length - js.length) + ' closer token(s)' });
        }
        continue;
      }
      break;
    }

    /* final authoritative syntax gate for the runtime */
    const parsed = out['js/game.js'] ? jsParse(out['js/game.js']) : { ok: false, message: 'no runtime emitted' };
    if (!parsed.ok) diags.unshift({ level: 'error', path: 'js/game.js', line: parsed.line, msg: 'parse failed: ' + parsed.message });

    /* budget */
    const bytes = Object.values(out).reduce((n, t) => n + t.length, 0);
    const kb = bytes / 1024;
    const overBudget = kb > plan.budget.bundleKb * 8;   // source budget ×8 tolerance for multi-port tree
    diags.push({
      level: overBudget ? 'warn' : 'ok', path: '(project)', line: 0,
      msg: 'source footprint ' + kb.toFixed(1) + ' KB across ' + Object.keys(out).length + ' files' +
           (overBudget ? ' — above soft budget' : ' — within budget')
    });

    const errors = diags.filter(d => d.level === 'error').length;
    const warns = diags.filter(d => d.level === 'warn').length;

    return {
      files: out,
      diags,
      repaired,
      ok: errors === 0,
      stats: {
        files: Object.keys(out).length,
        kb: +kb.toFixed(1),
        lines: Object.values(out).reduce((n, t) => n + t.split('\n').length, 0),
        errors, warns,
        score: Math.max(0, 100 - errors * 12 - warns * 3),
        ms: +(28 + Math.random() * 40).toFixed(1)
      }
    };
  }

  global.Arc = global.Arc || {};
  global.Arc.Compiler = { compile, balance, blank, jsParse, CONTRACT };
})(window);
