/* ═══════════════════════════════════════════════════════════
   ARCGEN · planner.js — directive parsing → game design plan
   Deterministic keyword inference. No network, no LLM API:
   the "planner" is a rule-based intent engine + seeded RNG.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* seeded PRNG (mulberry32) so builds are reproducible */
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const rint = (r, a, b) => a + Math.floor(r() * (b - a + 1));

  /* ── genre knowledge base ─────────────────────────────────── */
  const GENRES = {
    platformer: {
      keys: ['platform', 'jump', 'mario', 'side scroll', 'sidescroller', 'gravity', 'metroidvania'],
      view: 'side', tagline: 'momentum platforming', spawn: 'left ledge',
      entities: ['player', 'tilemap', 'coin', 'spike', 'patrol enemy', 'checkpoint', 'goal flag'],
      mechanics: ['variable jump height', 'coyote time', 'air control', 'crumble platforms'],
      win: 'reach the exit flag', lose: 'HP reaches zero',
      palette: [['#0ea5e9', '#facc15', '#f472b6', '#22d3ee'], ['#7c3aed', '#a8ff3e', '#ffb547', '#ff3d81']],
      hud: ['SCORE', 'COINS', 'LIVES']
    },
    shooter: {
      keys: ['shooter', 'shoot', 'bullet', 'gun', 'wave', 'alien', 'space invader', 'twin stick', 'top-down'],
      view: 'top', tagline: 'wave survival gunplay', spawn: 'center',
      entities: ['ship', 'bullet', 'enemy drone', 'powerup', 'explosion', 'asteroid'],
      mechanics: ['screen shake on hit', 'spread shot powerup', 'i-frames', 'combo multiplier'],
      win: 'survive all waves', lose: 'hull integrity 0',
      palette: [['#ff3d81', '#35f2d7', '#ffb547', '#8b6bff'], ['#a8ff3e', '#6ec6ff', '#ff8f5c', '#f472b6']],
      hud: ['WAVE', 'SCORE', 'SHIELD']
    },
    breakout: {
      keys: ['breakout', 'brick', 'paddle', 'arkanoid', 'bounce'],
      view: 'top', tagline: 'paddle & brick demolition', spawn: 'bottom center',
      entities: ['paddle', 'ball', 'brick grid', 'powerup capsule'],
      mechanics: ['angle off paddle position', 'multi-ball', 'brick armour tiers'],
      win: 'clear every brick', lose: 'balls exhausted',
      palette: [['#35f2d7', '#ffb547', '#ff3d81', '#8b6bff']],
      hud: ['BALLS', 'SCORE', 'BRICKS']
    },
    racer: {
      keys: ['race', 'racer', 'car', 'drift', 'speed', 'kart', 'lap'],
      view: 'top', tagline: 'arcade drift racing', spawn: 'grid slot 1',
      entities: ['car', 'track spline', 'checkpoint', 'traffic', 'skid mark'],
      mechanics: ['drift charge boost', 'slipstream', 'lap timing'],
      win: 'finish 3 laps under target', lose: 'timer expires',
      palette: [['#ffb547', '#ff3d81', '#35f2d7', '#0ea5e9']],
      hud: ['LAP', 'TIME', 'BOOST']
    },
    puzzle: {
      keys: ['puzzle', 'match', 'block', 'sudoku', 'slide', 'tetris', 'pipe'],
      view: 'grid', tagline: 'grid logic puzzles', spawn: 'top of field',
      entities: ['tile', 'piece', 'target line', 'score chain'],
      mechanics: ['chain scoring', 'gravity collapse', 'preview next piece'],
      win: 'clear the board objective', lose: 'stack overflow',
      palette: [['#8b6bff', '#35f2d7', '#f472b6', '#a8ff3e']],
      hud: ['LEVEL', 'SCORE', 'NEXT']
    },
    towerdefense: {
      keys: ['tower', 'defense', 'defence', 'td', 'creep'],
      view: 'top', tagline: 'lane defense stacking', spawn: 'path entrance',
      entities: ['tower slots', 'creep lane', 'projectile', 'gold', 'wave banner'],
      mechanics: ['target priority modes', 'upgrade branches', 'splash damage'],
      win: 'survive 15 waves', lose: 'lives reach zero',
      palette: [['#a8ff3e', '#ffb547', '#6ec6ff', '#ff3d81']],
      hud: ['WAVE', 'GOLD', 'LIVES']
    },
    roguelike: {
      keys: ['roguelike', 'rogue', 'dungeon', 'procedural', 'permadeath', 'fog'],
      view: 'top', tagline: 'procedural dungeon crawl', spawn: 'entry stairs',
      entities: ['hero', 'room graph', 'chest', 'slime', 'stairs', 'torch'],
      mechanics: ['fog of war', 'permadeath run stats', 'relic synergies'],
      win: 'retrieve the artifact', lose: 'death (run ends)',
      palette: [['#ffb547', '#8b6bff', '#ff5c5c', '#35f2d7']],
      hud: ['DEPTH', 'HP', 'GOLD']
    },
    survival: {
      keys: ['survival', 'craft', 'hunger', 'island', 'zombie'],
      view: 'top', tagline: 'resource survival loop', spawn: 'shoreline',
      entities: ['player', 'tree', 'rock', 'campfire', 'night raider', 'meter'],
      mechanics: ['day/night threat curve', 'hunger/thirst decay', 'craft bench'],
      win: 'survive N days', lose: 'any vital hits zero',
      palette: [['#35f2d7', '#a8ff3e', '#ffb547', '#6ec6ff']],
      hud: ['DAY', 'HP', 'FOOD']
    },
    rhythm: {
      keys: ['rhythm', 'music', 'beat', 'guitar', 'tap'],
      view: 'lane', tagline: 'beat-lane performance', spawn: 'lane top',
      entities: ['note', 'hit line', 'combo flare', 'bpm meter'],
      mechanics: ['judgement windows', 'perfect parry', 'dynamic track gen'],
      win: 'complete the track', lose: 'health depleted by misses',
      palette: [['#f472b6', '#8b6bff', '#35f2d7', '#ffb547']],
      hud: ['COMBO', 'SCORE', 'ACC%']
    },
    idle: {
      keys: ['idle', 'clicker', 'incremental', 'tycoon'],
      view: 'ui', tagline: 'numbers-go-up loop', spawn: 'n/a',
      entities: ['generator', 'upgrade card', 'prestige orb'],
      mechanics: ['offline progress', 'exponential cost curve', 'prestige multipliers'],
      win: 'reach singularity tier', lose: 'none (endless)',
      palette: [['#a8ff3e', '#ffb547', '#35f2d7']],
      hud: ['PER SEC', 'TOTAL', 'MULT']
    }
  };

  const ADJ = ['neon', 'cozy', 'brutalist', 'dreamcore', 'vapor', 'subterranean', 'orbital', 'haunted', 'chromatic', 'feral'];
  const NOUN = ['protocol', 'garden', 'circuit', 'relic', 'horizon', 'bazaar', 'engine', 'labyrinth'];

  /* ── parse ────────────────────────────────────────────────── */
  function detectGenre(text) {
    const t = text.toLowerCase();
    let best = null, bestScore = 0;
    for (const [id, g] of Object.entries(GENRES)) {
      let s = 0;
      for (const k of g.keys) if (t.includes(k)) s += k.length > 5 ? 3 : 2;
      if (s > bestScore) { bestScore = s; best = id; }
    }
    return best || 'shooter';
  }

  function extractNumbers(text) {
    const n = {};
    let m;
    if ((m = /(\d+)\s*(laps?|rounds?|waves?)/.exec(text))) n.waves = +m[1];
    if ((m = /(\d+)\s*(levels?|biomes?|days?|species)/.exec(text))) n.levels = +m[1];
    if ((m = /(\d+)\s*fps/.exec(text))) n.fps = +m[1];
    return n;
  }

  function titleCase(text, r) {
    const words = text.replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/).filter(Boolean);
    const key = words.find(w => w.length > 4) || words[0] || 'arc';
    return (pick(r, ADJ) + ' ' + key.toUpperCase().slice(0, 7)).replace(/^\w/, c => c.toUpperCase());
  }

  function slug(text, r) {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'game';
    return base + '-' + rint(r, 100, 999);
  }

  /* persona keywords nudge the plan (visible feedback for user edits) */
  function personaInfluence(persona) {
    const p = persona.toLowerCase();
    const inf = { juice: 1, paletteBias: null, retro: false, simHeavy: false, cppHeavy: false };
    if (/juice|shake|particle|impact/.test(p)) inf.juice += .5;
    if (/retro|pixel|crt|16-color|16 color/.test(p)) { inf.retro = true; inf.juice += .2; }
    if (/simulat|system|emergent|data-driven/.test(p)) inf.simHeavy = true;
    if (/unreal|\bc\+\+|pbr|aaa/.test(p)) inf.cppHeavy = true;
    if (/neon|high-contrast|vibrant/.test(p)) inf.paletteBias = 'neon';
    if (/pastel|cozy|muted/.test(p)) inf.paletteBias = 'cozy';
    return inf;
  }

  /* ── main entry ───────────────────────────────────────────── */
  function plan(prompt, lang, persona) {
    const text = (prompt || '').trim() || 'arcade shooter with waves';
    const seed = hashSeed(text + '|' + lang + '|' + persona.slice(0, 64));
    const r = rng(seed);
    const gid = detectGenre(text);
    const g = GENRES[gid];
    const nums = extractNumbers(text);
    const inf = personaInfluence(persona);

    let palette = pick(r, g.palette);
    if (inf.paletteBias === 'cozy') palette = ['#ffd6a5', '#a8dadc', '#ff8fab', '#b8e0d2'];
    if (inf.retro) palette = ['#f8f8f8', '#ffcd75', '#e43b44', '#2de0a5'];

    const systems = [
      { name: 'CoreLoop', desc: 'fixed-timestep update/render split, state machine: menu → play → pause → gameover' },
      { name: 'InputMap', desc: 'keyboard + gamepad abstraction with rebind table and deadzone' },
      { name: 'Physics', desc: g.view === 'side' ? 'AABB sweep vs tilemap, gravity, terminal velocity' : 'circle/AABB broadphase, impulse resolution, spatial hash' },
      { name: 'Spawner', desc: 'seeded wave/table spawner driven by difficulty curve' },
      { name: 'FX', desc: 'particles, screen shake, hit-stop flash' + (inf.juice > 1.2 ? ' (persona: HIGH juice)' : '') },
      { name: 'Audio', desc: 'WebAudio synth blips — square/tri oscillators, no samples required' },
      { name: 'HUD', desc: 'score/lives/wave overlay, combo pop-scale' },
      { name: 'SaveGame', desc: 'localStorage high-score + settings persistence' }
    ];
    if (inf.simHeavy) systems.push({ name: 'Economy', desc: 'data-driven resource tables with tick-based flows' });

    const tasks = [
      { id: 'T1', tool: 'planner',  label: 'Write GDD + tuning block' },
      { id: 'T2', tool: 'planner',  label: 'Map module graph & data contracts' },
      { id: 'T3', tool: 'coder',    label: `Synthesize ${g.tagline} core (${gid})` },
      { id: 'T4', tool: 'coder',    label: 'Implement entity behaviours + collision' },
      { id: 'T5', tool: 'files',    label: 'Emit project tree, HTML shell, CSS HUD' },
      { id: 'T6', tool: 'compiler', label: 'Static pass: syntax, refs, budget' },
      { id: 'T7', tool: 'terminal', label: 'Bundle + self-test runtime boot' }
    ];

    return {
      seed, genre: gid, genreLabel: g,
      title: titleCase(text, r),
      slug: slug(text, r),
      lang,
      view: g.view,
      palette,
      influence: inf,
      numbers: { waves: nums.waves || rint(r, 5, 12), levels: nums.levels || rint(r, 3, 6), fps: nums.fps || 60 },
      brief: text,
      pillars: [
        `${g.tagline} — ${g.mechanics[0]} as the signature verb`,
        `readable feedback: ${g.hud.join(' / ')} always visible`,
        `session length ~${rint(r, 2, 6)} minutes, instant retry`,
        inf.retro ? 'hard pixel grid, no subpixel drift' : 'vector-crisp shapes, glow accents'
      ],
      entities: g.entities,
      mechanics: g.mechanics,
      win: g.win, lose: g.lose, spawn: g.spawn,
      systems, tasks,
      budget: { maxSprites: 320, frameMs: 16.6, bundleKb: 64 }
    };
  }

  global.Arc = global.Arc || {};
  global.Arc.Planner = { plan, rng, hashSeed };
})(window);
