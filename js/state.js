/* ═══════════════════════════════════════════════════════════
   ARCGEN · state.js — central store, spec constants, persistence
   Pure local. No network calls anywhere in this file.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ───── model spec (as configured for this deployment) ───── */
  const SPEC = {
    topsMin: 4000,            // TB/s minimum
    topsNominal: 4192,        // measured peak
    accMin: 89,               // % minimum benchmark accuracy
    accNominal: 91.4,         // aggregate accuracy
    model: 'arcgen-ttt-340b-q8',
    context: '1M tokens',
    arch: 'TTT-MoE (test-time training, 128 experts / 9 active)'
  };

  const TOOLS = [
    { id: 'planner',   name: 'Planner',          role: 'decompose directive → GDD + task graph', icon: '◱' },
    { id: 'coder',     name: 'Coder Executor',   role: 'stream systems & gameplay code',          icon: '⌘' },
    { id: 'files',     name: 'File Generator',   role: 'emit project tree + assets',              icon: '▤' },
    { id: 'terminal',  name: 'Terminal Executor',role: 'run sandboxed build commands',            icon: '❯' },
    { id: 'compiler',  name: 'Compiler',         role: 'parse · validate · self-repair',          icon: '▲' }
  ];

  const PIPELINE = [
    { id: 'parse',   label: 'Directive parse' },
    { id: 'plan',    label: 'Design planning' },
    { id: 'arch',    label: 'Architecture map' },
    { id: 'code',    label: 'Code synthesis' },
    { id: 'assets',  label: 'Asset generation' },
    { id: 'compile', label: 'Compile + validate' },
    { id: 'ship',    label: 'Package build' }
  ];

  const LANGS = [
    { id: 'js',   label: 'JavaScript', ext: '.js',   color: '#ffb547', note: 'HTML5 canvas runtime · default playable target' },
    { id: 'html', label: 'HTML',       ext: '.html', color: '#ff3d81', note: 'shell, manifest, embedded preview' },
    { id: 'css',  label: 'CSS',        ext: '.css',  color: '#35f2d7', note: 'HUD skin, menus, responsive layout' },
    { id: 'cs',   label: 'C#',         ext: '.cs',   color: '#8b6bff', note: 'Unity-style MonoBehaviour components' },
    { id: 'cpp',  label: 'C++',        ext: '.cpp',  color: '#a8ff3e', note: 'Unreal-style actor + physics module' },
    { id: 'java', label: 'Java',       ext: '.java', color: '#ff8f5c', note: 'LibGDX / Android desktop port' },
    { id: 'py',   label: 'Python',     ext: '.py',   color: '#6ec6ff', note: 'Pygame prototype + AI tooling' },
    { id: 'glsl', label: 'GLSL',       ext: '.glsl', color: '#f472b6', note: 'shaders: bloom, palette, distortion' },
    { id: 'gd',   label: 'GDScript',   ext: '.gd',   color: '#c792ea', note: 'Godot 4 scene scripts' },
    { id: 'rs',   label: 'Rust+WASM',  ext: '.rs',   color: '#ffa07a', note: 'deterministic sim core compiled to WASM' },
    { id: 'lua',  label: 'Lua',        ext: '.lua',  color: '#7fd1ff', note: 'modding / scripting layer' },
    { id: 'json', label: 'JSON/ShaderLab', ext: '.json', color: '#9aa7c7', note: 'data tables, input maps, materials' }
  ];

  const BENCH = [
    { suite: 'GameCodeGen-Bench', domain: 'playable loop synthesis', score: 93.2 },
    { suite: 'PhysicsFidelity',   domain: 'collision & integration', score: 91.8 },
    { suite: 'DeterminismAudit',  domain: 'reproducible sims',       score: 95.4 },
    { suite: 'ShaderMath',        domain: 'GLSL / render equations', score: 89.6 },
    { suite: 'EngineAPI-CSharp',  domain: 'Unity surface recall',    score: 92.1 },
    { suite: 'EngineAPI-Cpp',     domain: 'Unreal surface recall',   score: 90.3 },
    { suite: 'NetcodePredict',    domain: 'rollback & interpolation',score: 89.1 },
    { suite: 'PerfBudget',        domain: 'frame-time modelling',    score: 94.0 },
    { suite: 'AssetPipeline',     domain: 'import / compression',    score: 91.2 },
    { suite: 'BugSelfRepair',     domain: 'diagnose → patch rate',   score: 92.7 }
  ];

  const RADAR = [
    { k: 'Planning', v: 94 }, { k: 'Coding', v: 92 }, { k: 'Physics', v: 90 },
    { k: 'Art/Shader', v: 88 }, { k: 'Audio', v: 89 }, { k: 'Perf', v: 95 }
  ];

  const DEFAULT_PERSONA =
`You are ARCGEN, an autonomous game-development agent.

IDENTITY
- Senior engine programmer + systems designer + technical artist in one mind.
- You ship games that run at 60fps on a potato and feel hand-crafted.

PRINCIPLES
1. Playability first: every build must have a start, a challenge, feedback and an end state.
2. Deterministic simulation: fixed timestep, seeded RNG, no hidden global state.
3. Zero dependencies unless requested; generated code must compile and run as-is.
4. Juice is not optional: screen shake, particles, easing, audio blips, hit-stop.
5. Self-review like a hostile senior engineer — find the bug before the player does.
6. Explain nothing in prose; emit files, plans and diagnostics only.

STYLE
- Small composable systems over monoliths.
- Comments describe intent, never syntax.
- Tunables live in one config block so designers can tweak without reading code.

OUTPUT CONTRACT
gdd.md → architecture.json → src/** → assets/** → build report`;

  const PERSONA_PRESETS = [
    { name: 'Arcade Surgeon', tag: 'tight loops · heavy juice', text: DEFAULT_PERSONA + '\n\nOVERRIDE: bias toward arcade 60-second loops, high-contrast neon palettes, chiptune SFX, and instant restart.' },
    { name: 'Simulation Nerd', tag: 'systems-first · emergent', text: DEFAULT_PERSONA + '\n\nOVERRIDE: prioritise interacting simulation systems, data-driven entities, and readable tuning tables over visuals.' },
    { name: 'Retro Cabinet', tag: 'pixel · CRT · 4 buttons', text: DEFAULT_PERSONA + '\n\nOVERRIDE: 16-color palette, integer pixel scaling, CRT shader, dithered shadows, gamepad-first UI.' },
    { name: 'AAA Realism Curio', tag: 'PBR · physics · cinematics', text: DEFAULT_PERSONA + '\n\nOVERRIDE: emit C++/C# engine modules with PBR material graphs, LOD strategy and cinematic camera rigs.' }
  ];

  const QUICK_TAGS = ['platformer', 'roguelike', 'top-down shooter', 'puzzle', 'racer', 'tower defense',
    'rhythm', 'survival', 'metroidvania', 'idle', 'breakout', 'stealth'];

  const SAMPLES = [
    'neon drift racer, 3 laps, ghost times, keyboard only',
    'gravity-flip platformer with momentum puzzles and boss gauntlet',
    'cozy fishing sim, day/night cycle, 40 species codex',
    'wave-based tower defense, chain lightning + poison synergy',
    'dungeon roguelike, fog of war, permadeath, 6 biomes',
    'rhythm duel game, procedurally generated tracks, perfect parry',
    'tiny survival island, hunger/thirst/temperature meters',
    'sumo push-out arena, physics knockback, local 2P'
  ];

  /* ───── store ───── */
  const LS_KEY = 'arcgen.v3';

  const State = {
    SPEC, TOOLS, PIPELINE, LANGS, BENCH, RADAR, QUICK_TAGS, SAMPLES, PERSONA_PRESETS,

    persona: DEFAULT_PERSONA,
    guards: { noNetwork: true, noEval: true, fixedTimestep: true, bundleLimit: false },
    lang: 'js',
    langs: ['js'],          // multi-language stack (primary first)
    prompt: '',
    plan: null,
    builds: [],          // [{id,name,files:{path:text},lang,createdAt}]
    activeBuild: -1,
    activeFile: null,
    status: 'idle',      // idle | working | ready | error
    pipeState: {},
    running: false,

    listeners: new Set(),
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit(evt) { this.listeners.forEach(fn => fn(evt)); },

    save() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          persona: this.persona, guards: this.guards, lang: this.lang, langs: this.langs,
          attach: this.attach || {},
          builds: this.builds.slice(-4), activeBuild: Math.max(-1, this.activeBuild - (this.builds.length - Math.min(4, this.builds.length)))
        }));
      } catch (e) { /* storage unavailable — non fatal */ }
    },
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (typeof d.persona === 'string' && d.persona.trim()) this.persona = d.persona;
        if (d.guards) Object.assign(this.guards, d.guards);
        if (d.lang) this.lang = d.lang;
        if (Array.isArray(d.langs) && d.langs.length) this.langs = d.langs;
        if (d.attach && typeof d.attach === 'object') this.attach = d.attach;
        if (Array.isArray(d.builds)) { this.builds = d.builds; this.activeBuild = d.builds.length ? (d.activeBuild ?? d.builds.length - 1) : -1; }
      } catch (e) { /* ignore corrupt state */ }
    },

    get build() { return this.builds[this.activeBuild] || null; },

    addBuild(b) {
      this.builds.push(b);
      if (this.builds.length > 6) this.builds.shift();
      this.activeBuild = this.builds.length - 1;
      this.activeFile = Object.keys(b.files)[0];
      this.save();
      this.emit('build');
    },

    setStatus(s, label) {
      this.status = s;
      this.emit('status');
      const el = document.getElementById('footTask');
      if (el && label) el.textContent = 'task: ' + label;
    },

    totalBytes() {
      const b = this.build; if (!b) return 0;
      return Object.values(b.files).reduce((n, t) => n + t.length, 0);
    }
  };

  global.Arc = global.Arc || {};
  global.Arc.State = State;
})(window);
