/**
 * Snoodle Pop — an original Snood-style bubble shooter.
 * Vanilla JS, no dependencies, no assets. All art is drawn on the canvas.
 *
 * Architecture (today, one IIFE — see REVIEW.md M-1 for the planned split):
 *   Board model: grid, neighbours(), clusterAt(), dropFloating(), snapToGrid()
 *   Renderer: draw(), drawBubble(), drawAimPreview() — canvas only.
 *   Input: pointerAngle(), keydown/mouse/touch listeners.
 *   Audio/HUD: beep(), updateHud(), setStatus() — WebAudio + textContent only.
 *   State machine: state in {'playing'|'paused'|'levelClear'|'gameOver'}.
 * Patched vs baseline (28afa9d) — behaviour-preserving except M-4:
 *   Named constants + derived board origin, JSDoc, dead-code removal,
 *   one hitsBubble() helper, one stepEffects() stepper (fixes M-4 pause drift),
 *   null guard for missing canvas, auto-pause on tab hide, palette names.
 * NOT changed here (needs tests/screenshots first): module split, sprite
 * cache (M-3), DPR scaling (L-5), snap-adjacency guard (M-5). See REVIEW.md.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) { if (typeof console !== 'undefined' && console.error) console.error('Snoodle Pop: canvas #game not found, game not started'); return; }
  var W = 480, H = 640;
  var R = 24, DX = 48, DY = 42;
  var SX = 240, SY = 575;
  var DANGER_Y = 520;
  var PUSH_EVERY = 6;
  var COLS = 8;
  var BOARD_X0 = (W - COLS * DX) / 2 + R; // 72, centres the board
  var BOARD_Y0 = 68; // top margin: room for sky/clouds above row 0
  var AIM_MAX = 1.35; // radians from vertical, ~77 degrees
  var FLY_SPEED = 900; // px/s
  var POP_BASE = 10, POP_BONUS = 10, DROP_POINTS = 20;
  var LEVEL_BONUS_BASE = 100, LEVEL_BONUS_PER = 50;

  // Original blob characters — colour is the identity, face varies by colour.
  // mouth, as actually drawn: 0 smile, 1 grin, 2 open smile, 3 wavy. No colour uses 4.
  var PALETTE = [
    { name: 'red', base: '#ef4444', light: '#fca5a5', dark: '#991b1b', mouth: 0 }, // red
    { name: 'blue', base: '#3b82f6', light: '#93c5fd', dark: '#1e40af', mouth: 1 }, // blue
    { name: 'green', base: '#22c55e', light: '#86efac', dark: '#166534', mouth: 2 }, // green
    { name: 'yellow', base: '#eab308', light: '#fde047', dark: '#854d0e', mouth: 0 }, // yellow
    { name: 'purple', base: '#a855f7', light: '#d8b4fe', dark: '#6b21a8', mouth: 1 }, // purple
    { name: 'orange', base: '#f97316', light: '#fdba74', dark: '#9a3412', mouth: 3 }, // orange
  ];

  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var levelEl = document.getElementById('level');
  var pushEl = document.getElementById('pushLabel');
  var statusEl = document.getElementById('statusLabel');
  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlayTitle');
  var overlayText = document.getElementById('overlayText');
  var overlayBtn = document.getElementById('overlayBtn');
  var overlayRestart = document.getElementById('overlayRestart');

  var state = 'playing'; // playing | paused | levelClear | gameOver
  var grid = []; // rows of 8, null or colour index
  var level = 1;
  var score = 0;
  var best = 0;
  try { best = parseInt(localStorage.getItem('snoodle-best') || '0', 10) || 0; } catch (e) { best = 0; }
  var aim = 0; // radians from vertical, -1.35 .. 1.35
  var current = 0, next = 1;
  var flying = null;
  var particles = [];
  var falling = [];
  var shotsSincePush = 0;
  var soundOn = true;
  var audio = null;
  var lastTime = 0;

  function colourCount() { return Math.min(3 + level, PALETTE.length); }
  function rowCount() { return Math.min(4 + level, 8); }

  function cellX(row, col) { return BOARD_X0 + col * DX + (row % 2 ? DX / 2 : 0); }
  function cellY(row) { return BOARD_Y0 + row * DY; }
  /**
   * Hex neighbours for odd-r offset coordinates (rows alternate half a
   * cell). Even rows' upper neighbours shift left, odd rows' shift right —
   * using one case for both would connect non-adjacent bubbles.
   */
  function neighbours(row, col) {
    var even = (row % 2 === 0);
    var d = even
      ? [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]]
      : [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
    var out = [], i;
    for (i = 0; i < d.length; i++) {
      var r = row + d[i][0], c = col + d[i][1];
      if (r >= 0 && r < grid.length && c >= 0 && c < COLS) out.push([r, c]);
    }
    return out;
  }
  function boardColours() {
    var seen = {}, list = [], r, c;
    for (r = 0; r < grid.length; r++) for (c = 0; c < COLS; c++) {
      var v = grid[r][c];
      if (v !== null && v !== undefined && !seen[v]) { seen[v] = true; list.push(v); }
    }
    return list;
  }
  function randomBoardColour() {
    var list = boardColours();
    if (list.length) return list[Math.floor(Math.random() * list.length)];
    var n = colourCount();
    return Math.floor(Math.random() * n);
  }
  function randomPaletteColour() { return Math.floor(Math.random() * colourCount()); }

  function newLevel(lv) {
    level = lv;
    grid = [];
    var rows = rowCount(), r, c;
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < COLS; c++) row.push(randomPaletteColour());
      grid.push(row);
    }
    shotsSincePush = 0;
    current = randomBoardColour();
    next = randomBoardColour();
    flying = null; particles = []; falling = [];
    state = 'playing';
    hideOverlay();
    updateHud();
  }

  function newGame() {
    score = 0;
    newLevel(1);
    setStatus('Aim with your mouse or finger — click / release to shoot.');
  }

  function setStatus(t) { statusEl.textContent = t; }
  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = Math.max(best, score);
    levelEl.textContent = level;
    pushEl.textContent = 'New row in: ' + (PUSH_EVERY - shotsSincePush) + ' shot' + ((PUSH_EVERY - shotsSincePush) === 1 ? '' : 's');
  }
  function saveBest() {
    if (score > best) {
      best = score;
      try { localStorage.setItem('snoodle-best', String(best)); } catch (e) {}
    }
  }

  // --- sound: tiny WebAudio blips, no files ---
  function beep(freq, dur, type, vol) {
    if (!soundOn) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch (e) {}
  }
  function popSound(n) { beep(500 + Math.min(n, 8) * 60, 0.15, 'triangle', 0.16); beep(900, 0.08, 'sine', 0.08); }

  // --- drawing a blob ---
  /**
   * Draw one blob. Eyes look toward (lookX, lookY); mouth is per-colour data.
   * Perf note (REVIEW M-3): gradient is rebuilt every call — cache the body
   * on an offscreen canvas in the renderer split, keep eyes/mouth per-frame.
   */
  function drawBubble(x, y, ci, scale, lookX, lookY) {
    var p = PALETTE[ci], s = scale || 1, r = R * s;
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, p.light); g.addColorStop(0.55, p.base); g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.45, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
    // eyes look slightly toward aim
    var lx = (lookX || 0) * 2.5 * s, ly = (lookY || 0) * 2 * s;
    var ey = y - r * 0.18, ex = r * 0.36;
    [[-ex, 0], [ex, 0]].forEach(function (e) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x + e[0], ey, r * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath(); ctx.arc(x + e[0] + lx, ey + ly, r * 0.13, 0, Math.PI * 2); ctx.fill();
    });
    // mouth
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
    ctx.beginPath();
    if (p.mouth === 1) { // grin
      ctx.moveTo(x - r * 0.38, y + r * 0.28); ctx.quadraticCurveTo(x, y + r * 0.62, x + r * 0.38, y + r * 0.28);
    } else if (p.mouth === 2) { // open smile
      ctx.fillStyle = '#111827';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.35, r * 0.28, r * 0.18, 0, 0, Math.PI); ctx.fill();
      return;
    } else if (p.mouth === 3) { // flat / wavy
      ctx.moveTo(x - r * 0.32, y + r * 0.35);
      ctx.quadraticCurveTo(x - r * 0.16, y + r * 0.22, x, y + r * 0.35);
      ctx.quadraticCurveTo(x + r * 0.16, y + r * 0.48, x + r * 0.32, y + r * 0.35);
    } else { // smile
      ctx.moveTo(x - r * 0.32, y + r * 0.22); ctx.quadraticCurveTo(x, y + r * 0.52, x + r * 0.32, y + r * 0.22);
    }
    ctx.stroke();
  }

  function drawAimPreview() {
    if (flying || state !== 'playing') return;
    var pts = simulate();
    ctx.strokeStyle = 'rgba(15,23,42,0.55)';
    ctx.lineWidth = 3; ctx.setLineDash([2, 12]); ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
    ctx.stroke(); ctx.setLineDash([]);
  }

  /**
   * True when point (x, y) overlaps the bubble at (row, col).
   * The -4 slack is deliberate: bubbles snap into the hex grid with a
   * 4px tolerance so a fast bubble does not tunnel past a neighbour
   * between frames. Shared by simulate() and update().
   */
  function hitsBubble(x, y, row, col) {
    var dx = x - cellX(row, col), dy = y - cellY(row);
    return dx * dx + dy * dy < (2 * R - 4) * (2 * R - 4);
  }

  function simulate() {
    var x = SX, y = SY, vx = Math.sin(aim), vy = -Math.cos(aim), pts = [], i;
    for (i = 0; i < 220; i++) {
      x += vx * 10; y += vy * 10;
      if (x < R) { x = R; vx = -vx; }
      if (x > W - R) { x = W - R; vx = -vx; }
      if (y <= cellY(0)) break;
      var hit = false, r, c;
      for (r = 0; r < grid.length && !hit; r++) for (c = 0; c < COLS; c++) {
        if (grid[r][c] === null || grid[r][c] === undefined) continue;
        if (hitsBubble(x, y, r, c)) { hit = true; break; }
      }
      if (hit) break;
      if (i % 2 === 0) pts.push([x, y]);
    }
    pts.push([x, y]);
    return pts;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // sky is in CSS; draw soft clouds
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    [[70, 40, 34], [360, 26, 28], [200, 18, 22]].forEach(function (cl) {
      ctx.beginPath(); ctx.arc(cl[0], cl[1], cl[2], 0, Math.PI * 2); ctx.arc(cl[0] + 28, cl[1] + 6, cl[2] * 0.7, 0, Math.PI * 2); ctx.fill();
    });
    // danger line
    var pulse = 0.55 + 0.3 * Math.sin(Date.now() / 300);
    ctx.strokeStyle = 'rgba(220,38,38,' + pulse.toFixed(2) + ')';
    ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(8, DANGER_Y); ctx.lineTo(W - 8, DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(220,38,38,0.9)'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('⚠ DANGER', 10, DANGER_Y - 6);

    // board bubbles
    var r, c, lookX = Math.sin(aim), lookY = -Math.cos(aim);
    for (r = 0; r < grid.length; r++) for (c = 0; c < COLS; c++) {
      if (grid[r][c] !== null && grid[r][c] !== undefined) drawBubble(cellX(r, c), cellY(r), grid[r][c], 1, lookX * 0.4, 0);
    }
    // falling bubbles
    falling.forEach(function (f) { drawBubble(f.x, f.y, f.color, 1, 0, 0); });
    // particles
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = PALETTE[p.color].base;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * p.life + 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });

    drawAimPreview();

    // launcher
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.arc(SX, SY, 34, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 2; ctx.stroke();
    // barrel direction
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(SX, SY); ctx.lineTo(SX + Math.sin(aim) * 34, SY - Math.cos(aim) * 34); ctx.stroke();
    if (!flying) drawBubble(SX, SY, current, 1, lookX, lookY);
    // next bubble
    ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('NEXT', 418, SY - 34);
    drawBubble(418, SY, next, 0.62, 0, 0);
  }

  /**
   * Snap a landed bubble to the nearest EMPTY cell, allowing one row beyond
   * the board. Caveat (REVIEW M-5, not fixed here): no adjacency guard, so
   * in a sparse board a shot can snap into a hole and then drop as floating.
   */
  function snapToGrid(x, y) {
    var bestR = 0, bestC = 0, bestD = 1e9, r, c;
    // Allow one row beyond the current board, so a shot landing below
    // the lowest row still snaps to a sensible new row instead of a far slot.
    for (r = 0; r < Math.max(grid.length + 1, 1); r++) {
      for (c = 0; c < COLS; c++) {
        if (r < grid.length && grid[r][c] !== null && grid[r][c] !== undefined) continue;
        var dx = x - cellX(r, c), dy = y - cellY(r);
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestR = r; bestC = c; }
      }
    }
    // extend grid if snapping beyond current rows (should not normally happen)
    while (bestR >= grid.length) grid.push([null, null, null, null, null, null, null, null]);
    return [bestR, bestC];
  }

  /**
   * BFS flood-fill from (row, col) over same-colour bubbles. Iterative
   * (stack), not recursive, so a large cluster cannot overflow the stack.
   * Returns the cluster even when < 3 — the caller decides if it pops.
   */
  function clusterAt(row, col, colour) {
    var seen = {}, stack = [[row, col]], out = [];
    seen[row + ',' + col] = true;
    while (stack.length) {
      var cur = stack.pop(); out.push(cur);
      neighbours(cur[0], cur[1]).forEach(function (n) {
        var k = n[0] + ',' + n[1];
        if (!seen[k] && grid[n[0]][n[1]] === colour) { seen[k] = true; stack.push(n); }
      });
    }
    return out;
  }

  /**
   * Drop every bubble not connected to row 0. The ceiling is the only
   * anchor: a bubble floats iff no occupied-neighbour path leads to row 0.
   * Dropped bubbles leave the grid immediately and animate via `falling`.
   */
  function dropFloating() {
    var anchored = {}, stack = [], c;
    for (c = 0; c < COLS; c++) if (grid[0] && grid[0][c] !== null && grid[0][c] !== undefined) stack.push([0, c]);
    while (stack.length) {
      var cur = stack.pop(), k = cur[0] + ',' + cur[1];
      if (anchored[k]) continue; anchored[k] = true;
      neighbours(cur[0], cur[1]).forEach(function (n) {
        if (grid[n[0]][n[1]] !== null && grid[n[0]][n[1]] !== undefined) stack.push(n);
      });
    }
    var dropped = 0, r;
    for (r = 0; r < grid.length; r++) for (c = 0; c < COLS; c++) {
      if (grid[r][c] !== null && grid[r][c] !== undefined && !anchored[r + ',' + c]) {
        falling.push({ x: cellX(r, c), y: cellY(r), vx: (Math.random() - 0.5) * 60, vy: 0, color: grid[r][c] });
        grid[r][c] = null; dropped++;
      }
    }
    return dropped;
  }

  function burst(x, y, colour, n) {
    var i;
    for (i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 1, color: colour });
    }
  }

  /**
   * Resolve one landed shot: pop >=3, drop floating, trim empty bottom rows,
   * then win (board empty) before lose (danger crossed), then deal next.
   * Order matters: clearing the last bubble on the danger row wins.
   */
  function resolveShot(row, col) {
    var colour = grid[row][col];
    var cluster = clusterAt(row, col, colour);
    if (cluster.length >= 3) {
      cluster.forEach(function (cell) {
        burst(cellX(cell[0], cell[1]), cellY(cell[0]), colour, 8);
        grid[cell[0]][cell[1]] = null;
      });
      var gained = cluster.length * POP_BASE + (cluster.length - 3) * POP_BONUS;
      score += gained; popSound(cluster.length);
      setStatus('Popped ' + cluster.length + '! +' + gained);
      var dropped = dropFloating();
      if (dropped) {
        score += dropped * DROP_POINTS;
        setStatus('Popped ' + cluster.length + ' and dropped ' + dropped + ' floating! +' + (gained + dropped * 20));
        beep(700, 0.18, 'triangle', 0.12);
      }
    } else {
      setStatus('No match — that bubble sticks.');
    }
    trimEmptyRows();
    if (boardEmpty()) { winLevel(); return; }
    if (dangerCrossed()) { gameOver(); return; }
    current = next; next = randomBoardColour();
    updateHud(); saveBest();
  }

  function trimEmptyRows() {
    while (grid.length && grid[grid.length - 1].every(function (v) { return v === null || v === undefined; })) grid.pop();
  }
  function boardEmpty() { return grid.every(function (row) { return row.every(function (v) { return v === null || v === undefined; }); }); }
  function dangerCrossed() {
    var r, c;
    for (r = 0; r < grid.length; r++) for (c = 0; c < COLS; c++) {
      if (grid[r][c] !== null && grid[r][c] !== undefined && cellY(r) + R > DANGER_Y) return true;
    }
    return false;
  }

  /**
   * Push a new random row on top (unshift). Side effect: because cellX()
   * derives offset from row % 2, existing bubbles also shift 24px sideways
   * — intended, documented in the README, graph rewires to match.
   */
  function pushRow() {
    var row = [], c;
    for (c = 0; c < COLS; c++) row.push(randomPaletteColour());
    grid.unshift(row);
    setStatus('A new row pushed down!');
    beep(220, 0.2, 'sawtooth', 0.08);
    if (dangerCrossed()) gameOver();
    updateHud();
  }

  function winLevel() {
    saveBest(); updateHud();
    var bonus = LEVEL_BONUS_BASE + level * LEVEL_BONUS_PER;
    score += bonus; saveBest(); updateHud();
    state = 'levelClear';
    showOverlay('Level ' + level + ' cleared! 🎉', 'Bonus +' + bonus + '. Score: ' + score + '. Ready for level ' + (level + 1) + ' — more rows, more colours.', 'Next level');
    beep(523, 0.15, 'sine', 0.14); setTimeout(function () { beep(659, 0.15, 'sine', 0.14); }, 140); setTimeout(function () { beep(784, 0.25, 'sine', 0.14); }, 280);
  }
  function gameOver() {
    saveBest(); updateHud(); state = 'gameOver';
    showOverlay('Game over', 'The board crossed the danger line. Final score: ' + score + ' · Best: ' + Math.max(best, score) + '. Level reached: ' + level + '.', 'Play again');
    beep(300, 0.3, 'sawtooth', 0.12); setTimeout(function () { beep(200, 0.4, 'sawtooth', 0.12); }, 200);
  }

  function showOverlay(title, text, btn) {
    overlayTitle.textContent = title; overlayText.textContent = text; overlayBtn.textContent = btn;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  function shoot() {
    if (state !== 'playing' || flying) return;
    flying = { x: SX, y: SY, vx: Math.sin(aim) * FLY_SPEED, vy: -Math.cos(aim) * FLY_SPEED, color: current };
    beep(400, 0.08, 'square', 0.06);
  }

  /**
   * Advance particles and falling bubbles by dt. Used by BOTH the playing
   * path (via update()) and the paused path (via loop()), so the two can
   * no longer drift apart — see REVIEW M-4.
   */
  function stepEffects(dt) {
    particles.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt; p.life -= dt * 1.6; });
    particles = particles.filter(function (p) { return p.life > 0; });
    falling.forEach(function (f) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 900 * dt; });
    falling = falling.filter(function (f) { return f.y < H + 40; });
  }

  function update(dt) {
    if (flying) {
      flying.x += flying.vx * dt; flying.y += flying.vy * dt;
      if (flying.x < R) { flying.x = R; flying.vx = -flying.vx; }
      if (flying.x > W - R) { flying.x = W - R; flying.vx = -flying.vx; }
      var landed = false;
      if (flying.y <= cellY(0)) landed = true;
      if (!landed) {
        var r, c;
        for (r = 0; r < grid.length && !landed; r++) for (c = 0; c < COLS; c++) {
          if (grid[r][c] === null || grid[r][c] === undefined) continue;
          if (hitsBubble(flying.x, flying.y, r, c)) landed = true;
        }
      }
      if (landed) {
        var cell = snapToGrid(flying.x, flying.y);
        grid[cell[0]][cell[1]] = flying.color;
        flying = null;
        shotsSincePush++;
        if (shotsSincePush >= PUSH_EVERY) { shotsSincePush = 0; pushRow(); if (state !== 'playing') return; }
        resolveShot(cell[0], cell[1]);
      }
    }
    stepEffects(dt);
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (!lastTime) lastTime = t;
    var dt = Math.min((t - lastTime) / 1000, 0.05);
    lastTime = t;
    if (state === 'playing') update(dt);
    else {
      // Still animate behind overlays, with the SAME stepper as playing.
      stepEffects(dt);
    }
    draw();
  }

  // --- input ---
  function pointerAngle(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var mx = (clientX - rect.left) * (W / rect.width);
    var my = (clientY - rect.top) * (H / rect.height);
    if (my >= SY - 10) return;
    var a = Math.atan2(mx - SX, SY - my);
    aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, a));
  }
  canvas.addEventListener('mousemove', function (e) { pointerAngle(e.clientX, e.clientY); });
  canvas.addEventListener('mousedown', function (e) { pointerAngle(e.clientX, e.clientY); shoot(); });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); pointerAngle(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchend', function (e) { e.preventDefault(); shoot(); }, { passive: false });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') aim = Math.max(-AIM_MAX, aim - 0.07);
    if (e.key === 'ArrowRight') aim = Math.min(AIM_MAX, aim + 0.07);
    if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); shoot(); }
    if (e.key === 's' || e.key === 'S') swap();
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === 'r' || e.key === 'R') newGame();
    if (e.key === 'm' || e.key === 'M') toggleSound();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') togglePause();
  });

  function swap() {
    if (state !== 'playing' || flying) return;
    var t = current; current = next; next = t; beep(600, 0.06, 'sine', 0.08);
  }
  function toggleSound() {
    soundOn = !soundOn;
    document.getElementById('soundBtn').textContent = soundOn ? '🔊 Sound' : '🔇 Muted';
  }
  function togglePause() {
    if (state === 'playing') { state = 'paused'; showOverlay('Paused', 'Score: ' + score + ' · Level: ' + level, 'Resume'); document.getElementById('pauseBtn').textContent = '▶ Resume'; }
    else if (state === 'paused') { state = 'playing'; hideOverlay(); document.getElementById('pauseBtn').textContent = '⏸ Pause'; }
  }

  document.getElementById('swapBtn').addEventListener('click', swap);
  document.getElementById('soundBtn').addEventListener('click', toggleSound);
  document.getElementById('pauseBtn').addEventListener('click', togglePause);
  document.getElementById('restartBtn').addEventListener('click', newGame);
  overlayBtn.addEventListener('click', function () {
    if (state === 'paused') togglePause();
    else if (state === 'levelClear') newLevel(level + 1);
    else if (state === 'gameOver') newGame();
  });
  overlayRestart.addEventListener('click', newGame);

  newGame();
  requestAnimationFrame(loop);
})();
