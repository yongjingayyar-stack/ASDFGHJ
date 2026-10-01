/* ════════════════════════════════════════════════════════════════
   ARCGEN · js/upload.js  —  on-device project ingestion (Arc.Upload)
   The topbar Upload button loads an existing game project from disk
   so the AI can analyze it and apply adjustments to real code:
     • .zip            → unpacked via bundled JSZip (vendor/)
     • build.json      → native ARCGEN export ({ plan, files })
     • loose files     → index.html / js/game.js / css / ports / docs…
     • images/audio    → stored as base64 data URLs in the tree
   Everything is parsed inside the browser sandbox — zero network.
   After ingest: renderTree + loadPreview + compile gate run exactly
   like a fresh generation, so patches/adjustments work on uploads.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const TEXT_EXT = ['js', 'ts', 'mjs', 'cjs', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss',
    'md', 'txt', 'json', 'cs', 'cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'java', 'py', 'rs',
    'lua', 'gd', 'gdshader', 'glsl', 'vert', 'frag', 'shader', 'yml', 'yaml', 'toml',
    'cfg', 'ini', 'xml', 'svg', 'bat', 'sh', 'makefile', 'cmake', 'gitignore', 'editorconfig'];
  const BIN_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'wav', 'ogg', 'mp3', 'ttf', 'otf', 'woff', 'woff2'];
  const MAX_FILES = 120;
  const MAX_BYTES = 4 * 1024 * 1024;           // per file
  const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git\/|node_modules\/)/i;

  function extOf(name) {
    const b = name.split('/').pop();
    if (/^(makefile|cmakelists|dockerfile)$/i.test(b)) return b.toLowerCase();
    const i = b.lastIndexOf('.');
    return i >= 0 ? b.slice(i + 1).toLowerCase() : '';
  }
  function isText(name) { return TEXT_EXT.indexOf(extOf(name)) >= 0; }
  function isBin(name) { return BIN_EXT.indexOf(extOf(name)) >= 0; }
  function readAs(file, how) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('read failed: ' + file.name));
      how === 'bin' ? r.readAsDataURL(file) : r.readAsText(file);
    });
  }

  /* ── derive a lightweight plan for uploaded projects ── */
  function derivePlan(files, label) {
    const langs = [];
    const seen = {};
    Object.keys(files).forEach(p => {
      const e = extOf(p);
      const map = { js: 'js', html: 'html', htm: 'html', css: 'css', md: 'md', cs: 'cs',
        cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'cpp', h: 'cpp', hpp: 'cpp', java: 'java',
        py: 'py', rs: 'rust', lua: 'lua', gd: 'gdscript', glsl: 'glsl', vert: 'glsl', frag: 'glsl' };
      const l = map[e];
      if (l && !seen[l]) { seen[l] = 1; langs.push(l); }
    });
    if (!langs.length) langs.push('js');
    const hasHtml = Object.keys(files).some(p => /\.html?$/i.test(p));
    const seed = Arc.Planner.hashSeed(label + Object.keys(files).sort().join('|'));
    const rng = Arc.Planner.rng(seed >>> 0);
    return {
      title: label, genre: 'uploaded project', prompt: 'project loaded from disk',
      langs: langs, lang: langs[0], seed: seed >>> 0, rng: rng,
      personaDigest: 'sha1:' + (Arc.Planner.hashSeed('upload') >>> 0).toString(16),
      influence: { juice: 0.5 }, createdAt: Date.now(), uploaded: true
    };
  }

  /* ── main entry: FileList | File[] → ingest into Arc.State ── */
  async function ingest(list, hooks) {
    const H = hooks || {};
    const log = (k, m) => H.log && H.log(k, m);
    const toast = (m, k) => H.toast && H.toast(m, k);
    const files = {};
    let zipped = 0, stripped = 0;

    const arr = Array.prototype.slice.call(list || []);
    if (!arr.length) { toast('no files selected'); return null; }

    for (const f of arr) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.zip') || (f.type || '').indexOf('zip') >= 0) {
        if (!global.JSZip) { log('err', 'JSZip unavailable — cannot unpack ' + f.name); continue; }
        log('sys', 'unpacking ' + f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)…');
        let zip;
        try { zip = await global.JSZip.loadAsync(f); }
        catch (e) { log('err', 'corrupt archive: ' + f.name); continue; }
        const entries = Object.values(zip.files).filter(e => !e.dir);
        zipped += entries.length;
        for (const e of entries) {
          const p = normPath(e.name);
          if (!p || IGNORE.test(p)) continue;
          if (isText(p)) {
            try { files[p] = await e.async('string'); } catch (_) { /* skip */ }
          } else if (isBin(p)) {
            try { files[p] = await e.async('base64').then(b => 'data:application/octet-stream;base64,' + b); } catch (_) { }
          }
        }
        continue;
      }
      if (lower.endsWith('.json')) {
        log('sys', 'reading manifest ' + f.name);
        let txt; try { txt = await readAs(f, 'txt'); } catch (_) { continue; }
        let obj; try { obj = JSON.parse(txt); } catch (_) { log('err', f.name + ' is not valid JSON'); continue; }
        if (obj && obj.files && typeof obj.files === 'object') {
          Object.keys(obj.files).forEach(p => {
            const np = normPath(p);
            if (np && !IGNORE.test(np)) files[np] = String(obj.files[p]);
          });
          if (obj.plan && obj.plan.title) { H.setMeta && H.setMeta(obj.plan); }
          log('ok', 'native build loaded · "' + ((obj.plan && obj.plan.title) || f.name) + '"');
        } else {
          const np = normPath(f.name);
          if (np) files[np] = txt;
        }
        continue;
      }
      const p = normPath(f.webkitRelativePath || f.name);
      if (!p) continue;
      if (isText(p)) {
        try { files[p] = await readAs(f, 'txt'); } catch (_) { }
      } else if (isBin(p)) {
        if (f.size > MAX_BYTES) { log('warn', p + ' exceeds 4 MB — skipped'); stripped++; continue; }
        try { files[p] = await readAs(f, 'bin'); } catch (_) { }
      } else {
        stripped++;
      }
    }

    const paths = Object.keys(files);
    if (!paths.length) { toast('nothing importable in selection', 'err'); log('err', 'no readable text/binary files found'); return null; }

    /* collapse single common root folder ("mygame/index.html" → "index.html") */
    let root = null;
    if (paths.every(p => p.indexOf('/') > 0)) {
      const first = paths.map(p => p.split('/')[0]).sort();
      if (first.every(x => x === first[0])) root = first[0];
    }
    let out = files;
    if (root) {
      out = {};
      paths.forEach(p => { out[p.slice(root.length + 1)] = files[p]; });
      log('sys', 'stripped archive root "' + root + '/"');
    }

    /* cap + size guard */
    const finalFiles = {};
    let count = 0;
    Object.keys(out).sort().forEach(p => {
      if (count >= MAX_FILES) { stripped++; return; }
      if (String(out[p]).length > MAX_BYTES * 1.4) { stripped++; return; }
      finalFiles[p] = out[p]; count++;
    });

    /* pick a display name */
    let label = (arr[0] && arr[0].name || 'upload').replace(/\.[^.]+$/, '');
    const htmlPath = Object.keys(finalFiles).find(p => /index\.html?$/i.test(p));
    if (htmlPath) {
      const m = /<title>([^<]{3,60})<\/title>/i.exec(finalFiles[htmlPath]);
      if (m) label = m[1].trim();
    }

    const plan = H.meta || derivePlan(finalFiles, label);
    /* attach-mode (H.createBuild === false): read files into context only,
       do NOT switch the active project */
    if (H.createBuild !== false) {
      S.addBuild({ id: 'up-' + Date.now().toString(36), name: label, files: finalFiles,
        lang: plan.lang, createdAt: Date.now(), history: [], uploaded: true });
      S.plan = plan;
      S.save();
    }

    log('ok', 'imported ' + count + ' file(s)' + (zipped ? ' from ' + zipped + ' archive entries' : '') +
      (stripped ? ' · ' + stripped + ' skipped' : ''));
    return { files: finalFiles, plan: S.plan, count: count, label: label };
  }

  function normPath(raw) {
    let p = String(raw || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    p = p.replace(/\/{2,}/g, '/');
    if (!p || p.indexOf('/') === 0 || /\.\./.test(p)) return null;
    return p;
  }

  global.Arc = global.Arc || {};
  global.Arc.Upload = { ingest: ingest, normPath: normPath, derivePlan: derivePlan };
})(window);
