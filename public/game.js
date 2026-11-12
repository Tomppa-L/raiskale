/* Räiskälekokki Bob: selainpeli. Ei ulkoisia tiedostoja, kaikki piirretään koodilla. */
(function () {
  'use strict';

  var W = 960, H = 540;
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  /* Pelin vakiot */
  var PAN = { x: 330, y: 372 };            // paistinpannun keskipiste
  var PLATE_Y = 424;                       // lautasen pinta
  var PLATE_RX = 128, PLATE_RY = 22;
  var DONE = 0.8, BURN = 1.3, BURNT_MAX = 1.5;
  var COOK_RATE = 0.22;                    // paistumisnopeus sekunnissa
  var OMEGA = Math.PI / 0.8;               // pyörimisnopeus käännössä (rad/s)
  var TOSS_T = 0.7;                        // heiton lentoaika
  var MAX_LIVES = 3;

  var game = {
    state: 'menu', t: 0, score: 0, stacked: 0, perfects: 0, lives: MAX_LIVES, wobble: 0,
    stack: [], pancake: null, phase: 0, p: 0, waitT: 0, swing: 0, flash: 0,
    parts: [], texts: [], msg: '', msgT: 0, muted: false, reason: '', endT: 0,
    pendingName: false, lastEntry: null, newBest: false, shocked: 0, forceP: null, cookMul: 1
  };

  /* ---------- Tallennus ---------- */
  var SCORE_KEY = 'raiskale_scores_v1';
  function loadScores() { try { var a = JSON.parse(localStorage.getItem(SCORE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function board() {
    return loadScores().filter(function (x) { return x && typeof x.n === 'string' && typeof x.s === 'number'; })
      .map(function (x) { return { n: x.n.slice(0, 12), s: x.s, k: Number(x.k) || 0, t: Number(x.t) || 0 }; })
      .sort(function (a, b) { return b.s - a.s || a.t - b.t; }).slice(0, 10);
  }
  function best() { var b = board(); return b.length ? b[0].s : 0; }
  function qualifies(s) { if (s <= 0) return false; var b = board(); return b.length < 10 || s > b[b.length - 1].s; }
  function addScore(name, s, k) {
    var b = board(), e = { n: name, s: s, k: k, t: Date.now() }; b.push(e);
    b.sort(function (a, c) { return c.s - a.s || a.t - c.t; });
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(b.slice(0, 10))); } catch (er) {}
    return e;
  }

  /* ---------- Ääni ---------- */
  var audio = null;
  function ac() {
    if (!audio) { var C = window.AudioContext || window.webkitAudioContext; if (C) { try { audio = new C(); } catch (e) {} } }
    if (audio && audio.state === 'suspended') audio.resume();
    return audio;
  }
  function noise(dur, freq, vol) {
    var a = ac(); if (!a || game.muted) return;
    var n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    var g = a.createGain(); g.gain.value = vol; src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  function tone(freq, dur, type, vol, slide) {
    var a = ac(); if (!a || game.muted) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(slide, a.currentTime + dur);
    g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }


  /* ---------- Taustamusiikki: koodilla soitettu bluesrokki-shuffle (E-blues, 12 tahtia) ---------- */
  var music = { on: false, next: 0, tick: 0, master: null, dist: null, nbuf: null };
  var BPM = 116, TICK = 60 / BPM / 3;
  var CHORD_ROOT = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];   // E E E E A A E E B A E B
  var E2 = 82.41, PENTA = [0, 3, 5, 7, 10, 12, 15];
  function hz(base, semis) { return base * Math.pow(2, semis / 12); }
  function distCurve(k) { var n = 1024, c = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; c[i] = Math.tanh(k * x); } return c; }
  function musicInit(a) {
    music.master = a.createGain(); music.master.gain.value = 0; music.master.connect(a.destination);
    var ws = a.createWaveShaper(); ws.curve = distCurve(7); ws.oversample = '2x';
    var lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    ws.connect(lp); lp.connect(music.master); music.dist = ws;
    var n = a.sampleRate, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; music.nbuf = buf;
  }
  function mnote(a, f, t, dur, type, vol, dest, cut, f2) {
    var o = a.createOscillator(), g = a.createGain(), fl = a.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.linearRampToValueAtTime(f2, t + dur);
    fl.type = 'lowpass'; fl.frequency.value = cut || 2500;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  function mnoise(a, t, dur, vol, type, freq) {
    var s = a.createBufferSource(); s.buffer = music.nbuf; var f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    var g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(music.master); s.start(t); s.stop(t + dur + 0.02);
  }
  function playTick(a, k, t) {
    var bar = Math.floor(k / 12) % 12, tt = k % 12, beat = Math.floor(tt / 3), sub = tt % 3, root = CHORD_ROOT[bar];
    /* rummut: potku 1 ja 3, virveli 2 ja 4, shuffle-hihat */
    if (sub === 0 && (beat === 0 || beat === 2)) { mnote(a, 120, t, 0.16, 'sine', 0.9, music.master, 400, 45); }
    if (sub === 0 && (beat === 1 || beat === 3)) { mnoise(a, t, 0.14, 0.5, 'highpass', 1500); mnote(a, 190, t, 0.08, 'triangle', 0.4, music.master, 1500); }
    if (sub !== 1) { mnoise(a, t, 0.04, sub === 0 ? 0.16 : 0.09, 'highpass', 7000); }
    /* basso: kävelevä 1-3-5-6 */
    if (sub === 0) { var w = [0, 4, 7, 9][beat]; mnote(a, hz(E2, root + w), t, TICK * 2.6, 'sawtooth', 0.5, music.master, 600); }
    /* rytmikitara: boogie-shuffle 5 → 6 särön läpi */
    if (sub === 0 || sub === 2) {
      var up = sub === 2 ? 9 : 7, base = hz(E2 * 2, root);
      mnote(a, base, t, TICK * 1.7, 'sawtooth', 0.22, music.dist, 1800);
      mnote(a, hz(base, up), t, TICK * 1.7, 'sawtooth', 0.16, music.dist, 1800);
      mnote(a, base * 2, t, TICK * 1.7, 'square', 0.05, music.dist, 1800);
    }
    /* soolokitara: lick joka neljännen tahdin lopussa, satunnaisia täytteitä muualla */
    var lickBar = (bar % 4 === 3), fill = (bar % 2 === 1 && beat === 3 && sub === 0 && Math.random() < 0.5);
    if ((lickBar && sub === 0) || fill) {
      var n = PENTA[Math.floor(Math.random() * PENTA.length)];
      var f = hz(E2 * 4, n), o = mnote(a, f, t, TICK * (lickBar ? 2.8 : 2), 'sawtooth', 0.3, music.dist, 3000, Math.random() < 0.4 ? f * 1.06 : null);
      var lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 5.5; lg.gain.value = f * 0.012; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + TICK * 3);
    }
    /* sähköinen sirahdus tahdin alussa */
    if (tt === 0 && bar % 4 === 0) { mnoise(a, t, 0.08, 0.15, 'bandpass', 5000); }
  }
  function musicSched() {
    var a = audio; if (!a || !music.on) return;
    if (music.next < a.currentTime - 0.3) music.next = a.currentTime + 0.05;
    while (music.next < a.currentTime + 0.3) { playTick(a, music.tick, music.next); music.tick = (music.tick + 1) % 144; music.next += TICK; }
    var want = (game.muted || game.state === 'paused' || document.hidden) ? 0 : 0.22;
    music.master.gain.setTargetAtTime(want, a.currentTime, 0.05);
  }
  function musicStart() {
    var a = ac(); if (!a || music.on) return;
    musicInit(a); music.on = true; music.next = a.currentTime + 0.1; music.tick = 0; setInterval(musicSched, 60);
  }

  /* ---------- Apufunktiot ---------- */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var STOPS = [[0, [246, 231, 181]], [0.8, [224, 169, 74]], [1.0, [201, 138, 46]], [1.3, [122, 74, 28]], [1.5, [43, 27, 14]]];
  function cookColor(c) {
    c = clamp(c, 0, 1.5);
    for (var i = 1; i < STOPS.length; i++) {
      if (c <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i], t = (c - a[0]) / (b[0] - a[0]);
        return 'rgb(' + Math.round(lerp(a[1][0], b[1][0], t)) + ',' + Math.round(lerp(a[1][1], b[1][1], t)) + ',' + Math.round(lerp(a[1][2], b[1][2], t)) + ')';
      }
    }
    return 'rgb(43,27,14)';
  }
  function tri(ph) { var x = ph % 2; if (x < 0) x += 2; return x < 1 ? x : 2 - x; }
  function level() { return game.stacked; }
  function flipWindow() { return Math.max(0.07, 0.14 - 0.003 * level()); }
  function gaugeFreq() { return Math.min(1.5, 0.55 + 0.03 * level()); }
  function plateX(t) { return 735 + 70 * Math.sin(t * (0.55 + 0.012 * level())); }
  function stackSpacing() { return Math.min(9, 300 / Math.max(1, game.stack.length + 1)); }
  function stackTopY(n) { return PLATE_Y - 6 - n * stackSpacing(); }
  function idealToss() { return (plateX(game.t + TOSS_T) - PAN.x - 250) / 450; }

  function say(str, col) { game.msg = str; game.msgCol = col || '#fff'; game.msgT = 1.4; }
  function puff(x, y, col, n) { for (var i = 0; i < n; i++) game.parts.push({ x: x, y: y, vx: rnd(-130, 130), vy: rnd(-190, 20), life: rnd(0.5, 1.1), col: col, r: rnd(2, 5) }); }
  function floatText(x, y, s, c) { game.texts.push({ x: x, y: y, s: s, c: c, life: 1.2 }); }

  /* ---------- Kulku ---------- */
  function newPancake() {
    game.pancake = { x: PAN.x, y: PAN.y - 6, rot: 0, cook: [0, 0], down: 0, mode: 'pan', t: 0, T: 0, p: 0, vx: 0, vy: 0 };
    tone(220, 0.12, 'sine', 0.05, 330);
  }
  function startGame() {
    hideForm();
    game.state = 'playing'; game.t = 0; game.score = 0; game.stacked = 0; game.perfects = 0; game.lives = MAX_LIVES; game.wobble = 0;
    game.stack = []; game.parts = []; game.texts = []; game.msg = ''; game.msgT = 0; game.pendingName = false; game.lastEntry = null; game.newBest = false;
    game.reason = ''; game.shocked = 0; game.waitT = 0.2; game.pancake = null; game.endT = 0;
  }
  function endGame(reason) {
    game.state = 'over'; game.reason = reason; game.lastEntry = null;
    game.pendingName = qualifies(game.score);
    game.newBest = game.score > 0 && game.score > best();
    tone(180, 0.6, 'sawtooth', 0.12, 60);
    if (game.pendingName && nameForm) { nameForm.hidden = false; try { nameIn.value = ''; nameIn.focus(); } catch (e) {} }
  }
  function loseLife(why) {
    game.lives--; say(why, '#ff8a80'); game.shocked = 0.8; tone(150, 0.35, 'sawtooth', 0.1, 90);
    game.pancake = null;
    if (game.lives <= 0) { game.endT = 0.9; game.reason = 'Kaikki elämät menivät'; } else game.waitT = 0.8;
  }

  function doFlip() {
    var pc = game.pancake; if (game.state !== 'playing' || !pc || pc.mode !== 'pan') return;
    var p = game.forceP != null ? game.forceP : game.p;
    pc.mode = 'flip'; pc.t = 0; pc.p = p; pc.T = 0.35 + 0.9 * p; pc.hmax = 60 + 180 * p; pc.rot = 0;
    game.swing = 0.25; tone(300, 0.18, 'sine', 0.07, 700); noise(0.12, 900, 0.12);
  }
  function doToss() {
    var pc = game.pancake; if (game.state !== 'playing' || !pc || pc.mode !== 'pan') return;
    var p = game.forceP != null ? game.forceP : game.p;
    pc.mode = 'toss'; pc.t = 0; pc.p = p; pc.rot = 0;
    pc.raw = pc.cook[0] < DONE || pc.cook[1] < DONE;
    pc.fromX = pc.x; pc.fromY = pc.y; pc.toX = PAN.x + 250 + 450 * p;
    pc.toY = stackTopY(game.stack.length);
    game.swing = 0.25; tone(260, 0.25, 'sine', 0.08, 520); noise(0.15, 1200, 0.14);
  }
  function landToss(pc) {
    var px = plateX(game.t), dx = pc.toX - px;
    if (pc.raw) {
      /* Radikaali virhe: raaka räiskäle tarjolle */
      puff(pc.toX, pc.toY, '#f6e7b5', 18); noise(0.3, 500, 0.25); game.shocked = 2; game.pancake = null;
      game.state = 'ending'; game.endT = 1.2; game.reason = 'Radikaali virhe: raaka räiskäle tarjolle!';
      say('Raaka räiskäle!', '#ff8a80'); return;
    }
    if (Math.abs(dx) > PLATE_RX - 12) {
      pc.mode = 'drop'; pc.vx = (pc.toX - pc.fromX) / TOSS_T * 0.5; pc.vy = 120; return;
    }
    var perfect = pc.cook[0] >= 0.9 && pc.cook[1] >= 0.9 && pc.cook[0] <= 1.15 && pc.cook[1] <= 1.15;
    game.stack.push({ dx: dx, perfect: perfect, a: pc.cook[0], b: pc.cook[1] });
    game.stacked++; if (perfect) game.perfects++;
    var gain = 10 + (perfect ? 5 : 0); game.score += gain;
    floatText(pc.toX, pc.toY - 24, '+' + gain + (perfect ? ' täydellinen!' : ''), perfect ? '#ffd54f' : '#fff');
    var off = Math.abs(dx);
    if (off < 20) { game.wobble = Math.max(0, game.wobble - 0.12); say('Osui keskelle!', '#a5d6a7'); }
    else { game.wobble += Math.max(0, off - 25) / 100; if (off > 50) say('Pino huojuu!', '#ffcc80'); }
    tone(520, 0.1, 'triangle', 0.09); puff(pc.toX, pc.toY, '#f6e7b5', 6);
    game.pancake = null;
    if (game.wobble > 1) {
      for (var i = 0; i < game.stack.length; i++) puff(plateX(game.t) + game.stack[i].dx, stackTopY(i), '#c98a2e', 3);
      game.state = 'ending'; game.endT = 1.2; game.reason = 'Pino kaatui!'; say('Pino kaatui!', '#ff8a80'); noise(0.5, 700, 0.25);
      return;
    }
    game.waitT = 0.6;
  }

  function update(dt) {
    game.t += dt;
    if (game.flash > 0) game.flash -= dt;
    if (game.swing > 0) game.swing -= dt;
    if (game.shocked > 0) game.shocked -= dt;
    if (game.msgT > 0) game.msgT -= dt;
    game.parts.forEach(function (q) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 300 * dt; q.life -= dt; });
    game.parts = game.parts.filter(function (q) { return q.life > 0; });
    game.texts.forEach(function (q) { q.y -= 30 * dt; q.life -= dt; });
    game.texts = game.texts.filter(function (q) { return q.life > 0; });

    if (game.state === 'ending') { game.endT -= dt; if (game.endT <= 0) endGame(game.reason); return; }
    if (game.state !== 'playing') return;

    game.phase += dt * gaugeFreq() * 2; game.p = tri(game.phase);
    game.wobble = Math.max(0, game.wobble - 0.05 * dt);
    if (game.endT > 0) { game.endT -= dt; if (game.endT <= 0) endGame(game.reason); return; }
    if (!game.pancake) { game.waitT -= dt; if (game.waitT <= 0 && game.lives > 0) newPancake(); return; }

    var pc = game.pancake;
    if (pc.mode === 'pan') {
      pc.cook[pc.down] += COOK_RATE * game.cookMul * dt;
      if (Math.random() < dt * 6) game.parts.push({ x: pc.x + rnd(-40, 40), y: pc.y, vx: rnd(-10, 10), vy: rnd(-60, -20), life: 0.5, col: 'rgba(255,255,255,.5)', r: 2 });
      if (pc.cook[pc.down] > BURNT_MAX) {
        puff(pc.x, pc.y, '#222', 16); noise(0.3, 600, 0.2); loseLife('Palanut!');
      }
    } else if (pc.mode === 'flip') {
      pc.t += dt; var u = Math.min(1, pc.t / pc.T);
      pc.y = PAN.y - 6 - pc.hmax * 4 * u * (1 - u); pc.rot = OMEGA * pc.t;
      if (pc.t >= pc.T) {
        var tol = 3.54 * flipWindow(), err = Math.abs(OMEGA * pc.T - Math.PI);
        if (err <= tol) {
          pc.mode = 'pan'; pc.down = 1 - pc.down; pc.rot = 0; pc.y = PAN.y - 6; game.swing = 0.15;
          say(err < tol * 0.4 ? 'Täydellinen käännös!' : 'Hyvä käännös!', '#a5d6a7'); tone(440, 0.1, 'triangle', 0.08); noise(0.1, 700, 0.1);
        } else { pc.mode = 'drop'; pc.vx = pc.rot < Math.PI ? 140 : -140; pc.vy = 0; pc.fail = 'Räiskäle tippui!'; }
      }
    } else if (pc.mode === 'toss') {
      pc.t += dt; var v = Math.min(1, pc.t / TOSS_T);
      pc.x = lerp(pc.fromX, pc.toX, v);
      pc.y = lerp(pc.fromY, pc.toY, v) - 4 * 120 * v * (1 - v);
      pc.rot = 0.25 * Math.sin(v * Math.PI);
      if (pc.t >= TOSS_T) landToss(pc);
    } else if (pc.mode === 'drop') {
      pc.vy += 700 * dt; pc.x += pc.vx * dt; pc.y += pc.vy * dt; pc.rot += 3 * dt;
      if (pc.y > 500) { puff(pc.x, 500, '#f6e7b5', 10); noise(0.2, 500, 0.18); loseLife(pc.fail || 'Ohi lautasen!'); }
    }
  }

  /* ---------- Piirto ---------- */
  var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  (function () {
    var c = bg.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#f2dcc0'); g.addColorStop(1, '#e8c9a0');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = '#d9a87a'; for (var x = 0; x < W; x += 80) for (var y = 0; y < 300; y += 60) { c.fillRect(x + 2, y + 2, 76, 56); }
    c.fillStyle = '#efd6b8'; for (x = 0; x < W; x += 80) for (y = 0; y < 300; y += 60) { c.fillRect(x + 6, y + 6, 68, 48); }
    c.fillStyle = '#7a5a45'; c.fillRect(0, 300, W, 16);                        // hyllylista
    c.fillStyle = '#5c4033'; c.fillRect(0, 316, W, H - 316);                   // alakaapit
    c.fillStyle = '#6e4d3d'; for (x = 0; x < W; x += 160) { c.fillRect(x + 8, 330, 144, 190); }
    c.fillStyle = '#c9a66b'; for (x = 0; x < W; x += 160) { c.fillRect(x + 76, 400, 8, 24); }
    c.fillStyle = '#8c6a55'; c.fillRect(0, 430, W, 10);                        // työtaso
    c.fillStyle = '#4a3a30'; c.fillRect(0, 440, W, H - 440);
    c.fillStyle = '#2a2220'; c.fillRect(190, 396, 250, 40);                    // liesi
    c.fillStyle = '#d9534f'; c.fillRect(215, 392, 200, 8);                     // levy
  })();

  function drawPlate(px) {
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, PLATE_Y + 14, PLATE_RX + 8, 16, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ec6f9c'; ctx.beginPath(); ctx.ellipse(px, PLATE_Y + 6, PLATE_RX, PLATE_RY + 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f48fb1'; ctx.beginPath(); ctx.ellipse(px, PLATE_Y, PLATE_RX, PLATE_RY, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f8bbd0'; ctx.beginPath(); ctx.ellipse(px, PLATE_Y + 1, PLATE_RX - 14, PLATE_RY - 5, 0, 0, 7); ctx.fill();
  }
  function drawPancakeShape(x, y, rx, ry, rot, top, bot, edge) {
    var cs = Math.cos(rot), col = cs >= 0 ? cookColor(top) : cookColor(bot), e = Math.max(0.12, Math.abs(cs));
    ctx.save(); ctx.translate(x, y); ctx.rotate(edge ? 0 : 0);
    ctx.fillStyle = '#9a6a30'; ctx.beginPath(); ctx.ellipse(0, 4, rx, ry * e + 1, 0, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry * e + 1, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawStack() {
    var px = plateX(game.t), sway = Math.sin(game.t * 11) * game.wobble * 0.07;
    ctx.save(); ctx.translate(px, PLATE_Y); ctx.rotate(sway); ctx.translate(-px, -PLATE_Y);
    for (var i = 0; i < game.stack.length; i++) {
      var s = game.stack[i];
      var y = stackTopY(i), sp = stackSpacing();
      ctx.fillStyle = '#9a6a30'; ctx.beginPath(); ctx.ellipse(px + s.dx, y + 4, 56, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = cookColor(0.9 + (i % 3) * 0.05); ctx.beginPath(); ctx.ellipse(px + s.dx, y + 4 - sp / 2, 56, 12, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  function drawBob() {
    var shock = game.shocked > 0;
    ctx.save(); ctx.translate(150, 436);
    ctx.fillStyle = '#2f3b5a'; ctx.fillRect(-28, -70, 22, 70); ctx.fillRect(6, -70, 22, 70);              // housut
    ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-60, -190, 120, 130, 16) : ctx.rect(-60, -190, 120, 130); ctx.fill(); // takki
    ctx.fillStyle = '#d32f2f'; ctx.fillRect(-20, -190, 40, 10);                                              // kaulaliina
    ctx.fillStyle = '#d32f2f'; ctx.font = '900 25px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('KOKKI-', 0, -146); ctx.fillText('TOMI', 0, -116);                                        // nimi rinnassa
    ctx.fillStyle = '#f48fb1'; ctx.fillRect(-36, -102, 72, 4);
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(0, -222, 30, 0, 7); ctx.fill();                    // pää
    ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.arc(-18, -262, 16, 0, 7); ctx.arc(0, -272, 20, 0, 7); ctx.arc(18, -262, 16, 0, 7); ctx.fill();
    ctx.fillRect(-30, -262, 60, 20);                                                                         // kokinlakki
    ctx.fillStyle = '#4a3020'; ctx.beginPath(); ctx.ellipse(0, -208, 20, 7, 0, 0, 7); ctx.fill();            // viikset
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-10, -230, shock ? 4 : 3, 0, 7); ctx.arc(10, -230, shock ? 4 : 3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath();
    if (shock) { ctx.ellipse(0, -196, 6, 8, 0, 0, 7); } else { ctx.arc(0, -204, 8, 0.2, Math.PI - 0.2); }
    ctx.stroke();
    ctx.restore();
    // käsi
    ctx.strokeStyle = '#fafafa'; ctx.lineWidth = 16; ctx.lineCap = 'round';
    var ang = -game.swing * 3.2;
    ctx.beginPath(); ctx.moveTo(196, 300); ctx.lineTo(232, PAN.y + 10 + ang * 8); ctx.stroke();
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(236, PAN.y + 10 + ang * 8, 9, 0, 7); ctx.fill();
  }
  function drawPan() {
    var sw = game.swing > 0 ? -Math.sin(Math.min(1, (0.25 - game.swing) / 0.25) * Math.PI) * 0.35 : 0;
    ctx.save(); ctx.translate(236, PAN.y + 10); ctx.rotate(sw); ctx.translate(-236, -(PAN.y + 10));
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(236, PAN.y + 4, 50, 12);                                         // varsi
    ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.ellipse(PAN.x, PAN.y + 6, 88, 22, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a4a4a'; ctx.beginPath(); ctx.ellipse(PAN.x, PAN.y + 2, 84, 18, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#1f1f1f'; ctx.beginPath(); ctx.ellipse(PAN.x, PAN.y + 3, 72, 13, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawGauge() {
    var gx = 280, gy = 484, gw = 400, gh = 18, w = flipWindow();
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(gx - 6, gy - 22, gw + 12, gh + 34);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = '#66bb6a'; ctx.fillRect(gx + gw * (0.5 - w), gy, gw * 2 * w, gh);            // käännösalue
    var ip = idealToss();
    if (ip > 0 && ip < 1) { ctx.fillStyle = '#f48fb1'; ctx.fillRect(gx + gw * ip - 3, gy - 8, 6, gh + 16); }
    ctx.fillStyle = '#fff'; ctx.fillRect(gx + gw * game.p - 2, gy - 4, 4, gh + 8);
    text('käännä: vihreä   heitä: vaaleanpunainen', gx + gw / 2, gy - 8, 13, '#e7d9cf', 'center', '500');
  }
  function text(str, x, y, size, col, align, weight) {
    ctx.font = (weight || '700') + ' ' + size + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    ctx.textAlign = align || 'left'; ctx.fillStyle = col; ctx.fillText(str, x, y);
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function panel(x, y, w, h) { ctx.fillStyle = 'rgba(20,12,8,.82)'; rrect(x, y, w, h, 14); ctx.fill(); }
  function button(r, label, active, size) {
    ctx.fillStyle = active ? '#f48fb1' : 'rgba(255,255,255,.12)'; rrect(r.x, r.y, r.w, r.h, 10); ctx.fill();
    if (!active) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; rrect(r.x, r.y, r.w, r.h, 10); ctx.stroke(); }
    text(label, r.x + r.w / 2, r.y + r.h / 2 + (size || 20) * 0.35, size || 20, active ? '#1a1210' : '#fff', 'center');
  }
  var FLIP_BTN = { x: 24, y: 470, w: 230, h: 54 };
  var TOSS_BTN = { x: W - 254, y: 470, w: 230, h: 54 };
  var START_BTN = { x: W / 2 - 130, y: 360, w: 260, h: 56 };
  var BOARD_BTN = { x: W / 2 - 130, y: 424, w: 260, h: 42 };
  var BACK_BTN = { x: W / 2 - 100, y: 448, w: 200, h: 44 };
  var PLAY_BTN = { x: W / 2 - 230, y: 440, w: 220, h: 48 };
  var MENU_BTN = { x: W / 2 + 10, y: 440, w: 220, h: 48 };
  function hit(r, p) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  function drawLogo(cx, by) {
    ctx.fillStyle = '#f48fb1'; ctx.beginPath(); ctx.ellipse(cx, by + 2, 30, 8, 0, 0, 7); ctx.fill();
    for (var i = 0; i < 4; i++) {
      var y = by - 4 - i * 7;
      ctx.fillStyle = '#9a6a30'; ctx.beginPath(); ctx.ellipse(cx, y + 3, 24, 8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = cookColor(0.85 + (i % 2) * 0.1); ctx.beginPath(); ctx.ellipse(cx, y, 24, 8, 0, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#fff3a0'; rrect(cx - 7, by - 38, 14, 7, 2); ctx.fill();            // voinokare
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 12, by - 44); ctx.quadraticCurveTo(cx - 17, by - 52, cx - 12, by - 58);
    ctx.moveTo(cx + 12, by - 44); ctx.quadraticCurveTo(cx + 17, by - 52, cx + 12, by - 58); ctx.stroke(); // höyry
  }
  function drawBars() {
    var pc = game.pancake; if (!pc) return;
    var items = [['Alapuoli', pc.cook[pc.down]], ['Päällinen', pc.cook[1 - pc.down]]];
    for (var i = 0; i < 2; i++) {
      var x = 20, y = 74 + i * 34, w = 170, h = 14, c = items[i][1];
      text(items[i][0], x, y - 4, 13, '#3a2a22', 'left', '700');
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(102,187,106,.55)'; ctx.fillRect(x + w * DONE / BURNT_MAX, y, w * (BURN - DONE) / BURNT_MAX, h);
      ctx.fillStyle = 'rgba(211,47,47,.55)'; ctx.fillRect(x + w * BURN / BURNT_MAX, y, w * (BURNT_MAX - BURN) / BURNT_MAX, h);
      ctx.fillStyle = cookColor(c); ctx.fillRect(x, y, w * Math.min(1, c / BURNT_MAX), h - 4);
      ctx.strokeStyle = '#3a2a22'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    }
  }
  function drawHUD() {
    text('Pino ' + game.stacked, 20, 36, 28, '#3a2a22');
    text('Pisteet ' + game.score + '  ·  Ennätys ' + best(), W - 20, 36, 22, '#3a2a22', 'right');
    var hearts = ''; for (var i = 0; i < MAX_LIVES; i++) hearts += i < game.lives ? '♥ ' : '♡ ';
    text(hearts, W - 20, 66, 24, '#d32f2f', 'right');
    drawBars();
    if (game.msgT > 0) { ctx.globalAlpha = Math.min(1, game.msgT * 2); text(game.msg, W / 2, 110, 30, game.msgCol, 'center', '800'); ctx.globalAlpha = 1; }
    button(FLIP_BTN, 'KÄÄNNÄ (Väli)', true, 22); button(TOSS_BTN, 'HEITÄ (Enter)', true, 22);
    drawGauge();
  }
  function drawBoard(x, y, rows, step, size, hl) {
    var b = board();
    if (!b.length) { text('Ei vielä tuloksia', x, y + 10, size, '#cbbfb5', 'left', '500'); return; }
    for (var i = 0; i < Math.min(rows, b.length); i++) {
      var mine = hl && hl.n === b[i].n && hl.s === b[i].s && hl.t === b[i].t, col = mine ? '#f48fb1' : '#fff';
      text((i + 1) + '.', x, y + i * step, size, col, 'left');
      text(b[i].n, x + 40, y + i * step, size, col, 'left', mine ? '800' : '500');
      text(b[i].s + ' p', x + 330, y + i * step, size, col, 'right');
    }
  }

  function render() {
    ctx.drawImage(bg, 0, 0, W, H);
    var px = plateX(game.t);
    drawPlate(px); drawStack();
    drawBob(); drawPan();
    var pc = game.pancake;
    if (pc) {
      var top = pc.cook[1 - pc.down], bot = pc.cook[pc.down];
      drawPancakeShape(pc.x, pc.y, 54, 12, pc.rot, top, bot);
    }
    game.parts.forEach(function (q) { ctx.globalAlpha = clamp(q.life * 1.5, 0, 1); ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
    game.texts.forEach(function (q) { ctx.globalAlpha = Math.min(1, q.life * 1.5); text(q.s, q.x, q.y, 20, q.c, 'center'); });
    ctx.globalAlpha = 1;
    if (game.state === 'playing' || game.state === 'paused' || game.state === 'ending') drawHUD();

    if (game.state === 'menu') {
      panel(W / 2 - 360, 26, 720, 470);
      var ttl = 'Kokki-Tomin räiskyvät räiskäleet', tsz = 40;
      ctx.font = '800 ' + tsz + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      while (ctx.measureText(ttl).width > 480 && tsz > 20) { tsz--; ctx.font = '800 ' + tsz + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'; }
      var tw = ctx.measureText(ttl).width;
      text(ttl, W / 2, 96, tsz, '#f48fb1', 'center', '800');
      drawLogo(W / 2 - tw / 2 - 46, 106); drawLogo(W / 2 + tw / 2 + 46, 106);
      text('Paista räiskäle kypsäksi molemmilta puolilta (vihreä alue).', W / 2, 138, 19, '#fff', 'center', '500');
      text('KÄÄNNÄ: paina, kun mittarin viisari on vihreällä alueella.', W / 2, 168, 19, '#fff', 'center', '500');
      text('HEITÄ: lennätä kypsä räiskäle pinoon vaaleanpunaiselle lautaselle.', W / 2, 198, 19, '#fff', 'center', '500');
      text('Tähtää vaaleanpunaisen merkin kohdalle. Lautanen liikkuu!', W / 2, 228, 17, '#cbbfb5', 'center', '500');
      text('Raaka räiskäle tarjolle on radikaali virhe: peli päättyy heti.', W / 2, 270, 19, '#ff9e91', 'center', '700');
      text('Palanut, pudonnut tai ohi lautasen = menetät elämän (3 kpl).', W / 2, 300, 17, '#cbbfb5', 'center', '500');
      text('Pino huojuu, jos osut huonosti. Liian huojuva pino kaatuu.', W / 2, 328, 17, '#cbbfb5', 'center', '500');
      button(START_BTN, 'Aloita peli', true, 26); button(BOARD_BTN, 'Tulostaulu (T)', false, 19);
      text('Ennätys: ' + best() + ' p', W / 2, 486, 15, '#cbbfb5', 'center', '600');
    }
    if (game.state === 'scores') {
      panel(W / 2 - 300, 30, 600, 470);
      text('Tulostaulu', W / 2, 90, 36, '#f48fb1', 'center', '800');
      drawBoard(W / 2 - 185, 150, 10, 28, 20, null);
      text('Tulokset tallentuvat tämän laitteen selaimeen.', W / 2, 438 - 4, 14, '#cbbfb5', 'center', '500');
      button(BACK_BTN, 'Takaisin', true, 20);
    }
    if (game.state === 'paused') { panel(W / 2 - 200, 200, 400, 110); text('Tauko', W / 2, 252, 40, '#fff', 'center'); text('Jatka klikkaamalla', W / 2, 288, 20, '#cbbfb5', 'center', '500'); }
    if (game.state === 'over') {
      panel(W / 2 - 300, 24, 600, 484);
      text('Peli päättyi', W / 2, 78, 40, '#f48fb1', 'center', '800');
      text(game.reason, W / 2, 112, 20, '#ff9e91', 'center', '700');
      text('Pino ' + game.stacked + '  ·  Pisteet ' + game.score, W / 2, 156, 30, '#fff', 'center');
      text('Täydellisiä ' + game.perfects, W / 2, 184, 16, '#cbbfb5', 'center', '500');
      if (game.pendingName) text('Pääsit tulostaululle! Kirjoita nimesi kuvan alapuolelle.', W / 2, 214, 18, '#a5d6a7', 'center');
      else if (game.newBest) text('Uusi ennätys!', W / 2, 214, 20, '#a5d6a7', 'center');
      text('Parhaat', W / 2, 250, 16, '#f8bbd0', 'center', '600');
      drawBoard(W / 2 - 185, 280, 5, 28, 19, game.lastEntry);
      if (!game.pendingName) { button(PLAY_BTN, 'Pelaa uudelleen', true, 20); button(MENU_BTN, 'Valikko', false, 20); }
    }
  }

  /* ---------- Lomake ---------- */
  var nameForm = document.getElementById('nameform'), nameIn = document.getElementById('namein'), nameSkip = document.getElementById('nameskip');
  function hideForm() { if (nameForm) nameForm.hidden = true; }
  function finishName(save) {
    if (save) {
      var n = (nameIn.value || '').replace(/[^\wåäöÅÄÖ \-]/g, '').trim().slice(0, 12) || 'Nimetön';
      game.lastEntry = addScore(n, game.score, game.stacked);
    }
    game.pendingName = false; hideForm();
  }
  if (nameForm) {
    nameForm.addEventListener('submit', function (e) { e.preventDefault(); finishName(true); });
    nameSkip.addEventListener('click', function () { finishName(false); });
  }

  /* ---------- Syötteet ---------- */
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); ac(); musicStart(); var p = pos(e);
    if (game.state === 'menu') { if (hit(START_BTN, p)) startGame(); else if (hit(BOARD_BTN, p)) game.state = 'scores'; return; }
    if (game.state === 'scores') { if (hit(BACK_BTN, p)) game.state = 'menu'; return; }
    if (game.state === 'over') { if (game.pendingName) return; if (hit(PLAY_BTN, p)) startGame(); else if (hit(MENU_BTN, p)) game.state = 'menu'; return; }
    if (game.state === 'paused') { game.state = 'playing'; return; }
    if (game.state === 'playing') { if (hit(FLIP_BTN, p)) doFlip(); else if (hit(TOSS_BTN, p)) doToss(); }
  });
  window.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase(); ac(); musicStart();
    if (k === 'm') game.muted = !game.muted;
    else if (k === 'p') { if (game.state === 'playing') game.state = 'paused'; else if (game.state === 'paused') game.state = 'playing'; }
    else if (k === 't' && (game.state === 'menu' || (game.state === 'over' && !game.pendingName))) game.state = 'scores';
    else if (k === 'escape' && (game.state === 'scores' || (game.state === 'over' && !game.pendingName))) game.state = 'menu';
    else if (game.state === 'playing' && (k === ' ' || k === 'arrowup')) { e.preventDefault(); ac(); doFlip(); }
    else if (game.state === 'playing' && (k === 'enter' || k === 'arrowdown')) { e.preventDefault(); ac(); doToss(); }
    else if ((k === 'enter' || k === ' ') && (game.state === 'menu' || (game.state === 'over' && !game.pendingName))) { e.preventDefault(); ac(); startGame(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && game.state === 'playing') game.state = 'paused'; });

  var last = 0;
  function frame(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (game.state !== 'paused') update(dt);
    render(); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (/[?&]debug\b/.test(location.search)) { window.__game = game; window.__music = music; window.__ideal = idealToss; window.__flip = doFlip; window.__toss = doToss; }
})();
