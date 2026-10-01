/* ════════════════════════════════════════════════════════════════
   ARCGEN · js/attach.js  —  FILE ATTACHER (Arc.Attach)
   Contextual file ingestion for BOTH pipelines:
     • Generation  — attached code/sprites/audio/docs condition the
                     planner + generators (palette, title, config,
                     asset embedding, language-stack hints).
     • Adjustment  — attached files become patch material: new assets
                     land in the tree, data-URL sprites are rewired
                     into the runtime, CFG values merge from uploads.
   Reuses Arc.Upload's on-device unpacking (zip/json/loose files).
   Attachments persist in localStorage (capped) so a refresh keeps
   context. Zero network — everything parsed in the sandbox.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const MAX_ATTACH = 12;                 // files per batch
  const CHIP_NAME = 26;                  // display truncation
  const ASSET_RX = /\.(png|jpe?g|gif|webp|bmp|ico|wav|ogg|mp3)$/i;

  /* ── attachment store (persisted, size-capped) ─────────────── */
  function store() {
    try { return (S.attach = S.attach || {}); }
    catch (_) { return (global.__attach = global.__attach || {}); }
  }
  function list() { return Object.keys(store()).sort(); }
  function count() { return list().length; }
  function get(path) { return store()[path]; }
  function clearAll() { S.attach = {}; S.save && S.save(); }
  function remove(path) { delete store()[path]; S.save && S.save(); }

  function fitPersist() {
    /* keep total attachment payload under ~1.6 MB of JSON */
    const keys = list();
    let total = 0;
    const sized = keys.map(p => { const b = String(store()[p] || '').length; total += b; return { p, b }; });
    sized.sort((a, b) => a.p.localeCompare(b.p));
    for (const it of sized) {
      if (total <= 1600 * 1024) break;
      delete store()[it.p]; total -= it.b;
    }
  }

  /* ── ingest via Arc.Upload pipeline, then register as context ─ */
  async function addFiles(fileList, log) {
    const L = typeof log === 'function' ? log : () => {};
    const arr = Array.prototype.slice.call(fileList || []).slice(0, MAX_ATTACH);
    if (!arr.length) { L('warn', 'attach: no files selected'); return []; }

    /* reuse zip/json/loose-file parsing from the uploader (context-only:
       no build is created, active project untouched) */
    const ingested = await Arc.Upload.ingest(arr, {
      log: (k, m) => L(k === 'ok' ? 'files' : k, 'attach · ' + m),
      toast: () => { },                       // silence upload toasts
      createBuild: false
    });

    const added = [];
    if (ingested && ingested.files) {
      Object.keys(ingested.files).forEach(p => {
        if (count() >= 40) { L('warn', 'attach limit reached (40) — ' + p + ' skipped'); return; }
        store()[p] = ingested.files[p];
        added.push(p);
      });
    }
    fitPersist();
    S.save && S.save();
    if (added.length) L('ok', 'attached ' + added.length + ' file(s) as AI context');
    return added;
  }

  /* ── context digests consumed by the pipelines ─────────────── */

  /* generation conditioning: pull style/config/title signals out of
     attached text files (CSS palettes, JS configs, MD titles) */
  function genContext() {
    const ctx = { langs: [], palette: null, cfg: {}, title: null, assets: [], docs: [] };
    list().forEach(p => {
      const v = String(get(p) || '');
      const ext = (p.split('.').pop() || '').toLowerCase();
      if (/^(js|ts)$/.test(ext)) {
        ctx.langs.push('js');
        const c = parseCfg(v); if (Object.keys(c).length) ctx.cfg = Object.assign(ctx.cfg, c);
        const pal = /["']?(PAL|palette|accent)["']?\s*[:=]\s*\[([^\]]+)\]/i.exec(v);
        if (pal) ctx.palette = hexes(pal[2]) || ctx.palette;
        const acc = /(["'])(#[0-9a-f]{6})\1/i.exec(v); if (acc && !ctx.palette) ctx.palette = [acc[2]];
      }
      if (/^(html?)$/.test(ext)) {
        ctx.langs.push('html');
        const t = /<title>([^<]{3,60})<\/title>/i.exec(v); if (t && !ctx.title) ctx.title = t[1].trim();
        const css = /:root[^{]*{([^}]*)}/i.exec(v);
        if (css) ctx.palette = hexes(css[1]) || ctx.palette;
      }
      if (/^(css|scss)$/.test(ext)) { ctx.langs.push('css'); ctx.palette = hexes(v) || ctx.palette; }
      if (/^(cs)$/.test(ext)) ctx.langs.push('cs');
      if (/^(cpp|cc|cxx|h|hpp)$/.test(ext)) ctx.langs.push('cpp');
      if (/^(java)$/.test(ext)) ctx.langs.push('java');
      if (/^(py)$/.test(ext)) ctx.langs.push('py');
      if (/^(rs)$/.test(ext)) ctx.langs.push('rust');
      if (/^(lua)$/.test(ext)) ctx.langs.push('lua');
      if (/^(gd)$/.test(ext)) ctx.langs.push('gdscript');
      if (/^(glsl|vert|frag)$/.test(ext)) ctx.langs.push('glsl');
      if (/^(md|txt)$/.test(ext)) {
        const h = /^#\s+([^\n]{3,60})/m.exec(v); if (h && !ctx.title) ctx.title = h[1].trim();
        ctx.docs.push(p);
      }
      if (ASSET_RX.test(p) && v.indexOf('data:') === 0) ctx.assets.push(p);
    });
    ctx.langs = ctx.langs.filter((x, i, a) => a.indexOf(x) === i);
    return ctx;
  }

  /* crude key:number / key:"string" extraction for CFG-style blocks */
  function parseCfg(text) {
    const out = {};
    const block = /(?:const|var|let)?\s*(?:CFG|CONFIG|config)\s*=\s*\{([\s\S]{0,1500}?)\}\s*;?/.exec(text);
    const src = block ? block[1] : text.slice(0, 1500);
    const rx = /([A-Za-z_][\w]*)\s*:\s*(-?\d+(?:\.\d+)?|"[^"\n]{1,60}"|'[^'\n]{1,60}')/g;
    let m, n = 0;
    while ((m = rx.exec(src)) && n++ < 24) {
      let val = m[2];
      out[m[1]] = /^["']/.test(val) ? val.slice(1, -1) : parseFloat(val);
    }
    return out;
  }
  function hexes(str) {
    const hs = (String(str).match(/#[0-9a-fA-F]{6}\b/g) || []);
    return hs.length ? hs.slice(0, 5).map(h => h.toLowerCase()) : null;
  }

  /* adjustment material: assets + cfg merged into the live build */
  function adjustMaterial() {
    const mat = { assets: {}, cfg: {}, docs: [] };
    list().forEach(p => {
      const v = String(get(p) || '');
      if (ASSET_RX.test(p) && v.indexOf('data:') === 0) mat.assets[p] = v;
      else if (/\.(js|ts|json|cfg|ini|toml|yaml|yml)$/i.test(p)) {
        try {
          if (/\.json$/i.test(p)) { const o = JSON.parse(v); if (o && typeof o === 'object') Object.assign(mat.cfg, flatten(o)); }
          else Object.assign(mat.cfg, parseCfg(v));
        } catch (_) { /* ignore unparseable */ }
      } else if (/\.(md|txt)$/i.test(p)) mat.docs.push(p);
    });
    return mat;
  }
  function flatten(o, pre, out) {
    out = out || {}; pre = pre ? pre + '_' : '';
    Object.keys(o).forEach(k => {
      const v = o[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, pre + k, out);
      else if (typeof v === 'number' || typeof v === 'string') out[(pre + k).toUpperCase()] = v;
    });
    return out;
  }

  /* deterministic injection ops applied through the patch stack */
  function buildAttachOps(files, mat) {
    const ops = [];

    /* 1 · copy every attached asset into the build tree (new files) */
    Object.keys(mat.assets).forEach(p => {
      const dest = 'assets/' + p.split('/').pop();
      ops.push({ path: dest, from: null, to: mat.assets[p], whys: ['attach: embedded asset → ' + dest] });
    });

    /* 2 · rewire attached images into the renderer (idempotent marker) */
    const gp = Object.keys(files).find(p => /game\.js$/i.test(p));
    const firstImg = Object.keys(mat.assets).find(p => /\.(png|jpe?g|webp)$/i.test(p));
    if (gp && firstImg && String(files[gp]).indexOf('PATCH:attached-sprites') < 0) {
      const loader = '\n/*PATCH:attached-sprites*/(function(){window.__SPR=window.__SPR||{};' +
        'var s=new Image();s.onload=function(){window.__SPR.main=1;};s.src=' + JSON.stringify(mat.assets[firstImg]) + ';})();/*ENDPATCH*/\n';
      const src = files[gp];
      const anchor = /\brequestAnimationFrame\b/.test(src) ? src.search(/\bfunction\s+render\b|\brequestAnimationFrame\b/) : -1;
      const next = anchor >= 0 ? src.slice(0, anchor) + loader + src.slice(anchor) : src + loader;
      ops.push({ path: gp, from: src, to: next, whys: ['attach: sprite wired into renderer (' + firstImg + ')'] });
    }

    /* 3 · merge attached CFG numbers into the live runtime config
       (chains onto op #2's output when both touch game.js) */
    if (gp) {
      const chain = ops.find(o => o.path === gp);
      let cur = chain ? chain.to : files[gp];
      let changed = false;
      Object.keys(mat.cfg).forEach(k => {
        if (!/^[A-Z][A-Z0-9_]{1,24}$/.test(k)) return;
        const v = mat.cfg[k];
        const rx = new RegExp('(' + k + '\\s*:\\s*)(-?\\d+(?:\\.\\d+)?|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')');
        if (rx.test(cur)) { cur = cur.replace(rx, '$1' + (typeof v === 'number' ? v : JSON.stringify(String(v)))); changed = true; }
      });
      if (changed) {
        if (chain) { chain.to = cur; chain.whys.push('attach: CFG merged from attached config'); }
        else ops.push({ path: gp, from: files[gp], to: cur, whys: ['attach: CFG merged from attached config'] });
      }
    }

    /* 4 · fold attached docs into the GDD as a reference section */
    if (mat.docs.length) {
      const gddPath = Object.keys(files).find(p => /gdd\.md$/i.test(p));
      if (gddPath) {
        const docBlock = mat.docs.map(p => '> 📎 `' + p + '` — attached reference loaded into AI context').join('\n');
        ops.push({ path: gddPath, from: files[gddPath], to: files[gddPath] + '\n\n## Attached references\n' + docBlock + '\n',
          whys: ['attach: GDD updated with reference log'] });
      }
    }
    return ops;
  }

  global.Arc = global.Arc || {};
  global.Arc.Attach = {
    addFiles, list, count, get, remove, clearAll,
    genContext, adjustMaterial, buildAttachOps
  };
})(window);
