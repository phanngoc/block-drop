/* sfx.js — âm thanh tổng hợp bằng WebAudio, không file ngoài.
   AudioContext chỉ được tạo sau cử chỉ đầu tiên của người dùng (luật iOS/Chrome). */
'use strict';
(function (root) {

  function Sfx() { this.ctx = null; this.on = true; this.master = null; }

  Sfx.prototype.boot = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  };

  /** Một nốt đơn. f=Hz, d=giây, type=dạng sóng, g=âm lượng tương đối. */
  Sfx.prototype.beep = function (f, d, type, g, slideTo) {
    if (!this.on || !this.ctx) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator(), a = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + d);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(g === undefined ? 0.6 : g, t + 0.008);
    a.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(a); a.connect(this.master);
    o.start(t); o.stop(t + d + 0.02);
  };

  Sfx.prototype.arp = function (freqs, step, type, g) {
    if (!this.on || !this.ctx) return;
    var self = this, i;
    for (i = 0; i < freqs.length; i++) {
      (function (f, k) { setTimeout(function () { self.beep(f, step * 1.6, type, g); }, k * step * 1000); })(freqs[i], i);
    }
  };

  Sfx.prototype.noise = function (d, g) {
    if (!this.on || !this.ctx) return;
    var n = Math.floor(this.ctx.sampleRate * d);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), ch = buf.getChannelData(0), i;
    for (i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(), a = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 1400;
    a.gain.value = g === undefined ? 0.5 : g;
    src.connect(f); f.connect(a); a.connect(this.master);
    src.start();
  };

  Sfx.prototype.move    = function () { this.beep(320, 0.03, 'square', 0.15); };
  Sfx.prototype.rotate  = function () { this.beep(520, 0.05, 'triangle', 0.3); };
  Sfx.prototype.blocked = function () { this.beep(120, 0.08, 'sawtooth', 0.2); };
  Sfx.prototype.slam    = function () { this.noise(0.12, 0.5); this.beep(180, 0.09, 'square', 0.35, 90); };
  Sfx.prototype.lock    = function () { this.beep(240, 0.05, 'square', 0.25); };
  Sfx.prototype.clear   = function (n) {
    if (n >= 4) this.arp([660, 880, 1100, 1320, 1660], 0.055, 'triangle', 0.55);
    else if (n === 3) this.arp([620, 830, 1040], 0.055, 'triangle', 0.5);
    else if (n === 2) this.arp([560, 750], 0.06, 'triangle', 0.45);
    else this.beep(700, 0.1, 'triangle', 0.4, 950);
  };
  Sfx.prototype.perfect = function () { this.arp([784, 988, 1175, 1568, 1976, 2349], 0.07, 'sine', 0.6); };
  Sfx.prototype.combo   = function (n) { this.beep(440 + Math.min(n, 8) * 90, 0.09, 'square', 0.4); };
  Sfx.prototype.levelup = function () { this.arp([523, 659, 784, 1046], 0.08, 'square', 0.45); };
  Sfx.prototype.leaf    = function () { this.beep(1180, 0.07, 'sine', 0.35, 1560); };
  Sfx.prototype.power   = function () { this.noise(0.35, 0.55); this.arp([300, 420, 560], 0.06, 'sawtooth', 0.3); };
  Sfx.prototype.over    = function () { this.arp([440, 370, 294, 220], 0.13, 'square', 0.4); };

  root.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
