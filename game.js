// Snoodle Pop — an original Snood-style bubble shooter.
// Vanilla JS, no dependencies, no assets. All art is drawn on the canvas.
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = 480, H = 640;
  var R = 24, DX = 48, DY = 42;
  var SX = 240, SY = 575;
  var DANGER_Y = 520;
  var PUSH_EVERY = 6;

  // Original blob characters — colour is the identity, face varies by colour.
  // mouth: 0 smile, 1 grin, 2 open smile, 3 flat, 4 wavy
  var PALETTE = [
    { base: '#ef4444', light: '#fca5a5', dark: '#991b1b', mouth: 0 }, // red
    { base: '#3b82f6', light: '#93c5fd', dark: '#1e40af', mouth: 1 }, // blue
    { base: '#22c55e', light: '#86efac', dark: '#166534', mouth: 2 }, // green
    { base: '#eab308', light: '#fde047', dark: '#854d0e', mouth: 0 }, // yellow
    { base: '#a855f7', light: '#d8b4fe', dark: '#6b21a8', mouth: 1 }, // purple
    { base: '#f97316', light: '#fdba74', dark: '#9a3412', mouth: 3 }, // orange
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

  function cellX(row, col) { return 72 + col * DX + (row % 2 ? DX / 2 : 0); }
  function cellY(row) { return 68 + row * DY; }
  function validCell(row, col) {
    return row >= 0 && row < grid.length && col >= 0 && col < 8 && grid[row][col] !== undefined;
  }
  function neighbours(row, col) {
    var even = (row % 2 === 0);
    var d = even
      ? [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]]
      : [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
    var out = [], i;
    for (i = 0; i < d.length; i++) {
      var r = row + d[i][0], c = col + d[i][1];
      if (r >= 0 && r < grid.length && c >= 0 && c < 8) out.push([r, c]);
    }
    return out;
  }
  function boardColours() {
    var seen = {}, list = [], r, c;
    for (r = 0; r < grid.length; r++) for (c = 0; c < 8; c++) {
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
      for (c = 0; c < 8; c++) row.push(randomPaletteColour());
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

  function simulate() {
    var x = SX, y = SY, vx = Math.sin(aim), vy = -Math.cos(aim), pts = [], i;
    for (i = 0; i < 220; i++) {
      x += vx * 10; y += vy * 10;
      if (x < R) { x = R; vx = -vx; }
      if (x > W - R) { x = W - R; vx = -vx; }
      if (y <= cellY(0)) break;
      var hit = false, r, c;
      for (r = 0; r < grid.length && !hit; r++) for (c = 0; c < 8; c++) {
        if (grid[r][c] === null || grid[r][c] === undefined) continue;
        var dx = x - cellX(r, c), dy = y - cellY(r);
        if (dx * dx + dy * dy < (2 * R - 4) * (2 * R - 4)) { hit = true; break; }
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
    for (r = 0; r < grid.length; r++) for (c = 0; c < 8; c++) {
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

  function snapToGrid(x, y) {
    var bestR = 0, bestC = 0, bestD = 1e9, r, c;
    // Allow one row beyond the current board, so a shot landing below
    // the lowest row still snaps to a sensible new row instead of a far slot.
    for (r = 0; r < Math.max(grid.length + 1, 1); r++) {
      for (c = 0; c < 8; c++) {
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

  function clusterAt(row, col, colour) {
    var seen = {}, stack = [[row, col]], out = [], key;
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

  function dropFloating() {
    var anchored = {}, stack = [], c;
    for (c = 0; c < 8; c++) if (grid[0] && grid[0][c] !== null && grid[0][c] !== undefined) stack.push([0, c]);
    while (stack.length) {
      var cur = stack.pop(), k = cur[0] + ',' + cur[1];
      if (anchored[k]) continue; anchored[k] = true;
      neighbours(cur[0], cur[1]).forEach(function (n) {
        if (grid[n[0]][n[1]] !== null && grid[n[0]][n[1]] !== undefined) stack.push(n);
      });
    }
    var dropped = 0, r;
    for (r = 0; r < grid.length; r++) for (c = 0; c < 8; c++) {
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

  function resolveShot(row, col) {
    var colour = grid[row][col];
    var cluster = clusterAt(row, col, colour);
    if (cluster.length >= 3) {
      cluster.forEach(function (cell) {
        burst(cellX(cell[0], cell[1]), cellY(cell[0]), colour, 8);
        grid[cell[0]][cell[1]] = null;
      });
      var gained = cluster.length * 10 + (cluster.length - 3) * 10;
      score += gained; popSound(cluster.length);
      setStatus('Popped ' + cluster.length + '! +' + gained);
      var dropped = dropFloating();
      if (dropped) {
        score += dropped * 20;
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
    for (r = 0; r < grid.length; r++) for (c = 0; c < 8; c++) {
      if (grid[r][c] !== null && grid[r][c] !== undefined && cellY(r) + R > DANGER_Y) return true;
    }
    return false;
  }

  function pushRow() {
    var row = [], c;
    for (c = 0; c < 8; c++) row.push(randomPaletteColour());
    grid.unshift(row);
    setStatus('A new row pushed down!');
    beep(220, 0.2, 'sawtooth', 0.08);
    if (dangerCrossed()) gameOver();
    updateHud();
  }

  function winLevel() {
    saveBest(); updateHud();
    var bonus = 100 + level * 50;
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
    flying = { x: SX, y: SY, vx: Math.sin(aim) * 900, vy: -Math.cos(aim) * 900, color: current };
    beep(400, 0.08, 'square', 0.06);
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
        for (r = 0; r < grid.length && !landed; r++) for (c = 0; c < 8; c++) {
          if (grid[r][c] === null || grid[r][c] === undefined) continue;
          var dx = flying.x - cellX(r, c), dy = flying.y - cellY(r);
          if (dx * dx + dy * dy < (2 * R - 4) * (2 * R - 4)) landed = true;
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
    particles.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt; p.life -= dt * 1.6; });
    particles = particles.filter(function (p) { return p.life > 0; });
    falling.forEach(function (f) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 900 * dt; });
    falling = falling.filter(function (f) { return f.y < H + 40; });
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (!lastTime) lastTime = t;
    var dt = Math.min((t - lastTime) / 1000, 0.05);
    lastTime = t;
    if (state === 'playing') update(dt);
    else {
      // still animate particles/falling behind overlays
      particles.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.6; });
      particles = particles.filter(function (p) { return p.life > 0; });
      falling.forEach(function (f) { f.y += f.vy * dt; f.vy += 900 * dt; });
      falling = falling.filter(function (f) { return f.y < H + 40; });
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
    aim = Math.max(-1.35, Math.min(1.35, a));
  }
  canvas.addEventListener('mousemove', function (e) { pointerAngle(e.clientX, e.clientY); });
  canvas.addEventListener('mousedown', function (e) { pointerAngle(e.clientX, e.clientY); shoot(); });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); pointerAngle(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('touchend', function (e) { e.preventDefault(); shoot(); }, { passive: false });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') aim = Math.max(-1.35, aim - 0.07);
    if (e.key === 'ArrowRight') aim = Math.min(1.35, aim + 0.07);
    if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); shoot(); }
    if (e.key === 's' || e.key === 'S') swap();
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === 'r' || e.key === 'R') newGame();
    if (e.key === 'm' || e.key === 'M') toggleSound();
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
