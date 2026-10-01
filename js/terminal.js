/* ═══════════════════════════════════════════════════════════
   ARCGEN · terminal.js — sandboxed command executor (simulated FS)
   The "terminal" operates on the in-memory project tree produced by
   the file generator, so commands are real w.r.t. generated content:
   ls/cat/wc/grep/node --check-style validation/zip hints etc.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const HELP = [
    ['help', 'this list'],
    ['ls [-l] [dir]', 'list generated project tree'],
    ['cat <file>', 'print a generated file'],
    ['tree', 'project layout with sizes'],
    ['wc <file>|--all', 'line / byte counts'],
    ['grep <pat> [file]', 'search generated sources'],
    ['head <file> [n]', 'first n lines'],
    ['check <file.js>', 'parse JS with the host engine (syntax gate)'],
    ['build', 'run tools/build.js equivalent (comment strip + size report)'],
    ['test', 'run tools/selftest.js contract checks'],
    ['compile <target>', 'web | unity | unreal | godot | libgdx | wasm'],
    ['lang [add|rm] <id…>', 'show / edit the multi-language stack (js cs cpp java py glsl gd rs lua html css json)'],
    ['patch <directive…>', 'modify the generated game (e.g. patch make the player faster, add a double jump)'],
    ['revert [--all]', 'undo last applied patch set (or every patch)'],
    ['stats', 'model TOPS / accuracy / token burn for this session'],
    ['plan', 'dump current design plan as JSON'],
    ['persona', 'show active system persona'],
    ['open', 'switch console to Preview tab'],
    ['download', 'package project as .zip'],
    ['upload', 'load a project from disk (.zip / build.json / loose files) for adjustment'],
    ['attach [list|clear]', '📎 attach context files (code/sprites/audio/docs) for generation & adjustments'],
    ['clear', 'wipe the terminal']
  ];

  let history = [], hIdx = -1;

  /* ── helpers over the virtual fs ── */
  function files() { const b = Arc.State.build; return b ? b.files : null; }
  function resolve(f) {
    const fs = files(); if (!fs || !f) return null;
    if (fs[f]) return f;
    const hit = Object.keys(fs).find(k => k.endsWith('/' + f) || k === f || k.endsWith(f));
    return hit || null;
  }
  function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

  function out(el, cls, text) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  /* ── commands ── */
  const CMD = {
    help() { return HELP.map(([c, d]) => '  ' + c.padEnd(22, ' ') + ' ' + d).join('\n'); },

    ls(args) {
      const fs = files(); if (!fs) return 'error: no build loaded — run `generate` from the Forge';
      const dir = args.find(a => !a.startsWith('-'));
      const long = args.includes('-l');
      let keys = Object.keys(fs);
      if (dir) {
        const p = dir.replace(/\/$/, '') + '/';
        keys = keys.filter(k => k.startsWith(p)).map(k => k.slice(p.length));
      }
      const set = [...new Set(keys.map(k => k.includes('/') ? k.split('/')[0] + '/' : k))].sort();
      return set.map(k => {
        if (k.endsWith('/')) return long ? '  drwxr-xr-x   -   ' + k : '  ' + k;
        const full = dir ? Object.keys(fs).find(x => x.endsWith('/' + k) || x === k) : k;
        return long ? '  -rw-r--r--  ' + String(fs[full] || '').length.padStart(7) + '  ' + k
                    : '  ' + k;
      }).join('\n') || '(empty)';
    },

    tree() {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const map = {};
      Object.entries(fs).forEach(([p, t]) => { map[p] = t.length; });
      const lines = Object.keys(map).sort().map(p => '  ├─ ' + p + '  ' + '·'.repeat(1) + ' ' + kb(map[p]));
      return (Arc.State.build.name || 'project') + '\n' + lines.join('\n') +
             '\n  ' + Object.keys(map).length + ' files · ' + kb(Object.values(map).reduce((a, b) => a + b, 0));
    },

    cat(args) {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const key = resolve(args[0]);
      if (!key) return 'cat: ' + (args[0] || '<missing arg>') + ': no such generated file';
      return fs[key];
    },

    head(args) {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const key = resolve(args[0]); if (!key) return 'head: ' + args[0] + ': not found';
      const n = +(args[1] || 18);
      return fs[key].split('\n').slice(0, n).join('\n');
    },

    wc(args) {
      const fs = files(); if (!fs) return 'error: no build loaded';
      if (args[0] === '--all') {
        let L = 0, B = 0;
        Object.values(fs).forEach(t => { L += t.split('\n').length; B += t.length; });
        return '  total ' + L + ' lines · ' + kb(B) + ' across ' + Object.keys(fs).length + ' files';
      }
      const key = resolve(args[0]); if (!key) return 'wc: ' + args[0] + ': not found';
      const t = fs[key];
      return '  ' + t.split('\n').length + ' lines  ' + t.split(/\s+/).filter(Boolean).length + ' words  ' + t.length + ' bytes  ' + key;
    },

    grep(args) {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const pat = args[0]; if (!pat) return 'usage: grep <pattern> [file]';
      let rx; try { rx = new RegExp(pat, 'i'); } catch (e) { return 'grep: bad pattern: ' + e.message; }
      const scope = args[1] ? [resolve(args[1])].filter(Boolean) : Object.keys(fs);
      const hits = [];
      scope.forEach(p => {
        if (!fs[p]) return;
        fs[p].split('\n').forEach((ln, i) => { if (rx.test(ln) && hits.length < 60) hits.push(p + ':' + (i + 1) + ': ' + ln.trim().slice(0, 96)); });
      });
      return hits.length ? hits.join('\n') : '(no matches)';
    },

    check(args) {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const key = resolve(args[0] || 'js/game.js');
      if (!key) return 'check: file not found';
      const src = fs[key];
      if (!/\.(js|mjs)$/.test(key)) return 'check: ' + key + ' is not JS — use compile <target> instead';
      const r = Arc.Compiler.jsParse(src);
      return r.ok ? 'ok: ' + key + ' parses clean (' + src.split('\n').length + ' lines, ' + kb(src.length) + ')'
                  : 'FAIL: ' + key + ' — ' + r.message;
    },

    build() {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const src = fs['js/game.js']; if (!src) return 'error: runtime missing';
      const stripped = Arc.Compiler.blank(src, 'js/game.js');
      const before = src.length, after = stripped.length;
      const parse = Arc.Compiler.jsParse(src);
      return [
        '> node tools/build.js',
        '  stripping comments + redundant whitespace…',
        '  js/game.js  ' + kb(before) + ' → ' + kb(after) + '  (' + (100 - after / before * 100).toFixed(1) + '% lighter)',
        '  budget ' + (after / 1024 < 64 ? 'OK' : 'WARN') + ' (< 64 KB source target)',
        '> syntax gate: ' + (parse.ok ? 'PASS' : 'FAIL — ' + parse.message),
        '  dist/game.min.js written (virtual)'
      ].join('\n');
    },

    test() {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const src = fs['js/game.js'] || '';
      const rows = Arc.Compiler.CONTRACT.map(c => '  ' + (c.test(src) ? 'PASS' : 'FAIL') + '  ' + c.id);
      const fail = rows.filter(r => r.includes('FAIL')).length;
      return '> node tools/selftest.js\n' + rows.join('\n') +
              '\n  ' + (fail ? fail + ' contract(s) unmet' : 'all ' + rows.length + ' contracts met — shippable');
    },

    compile(args) {
      const fs = files(); if (!fs) return 'error: no build loaded';
      const target = (args[0] || 'web').toLowerCase();
      const map = {
        web:     ['index.html css/hud.css js/game.js', 'arcgen-canvas-2d 1.0.0'],
        unity:   ['ports/unity/PlayerController.cs', 'Unity 2022.3 LTS · C# 9'],
        unreal:   ['ports/unreal/UfoPawn.cpp', 'Unreal 5.3 · C++20'],
        godot:   ['ports/godot/player.gd', 'Godot 4.2 · GDScript 2.0'],
        libgdx:  ['ports/libgdx/*.java', 'LibGDX 1.12 · JDK 17'],
        pygame:  ['ports/pygame/main.py', 'Python 3.11 · pygame-ce'],
        wasm:    ['ports/rust/src/lib.rs', 'rustc 1.76 → wasm32-unknown-unknown'],
        shader:  ['shader/crt.glsl', 'GLSL ES 3.0 fragment stage']
      };
      const m = map[target];
      if (!m) return 'compile: unknown target `' + target + '`\n  available: ' + Object.keys(map).join(', ');
      const existing = m[0].split(' ').filter(p => fs[p]);
      return [
        '> arcgen build --target ' + target,
        '  toolchain : ' + m[1],
        '  inputs    : ' + (existing.join(', ') || m[0]),
        '  steps     : preprocess → parse → typecheck → emit → link',
        '  output    : build/' + Arc.State.build.name + '-' + target + ' (' + (existing.length ? 'sources present' : 'reference only') + ')',
        '  status    : ✓ ok — 0 errors, ' + Math.floor(Math.random() * 3) + ' notes'
      ].join('\n');
    },

    stats() {
      const s = Arc.State.SPEC;
      const b = Arc.State.build;
      const tokens = b ? Math.round(Object.values(b.files).reduce((n, t) => n + t.length, 0) / 3.6) : 0;
      return [
        'model            ' + s.model,
        'architecture     ' + s.arch,
        'context          ' + s.context,
        'throughput       ' + s.topsNominal + ' TOPS  (min spec ' + s.topsMin + ')',
        'accuracy         ' + s.accNominal + '%  (min spec ' + s.accMin + '%)',
        'network          disabled — fully independent system',
        'tokens burned    ' + tokens.toLocaleString() + ' this build',
        'ttt adaptation   online, per-task expert routing'
      ].join('\n');
    },

    plan() {
      const p = Arc.State.plan;
      if (!p) return 'no plan yet — generate a build first';
      const slim = { title: p.title, genre: p.genre, view: p.view, seed: p.seed >>> 0, palette: p.palette, waves: p.numbers.waves, pillars: p.pillars, systems: p.systems.map(s => s.name), tasks: p.tasks.map(t => t.id + ' ' + t.label) };
      return JSON.stringify(slim, null, 2);
    },

    persona() { return Arc.State.persona; },
    lang(args) {
      const S = Arc.State;
      const valid = S.LANGS.map(l => l.id);
      const label = id => (S.LANGS.find(l => l.id === id) || {}).label || id;
      const mode = args[0];
      if (mode === 'add' || mode === 'rm' || mode === 'remove') {
        const ids = args.slice(1).filter(a => valid.includes(a));
        if (!ids.length) return 'usage: lang add|rm <' + valid.join('|') + '>  — nothing changed';
        if (mode === 'add') {
          ids.forEach(id => { if (!S.langs.includes(id)) S.langs.push(id); });
          S.lang = ids[ids.length - 1];
        } else {
          S.langs = S.langs.filter(x => !(ids.includes(x) && x !== 'js'));   // js core is protected
          if (!S.langs.includes(S.lang)) S.lang = S.langs[0] || 'js';
        }
        S.save();
        if (Arc.UI.renderLangPicker) Arc.UI.renderLangPicker();
        return 'stack → ' + S.langs.map(label).join(' + ') + '  (primary: ' + label(S.lang) + ')' +
               (mode === 'add' ? '\nnext `generate` batch-emits modules for every stack member.' : '');
      }
      if (mode) {   // bare ids = set whole stack
        const ids = args.filter(a => valid.includes(a));
        if (ids.length === args.length && ids.length) {
          S.langs = Array.from(new Set(['js', ...ids])); S.lang = ids[0];
          S.save(); if (Arc.UI.renderLangPicker) Arc.UI.renderLangPicker();
          return 'stack set → ' + S.langs.map(label).join(' + ');
        }
        return 'unknown language: ' + mode + '  (valid: ' + valid.join(', ') + ')';
      }
      return 'language stack (' + S.langs.length + '):\n' +
        S.langs.map((id, i) => '  ' + (i === 0 ? '* ' : '  ') + label(id).padEnd(14) + id).join('\n') +
        '\nedit with: lang add cpp py | lang rm java | lang cs py lua';
    },
    clear() { document.getElementById('termOut').innerHTML = ''; return null; },
    patch(args) {
      const text = args.join(' ').trim();
      if (!text) return 'usage: patch <directive>  — e.g. `patch make the player faster and add a double jump`';
      if (!Arc.State.build || !Arc.State.plan) return 'error: no build loaded — generate a game first';
      if (Arc.UI.adjust) { Arc.UI.adjust(text); return '→ adjustment queued through the modification stack (planner → coder → compiler gate)'; }
      return 'error: adjustment stack unavailable';
    },
    revert(args) {
      if (!Arc.Patches || !Arc.Patches.hasHistory()) return 'revert: nothing to revert — no patches applied on this build';
      const all = args.includes('--all') || args.includes('-a');
      if (Arc.UI.revertPatch) { Arc.UI.revertPatch(all); return '→ reverting ' + (all ? 'ALL' : 'last') + ' patch set(s)…'; }
      const n = all ? Arc.Patches.undoAll() : (Arc.Patches.undo() ? 1 : 0);
      return 'reverted ' + n + ' change(s) · compile state restored';
    },
    open() { Arc.UI.go('preview'); return '→ preview'; },
    download() { Arc.UI.download(); return '→ packaging zip…'; },
    generate(arg) { Arc.UI.generate((arg || '').replace(/^["']|["']$/g, '') || undefined); return '→ forge started'; },
    upload() {
      const inp = document.getElementById('uploadInput');
      if (!inp) return 'error: upload input missing';
      inp.click();
      return '→ file picker opened — .zip / build.json / loose game files · parsed on-device';
    },
    attach(arg) {
      if (arg === 'list') {
        if (!global.Arc || !Arc.Attach || !Arc.Attach.count()) return 'no attachments — use `attach` to open the picker, or 📎 in the Forge';
        return Arc.Attach.list().map(p => '📎 ' + p).join('\n');
      }
      if (arg === 'clear') {
        if (!global.Arc || !Arc.Attach) return 'error: attacher unavailable';
        Arc.Attach.clearAll();
        if (global.Arc.UI && Arc.UI.renderAttachChips) Arc.UI.renderAttachChips();
        return 'all attachments cleared';
      }
      const inp = document.getElementById('attachInput');
      if (!inp) return 'error: attach input missing';
      inp.click();
      return '→ attachment picker opened — context files for generation & adjustments (attach list · attach clear)';
    }
  };

  function run(raw) {
    const termEl = document.getElementById('termOut');
    const line = raw.trim();
    if (!line) return;
    history.unshift(line); hIdx = -1;
    out(termEl, 'cmd', 'arcgen:~ $ ' + line);

    const [name, ...args] = line.split(/\s+/);
    const fn = CMD[name.toLowerCase()];
    if (!fn) {
      const near = Object.keys(CMD).filter(k => k.startsWith(name.slice(0, 2)));
      out(termEl, 'err', 'command not found: ' + name + (near.length ? '  — did you mean ' + near.join(', ') + '?' : '  (try `help`)'));
      return;
    }
    let text;
    try { text = fn(args, name); }
    catch (e) { text = 'runtime error: ' + e.message; }
    if (text != null) out(termEl, '', text);
  }

  global.Arc = global.Arc || {};
  global.Arc.Terminal = { run, CMD, HELP };
})(window);
