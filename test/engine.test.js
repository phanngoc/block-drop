/* Test engine — luật game phải đúng mà không cần mở browser.
   Chạy: npm test  (node --test test/) */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

/** Chạy engine n ms theo từng bước 16ms (giống frame thật, vì step() cắt dt > 60). */
function run(s, ms, ev) {
  ev = ev || [];
  for (let t = 0; t < ms; t += 16) E.step(s, 16, ev);
  return ev;
}

test('bàn chơi đúng kích thước và luôn có khối + khối kế tiếp', () => {
  const s = E.create(1);
  assert.strictEqual(s.cols, 8);
  assert.strictEqual(s.rows, 18);
  assert.strictEqual(s.grid.length, s.cols * s.rows);
  assert.ok(s.rows > E.DANGER_ROWS + 4, 'bàn phải cao hơn vạch nguy hiểm một quãng dùng được');
  assert.ok(s.piece && s.next, 'phải có piece và next ngay khi tạo');
  assert.ok(s.grid.every((v) => v === 0), 'bàn phải trống');
});

test('trọng lực: khối rơi theo thời gian, tốc độ tăng theo level', () => {
  const s = E.create(2);
  const y0 = s.piece.y;
  run(s, 900);
  assert.ok(s.piece.y > y0, 'sau 900ms khối phải rơi ít nhất 1 ô');
  assert.ok(E.gravMs(1) > E.gravMs(5), 'level cao phải rơi nhanh hơn');
  assert.strictEqual(E.gravMs(99), E.GRAV_MIN, 'phải có sàn tốc độ');
});

test('thanh kéo: setKnob đổi cột mục tiêu và khối trượt tới đó', () => {
  const s = E.create(3);
  E.setKnob(s, 1);                       // kéo núm sang phải hết
  const span = s.cols - E.pieceW(s.piece);
  assert.strictEqual(s.targetX, span);
  run(s, 600);
  assert.strictEqual(s.piece.x, span, 'khối phải trượt tới cột mục tiêu');
  E.setKnob(s, 0);
  run(s, 600);
  assert.strictEqual(s.piece.x, 0);
});

test('nudge kẹp trong biên, không đẩy khối ra ngoài tường', () => {
  const s = E.create(4);
  for (let i = 0; i < 30; i++) E.nudge(s, -1);
  assert.strictEqual(s.targetX, 0);
  for (let i = 0; i < 30; i++) E.nudge(s, 1);
  assert.strictEqual(s.targetX, s.cols - E.pieceW(s.piece));
});

test('quay: đổi hình hoặc báo blocked, không bao giờ chèn ra ngoài bàn', () => {
  const s = E.create(5);
  for (let i = 0; i < 40; i++) {
    const ev = [];
    E.rotate(s, ev);
    assert.ok(!E.hits(s, s.piece, s.piece.x, s.piece.y), 'sau khi quay khối không được chèn');
    assert.ok(s.piece.x >= 0 && s.piece.x + E.pieceW(s.piece) <= s.cols, 'khối phải nằm trong bàn');
    run(s, 100);
    if (s.over) break;
  }
});

test('thả nhanh: khoá khối, cộng điểm theo số ô rơi, sinh khối mới', () => {
  const s = E.create(6);
  const ev = [];
  const n = E.hardDrop(s, ev);
  assert.ok(n > 0, 'phải rơi được vài ô');
  assert.strictEqual(s.score, n * 2, 'điểm thả nhanh = 2/ô');
  const kinds = ev.map((e) => e.t);
  assert.ok(kinds.includes('slam') && kinds.includes('lock') && kinds.includes('spawn'));
  assert.ok(E.stackTop(s) < s.rows, 'bàn phải có gạch sau khi khoá');
});

test('dọn hàng: 1 hàng đầy bị xoá, cộng điểm, lines tăng', () => {
  const s = E.create(7);
  // đổ đầy hàng cuối trừ 1 ô rồi ép khối lấp vào — dùng grid trực tiếp cho gọn
  for (let x = 1; x < s.cols; x++) s.grid[(s.rows - 1) * s.cols + x] = 3;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  const ev = [];
  E.hardDrop(s, ev);
  const clear = ev.find((e) => e.t === 'clear');
  assert.ok(clear, 'phải phát sự kiện clear');
  assert.strictEqual(clear.n, 1);
  assert.strictEqual(s.lines, 1);
  assert.ok(s.score >= E.LINE_SCORE[1], 'phải cộng điểm dọn hàng');
  assert.ok(clear.perfect, 'dọn hết bàn thì phải là perfect');
  assert.ok(clear.snaps[0].length === s.cols, 'snapshot hàng để vẽ hiệu ứng');
});

test('all clear cộng đúng PERFECT_BONUS và combo tăng liên tiếp', () => {
  const s = E.create(8);
  for (let x = 1; x < s.cols; x++) s.grid[(s.rows - 1) * s.cols + x] = 3;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  E.hardDrop(s, []);
  assert.strictEqual(s.combo, 1);
  assert.ok(s.score >= E.PERFECT_BONUS, 'all clear phải cộng bonus');
  // hàng thứ hai liên tiếp -> combo 2
  for (let x = 1; x < s.cols; x++) s.grid[(s.rows - 1) * s.cols + x] = 4;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  E.hardDrop(s, []);
  assert.strictEqual(s.combo, 2);
  assert.strictEqual(s.bestCombo, 2);
});

test('combo reset khi khoá khối mà không dọn được hàng', () => {
  const s = E.create(9);
  s.combo = 3;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  const ev = [];
  E.hardDrop(s, ev);
  assert.strictEqual(s.combo, 0);
  assert.ok(ev.some((e) => e.t === 'combobreak'));
});

test('lá: đủ LEAF_NEED lá thì được 1 lượt power, power thổi bay hàng dưới', () => {
  const s = E.create(10);
  // hàng cuối đầy, có đúng LEAF_NEED ô mang lá -> dọn 1 lần là đủ 1 power
  for (let x = 0; x < s.cols; x++) {
    s.grid[(s.rows - 1) * s.cols + x] = 3 | (x < E.LEAF_NEED ? E.LEAF_BIT : 0);
  }
  s.grid[(s.rows - 1) * s.cols + 0] = 0;                       // để trống 1 ô cho khối lấp
  s.grid[(s.rows - 1) * s.cols + 1] = 3 | E.LEAF_BIT;
  let leaves = 0;
  for (let x = 0; x < s.cols; x++) if (s.grid[(s.rows - 1) * s.cols + x] & E.LEAF_BIT) leaves++;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  const ev = [];
  E.hardDrop(s, ev);
  const le = ev.find((e) => e.t === 'leaf');
  assert.ok(le, 'phải phát sự kiện leaf');
  assert.strictEqual(le.n, leaves);
  const expectPower = Math.floor(leaves / E.LEAF_NEED);
  assert.strictEqual(s.power, expectPower);
});

test('power: cần có power và có gạch mới dùng được; xoá đúng số hàng dưới', () => {
  const s = E.create(11);
  assert.strictEqual(E.usePower(s, []), false, 'không có power thì không dùng được');
  s.power = 1;
  assert.strictEqual(E.usePower(s, []), false, 'bàn trống thì không cho tiêu power');
  for (let y = s.rows - E.POWER_ROWS; y < s.rows; y++)
    for (let x = 0; x < s.cols; x++) s.grid[y * s.cols + x] = 5;
  const ev = [];
  assert.strictEqual(E.usePower(s, ev), true);
  assert.strictEqual(s.power, 0);
  assert.ok(E.isEmpty(s), 'hai hàng dưới phải bị thổi sạch');
  const pe = ev.find((e) => e.t === 'power');
  assert.strictEqual(pe.rows.length, E.POWER_ROWS);
});

test('level lên theo mốc LEVEL_SCORE', () => {
  const s = E.create(12);
  s.score = E.LEVEL_SCORE * 3 - 1;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  const ev = [];
  E.hardDrop(s, ev);
  assert.ok(s.level >= 3, 'điểm > 3000 thì phải ở level ≥ 3');
  assert.ok(ev.some((e) => e.t === 'levelup'));
});

test('game over khi khối mới sinh ra không có chỗ', () => {
  const s = E.create(13);
  // cột 0 kín từ hàng 1 xuống đáy -> khối 1 ô khoá ở (0,0); khối kế tiếp sinh ở
  // x=0 nên ô nào của nó cũng đụng cột 0 -> hết lượt. Không hàng nào đầy nên
  // không có pha dọn hàng làm nhiễu.
  for (let y = 1; y < s.rows; y++) s.grid[y * s.cols] = 6;
  s.targetX = 0;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  const ev = [];
  E.hardDrop(s, ev);
  assert.strictEqual(s.piece.y, 0, 'khối phải khoá ở hàng trên cùng');
  assert.ok(s.over, 'phải kết thúc');
  assert.ok(ev.some((e) => e.t === 'over'));
  // sau khi over, mọi input phải trơ
  const before = s.score;
  E.step(s, 1000, ev); E.rotate(s, ev); E.hardDrop(s, ev);
  assert.strictEqual(s.score, before);
});

test('báo nguy khi đống gạch cao lên và tắt khi thấp lại', () => {
  const s = E.create(14);
  // đống cao tới vạch nguy hiểm nhưng CHỪA cột cuối -> không hàng nào đầy nên
  // không bị dọn, đống ở nguyên độ cao đó.
  for (let y = E.DANGER_ROWS; y < s.rows; y++)
    for (let x = 0; x < s.cols - 1; x++) s.grid[y * s.cols + x] = 6;
  s.targetX = 0;
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  let ev = [];
  E.hardDrop(s, ev);
  assert.ok(ev.some((e) => e.t === 'danger' && e.on === true), 'phải bật cảnh báo');
  assert.strictEqual(s.danger, true);
  // dọn sạch rồi thả tiếp -> phải tắt cảnh báo
  for (let i = 0; i < s.grid.length; i++) s.grid[i] = 0;
  ev = [];
  E.hardDrop(s, ev);
  assert.ok(ev.some((e) => e.t === 'danger' && e.on === false), 'phải tắt cảnh báo');
  assert.strictEqual(s.danger, false);
});

test('1000 khối random không làm engine vỡ (fuzz)', () => {
  let games = 0, over = 0;
  for (let g = 0; g < 12; g++) {
    const s = E.create(1000 + g);
    const ev = [];
    for (let i = 0; i < 400 && !s.over; i++) {
      ev.length = 0;
      E.setKnob(s, Math.random());
      if (Math.random() < 0.4) E.rotate(s, ev);
      if (Math.random() < 0.5) E.hardDrop(s, ev); else run(s, 200, ev);
      if (Math.random() < 0.05) E.usePower(s, ev);
      // bất biến: không ô nào ngoài dải màu hợp lệ
      for (let k = 0; k < s.grid.length; k++) {
        const v = s.grid[k];
        assert.ok(v === 0 || ((v & 7) >= 1 && (v & 7) <= 7), 'ô lưới phải hợp lệ: ' + v);
      }
      assert.ok(s.score >= 0 && s.lines >= 0 && s.level >= 1);
    }
    games++; if (s.over) over++;
  }
  assert.strictEqual(games, 12);
  assert.ok(over > 0, 'chơi random đủ lâu thì phải có ván kết thúc — nếu không, game over không bao giờ xảy ra');
});

test('dọn nhiều hàng: hồi quy bug removeRows xoá sai thứ tự', () => {
  // 3 hàng dưới đầy trừ cột 0; khối dọc 3 ô lấp cột 0 -> dọn đúng 3 hàng, bàn sạch.
  const s = E.create(21);
  for (let y = s.rows - 3; y < s.rows; y++)
    for (let x = 1; x < s.cols; x++) s.grid[y * s.cols + x] = 3;
  s.piece = { c: 1, m: [[1], [1], [1]], leaf: null, x: 0, y: 0 };
  const ev = [];
  E.hardDrop(s, ev);
  const clear = ev.find((e) => e.t === 'clear');
  assert.strictEqual(clear.n, 3, 'phải dọn 3 hàng một lượt');
  assert.ok(E.isEmpty(s), 'bàn phải sạch — bug cũ để sót hàng dưới cùng');
  assert.ok(clear.perfect);
});

test('dọn hai hàng KHÔNG liền nhau: phần ở giữa phải rơi đúng chỗ', () => {
  const s = E.create(22);
  const last = s.rows - 1;
  for (let x = 0; x < s.cols; x++) {
    s.grid[last * s.cols + x] = 3;              // hàng 14: đầy -> bị dọn
    s.grid[(last - 2) * s.cols + x] = 4;        // hàng 12: đầy -> bị dọn
  }
  s.grid[(last - 1) * s.cols + 2] = 7;          // hàng 13: 1 ô, không đầy -> phải sống
  s.piece = { c: 2, m: [[1]], leaf: null, x: 0, y: 0 };
  s.targetX = 0;
  const ev = [];
  E.hardDrop(s, ev);                            // khối rơi lên trên đống, không lấp gì
  const clear = ev.find((e) => e.t === 'clear');
  assert.strictEqual(clear.n, 2);
  assert.deepStrictEqual(clear.rows, [last - 2, last]);
  // ô sống duy nhất của hàng 13 phải nằm ở đáy sau khi hai hàng kia biến mất
  assert.strictEqual(s.grid[last * s.cols + 2], 7, 'ô sót phải rơi xuống đáy');
  let n = 0;
  for (let i = 0; i < s.grid.length; i++) if (s.grid[i]) n++;
  assert.strictEqual(n, 2, 'chỉ còn ô sót + khối vừa khoá');
});
