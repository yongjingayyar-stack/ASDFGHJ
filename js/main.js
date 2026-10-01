/* ═══════════════════════════════════════════════════════════
   ARCGEN · main.js — boot sequence + orchestration of the five
   tools into one streamed build, preview wiring and packaging.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const S = Arc.State, U = Arc.UI;
  const $ = U.$, $$ = U.$$;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ───────────────────────── BOOT ───────────────────────── */
  const BOOT_LINES = [
    ['mounting sandbox', 'isolated origin · no network egress'],
    ['loading weights', 'arcgen-ttt-340b-q8 · 128 experts'],
    ['verifying compute floor', '4192 TOPS ≥ 4000 TB/s minimum ✓'],
    ['benchmark handshake', 'aggregate accuracy 91.4% ≥ 89% ✓'],
    ['registering tools', 'planner · coder · files · terminal · compiler'],
    ['baking system persona', 'root instruction layer locked'],
    ['warming determinism lock', 'fixed timestep 1/60 · seeded RNG'],
    ['console ready', 'ARCGEN online']
  ];

  async function boot() {
    const log = $('#bootLog'), fill = $('#bootBarFill');
    for (let i = 0; i < BOOT_LINES.length; i++) {
      const [a, b] = BOOT_LINES[i];
      const d = document.createElement('div');
      d.innerHTML = '<b>[' + String(i + 1).padStart(2, '0') + ']</b> ' + a +
                    ' <em>' + b + '</em>';
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      fill.style.width = ((i + 1) / BOOT_LINES.length * 100) + '%';
      await sleep(190 + Math.random() * 130);
    }
    $('#bootEnter').hidden = false;
  }

  function leaveBoot() {
    $('#boot').classList.add('is-out');
    $('#app').hidden = false;
    setTimeout(() => $('#boot').remove(), 700);
    U.logLine('sys', 'ARCGEN cognitive stack initialised — fully independent, zero API surface.');
    U.logLine('sys', 'spec floor verified: ' + S.SPEC.topsNominal + ' TOPS · ' + S.SPEC.accNominal + '% benchmark accuracy.');
    U.logLine('plan', 'waiting for a game directive. Type one in the Forge, or press ◈ Surprise me.');
  }

  /* ───────────────────────── GENERATION RUN ───────────────────────── */
  async function generate(forcedPrompt) {
    if (S.running) return;
    const prompt = (forcedPrompt != null ? forcedPrompt : $('#promptInput').value).trim();
    if (!prompt) { U.toast('describe the game first', 'err'); $('#promptInput').focus(); return; }
    if (forcedPrompt != null) $('#promptInput').value = prompt;

    S.running = true;
    S.setStatus('working', 'synthesising…');
    $('#btnGenerate').disabled = true;
    U.renderPipeline();
    $$('#toolList li').forEach(li => li.classList.remove('is-ok', 'is-live'));
    U.renderDiags(null);

    const t0 = performance.now();
    U.logLine('head', '── DIRECTIVE · "' + prompt + '" ──', 'SYS');

    /* 1 · parse + plan (PLANNER) */
    U.pipeSet('parse', 'run'); U.toolLive('planner', true);
    await U.typeLine('plan', 'tokenising directive · extracting genre intent, numeric constraints and feel keywords');
    U.pipeSet('parse', 'done'); U.pipeSet('plan', 'run');
    await sleep(220);

    const plan = Arc.Planner.plan(prompt, S.lang, S.persona, S.langs);

    /* 1b · file-attacher conditioning: attached references steer the plan */
    if (global.Arc && Arc.Attach && Arc.Attach.count()) {
      const ac = Arc.Attach.genContext();
      if (ac.title) { plan.title = ac.title; U.logLine('plan', 'attach context → title adopted from attached doc: “' + ac.title + '”'); }
      if (ac.palette) { plan.palette = ac.palette.slice(); U.logLine('plan', 'attach context → palette pulled from attached stylesheet: ' + ac.palette.join(' ')); }
      const extra = ac.langs.filter(l => l !== 'html' && l !== 'css' && plan.langs.indexOf(l) < 0);
      if (extra.length) { plan.langs = plan.langs.concat(extra); U.logLine('plan', 'attach context → stack extended with ' + extra.join(', ') + ' (from attached sources)'); }
      if (Object.keys(ac.cfg).length) { plan.attachCfg = ac.cfg; U.logLine('plan', 'attach context → ' + Object.keys(ac.cfg).length + ' config value(s) queued for runtime merge'); }
      if (ac.assets.length) U.logLine('plan', 'attach context → ' + ac.assets.length + ' asset(s) will be embedded into the build tree');
    }
    S.plan = plan;
    U.logLine('plan', 'genre → ' + plan.genre + ' (' + plan.genreLabel.tagline + ') · view ' + plan.view + ' · seed ' + (plan.seed >>> 0));
    U.logLine('plan', 'language stack → ' + plan.langs.map(x => (S.LANGS.find(l => l.id === x) || {}).label || x).join(' + ') + ' (' + plan.langs.length + ' languages in parallel)');
    U.logLine('plan', 'title candidate: “' + plan.title + '” · palette ' + plan.palette.join(' '));
    plan.pillars.forEach(p => U.logLine('plan', 'pillar · ' + p));
    U.pipeSet('plan', 'done'); U.pipeSet('arch', 'run');
    await sleep(200);
    U.logLine('plan', 'module graph: ' + plan.systems.map(s => s.name).join(' → '));
    U.logLine('plan', 'budget: ≤' + plan.budget.frameMs + 'ms/frame · ≤' + plan.budget.maxSprites + ' sprites · ≤' + plan.budget.bundleKb + 'KB source');
    U.pipeSet('arch', 'done');

    /* 2 · code synthesis (CODER EXECUTOR) — parallel per-language lanes */
    U.pipeSet('code', 'run'); U.toolLive('planner', false); U.toolLive('coder', true);
    await U.typeLine('code', 'streaming runtime · ' + plan.systems.length + ' systems · fixed timestep + seeded RNG + input map');
    const LN = Arc.Planner.LANG_NAMES;
    const laneNarration = {
      js:   'lane[JavaScript] → js/game.js state machine, entities, fx, synth audio',
      html: 'lane[HTML] → index.html shell + webmanifest',
      css:  'lane[CSS] → hud.css skin, responsive layout',
      json: 'lane[JSON] → data/tables.json + architecture.json contracts',
      cs:   'lane[C#] → Unity PlayerController + project.meta from shared CFG',
      cpp:  'lane[C++] → Unreal UfoPawn + native SDL2 main.cpp + CMakeLists',
      java: 'lane[Java] → LibGDX screen + javac harness (same mulberry32 stream)',
      py:   'lane[Python] → pygame prototype + tuning_tool.py validator',
      gd:   'lane[GDScript] → Godot player.gd + project.godot scaffold',
      rs:   'lane[Rust] → wasm-bindgen sim core + Cargo.toml',
      lua:  'lane[Lua] → chaos mod + config.lua hook table',
      glsl: 'lane[GLSL] → crt.glsl + bloom.glsl post passes'
    };
    const narration = [
      'emit js/game.js — state machine menu/play/pause/over',
      ...plan.langs.map(id => laneNarration[id] || ('lane[' + (LN[id] || id) + '] → module synthesis'))
    ];
    if (plan.langs.length > 1) narration.push('cross-language contract check: CFG values mirrored across ' + plan.langs.length + ' targets · persona juice ' + plan.influence.juice.toFixed(2));
    narration.push('persona check → prose output suppressed');
    for (const n of narration) { await sleep(110); U.logLine('code', n); }
    U.pipeSet('code', 'done');

    /* 3 · file generation (FILE GENERATOR) — batch emit, many files at once */
    U.pipeSet('assets', 'run'); U.toolLive('coder', false); U.toolLive('files', true);
    let files;
    try { files = Arc.Generators.generate(plan, S.persona); }
    catch (e) {
      U.logLine('err', 'generator fault: ' + e.message);
      finish(true); return;
    }
    const paths = Object.keys(files);
    /* 3b · fold attachment material into the fresh build through the
          patch stack (assets embedded, CFG merged, GDD logged) —
          compiler-gated and revertible like any other patch set. */
    if (global.Arc && Arc.Attach && Arc.Attach.count()) {
      try {
        const mat = Arc.Attach.adjustMaterial();
        const aops = Arc.Attach.buildAttachOps(files, mat);
        if (aops.length) {
          files = Object.assign({}, files);
          aops.forEach(o => { files[o.path] = o.to; });
          S.addBuild({
            name: plan.slug, title: plan.title, short: plan.title.split(' ')[0],
            files, lang: plan.lang, langs: plan.langs.slice(), seed: plan.seed >>> 0,
            genreLabel: plan.genreLabel.tagline,
            personaDigest: plan.personaDigest, createdAt: Date.now()
          });
          Arc.Patches.apply({ directive: 'attach context → build', ops: [], newTitle: null }, aops);
          U.logLine('file', 'attachment pass → ' + aops.length + ' injected change(s): ' +
            [...new Set(aops.map(o => o.path))].join(', '));
        } else {
          S.addBuild(build);
        }
      } catch (e) { U.logLine('warn', 'attachment injection skipped: ' + e.message); S.addBuild(build); }
    } else {
      S.addBuild(build);
    }
    const allPaths = Object.keys(files);
    U.logLine('file', 'batch pass → ' + allPaths.length + ' files emitted in one sweep · ' + (Object.values(files).reduce((n, t) => n + t.length, 0) / 1024).toFixed(1) + ' KB');
    /* group by directory so the log reads like a real emitter */
    const groups = {};
    allPaths.forEach(p => { const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '(root)'; (groups[d] = groups[d] || []).push(p); });

    for (const [dir, list] of Object.entries(groups)) {
      await sleep(60);
      U.logLine('file', 'wrote ' + dir + '/ ← ' + list.length + ' file(s): ' + list.map(p => p.split('/').pop()).join(', '));
    }
    U.pipeSet('assets', 'done');

    /* 4 · terminal pass (TERMINAL EXECUTOR) */
    U.pipeSet('compile', 'run'); U.toolLive('files', false); U.toolLive('terminal', true);
    const build = {
      name: plan.slug, title: plan.title, short: plan.title.split(' ')[0],
      files, lang: plan.lang, langs: plan.langs.slice(), seed: plan.seed >>> 0,
      genreLabel: plan.genreLabel.tagline,
      personaDigest: plan.personaDigest, createdAt: Date.now()
    };
    S.addBuild(build);
    const termOut = $('#termOut');
    for (const cmd of ['ls -l', 'wc --all', 'check js/game.js', 'test', 'build']) {
      await sleep(180);
      U.logLine('term', '$ ' + cmd);
      Arc.Terminal.run(cmd);
    }
    U.pipeSet('compile', 'done');

    /* 5 · compiler verdict (COMPILER) */
    U.toolLive('terminal', false); U.toolLive('compiler', true);
    await sleep(220);
    const res = Arc.Compiler.compile(files, plan);
    U.renderDiags(res.diags);
    res.diags.filter(d => d.level === 'error').forEach(d => U.logLine('err', d.path + (d.line ? ':' + d.line : '') + ' ' + d.msg));
    res.diags.filter(d => d.level === 'warn').slice(0, 4).forEach(d => U.logLine('warn', d.path + ' ' + d.msg));
    if (res.repaired) U.logLine('comp', 'self-repair applied ' + res.repaired + ' patch(es), re-passed clean');
    U.logLine(res.ok ? 'ok' : 'err',
      'compile report · ' + res.stats.files + ' files · ' + res.stats.lines.toLocaleString() + ' lines · ' +
      res.stats.errors + ' errors · ' + res.stats.warns + ' warnings · health ' + res.stats.score + '/100 · ' + res.stats.ms + ' ms');

    U.pipeSet('ship', 'run');
    await sleep(200);
    U.pipeSet('ship', 'done');
    U.toolLive('compiler', false);

    /* 6 · hand off to preview */
    U.loadPreview();
    U.renderTree();
    S.setStatus(res.ok ? 'ready' : 'error', res.ok ? 'build ready' : 'build has errors');
    U.logLine('head', '── BUILD READY · ' + plan.title + ' ──', 'SYS');
    U.logLine('ok', 'playable now in Preview · downloadable from Export · ' + ((performance.now() - t0) / 1000).toFixed(1) + 's total');
    U.toast(res.ok ? 'Build ready — open Preview' : 'Build finished with errors', res.ok ? 'ok' : 'err');
    if (res.ok) go('preview');
    finish(false);
  }

  function finish(aborted) {
    S.running = false;
    $('#btnGenerate').disabled = !!aborted ? false : false;
    if (!aborted) $('#btnGenerate').focus();
  }

  /* ───────────────────────── COMPILE BUTTON ───────────────────────── */
  async function manualCompile() {
    const b = S.build; if (!b || !S.plan) { U.toast('no build to compile', 'err'); return; }
    U.toolLive('compiler', true);
    S.setStatus('working', 'compiling');
    await sleep(320);
    const res = Arc.Compiler.compile(b.files, S.plan);
    U.renderDiags(res.diags);
    U.logLine(res.ok ? 'ok' : 'err', 'manual compile · ' + res.stats.errors + ' errors · ' + res.stats.warns + ' warnings · health ' + res.stats.score + '/100');
    U.toolLive('compiler', false);
    S.setStatus(res.ok ? 'ready' : 'error', 'compiled');
    Arc.Terminal.run('compile ' + ($('.ctarget.is-on') || {}).textContent || 'web');
  }

  /* ───────────────────────── DOWNLOAD ───────────────────────── */
  async function download() {
    const b = S.build;
    if (!b) { U.toast('generate a build first', 'err'); return; }
    const btn = $('#btnDownload');
    btn.disabled = true; btn.textContent = '⏳ packing…';
    try {
      let blob;
      if (typeof JSZip === 'function') {
        const zip = new JSZip();
        const root = zip.folder(b.name);
        Object.entries(b.files).forEach(([p, t]) => root.file(p, t));
        root.file('BUILDSPEC.json', JSON.stringify({
          generator: 'ARCGEN ' + S.SPEC.model, seed: b.seed, personaDigest: b.personaDigest,
          spec: { tops: S.SPEC.topsMin + '+ TB/s', accuracy: S.SPEC.accMin + '+%' },
          builtAt: new Date(b.createdAt).toISOString()
        }, null, 2));
        blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      } else {
        /* graceful degradation: ship the playable single-file build */
        const html = U.singleFileHTML(b);
        blob = new Blob([html], { type: 'text/html' });
        U.toast('zipper unavailable — exporting single-file HTML', 'err');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = b.name + (typeof JSZip === 'function' ? '.zip' : '.html');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      U.logLine('ok', 'packaged ' + a.download + ' (' + (blob.size / 1024).toFixed(1) + ' KB) — on-device, no upload');
      U.toast('downloaded ' + a.download, 'ok');
    } catch (e) {
      U.logLine('err', 'packaging failed: ' + e.message);
      U.toast('packaging failed', 'err');
    }
    btn.disabled = false; btn.textContent = '⬇ Download project (.zip)';
  }

  /* ───────────────────────── VIEW ROUTER ───────────────────────── */
  function go(view) {
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + view));
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === view));
    if (view === 'preview') U.loadPreview();
    if (view === 'bench') U.renderBench();
    if (view === 'export') U.renderTree();
    if (view === 'persona') U.renderPersona();
  }

  /* ─────────────────── ITERATIVE MODIFICATION STACK ───────────────────
     The AI adjusts the game it already generated: natural-language
     directive → planner intent parse → coder surgical patches →
     files updated in tree → terminal logs → compiler validation gate.
     On compile failure the patch set auto-reverts (transactional). */
  async function adjust(text) {
    const b = S.build;
    if (!b || !S.plan) { U.toast('generate a build first — nothing to modify', 'err'); return false; }
    text = (text || '').trim();
    if (!text) { U.toast('type an adjustment, e.g. “make the player faster”', 'err'); return false; }
    if (S.running) { U.toast('agent busy — wait for the current run', 'err'); return false; }

    const btn = $('#btnAdjust');
    if (btn) btn.disabled = true;
    S.setStatus('working', 'modifying');
    U.toolLive('planner', true);
    U.logLine('head', '── ADJUSTMENT REQUEST ──', 'SYS');
    U.logLine('sys', 'directive: “' + text + '”');
    await sleep(160);

    let an;
    try { an = Arc.Patches.analyze(text); }
    catch (e) { an = null; U.logLine('err', 'intent parser fault: ' + e.message); }
    U.toolLive('planner', false);

    if (!an || !an.ok) {
      U.logLine('warn', (an && an.error) || 'adjustment could not be analyzed');
      U.toast('adjustment not recognized', 'err');
      S.setStatus('ready', 'idle');
      if (btn) btn.disabled = false;
      return false;
    }

    /* surface diagnostic / audit notes from the analyzer (self-heal reports etc.) */
    if (an.notes && an.notes.length) {
      const isHeal = /black|blank|screen|sound|audio|crash|broken|regenerat|self-heal/i.test(an.ops ? an.ops.map(o => o.why).join(' ') : '');
      an.notes.forEach(n => U.logLine(/^⚠/.test(n) ? 'warn' : (isHeal && /^✓/.test(n)) ? 'ok' : 'sys', n));
    }

    /* file-attacher material: attached assets/configs/docs become
       patch ops that ride along with this adjustment (or stand alone) */
    let attachOps = [];
    if (global.Arc && Arc.Attach && Arc.Attach.count()) {
      try {
        const mat = Arc.Attach.adjustMaterial();
        attachOps = Arc.Attach.buildAttachOps(b.files, mat);
        if (attachOps.length) {
          U.logLine('plan', 'attach context → ' + attachOps.length + ' injection op(s) from ' +
            Arc.Attach.count() + ' attached file(s): ' + [...new Set(attachOps.map(o => o.path))].join(', '));
        }
      } catch (e) { U.logLine('warn', 'attachment material skipped: ' + e.message); }
    }

    if ((!an.matched || !an.ops || !an.ops.length) && !attachOps.length) {
      U.logLine('warn', 'no recognized adjustment in that directive — try feature words (double jump, dash, pause menu…), knobs (faster, fire rate, waves…), colours, or describe the problem ("black screen", "no sound"). Files attached via 📎 are folded in automatically.');
      U.toast('adjustment not recognized', 'err');
      S.setStatus('ready', 'idle');
      if (btn) btn.disabled = false;
      return false;
    }
    if (!an.matched && attachOps.length) {
      U.logLine('sys', 'directive had no keyword match — proceeding with attachment-driven changes only');
    }

    if (an.diagnostic) U.logLine('plan', 'self-heal mode · ' + an.ops.length + ' repair op(s) over ' +
      [...new Set(an.ops.map(o => o.path))].join(', '));
    else U.logLine('plan', 'intent → ' + an.ops.length + ' patch op(s) over ' +
      [...new Set(an.ops.map(o => o.path))].join(', '));
    U.toolLive('coder', true);
    await sleep(200);

    let applied = null;
    try { applied = Arc.Patches.apply(an, attachOps); }
    catch (e) { U.logLine('err', 'coder fault during apply: ' + e.message); }
    U.toolLive('coder', false);
    if (!applied || !applied.ok) {
      U.logLine('err', 'apply failed: ' + ((applied && applied.error) || 'unknown'));
      U.toast('patch could not be applied', 'err');
      S.setStatus('ready', 'idle');
      if (btn) btn.disabled = false;
      return false;
    }
    (applied.changed || []).forEach(p => U.logLine('file', 'modified ' + p));

    /* terminal pass — virtual fs write log */
    U.toolLive('terminal', true);
    U.logLine('term', '$ arcgen fs commit --paths ' + [...new Set(an.ops.map(o => o.path))].join(','));
    await sleep(140);
    U.toolLive('terminal', false);

    /* compiler validation gate */
    U.toolLive('compiler', true);
    await sleep(220);
    let res = null;
    try { res = Arc.Compiler.compile(S.build.files, S.plan); }
    catch (e) { U.logLine('err', 'compiler fault: ' + e.message); }
    U.toolLive('compiler', false);

    if (res && res.ok) {
      U.renderDiags(res.diags);
      U.logLine(res.ok ? 'ok' : 'err', 'post-patch compile · ' + res.stats.errors + ' errors · ' +
        res.stats.warns + ' warnings · health ' + res.stats.score + '/100');
      U.loadPreview();
      U.renderTree();
      S.save();
      S.setStatus('ready', 'modified');
      U.logLine('head', '── PATCH APPLIED ──', 'SYS');
      U.toast('Game modified — preview updated', 'ok');
      if (btn) btn.disabled = false;
      return true;
    }

    /* gate rejected → transactional revert */
    U.logLine('err', 'compiler rejected the patched build — reverting automatically');
    if (res) { U.renderDiags(res.diags); res.diags.filter(d => d.level === 'error').slice(0, 4)
      .forEach(d => U.logLine('err', d.path + (d.line ? ':' + d.line : '') + ' ' + d.msg)); }
    try { Arc.Patches.undo(); } catch (e) { U.logLine('err', 'revert fault: ' + e.message); }
    U.loadPreview(); U.renderTree(); S.save();
    S.setStatus('ready', 'reverted');
    U.toast('patch reverted — build unchanged', 'err');
    if (btn) btn.disabled = false;
    return false;
  }

  async function revertPatch(all) {
    if (!Arc.Patches.hasHistory()) { U.toast('nothing to revert', 'err'); return; }
    const n = all ? Arc.Patches.undoAll() : Arc.Patches.undo();
    if (!n) { U.toast('nothing to revert', 'err'); return; }
    U.logLine('sys', (all ? 'reverted ALL patch sets (' : 'reverted last patch set (') + n + ' change(s))');
    if (S.build && S.plan) {
      const res = Arc.Compiler.compile(S.build.files, S.plan);
      U.renderDiags(res.diags);
    }
    U.loadPreview(); U.renderTree(); S.save();
    U.toast(all ? 'all patches reverted' : 'patch reverted', 'ok');
  }

  /* ───────────────────────── UPLOAD / INGEST ───────────────────────── */
  async function handleUpload(fileList) {
    if (!fileList || !fileList.length) return;
    S.setStatus('working', 'ingesting project');
    U.logLine('head', '── PROJECT UPLOAD ──', 'SYS');
    U.toolLive('files', true);
    let result = null;
    try {
      result = await Arc.Upload.ingest(fileList, {
        log: (k, m) => U.logLine(k, m),
        toast: (m, k) => U.toast(m, k)
      });
    } catch (e) {
      U.logLine('err', 'upload fault: ' + e.message);
    }
    U.toolLive('files', false);
    if (!result) { S.setStatus('ready', 'idle'); return; }

    /* analyze pass — planner scans the imported tree for structure */
    U.toolLive('planner', true);
    await sleep(260);
    const langsTxt = (S.plan.langs || [S.plan.lang]).join(' + ');
    U.logLine('plan', 'analyzed “' + result.label + '” · ' + result.count + ' file(s) · stack: ' + langsTxt);
    U.logLine('plan', 'project mapped into virtual FS — adjustments can now target uploaded code');
    U.toolLive('planner', false);

    /* compiler validation gate on the imported build */
    U.toolLive('compiler', true);
    await sleep(240);
    let res = null;
    try { res = Arc.Compiler.compile(S.build.files, S.plan); }
    catch (e) { U.logLine('err', 'compiler fault: ' + e.message); }
    U.toolLive('compiler', false);
    if (res) {
      U.renderDiags(res.diags);
      U.logLine(res.ok ? 'ok' : 'warn', 'upload compile · ' + res.stats.errors + ' errors · ' +
        res.stats.warns + ' warnings · health ' + res.stats.score + '/100');
    }

    U.renderTree(); U.loadPreview(); S.save();
    go('preview');
    S.setStatus('ready', 'project loaded');
    U.logLine('head', '── READY FOR ADJUSTMENTS ──', 'SYS');
    U.toast('Project loaded — type an adjustment below', 'ok');
    const ai = $('#adjustInput'); if (ai) { ai.focus(); ai.placeholder = 'Adjust this uploaded project… e.g. “make it pink, add a pause menu”'; }
  }

  /* ───────────────────────── FILE ATTACHER ─────────────────────────
     📎 context files (code, sprites, audio, docs) that condition both
     generation and adjustments. Parsed on-device via Arc.Upload's
     unpacking; persisted in the state store; rendered as chips. */
  async function attachFiles(fileList) {
    if (!global.Arc || !Arc.Attach) { U.toast('attacher unavailable', 'err'); return; }
    if (!fileList || !fileList.length) return;
    U.toolLive('files', true);
    U.logLine('head', '── FILE ATTACHMENT ──', 'SYS');
    let added = [];
    try { added = await Arc.Attach.addFiles(fileList, (k, m) => U.logLine(k, m)); }
    catch (e) { U.logLine('err', 'attach fault: ' + e.message); }
    U.toolLive('files', false);
    renderAttachChips();
    if (!added.length) { U.toast('nothing attached', 'err'); return; }
    const ac = Arc.Attach.genContext();
    U.logLine('plan', 'context digest → ' +
      (ac.langs.length ? 'stack hints [' + ac.langs.join(', ') + '] · ' : '') +
      (ac.palette ? 'palette ' + ac.palette.join(' ') + ' · ' : '') +
      (ac.title ? 'title “' + ac.title + '” · ' : '') +
      (ac.assets.length ? ac.assets.length + ' asset(s)' : 'no assets'));
    if (S.build && S.plan) {
      const mat = Arc.Attach.adjustMaterial();
      const aops = Arc.Attach.buildAttachOps(S.build.files, mat);
      if (aops.length) {
        U.logLine('sys', 'active build detected — apply now? press ⚡ Modify or type any adjustment; attachments fold in automatically (' + aops.length + ' op(s) ready)');
      }
    } else {
      U.logLine('sys', 'attachments queued — they will condition the next Generate run');
    }
    U.toast(added.length + ' file(s) attached as AI context', 'ok');
  }

  function renderAttachChips() {
    const box = $('#attachChips');
    if (!box || !global.Arc || !Arc.Attach) return;
    box.innerHTML = '';
    const paths = Arc.Attach.list();
    paths.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'attach-chip';
      const name = p.length > 26 ? p.slice(0, 12) + '…' + p.split('/').pop() : p;
      chip.innerHTML = '<i>📎</i><b></b><em>×</em>';
      chip.querySelector('b').textContent = name;
      chip.title = p + ' — click to detach';
      chip.querySelector('em').onclick = (ev) => {
        ev.stopPropagation();
        Arc.Attach.remove(p);
        renderAttachChips();
        U.logLine('sys', 'detached ' + p);
      };
      box.appendChild(chip);
    });
    if (paths.length) {
      const clr = document.createElement('button');
      clr.className = 'attach-clear';
      clr.textContent = 'clear all';
      clr.onclick = () => { Arc.Attach.clearAll(); renderAttachChips(); U.logLine('sys', 'all attachments cleared'); };
      box.appendChild(clr);
    }
  }

  /* ───────────────────────── WIRING ───────────────────────── */
  function wire() {
    /* tabs */
    $$('.tab').forEach(t => t.onclick = () => go(t.dataset.view));

    /* forge */
    $('#btnGenerate').onclick = () => generate();
    $('#promptInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
    });
    $('#btnRandomize').onclick = () => {
      const p = S.SAMPLES[Math.floor(Math.random() * S.SAMPLES.length)];
      $('#promptInput').value = p;
      U.logLine('sys', 'sample directive loaded: “' + p + '”');
    };
    $('#btnClearConsole').onclick = () => { $('#console').innerHTML = ''; U.logLine('sys', 'console cleared'); };

    /* adjustment stack (modify the generated game) */
    const ai = $('#adjustInput');
    $('#btnAdjust').onclick = () => { adjust(ai.value); };
    ai.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); adjust(ai.value).then(ok => { if (ok) ai.value = ''; }); }
    });
    $('#btnUndoPatch').onclick = () => revertPatch(false);
    $('#btnUndoAll').onclick = () => revertPatch(true);

    /* upload — topbar button loads a project so adjustments can target it */
    const upIn = $('#uploadInput');
    const openPicker = () => { if (upIn) upIn.click(); };
    ['#btnUpload', '#btnUploadPin'].forEach(sel => {
      const b = $(sel);
      if (b) b.onclick = openPicker;
    });
    if (upIn) {
      upIn.addEventListener('change', () => { handleUpload(upIn.files); upIn.value = ''; });
    }

    /* file attacher — 📎 context files for generation AND adjustments */
    renderAttachChips();
    const atIn = $('#attachInput');
    const atBtn = $('#btnAttach');
    if (atBtn) atBtn.onclick = () => { if (atIn) atIn.click(); };
    if (atIn) {
      atIn.addEventListener('change', async () => {
        await attachFiles(atIn.files);
        atIn.value = '';
      });
    }
    if (atIn) {
      /* dropping onto the dock specifically attaches instead of importing */
      const dock = $('#attachDock');
      ['dragover', 'drop'].forEach(ev => dock.addEventListener(ev, e => {
        e.stopPropagation(); e.preventDefault();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) attachFiles(e.dataTransfer.files);
      }));
    }

    /* safety net: if the app ever renders without the buttons (stale DOM),
       Alt+U still opens the ingestion picker */
    document.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); openPicker(); }
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {   /* Alt+A opens the file attacher */
        e.preventDefault(); if (atIn) atIn.click();
      }
    });
    {
      /* drag & drop anywhere on the app shell also ingests a project */
      const app = $('#app');
      ['dragenter', 'dragover'].forEach(ev => app.addEventListener(ev, e => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
        app.classList.add('is-dragging');
      }));
      ['dragleave', 'drop'].forEach(ev => app.addEventListener(ev, e => {
        e.preventDefault();
        if (ev === 'dragleave' && app.contains(e.relatedTarget)) return;
        app.classList.remove('is-dragging');
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
      }));
    }

    /* preview */
    $('#btnReload').onclick = () => { U.loadPreview(); U.toast('runtime reloaded'); };
    $('#viewportSel').onchange = () => U.applyViewport();
    $('#btnFullscreen').onclick = () => {
      const f = $('#gameFrame');
      if (f.requestFullscreen) f.requestFullscreen();
      else U.toast('fullscreen blocked by browser');
    };

    /* export */
    $('#btnDownload').onclick = download;
    $('#btnCopyFile').onclick = () => {
      const b = S.build; if (!b || !S.activeFile) return;
      const txt = b.files[S.activeFile];
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
        .then(() => U.toast('copied ' + S.activeFile, 'ok'))
        .catch(() => {
          const ta = document.createElement('textarea');
          ta.value = txt; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); U.toast('copied ' + S.activeFile, 'ok'); }
          catch (e) { U.toast('copy failed — select manually', 'err'); }
          ta.remove();
        });
    };

    /* compile */
    $('#btnCompile').onclick = manualCompile;

    /* persona */
    const ta = $('#personaInput');
    ta.addEventListener('input', () => { $('#personaCount').textContent = ta.value.length + ' chars'; });
    $('#btnPersonaSave').onclick = async () => {
      S.persona = ta.value; S.save(); U.renderPersona();
      S.setStatus('working', 're-baking persona');
      U.logLine('sys', 'persona re-bake → recomputing behaviour deltas');
      await sleep(420);
      const digest = 'sha1:' + (Arc.Planner.hashSeed(S.persona) >>> 0).toString(16);
      U.logLine('ok', 'persona locked · digest ' + digest + ' · will apply to next build');
      S.setStatus('ready', 'persona baked');
      U.toast('persona re-baked', 'ok');
    };
    $('#btnPersonaReset').onclick = () => {
      S.persona = Arc.State.PERSONA_PRESETS[0].text.replace(/\n\nOVERRIDE[\s\S]*$/, '');
      ta.value = S.persona; S.save(); U.renderPersona(); U.toast('default persona restored');
    };

    /* terminal */
    $('#termForm').addEventListener('submit', e => {
      e.preventDefault();
      const inp = $('#termInput');
      Arc.Terminal.run(inp.value);
      inp.value = '';
    });
    $('#termInput').addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const v = e.target.value.trim().split(/\s+/)[0];
        const hit = Object.keys(Arc.Terminal.CMD).find(k => k.startsWith(v));
        if (hit) e.target.value = hit + ' ';
      }
    });

    /* clock */
    setInterval(() => {
      $('#footClock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
    }, 1000);

    /* status subscription */
    S.subscribe(evt => { if (evt === 'status') U.syncStatus(); });

    /* boot button */
    $('#bootEnter').onclick = leaveBoot;
    addEventListener('keydown', e => {
      if (!$('#boot') && !e.metaKey && !e.ctrlKey && !e.altKey) return;
      if ($('#boot') && !$('#boot').classList.contains('is-out') && (e.key === 'Enter' || e.key === ' ')) {
        if (!$('#bootEnter').hidden) { e.preventDefault(); leaveBoot(); }
      }
      /* global shortcuts */
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && $('#promptInput').value.trim()) generate();
    });
  }

  /* ───────────────────────── INIT ───────────────────────── */
  function init() {
    S.load();
    U.renderTools(); U.renderPipeline(); U.renderLangPicker(); U.renderQuickTags();
    U.renderPersona(); U.renderPresets(); U.renderGuards(); U.renderCompileTargets();
    U.renderBench(); U.renderTree(); U.syncStatus(); U.startTTT();
    Arc.Terminal.CMD && (() => {
      const el = $('#termOut');
      const d = document.createElement('div');
      d.className = 'dim';
      d.textContent = 'arcgen shell · virtual filesystem over generated builds\ncommands: help ls cat tree wc grep check build test compile stats plan persona open download generate clear';
      el.appendChild(d);
    })();
    if (S.builds.length) { U.loadPreview(); U.logLine('sys', 'restored ' + S.builds.length + ' cached build(s) from local storage.'); }
    wire();
    boot();
  }

  /* expose for terminal commands */
  Arc.UI.go = go;
  Arc.UI.generate = generate;
  Arc.UI.download = download;
  Arc.UI.adjust = adjust;
  Arc.UI.revertPatch = revertPatch;
  Arc.UI.handleUpload = handleUpload;
  Arc.UI.attachFiles = attachFiles;
  Arc.UI.renderAttachChips = renderAttachChips;

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', init) : init();
})();
