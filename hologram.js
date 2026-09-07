/* hologram.js — bạn đồng hành hologram bên phải bàn chơi.
   Nhiệm vụ duy nhất: nhận SỰ KIỆN từ engine và phản ứng (tư thế + câu thoại +
   tia sáng). Không biết gì về luật game, không đọc state — nhờ vậy đổi lời cổ vũ
   không sợ vỡ logic. */
'use strict';
(function (root) {

  var POSE_MS = 2600;      // ms giữ tư thế đặc biệt trước khi về idle
  var IDLE_MS = 13000;     // ms giữa hai câu nói lúc rảnh
  var SPARK_N = 10;        // số tia sáng trong hồ quang

  // Lời thoại: mảng để mỗi lần lấy một câu khác nhau, đỡ nhàm.
  var LINES = {
    start:   ['Cùng chơi nhé!', 'Mình tin bạn đó!', 'Bắt đầu thôi!'],
    idle:    ['Bạn làm được mà!', 'Cứ bình tĩnh xếp!', 'Nhìn cột trống kia kìa!',
              'Mình đang xem bạn chơi 👀', 'Từ từ thôi, không gấp!'],
    nice:    ['Tốt lắm!', 'Gọn gàng!', 'Đẹp đấy!', 'Chuẩn!'],
    great:   ['Hai hàng luôn!', 'Ghê quá!', 'Tuyệt vời!'],
    triple:  ['Ba hàng?! 🔥', 'Bạn đỉnh thật!', 'Quá mượt!'],
    tetris:  ['TETRIS! Siêu đỉnh!', 'BỐN HÀNG!! 🤯', 'Không thể tin được!'],
    perfect: ['HOÀN HẢO!!! ✨', 'Sạch bàn luôn!', 'Bạn là thiên tài!'],
    combo:   ['Combo ×{n}!', 'Đừng dừng lại!', 'Chuỗi {n} rồi!'],
    levelup: ['Level {n}! Cẩn thận nhé!', 'Nhanh hơn rồi đó!', 'Lên hạng!'],
    leaf:    ['Được lá rồi 🍃', 'Nhặt lá đi!'],
    power:   ['Đủ 5 lá — thổi thôi!', 'Có gió lá rồi!'],
    blow:    ['Bay hết! 🍃🍃', 'Thoáng chưa!'],
    danger:  ['Bình tĩnh nào!', 'Cao quá rồi đó!', 'Cẩn thận!'],
    safe:    ['Thở phào 😮‍💨', 'Ổn rồi!'],
    over:    ['Ván sau ăn to hơn!', 'Chơi lại nha, mình chờ!', 'Gần rồi mà!']
  };

  // Ưu tiên: sự kiện nhỏ không được cắt ngang lời khen lớn đang hiện.
  var RANK = {
    idle: 0, nice: 1, leaf: 1, safe: 1, combo: 2, great: 2, levelup: 2,
    power: 2, blow: 2, danger: 3, triple: 3, tetris: 4, perfect: 5, over: 5, start: 5
  };

  var POSE = {
    start: 'cheer', idle: 'idle', nice: 'cheer', great: 'cheer', triple: 'wow',
    tetris: 'wow', perfect: 'wow', combo: 'cheer', levelup: 'wow', leaf: 'cheer',
    power: 'cheer', blow: 'cheer', danger: 'worry', safe: 'idle', over: 'sad'
  };

  function Holo(el, sayEl, sparkEl) {
    this.el = el; this.sayEl = sayEl;
    this.pose = 'idle'; this.rank = 0;
    this.poseT = 0; this.idleT = 0;
    this.typeTarget = ''; this.typeAt = 0; this.typeT = 0;
    this.sparks = [];
    var i, d;
    for (i = 0; i < SPARK_N; i++) {
      d = document.createElement('i');
      d.className = 'sp';
      sparkEl.appendChild(d);
      this.sparks.push({ el: d, t: 0, ttl: 0, x: 0, y: 0, vx: 0, vy: 0 });
    }
  }

  Holo.prototype.pick = function (kind, n) {
    var arr = LINES[kind] || LINES.idle;
    var s = arr[(Math.random() * arr.length) | 0];
    return s.replace('{n}', n === undefined ? '' : n);
  };

  /** Nói một câu. kind quyết định tư thế + độ ưu tiên. */
  Holo.prototype.say = function (kind, n) {
    var r = RANK[kind] === undefined ? 1 : RANK[kind];
    if (r < this.rank && this.poseT > 0) return;        // đang khen to, đừng cắt
    this.rank = r;
    this.setPose(POSE[kind] || 'idle');
    this.type(this.pick(kind, n));
    this.poseT = kind === 'idle' ? 0 : POSE_MS;
    this.idleT = IDLE_MS;
    if (r >= 4) { this.flash(); this.burst(14); }
    else if (r >= 2) this.burst(6);
    if (kind === 'danger') this.el.classList.add('warm');
    if (kind === 'safe' || kind === 'start') this.el.classList.remove('warm');
    if (kind === 'tetris' || kind === 'perfect') this.glitch();
  };

  Holo.prototype.setPose = function (p) {
    if (p === this.pose) return;
    this.el.classList.remove('p-' + this.pose);
    this.pose = p;
    this.el.classList.add('p-' + p);
  };

  Holo.prototype.type = function (txt) {
    this.typeTarget = txt; this.typeAt = 0; this.typeT = 0;
    this.sayEl.textContent = '';
  };

  Holo.prototype.flash = function () {
    var el = this.el;
    el.classList.remove('flash');
    void el.offsetWidth;                                // bắt lại animation
    el.classList.add('flash');
  };

  Holo.prototype.glitch = function () {
    var el = this.el;
    el.classList.remove('glitch');
    void el.offsetWidth;
    el.classList.add('glitch');
  };

  Holo.prototype.burst = function (n) {
    var i, s, a, sp;
    for (i = 0, s = 0; i < this.sparks.length && s < n; i++) {
      sp = this.sparks[i];
      if (sp.ttl > 0) continue;
      a = Math.random() * Math.PI * 2;
      sp.x = 50 + (Math.random() * 20 - 10);
      sp.y = 55 + (Math.random() * 20 - 10);
      sp.vx = Math.cos(a) * (28 + Math.random() * 32);
      sp.vy = Math.sin(a) * (28 + Math.random() * 32) - 14;
      sp.ttl = 620 + Math.random() * 320; sp.t = 0;
      s++;
    }
  };

  /** Gọi mỗi frame. dt = ms. */
  Holo.prototype.update = function (dt) {
    var i, sp, k;
    // đánh máy chữ
    if (this.typeAt < this.typeTarget.length) {
      this.typeT += dt;
      while (this.typeT >= 26 && this.typeAt < this.typeTarget.length) {
        this.typeT -= 26; this.typeAt++;
      }
      this.sayEl.textContent = this.typeTarget.slice(0, this.typeAt);
    }
    // hết hạn tư thế -> về idle
    if (this.poseT > 0) {
      this.poseT -= dt;
      if (this.poseT <= 0) { this.poseT = 0; this.rank = 0; this.setPose('idle'); }
    }
    // buồn miệng thì tự nói
    this.idleT -= dt;
    if (this.idleT <= 0) { this.idleT = IDLE_MS; if (this.rank === 0) this.say('idle'); }
    // tia sáng
    for (i = 0; i < this.sparks.length; i++) {
      sp = this.sparks[i];
      if (sp.ttl <= 0) continue;
      sp.t += dt;
      if (sp.t >= sp.ttl) { sp.ttl = 0; sp.el.style.opacity = '0'; continue; }
      k = sp.t / sp.ttl;
      sp.el.style.left = (sp.x + sp.vx * k) + '%';
      sp.el.style.top = (sp.y + sp.vy * k + 40 * k * k) + '%';
      sp.el.style.opacity = String(1 - k);
      sp.el.style.transform = 'scale(' + (1.4 - k) + ')';
    }
  };

  /** Ánh xạ sự kiện engine -> lời cổ vũ. Đây là toàn bộ chỗ hai bên gặp nhau. */
  Holo.prototype.onEvent = function (e) {
    switch (e.t) {
      case 'clear':
        if (e.perfect) this.say('perfect');
        else if (e.n >= 4) this.say('tetris');
        else if (e.n === 3) this.say('triple');
        else if (e.combo >= 2) this.say('combo', e.combo);
        else if (e.n === 2) this.say('great');
        else this.say('nice');
        break;
      case 'levelup':   this.say('levelup', e.level); break;
      case 'powergain': this.say('power'); break;
      case 'leaf':      if (Math.random() < 0.5) this.say('leaf'); break;
      case 'power':     this.say('blow'); break;
      case 'danger':    this.say(e.on ? 'danger' : 'safe'); break;
      case 'over':      this.say('over'); break;
    }
  };

  root.Hologram = Holo;
})(typeof window !== 'undefined' ? window : globalThis);
