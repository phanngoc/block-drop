/* game.js — vẽ + input. Toàn bộ luật nằm ở engine.js; file này chỉ biến state
   thành pixel và biến ngón tay thành lời gọi engine.

   Quy tắc hiệu năng (bài học tank-battle): KHÔNG cấp phát trong vòng lặp render.
   Hạt, chữ nổi, vệt sáng đều là pool cấp phát sẵn; gradient cache theo layout. */
'use strict';
(function () {

  var E = window.BlockDrop;
  var COLS = E.COLS, ROWS = E.ROWS, LEAF_BIT = E.LEAF_BIT;

  // ── tham số hiển thị ───────────────────────────────────────────────────
  var DPR_CAP    = 2;      // cap DPR — hơn nữa chỉ tốn fill rate trên mobile
  var SHAKE_HARD = 5;      // px rung khi thả nhanh
  var SHAKE_BIG  = 13;     // px rung khi tetris / all clear
  var SHAKE_DECAY= 0.86;   // hệ số tắt rung mỗi frame
  var POP_TTL    = 1150;   // ms chữ nổi tồn tại
  var FLASH_TTL  = 260;    // ms hàng dọn nháy trắng
  var TRAIL_TTL  = 220;    // ms vệt thả nhanh
  var PART_MAX   = 300;    // hạt trong pool
  var POP_MAX    = 8;
  var FLASH_MAX  = 6;
  var TRAIL_MAX  = 4;
  var GRAV_PART  = 0.0016; // px/ms^2 cho hạt

  var COLORS = [
    '#000000',
    '#35d0e0',  // 1 I
    '#f5b53d',  // 2 O
    '#8a4ff5',  // 3 T
    '#46d76a',  // 4 S
    '#ef4c8e',  // 5 Z
    '#3d7bf5',  // 6 J
    '#f2762a'   // 7 L
  ];
  var GHOST = '#4fe07a';

  // ── DOM ────────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  var boardbox = $('boardbox'), cv = $('board'), ctx = cv.getContext('2d');
  var nextCv = $('next'), nctx = nextCv.getContext('2d');
  var rail = $('rail'), stage = document.querySelector('.stage');
  var track = $('track'), knob = $('knob'), trackFill = $('trackFill');
  var elScore = $('vScore'), elLevel = $('vLevel'), elLines = $('vLines');
  var elLvNum = $('vLvNum'), elLvProg = $('vLvProg'), elLvFill = $('vLvFill');
  var elCombo = $('vCombo'), comboPanel = $('comboPanel');
  var elLeaf = $('vLeaf'), elPower = $('vPower'), leafChip = $('leafChip');
  var chipScore = $('chipScore'), chipLevel = $('chipLevel'), chipLines = $('chipLines');

  var sfx = new window.Sfx();
  var holo = new window.Hologram($('holo'), $('holoSay'), $('holoSparks'));

  // ── lưu trữ ────────────────────────────────────────────────────────────
  var SKEY = 'blockdrop.v1';
  var save = { best: 0, bestCombo: 0, games: 0, lines: 0, sound: true };
  try {
    var raw = localStorage.getItem(SKEY);
    if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') {
      save.best = o.best | 0; save.bestCombo = o.bestCombo | 0;
      save.games = o.games | 0; save.lines = o.lines | 0;
      save.sound = o.sound !== false;
    } }
  } catch (e) {}

  function persist() {
    try { localStorage.setItem(SKEY, JSON.stringify(save)); } catch (e) {}
    if (window.ArcadeGame) window.ArcadeGame.syncSave(save);
  }
  // Save từ platform về (chơi máy khác): chỉ lấy phần tốt hơn, không ghi đè bừa.
  window.__arcadeApplyRemote = function (d) {
    if (!d || typeof d !== 'object') return;
    if ((d.best | 0) > save.best) save.best = d.best | 0;
    if ((d.bestCombo | 0) > save.bestCombo) save.bestCombo = d.bestCombo | 0;
    save.games = Math.max(save.games, d.games | 0);
    save.lines = Math.max(save.lines, d.lines | 0);
    paintStartCard();
  };

  // ── state ──────────────────────────────────────────────────────────────
  var s = E.create((Math.random() * 0xffffffff) >>> 0);
  var running = false, started = false;
  var CELL = 24, BW = 0, BH = 0, dpr = 1;
  var EV = [];                       // mảng sự kiện dùng lại mỗi frame
  var dragging = false, dragT = 0.5;
  var shake = 0, boardFlash = 0, comboAura = 0;
  var lastScore = 0;

  // pool hiệu ứng
  var parts = new Array(PART_MAX), pops = new Array(POP_MAX),
      flashes = new Array(FLASH_MAX), trails = new Array(TRAIL_MAX);
  (function initPools() {
    var i;
    for (i = 0; i < PART_MAX; i++) parts[i] = { on: 0, x: 0, y: 0, vx: 0, vy: 0, t: 0, ttl: 0, sz: 0, c: '#fff', sq: 1 };
    for (i = 0; i < POP_MAX; i++) pops[i] = { on: 0, txt: '', x: 0, y: 0, t: 0, ttl: 0, c: '#fff', sz: 1, big: 0 };
    for (i = 0; i < FLASH_MAX; i++) flashes[i] = { on: 0, row: 0, t: 0 };
    for (i = 0; i < TRAIL_MAX; i++) trails[i] = { on: 0, x: 0, y0: 0, y1: 0, w: 0, t: 0, c: '#fff' };
  })();

  function addPart(x, y, vx, vy, ttl, sz, c, sq) {
    var i, p;
    for (i = 0; i < PART_MAX; i++) {
      p = parts[i];
      if (p.on) continue;
      p.on = 1; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.t = 0; p.ttl = ttl; p.sz = sz; p.c = c; p.sq = sq ? 1 : 0;
      return;
    }
  }
  function addPop(txt, cx, cy, c, big) {
    var i, p, oldest = 0, oldT = -1;
    for (i = 0; i < POP_MAX; i++) if (!pops[i].on) { p = pops[i]; break; }
    if (!p) {                                     // hết chỗ: đạp cái già nhất
      for (i = 0; i < POP_MAX; i++) if (pops[i].t > oldT) { oldT = pops[i].t; oldest = i; }
      p = pops[oldest];
    }
    p.on = 1; p.txt = txt; p.x = cx; p.y = cy; p.t = 0; p.ttl = POP_TTL;
    p.c = c || '#fff'; p.big = big ? 1 : 0;
  }
  function addFlash(row) {
    var i;
    for (i = 0; i < FLASH_MAX; i++) if (!flashes[i].on) { flashes[i].on = 1; flashes[i].row = row; flashes[i].t = 0; return; }
  }
  function addTrail(x, y0, y1, w, c) {
    var i;
    for (i = 0; i < TRAIL_MAX; i++) if (!trails[i].on) {
      trails[i].on = 1; trails[i].x = x; trails[i].y0 = y0; trails[i].y1 = y1;
      trails[i].w = w; trails[i].t = 0; trails[i].c = c; return;
    }
  }

  /** Nổ tung một hàng vừa bị dọn: mỗi ô thành vài hạt mang màu của ô đó. */
  function burstRow(row, snap, power) {
    var x, cell, cx, cy, k, n = power ? 5 : 4;
    for (x = 0; x < COLS; x++) {
      cell = snap[x]; if (!cell) continue;
      cx = (x + 0.5) * CELL; cy = (row + 0.5) * CELL;
      for (k = 0; k < n; k++) {
        addPart(cx + (Math.random() - 0.5) * CELL, cy + (Math.random() - 0.5) * CELL,
          (Math.random() - 0.5) * 0.42, -Math.random() * 0.5 - 0.05,
          520 + Math.random() * 420, CELL * (0.16 + Math.random() * 0.2),
          COLORS[cell & 7], 1);
      }
      if (cell & LEAF_BIT) {
        for (k = 0; k < 6; k++) {
          addPart(cx, cy, (Math.random() - 0.5) * 0.5, -Math.random() * 0.6,
            700 + Math.random() * 400, CELL * 0.16, '#7bee9a', 0);
        }
      }
    }
  }

  function sparkle(cx, cy, n, c) {
    var k, a, v;
    for (k = 0; k < n; k++) {
      a = Math.random() * Math.PI * 2; v = 0.15 + Math.random() * 0.45;
      addPart(cx, cy, Math.cos(a) * v, Math.sin(a) * v - 0.1,
        520 + Math.random() * 380, CELL * (0.1 + Math.random() * 0.16), c, 0);
    }
  }

  // ── layout ─────────────────────────────────────────────────────────────
  var GRAD = new Array(8), NGRAD = new Array(8), NSZ = 0;
  var BEAMG = null, TRAILG = null, AURAG = null;   // gradient toàn bàn, cache theo layout

  /** Gradient cache theo layout — tạo mỗi frame là nguyên nhân giật số 1. */
  function buildGrads(c, arr, sz) {
    var i, g;
    for (i = 1; i <= 7; i++) {
      g = c.createLinearGradient(0, 0, 0, sz);
      g.addColorStop(0, shade(COLORS[i], 1.32));
      g.addColorStop(0.5, COLORS[i]);
      g.addColorStop(1, shade(COLORS[i], 0.7));
      arr[i] = g;
    }
  }
  function shade(hex, f) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.round(r * f)); g = Math.min(255, Math.round(g * f)); b = Math.min(255, Math.round(b * f));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var railW = rail.offsetWidth || 100;
    var availW = stage.clientWidth - railW - 8 - 4;      // 8 gap, 4 viền bàn
    var availH = stage.clientHeight - 4;
    if (availW < 40 || availH < 40) return;
    CELL = Math.max(12, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    BW = CELL * COLS; BH = CELL * ROWS;

    cv.style.width = BW + 'px'; cv.style.height = BH + 'px';
    cv.width = Math.round(BW * dpr); cv.height = Math.round(BH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardbox.style.width = (BW + 4) + 'px';
    boardbox.style.height = (BH + 4) + 'px';
    rail.style.height = (BH + 4) + 'px';

    var nw = Math.max(52, rail.clientWidth - 10), nh = Math.round(nw * 0.52);
    nextCv.style.width = nw + 'px'; nextCv.style.height = nh + 'px';
    nextCv.width = Math.round(nw * dpr); nextCv.height = Math.round(nh * dpr);
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    NSZ = Math.min((nw - 10) / 4, (nh - 8) / 2, CELL * 0.92);
    KNOB_R = (knob.offsetWidth || 42) / 2;
    buildGrads(ctx, GRAD, CELL);
    buildGrads(nctx, NGRAD, NSZ);
    BEAMG = ctx.createLinearGradient(0, 0, 0, BH);
    BEAMG.addColorStop(0, 'rgba(120,255,170,0)');
    BEAMG.addColorStop(1, 'rgba(120,255,170,.15)');
    TRAILG = ctx.createLinearGradient(0, 0, 0, BH);
    TRAILG.addColorStop(0, 'rgba(255,255,255,0)');
    TRAILG.addColorStop(1, 'rgba(255,255,255,.85)');
    AURAG = ctx.createLinearGradient(0, BH, 0, BH * 0.4);
    AURAG.addColorStop(0, 'rgba(255,208,106,.55)');
    AURAG.addColorStop(1, 'rgba(255,208,106,0)');
    syncKnob(true);
    drawNext();
  }

  // ── vẽ ô ───────────────────────────────────────────────────────────────
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawLeaf(c, sz) {
    c.save();
    c.translate(sz * 0.5, sz * 0.5);
    c.rotate(-0.6);
    var w = sz * 0.26, hh = sz * 0.27;
    c.beginPath();                                   // phiến lá: hai cung gặp nhau ở hai đầu nhọn
    c.moveTo(0, -hh);
    c.quadraticCurveTo(w, -hh * 0.1, 0, hh);
    c.quadraticCurveTo(-w, -hh * 0.1, 0, -hh);
    c.closePath();
    c.fillStyle = 'rgba(255,255,255,.92)'; c.fill();
    c.beginPath();                                   // gân giữa + cuống
    c.moveTo(0, -hh * 0.85); c.lineTo(0, hh * 1.25);
    c.strokeStyle = 'rgba(24,84,46,.8)';
    c.lineWidth = Math.max(1, sz * 0.045);
    c.stroke();
    c.restore();
  }

  /** Một viên gạch. gx,gy = toạ độ ô; sz = cỡ ô px; g = bộ gradient của canvas đó. */
  function cell(c, gx, gy, v, alpha, sz, g) {
    var ci = v & 7;
    var r = Math.max(2, sz * 0.18), inset = Math.max(1, sz * 0.045);
    c.save();
    if (alpha !== undefined && alpha !== 1) c.globalAlpha = alpha;
    c.translate(gx * sz, gy * sz);
    // thân
    rr(c, 0, 0, sz, sz, r);
    c.fillStyle = g[ci] || COLORS[ci];
    c.fill();
    // gờ sáng trên
    rr(c, inset * 1.6, inset * 1.4, sz - inset * 3.2, sz * 0.26, r * 0.5);
    c.fillStyle = 'rgba(255,255,255,.34)';
    c.fill();
    // viền
    rr(c, inset / 2, inset / 2, sz - inset, sz - inset, r);
    c.strokeStyle = 'rgba(0,0,0,.42)';
    c.lineWidth = Math.max(1, sz * 0.06);
    c.stroke();
    if (v & LEAF_BIT) drawLeaf(c, sz);
    c.restore();
  }

  function drawGridBg() {
    var i, x, y;
    ctx.fillStyle = '#221a4b';
    ctx.fillRect(0, 0, BW, BH);
    // vệt sáng dọc mờ như trong ảnh mẫu
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 1; i < COLS; i++) { x = Math.round(i * CELL) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, BH); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath();
    for (i = 1; i < ROWS; i++) { y = Math.round(i * CELL) + 0.5; ctx.moveTo(0, y); ctx.lineTo(BW, y); }
    ctx.stroke();
    // vạch nguy hiểm
    y = Math.round(E.DANGER_ROWS * CELL) + 0.5;
    ctx.strokeStyle = s.danger ? 'rgba(255,93,110,.55)' : 'rgba(255,93,110,.16)';
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(BW, y); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawStack() {
    var x, y, v;
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      v = s.grid[y * COLS + x];
      if (v) cell(ctx, x, y, v, 1, CELL, GRAD);
    }
  }

  function drawGhostAndPiece(now) {
    var p = s.piece; if (!p) return;
    var gy = E.ghostY(s), x, y, w = E.pieceW(p);

    // cột đích: dải sáng dọc để mắt bám được thanh kéo
    ctx.fillStyle = BEAMG;
    ctx.fillRect(p.x * CELL, p.y * CELL, w * CELL, (gy + p.m.length - p.y) * CELL);

    // bóng đáp — viền xanh như ảnh mẫu
    if (gy !== p.y) {
      ctx.save();
      ctx.strokeStyle = GHOST;
      ctx.shadowColor = GHOST; ctx.shadowBlur = CELL * 0.35;
      ctx.lineWidth = Math.max(1.5, CELL * 0.09);
      for (y = 0; y < p.m.length; y++) for (x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x]) continue;
        rr(ctx, (p.x + x) * CELL + 2, (gy + y) * CELL + 2, CELL - 4, CELL - 4, Math.max(2, CELL * 0.16));
        ctx.stroke();
      }
      ctx.restore();
    }

    // khối đang rơi + hào quang
    var pulse = 0.5 + 0.5 * Math.sin(now / 190);
    ctx.save();
    ctx.shadowColor = COLORS[p.c]; ctx.shadowBlur = CELL * (0.3 + 0.22 * pulse);
    for (y = 0; y < p.m.length; y++) for (x = 0; x < p.m[y].length; x++) {
      if (!p.m[y][x]) continue;
      if (p.y + y < 0) continue;
      cell(ctx, p.x + x, p.y + y, p.c | (p.leaf && p.leaf[y][x] ? LEAF_BIT : 0), 1, CELL, GRAD);
    }
    ctx.restore();

    // sắp khoá: nháy viền trắng cho biết
    if (s.grounded) {
      var k = s.lockAcc / E.LOCK_DELAY;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.5 * k;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, CELL * 0.06);
      for (y = 0; y < p.m.length; y++) for (x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x] || p.y + y < 0) continue;
        rr(ctx, (p.x + x) * CELL + 1, (p.y + y) * CELL + 1, CELL - 2, CELL - 2, Math.max(2, CELL * 0.16));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawEffects(dt, now) {
    var i, p, k, f, t;

    // vệt thả nhanh
    for (i = 0; i < TRAIL_MAX; i++) {
      t = trails[i]; if (!t.on) continue;
      t.t += dt;
      if (t.t >= TRAIL_TTL) { t.on = 0; continue; }
      k = 1 - t.t / TRAIL_TTL;
      ctx.save();
      ctx.globalAlpha = k * 0.5;
      ctx.fillStyle = TRAILG;
      ctx.fillRect(t.x * CELL + CELL * 0.1, t.y0 * CELL, t.w * CELL - CELL * 0.2, (t.y1 - t.y0) * CELL);
      ctx.restore();
    }

    // hàng dọn nháy trắng
    for (i = 0; i < FLASH_MAX; i++) {
      f = flashes[i]; if (!f.on) continue;
      f.t += dt;
      if (f.t >= FLASH_TTL) { f.on = 0; continue; }
      k = 1 - f.t / FLASH_TTL;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = CELL * 0.8 * k;
      ctx.fillRect(0, f.row * CELL + CELL * (1 - k) * 0.5, BW, CELL * k);
      ctx.restore();
    }

    // hạt
    for (i = 0; i < PART_MAX; i++) {
      p = parts[i]; if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.ttl) { p.on = 0; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV_PART * dt;
      k = 1 - p.t / p.ttl;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.fillStyle = p.c;
      if (p.sq) {
        ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz * k + 1, p.sz * k + 1);
      } else {
        ctx.shadowColor = p.c; ctx.shadowBlur = p.sz * 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6, p.sz * 0.5 * k), 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }

    // chữ nổi
    for (i = 0; i < POP_MAX; i++) {
      p = pops[i]; if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.ttl) { p.on = 0; continue; }
      k = p.t / p.ttl;
      var sc = k < 0.16 ? (k / 0.16) * 1.25 : 1.25 - Math.min(1, (k - 0.16) / 0.24) * 0.25;
      var fs = (p.big ? CELL * 0.86 : CELL * 0.56) * sc;
      ctx.save();
      ctx.globalAlpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      ctx.translate(p.x, p.y - k * CELL * 1.5);
      ctx.font = '900 ' + fs.toFixed(1) + 'px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, fs * 0.14); ctx.strokeStyle = 'rgba(20,8,40,.9)';
      ctx.strokeText(p.txt, 0, 0);
      ctx.shadowColor = p.c; ctx.shadowBlur = fs * 0.5;
      ctx.fillStyle = p.c;
      ctx.fillText(p.txt, 0, 0);
      ctx.restore();
    }

    // loé sáng toàn bàn (tetris / all clear)
    if (boardFlash > 0) {
      boardFlash -= dt;
      if (boardFlash < 0) boardFlash = 0;
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, boardFlash / 300);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, BW, BH);
      ctx.restore();
    }

    // hào quang combo
    if (comboAura > 0) {
      comboAura -= dt;
      if (comboAura < 0) comboAura = 0;
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, comboAura / 700);
      ctx.fillStyle = AURAG; ctx.fillRect(0, 0, BW, BH);
      ctx.restore();
    }
  }

  function drawNext() {
    var p = s.next;
    nctx.clearRect(0, 0, nextCv.width / dpr, nextCv.height / dpr);
    if (!p || !NSZ) return;
    var w = nextCv.width / dpr, h = nextCv.height / dpr;
    var cw = p.m[0].length, ch = p.m.length, x, y;
    nctx.save();
    nctx.translate((w - NSZ * cw) / 2, (h - NSZ * ch) / 2);
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
      if (!p.m[y][x]) continue;
      cell(nctx, x, y, p.c | (p.leaf && p.leaf[y][x] ? LEAF_BIT : 0), 1, NSZ, NGRAD);
    }
    nctx.restore();
  }

  // ── HUD ────────────────────────────────────────────────────────────────
  function bump(el) {
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  }
  function hud() {
    if (s.score !== lastScore) { elScore.textContent = s.score; bump(chipScore); lastScore = s.score; }
    elLevel.textContent = s.level; elLines.textContent = s.lines;
    elLvNum.textContent = s.level;
    var into = s.score % E.LEVEL_SCORE;
    elLvProg.textContent = into + ' / ' + E.LEVEL_SCORE;
    elLvFill.style.width = (into / E.LEVEL_SCORE * 100).toFixed(1) + '%';
    elCombo.textContent = '×' + s.combo;
    elLeaf.textContent = s.leaf + '/' + E.LEAF_NEED;
    elPower.textContent = '×' + s.power;
    if (s.power > 0) leafChip.classList.add('ready'); else leafChip.classList.remove('ready');
  }

  // ── thanh kéo ──────────────────────────────────────────────────────────
  /* Tâm núm chỉ chạy trong [R, W-R]: nếu ánh xạ thẳng 0..W thì ở hai đầu núm
     trèo ra ngoài dây và đè lên bánh vàng — vừa xấu vừa ăn mất vùng chạm. */
  var KNOB_R = 21;
  function knobPx(t) { return KNOB_R + t * Math.max(1, track.clientWidth - KNOB_R * 2); }
  function putKnob(t) {
    var px = knobPx(t);
    knob.style.left = px + 'px';
    trackFill.style.width = px + 'px';
  }
  function syncKnob(force) {
    if (dragging && !force) return;
    putKnob(E.knobT(s));
  }
  function knobFromEvent(ev) {
    var r = track.getBoundingClientRect();
    var t = (ev.clientX - r.left - KNOB_R) / Math.max(1, r.width - KNOB_R * 2);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  track.addEventListener('pointerdown', function (ev) {
    if (!running) return;
    dragging = true; knob.classList.add('drag');
    track.setPointerCapture(ev.pointerId);
    dragT = knobFromEvent(ev);
    putKnob(dragT);
    ev.preventDefault();
  });
  track.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    dragT = knobFromEvent(ev);
    putKnob(dragT);
    ev.preventDefault();
  });
  function endDrag(ev) {
    if (!dragging) return;
    dragging = false; knob.classList.remove('drag');
    if (ev && ev.pointerId !== undefined && track.hasPointerCapture(ev.pointerId)) track.releasePointerCapture(ev.pointerId);
    syncKnob(true);
  }
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  $('pulL').addEventListener('click', function () { if (running) { E.nudge(s, -1); sfx.move(); syncKnob(true); } });
  $('pulR').addEventListener('click', function () { if (running) { E.nudge(s, 1); sfx.move(); syncKnob(true); } });

  // ── input khác ─────────────────────────────────────────────────────────
  cv.addEventListener('pointerdown', function (ev) {
    if (!running) return;
    EV.length = 0; E.rotate(s, EV);
    consume(EV);
    drawNext();
    ev.preventDefault();
  });
  $('btnDrop').addEventListener('click', function () {
    if (!running) return;
    EV.length = 0; E.hardDrop(s, EV); consume(EV); drawNext();
  });
  leafChip.addEventListener('click', function () {
    if (!running) return;
    EV.length = 0;
    if (!E.usePower(s, EV)) { sfx.blocked(); return; }
    consume(EV);
  });
  window.addEventListener('keydown', function (ev) {
    if (!running) {
      if (ev.code === 'Space' || ev.code === 'Enter') { if (!started) start(); }
      return;
    }
    EV.length = 0;
    switch (ev.code) {
      case 'ArrowLeft':  E.nudge(s, -1); sfx.move(); syncKnob(true); break;
      case 'ArrowRight': E.nudge(s, 1);  sfx.move(); syncKnob(true); break;
      case 'ArrowUp': case 'KeyX': E.rotate(s, EV); break;
      case 'Space': case 'ArrowDown': E.hardDrop(s, EV); break;
      case 'KeyZ': E.usePower(s, EV); break;
      case 'KeyP': case 'Escape': pause(); return;
      default: return;
    }
    ev.preventDefault();
    consume(EV); drawNext();
  });

  // ── xử lý sự kiện engine -> hiệu ứng ───────────────────────────────────
  function consume(ev) {
    var i, e, cx, cy, r;
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      holo.onEvent(e);
      switch (e.t) {
        case 'move': sfx.move(); break;
        case 'rotate': sfx.rotate(); break;
        case 'blocked': sfx.blocked(); break;
        case 'lock':
          sfx.lock();
          shake = Math.max(shake, 2);
          break;
        case 'slam':
          sfx.slam();
          shake = Math.max(shake, SHAKE_HARD);
          if (e.rows > 0) addTrail(e.x, e.y - e.rows, e.y + 1, e.w, 'rgba(255,255,255,.8)');
          break;
        case 'clear':
          onClear(e);
          break;
        case 'levelup':
          sfx.levelup();
          addPop('LEVEL ' + e.level, BW / 2, BH * 0.3, '#ffd06a', 1);
          sparkle(BW / 2, BH * 0.3, 22, '#ffd06a');
          bump(chipLevel);
          break;
        case 'leaf': sfx.leaf(); break;
        case 'powergain':
          sfx.leaf();
          addPop('GIÓ LÁ +1', BW / 2, BH * 0.45, '#7bee9a', 0);
          break;
        case 'power':
          sfx.power();
          shake = Math.max(shake, SHAKE_BIG * 0.7);
          for (r = 0; r < e.rows.length; r++) { addFlash(e.rows[r]); burstRow(e.rows[r], e.snaps[r], 1); }
          addPop('GIÓ LÁ!', BW / 2, BH * 0.62, '#7bee9a', 1);
          break;
        case 'spawn': syncKnob(); drawNext(); break;
        case 'over': gameOver(); break;
      }
    }
    hud();
  }

  function onClear(e) {
    var r, row;
    sfx.clear(e.n);
    for (r = 0; r < e.rows.length; r++) {
      row = e.rows[r];
      addFlash(row);
      burstRow(row, e.snaps[r], e.n >= 4 ? 1 : 0);
    }
    // Một nhãn chính + một dòng điểm. Perfect gộp luôn nhãn số hàng, nếu không
    // thì 4 pha (tetris + perfect + combo + levelup) đè lên nhau đọc không kịp.
    var midY = (e.rows[0] + 0.5) * CELL;
    var txt, col, big = 0;
    if (e.perfect) { txt = 'PERFECT!'; col = '#fff59a'; big = 1; }
    else if (e.n >= 4) { txt = 'TETRIS!'; col = '#ffd06a'; big = 1; }
    else if (e.n === 3) { txt = 'AWESOME!'; col = '#ff9ec4'; big = 1; }
    else if (e.n === 2) { txt = 'GREAT!'; col = '#7fe9ff'; }
    else { txt = 'NICE!'; col = '#a8ff9e'; }
    addPop(txt, BW / 2, midY, col, big);
    addPop('+' + e.gained, BW / 2, midY + CELL * 1.05, '#fff', 0);

    if (e.combo >= 2) {
      sfx.combo(e.combo);
      addPop('COMBO ×' + e.combo, BW / 2, midY - CELL * 1.15, '#ffb54d', 0);
      comboAura = 900;
      comboPanel.classList.remove('on'); void comboPanel.offsetWidth; comboPanel.classList.add('on');
    }
    if (e.n >= 4) { boardFlash = 300; shake = Math.max(shake, SHAKE_BIG); }
    if (e.perfect) {
      sfx.perfect();
      boardFlash = 420; shake = Math.max(shake, SHAKE_BIG);
      addPop('ALL CLEAR +' + E.PERFECT_BONUS, BW / 2, midY - CELL * 2.3, '#7fe9ff', 0);
      sparkle(BW / 2, BH * 0.5, 60, '#fff59a');
      sparkle(BW / 2, BH * 0.62, 40, '#7fe9ff');
    }
    if (s.combo > save.bestCombo) { save.bestCombo = s.combo; persist(); }
    boardbox.classList.toggle('combo', s.combo >= 2);
  }

  // ── vòng lặp ───────────────────────────────────────────────────────────
  var prev = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = prev ? now - prev : 16;
    prev = now;
    if (dt > 100) dt = 100;

    if (running) {
      if (dragging) E.setKnob(s, dragT);
      EV.length = 0;
      E.step(s, dt, EV);
      if (EV.length) consume(EV);
    }
    holo.update(dt);

    // vẽ
    ctx.save();
    if (shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= SHAKE_DECAY;
    } else shake = 0;
    ctx.clearRect(-20, -20, BW + 40, BH + 40);
    drawGridBg();
    drawStack();
    if (running || s.paused) drawGhostAndPiece(now);
    drawEffects(dt, now);
    ctx.restore();

    boardbox.classList.toggle('danger', !!s.danger && running);
    if (!dragging) syncKnob();
  }

  // ── vòng đời ván ───────────────────────────────────────────────────────
  function paintStartCard() {
    $('sBest').textContent = save.best;
    $('sCombo').textContent = save.bestCombo;
  }

  function start() {
    s = E.create((Math.random() * 0xffffffff) >>> 0);
    lastScore = -1;
    var i;
    for (i = 0; i < PART_MAX; i++) parts[i].on = 0;
    for (i = 0; i < POP_MAX; i++) pops[i].on = 0;
    for (i = 0; i < FLASH_MAX; i++) flashes[i].on = 0;
    for (i = 0; i < TRAIL_MAX; i++) trails[i].on = 0;
    shake = 0; boardFlash = 0; comboAura = 0;
    boardbox.classList.remove('combo', 'danger');
    running = true; started = true;
    sfx.boot();
    veil('veilStart', false); veil('veilOver', false); veil('veilPause', false);
    layout(); hud(); drawNext(); syncKnob(true);
    holo.say('start');
    if (window.ArcadeGame) window.ArcadeGame.track('game_start', { level: 1 });
  }

  function gameOver() {
    running = false;
    sfx.over();
    save.games++; save.lines += s.lines;
    var rec = s.score > save.best;
    if (rec) save.best = s.score;
    if (s.bestCombo > save.bestCombo) save.bestCombo = s.bestCombo;
    persist();
    $('oScore').textContent = s.score;
    $('oLines').textContent = s.lines;
    $('oCombo').textContent = '×' + s.bestCombo;
    $('oBest').textContent = save.best;
    $('overTitle').textContent = rec ? 'KỶ LỤC MỚI!' : 'HẾT LƯỢT';
    $('overTitle').className = rec ? 'win' : '';
    $('overMsg').textContent = rec
      ? 'Bạn vừa phá kỷ lục của chính mình 🎉'
      : (s.score >= save.best * 0.8 ? 'Sát kỷ lục rồi, thử lại đi!' : 'Ván sau ăn to hơn!');
    paintStartCard();
    veil('veilOver', true);
    if (window.ArcadeGame) {
      window.ArcadeGame.onScore('alltime', s.score);
      window.ArcadeGame.onScore('daily', s.score);
      window.ArcadeGame.track('game_over', { score: s.score, lines: s.lines, level: s.level });
    }
  }

  function pause() {
    if (!running) return;
    running = false; s.paused = true;
    veil('veilPause', true);
  }
  function resume() {
    s.paused = false; running = true; prev = 0;
    veil('veilPause', false);
  }

  function veil(id, on) { $(id).classList.toggle('on', !!on); }

  // ── nút ────────────────────────────────────────────────────────────────
  $('btnStart').addEventListener('click', start);
  $('btnAgain').addEventListener('click', start);
  $('btnResume').addEventListener('click', resume);
  $('btnQuit').addEventListener('click', function () { s.paused = false; veil('veilPause', false); start(); });
  $('btnPause').addEventListener('click', function () { if (running) pause(); else if (s.paused) resume(); });
  $('btnHelp').addEventListener('click', function () { if (running) pause(); veil('veilHelp', true); });
  $('btnHelp2').addEventListener('click', function () { veil('veilHelp', true); });
  $('btnHelpClose').addEventListener('click', function () { veil('veilHelp', false); });
  $('btnSound').addEventListener('click', function () {
    save.sound = !save.sound; sfx.on = save.sound;
    $('btnSound').textContent = save.sound ? '🔊' : '🔇';
    $('btnSound').classList.toggle('off', !save.sound);
    if (save.sound) { sfx.boot(); sfx.rotate(); }
    persist();
  });

  document.addEventListener('visibilitychange', function () { if (document.hidden && running) pause(); });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 120); });

  // ── khởi động ──────────────────────────────────────────────────────────
  sfx.on = save.sound;
  $('btnSound').textContent = save.sound ? '🔊' : '🔇';
  $('btnSound').classList.toggle('off', !save.sound);
  paintStartCard();
  layout(); hud();
  requestAnimationFrame(frame);
  window.__blockdrop = { s: function () { return s; }, E: E, start: start, layout: layout };
})();
