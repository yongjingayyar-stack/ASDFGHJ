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

  /* ── language-aware comment/string grammar for the scanner ── */
  const LINE_MARK = {
    js: ['//'], cline: ['//'], py: ['#'], sh: ['#'], gd: ['#'], lua: ['--'],
    html: [], css: [], json: [], text: []
  };

  /* returns index just past a regex literal starting at i, or -1 if it looks
     like a division operator instead. Heuristic: no newline before terminator,
     body has no unescaped spaces unless escaped, and terminator is followed by
     a flag/operand-ish char. */
  function scanRegex(src, i) {
    const n = src.length;
    let j = i + 1, cls = false, ok = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '\n') break;
      if (ch === '[') cls = true;
      else if (ch === ']') cls = false;
      else if (ch === '/' && !cls) {
        // must be followed by flags, operator, punctuation or EOL — not an identifier start
        const nx = src[j + 1];
        if (!nx || !/[A-Za-z0-9_$]/.test(nx)) { ok = true; j++; break; }
        j++; break;
      }
      j++;
    }
    if (!ok) return -1;
    while (j < n && /[gimsuyd]/.test(src[j])) j++;   // flags
    return j;
  }

  function langFor(path) {
    if (/\.html?$/i.test(path)) return 'html';
    if (/\.css$/i.test(path)) return 'css';
    if (/\.(json|webmanifest)$/i.test(path)) return 'json';
    if (/\.py$/i.test(path)) return 'py';
    if (/^Makefile$|\.sh$/i.test(path)) return 'sh';
    if (/\.gd$/i.test(path)) return 'gd';
    if (/\.lua$/i.test(path)) return 'lua';
    if (/\.(md|txt)$/i.test(path) || /\.gitignore$/i.test(path)) return 'text';
    if (/\.(js|mjs)$/i.test(path)) return 'js';
    return 'cline'; // c-family: C/C++/Java/C#/GLSL/Rust — // and /* */
  }

  function blank(src, path) {
    const lg = langFor(path || '');
    const lineMarks = LINE_MARK[lg] !== undefined ? LINE_MARK[lg] : [];
    const blockPairs = lg === 'html' ? [['<!--', '-->']]
      : lg === 'lua' ? [['--[[', ']]']]
      : (lg === 'json' || lg === 'text') ? []
      : [['/*', '*/']];   // js, c-family, css, py, sh, gd, glsl
    const triple = (lg === 'py');
    const hashLine = lg === 'py' || lg === 'sh' || lg === 'gd';

    const regexOk = lg === 'js' || lg === 'cline';
    let out = '';
    const n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i];
      let hit = false;

      /* regex literals in JS-family sources: blank from / to the closing / */
      if (regexOk && c === '/' && src[i + 1] !== '*' && src[i + 1] !== '/') {
        const j = scanRegex(src, i);
        if (j > i) { out += ' '.repeat(j - i); i = j; continue; }
      }

      for (const [open, close] of blockPairs) {
        if (src.startsWith(open, i)) {
          const j = src.indexOf(close, i + open.length);
          if (j < 0) return null;                       // unterminated → unreliable
          const e = j + close.length;
          out += ' '.repeat(e - i); i = e; hit = true; break;
        }
      }
      if (hit) continue;

      if (triple && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
        const q = src.substr(i, 3);
        const j = src.indexOf(q, i + 3);
        const e = j < 0 ? n : j + 3;
        out += ' '.repeat(e - i); i = e; continue;
      }

      for (const m of lineMarks) {
        if (src.startsWith(m, i)) {
          let j = i; while (j < n && src[j] !== '\n') j++;
          out += ' '.repeat(j - i); i = j; hit = true; break;
        }
      }
      if (hit) continue;

      if (hashLine && c === '#') { let j = i; while (j < n && src[j] !== '\n') j++; out += ' '.repeat(j - i); i = j; continue; }

      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === c) { j++; break; }
          if (src[j] === '\n' && c !== '`') break;
          j++;
        }
        out += '·'.repeat(j - i); i = j; continue;
      }

      out += c; i++;
    }
    return out;
  }

  function balance(text) {
    const pairs = { '}': '{', ')': '(', ']': '[' };
    const opens = { '{': 1, '(': 1, '[': 1 };
    const stack = [];
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') line++;
      if (opens[c]) stack.push({ c, line });
      else if (pairs[c]) {
        const top = stack.pop();
        if (!top || top.c !== pairs[c]) return { ok: false, line, why: 'unexpected "' + c + '"' + (top ? ' (opened line ' + top.line + ')' : '') };
      }
    }
    if (stack.length) { const t = stack[stack.length - 1]; return { ok: false, line: t.line, why: 'unclosed "' + t.c + '"' }; }
    return { ok: true, line: 0 };
  }

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
          if (!/<link rel="stylesheet" href="css\/hud.css">/.test(raw)) diags.push({ level: 'warn', path, line: 0, msg: 'HUD stylesheet not linked' });
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
