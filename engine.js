/* engine.js — logic thuần của Block Drop. Không chạm DOM, không đọc đồng hồ:
   thời gian đi vào qua tham số dt. Chạy được trong node để test.

   Luật: khối rơi từ trên; người chơi KHÔNG bấm trái/phải mà kéo THANH DƯỚI để
   đặt cột mục tiêu, khối tự trượt tới cột đó rồi rơi xuống. */
'use strict';
(function (root) {

  // ── tham số cân bằng (đơn vị ghi rõ, /game-iterate sửa ở đây) ───────────
  var COLS        = 8;      // ô
  var ROWS        = 18;     // ô — chọn theo chiều cao thật của màn portrait:
                            //   8 cột × cỡ ô do bề ngang quyết định ⇒ 18 hàng vừa
                            //   khít 390×844 mà không để lại khoảng trống chết.
  var GRAV_BASE   = 850;    // ms cho 1 ô rơi, ở level 1
  var GRAV_STEP   = 62;     // ms trừ đi mỗi level
  var GRAV_MIN    = 130;    // ms/ô — sàn tốc độ, đừng nhanh hơn phản xạ ngón tay
  var LOCK_DELAY  = 300;    // ms khối chạm đáy còn được trượt trước khi khoá
  var SLIDE_SPEED = 24;     // ô/giây khi khối trượt về cột mục tiêu
  var LEVEL_SCORE = 1000;   // điểm cho 1 level
  var LINE_SCORE  = [0, 100, 300, 500, 800];   // theo số hàng dọn 1 lượt
  var COMBO_SCORE = 50;     // điểm × (combo-1) × level
  var PERFECT_BONUS = 2000; // dọn sạch bàn
  var HARD_DROP_PT  = 2;    // điểm mỗi ô khi thả nhanh
  var LEAF_NEED   = 5;      // lá đổi 1 lượt power
  var LEAF_CHANCE = 0.22;   // xác suất một khối mang ô lá
  var POWER_ROWS  = 2;      // số hàng dưới bị power thổi bay
  var POWER_SCORE = 120;    // điểm × level khi dùng power
  var POWER_MAX   = 9;
  var DANGER_ROWS = 4;      // còn ≤ n hàng trống ở trên thì báo nguy

  // ── hình khối: khai 1 ma trận, các hướng khác sinh ra bằng phép quay ────
  //    c = mã màu 1..7 (game.js quyết định màu thật)
  var SHAPES = [
    { c: 1, m: [[1, 1, 1, 1]] },                  // I
    { c: 2, m: [[1, 1], [1, 1]] },                // O
    { c: 3, m: [[0, 1, 0], [1, 1, 1]] },          // T
    { c: 4, m: [[0, 1, 1], [1, 1, 0]] },          // S
    { c: 5, m: [[1, 1, 0], [0, 1, 1]] },          // Z
    { c: 6, m: [[1, 0, 0], [1, 1, 1]] },          // J
    { c: 7, m: [[0, 0, 1], [1, 1, 1]] }           // L
  ];
  var KICKS = [0, -1, 1, -2, 2];   // thử dịch ngang khi quay bị chèn

  // Ô trong lưới: 0 = trống; 1..7 = màu; bit 8 = có lá.
  var LEAF_BIT = 8;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function rotCW(m) {
    var h = m.length, w = m[0].length, r = [], x, y;
    for (x = 0; x < w; x++) { r.push([]); for (y = h - 1; y >= 0; y--) r[x].push(m[y][x]); }
    return r;
  }

  function cloneM(m) {
    var r = [], y;
    for (y = 0; y < m.length; y++) r.push(m[y].slice());
    return r;
  }

  function refill(s) {
    var i, j, t, b = [0, 1, 2, 3, 4, 5, 6];
    for (i = b.length - 1; i > 0; i--) {           // Fisher-Yates với rng của state
      j = (s.rng() * (i + 1)) | 0;
      t = b[i]; b[i] = b[j]; b[j] = t;
    }
    for (i = 0; i < b.length; i++) s.bag.push(b[i]);
  }

  function makePiece(s) {
    if (!s.bag.length) refill(s);
    var def = SHAPES[s.bag.shift()];
    var p = { c: def.c, m: cloneM(def.m), leaf: null, x: 0, y: 0 };
    if (s.rng() < LEAF_CHANCE) {
      // đánh dấu 1 ô đặc của khối là "lá" — ma trận lá quay cùng khối
      var cells = [], y, x;
      for (y = 0; y < p.m.length; y++) for (x = 0; x < p.m[y].length; x++) if (p.m[y][x]) cells.push([y, x]);
      var pick = cells[(s.rng() * cells.length) | 0];
      p.leaf = [];
      for (y = 0; y < p.m.length; y++) { p.leaf.push([]); for (x = 0; x < p.m[y].length; x++) p.leaf[y].push(0); }
      p.leaf[pick[0]][pick[1]] = 1;
    }
    return p;
  }

  function pieceW(p) { return p.m[0].length; }
  function pieceH(p) { return p.m.length; }

  /** Khối ở (px,py) có chèn vào tường/đáy/gạch cũ không? */
  function hits(s, p, px, py) {
    var y, x, gx, gy;
    for (y = 0; y < p.m.length; y++) {
      for (x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x]) continue;
        gx = px + x; gy = py + y;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy < 0) continue;                       // phần còn ở trên nóc: bỏ qua
        if (s.grid[gy * COLS + gx]) return true;
      }
    }
    return false;
  }

  function ghostY(s) {
    if (!s.piece) return 0;
    var y = s.piece.y;
    while (!hits(s, s.piece, s.piece.x, y + 1)) y++;
    return y;
  }

  function stackTop(s) {                            // hàng đầu tiên có gạch (ROWS nếu sạch)
    var y, x;
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) if (s.grid[y * COLS + x]) return y;
    return ROWS;
  }

  function gravMs(level) {
    var v = GRAV_BASE - (level - 1) * GRAV_STEP;
    return v < GRAV_MIN ? GRAV_MIN : v;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function spawn(s, ev) {
    s.piece = s.next || makePiece(s);
    s.next = makePiece(s);
    s.piece.x = clamp(s.targetX, 0, COLS - pieceW(s.piece));
    s.piece.y = 0;
    s.targetX = s.piece.x;
    s.fallAcc = 0; s.lockAcc = 0; s.grounded = false; s.slideAcc = 0;
    s.pieces++;
    if (hits(s, s.piece, s.piece.x, s.piece.y)) {
      s.over = true;
      ev.push({ t: 'over', score: s.score });
      return;
    }
    ev.push({ t: 'spawn' });
    var top = stackTop(s);
    var d = top <= DANGER_ROWS;
    if (d !== s.danger) { s.danger = d; ev.push({ t: 'danger', on: d }); }
  }

  /** Ghi khối vào lưới. Trả về số ô đã ghi. */
  function weld(s, ev) {
    var y, x, gx, gy, n = 0, p = s.piece;
    for (y = 0; y < p.m.length; y++) {
      for (x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x]) continue;
        gx = p.x + x; gy = p.y + y;
        if (gy < 0 || gy >= ROWS) continue;
        s.grid[gy * COLS + gx] = p.c | (p.leaf && p.leaf[y][x] ? LEAF_BIT : 0);
        n++;
      }
    }
    ev.push({ t: 'lock', x: p.x, y: p.y, c: p.c, cells: n });
    return n;
  }

  /** Ảnh chụp nội dung một hàng — game.js cần để vẽ hiệu ứng nổ đúng màu. */
  function snapRow(s, y) {
    var x, r = [];
    for (x = 0; x < COLS; x++) r.push(s.grid[y * COLS + x]);
    return r;
  }

  function removeRows(s, rows) {
    // rows PHẢI tăng dần và phải xử lý từ hàng TRÊN xuống: mỗi lần dồn xuống chỉ
    // dịch phần nằm trên hàng bị xoá, nên các chỉ số hàng dưới nó vẫn còn nguyên.
    // (Làm ngược lại thì dọn 2 hàng trở lên sẽ để sót hàng dưới cùng.)
    var i, y, x;
    for (i = 0; i < rows.length; i++) {
      for (y = rows[i]; y > 0; y--) for (x = 0; x < COLS; x++) s.grid[y * COLS + x] = s.grid[(y - 1) * COLS + x];
      for (x = 0; x < COLS; x++) s.grid[x] = 0;
    }
  }

  function isEmpty(s) {
    var i;
    for (i = 0; i < s.grid.length; i++) if (s.grid[i]) return false;
    return true;
  }

  function addLeaves(s, n, ev) {
    if (n <= 0) return;
    s.leaf += n; s.leafTotal += n;
    ev.push({ t: 'leaf', n: n, have: s.leaf, need: LEAF_NEED });
    while (s.leaf >= LEAF_NEED) {
      s.leaf -= LEAF_NEED;
      if (s.power < POWER_MAX) { s.power++; ev.push({ t: 'powergain', power: s.power }); }
    }
  }

  function bumpLevel(s, ev) {
    var lv = 1 + Math.floor(s.score / LEVEL_SCORE);
    if (lv > s.level) { s.level = lv; ev.push({ t: 'levelup', level: lv }); }
  }

  /** Dọn hàng đầy sau khi khoá khối. */
  function resolve(s, ev) {
    var y, x, full, rows = [], snaps = [], leaves = 0;
    for (y = 0; y < ROWS; y++) {
      full = true;
      for (x = 0; x < COLS; x++) if (!s.grid[y * COLS + x]) { full = false; break; }
      if (!full) continue;
      rows.push(y); snaps.push(snapRow(s, y));
      for (x = 0; x < COLS; x++) if (s.grid[y * COLS + x] & LEAF_BIT) leaves++;
    }
    if (!rows.length) {
      if (s.combo > 0) ev.push({ t: 'combobreak', combo: s.combo });
      s.combo = 0;
      return;
    }
    var n = rows.length;
    removeRows(s, rows);
    s.lines += n;
    s.combo++;
    if (s.combo > s.bestCombo) s.bestCombo = s.combo;

    var gained = LINE_SCORE[n] * s.level;
    if (s.combo > 1) gained += COMBO_SCORE * (s.combo - 1) * s.level;
    var perfect = isEmpty(s);
    if (perfect) gained += PERFECT_BONUS;
    s.score += gained;

    ev.push({
      t: 'clear', rows: rows, snaps: snaps, n: n,
      combo: s.combo, perfect: perfect, leaves: leaves, gained: gained
    });
    addLeaves(s, leaves, ev);
    bumpLevel(s, ev);
  }

  function lock(s, ev) {
    weld(s, ev);
    resolve(s, ev);
    if (!s.over) spawn(s, ev);
  }

  // ── API ────────────────────────────────────────────────────────────────
  function create(seed) {
    var s = {
      cols: COLS, rows: ROWS,
      grid: new Array(COLS * ROWS),
      piece: null, next: null,
      bag: [], rng: mulberry32((seed >>> 0) || 0x9e3779b9),
      score: 0, lines: 0, level: 1, combo: 0, bestCombo: 0,
      leaf: 0, leafTotal: 0, power: 0, powerUsed: 0,
      targetX: (COLS >> 1) - 1,
      slideAcc: 0, fallAcc: 0, lockAcc: 0, grounded: false,
      over: false, paused: false, danger: false,
      pieces: 0, elapsed: 0, drops: 0
    };
    var i;
    for (i = 0; i < s.grid.length; i++) s.grid[i] = 0;
    spawn(s, []);
    return s;
  }

  /** Thanh kéo đặt cột mục tiêu. t ∈ [0,1] theo vị trí núm trên thanh. */
  function setKnob(s, t) {
    if (!s.piece) return;
    var span = COLS - pieceW(s.piece);
    s.targetX = clamp(Math.round(t * span), 0, span);
  }

  /** Núm nên nằm ở đâu (0..1) để khớp khối hiện tại. */
  function knobT(s) {
    if (!s.piece) return 0.5;
    var span = COLS - pieceW(s.piece);
    return span <= 0 ? 0.5 : clamp(s.piece.x / span, 0, 1);
  }

  function nudge(s, dir) {
    if (!s.piece || s.over || s.paused) return;
    var span = COLS - pieceW(s.piece);
    s.targetX = clamp(s.targetX + dir, 0, span);
  }

  function rotate(s, ev) {
    if (!s.piece || s.over || s.paused) return false;
    var p = s.piece, m2 = rotCW(p.m), l2 = p.leaf ? rotCW(p.leaf) : null;
    var probe = { m: m2, leaf: l2, c: p.c, x: p.x, y: p.y };
    var i, k, nx;
    for (i = 0; i < KICKS.length; i++) {
      k = KICKS[i];
      nx = clamp(p.x + k, 0, COLS - m2[0].length);
      if (!hits(s, probe, nx, p.y)) {
        p.m = m2; p.leaf = l2; p.x = nx;
        s.targetX = nx;
        if (s.grounded) s.lockAcc = 0;              // quay được thì gia hạn khoá
        ev.push({ t: 'rotate' });
        return true;
      }
      if (!hits(s, probe, nx, p.y - 1)) {           // kick lên 1 ô khi sát đáy
        p.m = m2; p.leaf = l2; p.x = nx; p.y = p.y - 1;
        s.targetX = nx;
        if (s.grounded) s.lockAcc = 0;
        ev.push({ t: 'rotate' });
        return true;
      }
    }
    ev.push({ t: 'blocked' });
    return false;
  }

  function hardDrop(s, ev) {
    if (!s.piece || s.over || s.paused) return 0;
    var gy = ghostY(s), n = gy - s.piece.y;
    s.piece.y = gy;
    if (n > 0) s.score += n * HARD_DROP_PT;
    s.drops++;
    ev.push({ t: 'slam', rows: n, x: s.piece.x, y: gy, w: pieceW(s.piece) });
    lock(s, ev);
    bumpLevel(s, ev);
    return n;
  }

  /** Power "gió lá": thổi bay POWER_ROWS hàng dưới cùng. */
  function usePower(s, ev) {
    if (s.over || s.paused || s.power < 1) return false;
    var rows = [], snaps = [], y, any = false, i;
    var from = ROWS - POWER_ROWS; if (from < 0) from = 0;
    for (y = from; y < ROWS; y++) {                  // tăng dần: khớp yêu cầu của removeRows
      rows.push(y); snaps.push(snapRow(s, y));
      for (i = 0; i < COLS; i++) if (s.grid[y * COLS + i]) any = true;
    }
    if (!any) return false;                          // đừng cho tiêu power vào chỗ trống
    removeRows(s, rows);
    s.power--; s.powerUsed++;
    s.score += POWER_SCORE * s.level;
    ev.push({ t: 'power', rows: rows, snaps: snaps });
    bumpLevel(s, ev);
    var top = stackTop(s), d = top <= DANGER_ROWS;
    if (d !== s.danger) { s.danger = d; ev.push({ t: 'danger', on: d }); }
    return true;
  }

  /** Tiến 1 khung. dt = ms. ev = mảng do người gọi cấp (tránh cấp phát mỗi frame). */
  function step(s, dt, ev) {
    if (s.over || s.paused || !s.piece) return ev;
    if (dt > 60) dt = 60;                            // tab ẩn quay lại: đừng nhảy vài ô
    s.elapsed += dt;

    // 1) trượt ngang về cột mục tiêu do thanh kéo đặt
    if (s.piece.x !== s.targetX) {
      s.slideAcc += SLIDE_SPEED * dt / 1000;
      var guard = 0;
      while (s.slideAcc >= 1 && s.piece.x !== s.targetX && guard++ < COLS) {
        var dir = s.targetX > s.piece.x ? 1 : -1;
        if (hits(s, s.piece, s.piece.x + dir, s.piece.y)) { s.targetX = s.piece.x; s.slideAcc = 0; break; }
        s.piece.x += dir; s.slideAcc -= 1;
        ev.push({ t: 'move', x: s.piece.x });
        if (s.grounded && !hits(s, s.piece, s.piece.x, s.piece.y + 1)) { s.grounded = false; s.lockAcc = 0; }
      }
    } else s.slideAcc = 0;

    // 2) rơi
    if (hits(s, s.piece, s.piece.x, s.piece.y + 1)) {
      s.grounded = true;
      s.lockAcc += dt;
      if (s.lockAcc >= LOCK_DELAY) lock(s, ev);
    } else {
      s.grounded = false; s.lockAcc = 0;
      s.fallAcc += dt;
      var iv = gravMs(s.level), guard2 = 0;
      while (s.fallAcc >= iv && guard2++ < ROWS) {
        if (hits(s, s.piece, s.piece.x, s.piece.y + 1)) break;
        s.piece.y++; s.fallAcc -= iv;
        ev.push({ t: 'fall', y: s.piece.y });
      }
    }
    return ev;
  }

  root.BlockDrop = {
    COLS: COLS, ROWS: ROWS, LEAF_BIT: LEAF_BIT, LEAF_NEED: LEAF_NEED,
    LEVEL_SCORE: LEVEL_SCORE, POWER_ROWS: POWER_ROWS, POWER_MAX: POWER_MAX,
    GRAV_BASE: GRAV_BASE, GRAV_MIN: GRAV_MIN, LOCK_DELAY: LOCK_DELAY,
    LINE_SCORE: LINE_SCORE, PERFECT_BONUS: PERFECT_BONUS, DANGER_ROWS: DANGER_ROWS,
    SHAPES: SHAPES,
    create: create, step: step, rotate: rotate, hardDrop: hardDrop, usePower: usePower,
    setKnob: setKnob, knobT: knobT, nudge: nudge,
    ghostY: ghostY, stackTop: stackTop, gravMs: gravMs, pieceW: pieceW, pieceH: pieceH,
    hits: hits, isEmpty: isEmpty
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.BlockDrop;
})(typeof window !== 'undefined' ? window : globalThis);
