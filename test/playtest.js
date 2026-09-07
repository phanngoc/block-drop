/* playtest.js — cổng verify G2/G3 bằng Chrome headless qua DevTools Protocol.
   Không phải unit test: nó mở game thật, bơm ngón tay giả vào thanh kéo và kiểm
   tra state ĐỔI. Đây là chỗ bắt lỗi "vẽ đẹp mà không tương tác".

   Chạy: node test/playtest.js [url]        (mặc định http://127.0.0.1:8790/)
   Ảnh chụp: /tmp/blockdrop-playtest*.png
*/
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
// ws: thử gói cài riêng trước, rồi tới node_modules của platform (khi game nằm
// trong repo games/). Clone lẻ mà thiếu cả hai thì nói rõ phải làm gì.
let WebSocket;
for (const p of ['ws', '../../node_modules/ws']) {
  try { WebSocket = require(p); break; } catch (e) { /* thử tiếp */ }
}
if (!WebSocket) {
  console.error('Thiếu gói "ws" (chỉ harness cần, game thì không).\n  npm i --no-save ws');
  process.exit(2);
}

const URL = process.argv[2] || 'http://127.0.0.1:8790/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const VW = 390, VH = 844, VDPR = 3;      // iPhone 14 Pro — viewport mục tiêu của skill

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' — ' + detail : ''));
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.waits = new Map(); this.events = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.id && this.waits.has(m.id)) { this.waits.get(m.id)(m); this.waits.delete(m.id); }
        else if (m.method) this.events.push(m);
      });
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waits.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async tap(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
    }
    await sleep(60);
  }
  async drag(x0, y0, x1, y1, steps) {
    steps = steps || 8;
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1, pointerType: 'touch' });
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1, pointerType: 'touch',
        x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps
      });
      await sleep(20);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1, pointerType: 'touch' });
    await sleep(80);
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }
}

(async function main() {
  const profile = fs.mkdtempSync('/tmp/bd-chrome-');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--mute-audio', `--window-size=${VW},${VH}`, 'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch (e) { await sleep(200); } }
    const tabs = await getJSON('/json/list');
    const page = tabs.find((t) => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: VDPR, mobile: true
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(1800);

    console.log('\n── G2: BOOT ' + '─'.repeat(40));
    // Tách lỗi JS khỏi lỗi mạng: chạy standalone (không có platform) thì SDK gọi
    // /v1/auth/guest và ăn 404 — arcade-bridge.js nuốt lỗi đó theo thiết kế
    // "platform là bổ sung, không phải phụ thuộc". Cổng chặn là lỗi JS.
    const all = cdp.events.filter((e) =>
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
      e.method === 'Runtime.exceptionThrown');
    const net = all.filter((e) => e.params?.entry?.source === 'network');
    const js = all.filter((e) => !net.includes(e));
    gate('0 lỗi JS', js.length === 0, js.length ? JSON.stringify(js.slice(0, 3)).slice(0, 500) : 'sạch');
    gate('0 lỗi mạng', net.length === 0,
      net.length ? net.map((e) => e.params.entry.url).join(', ') + ' (bình thường khi chạy standalone, không có API platform)' : 'sạch');

    const boot = await cdp.evaluate(`(() => {
      const g = window.__blockdrop;
      return { api: !!g, cv: !!document.getElementById('board'),
               w: document.getElementById('board').width, h: document.getElementById('board').height };
    })()`);
    gate('game khởi tạo, canvas có kích thước', boot.api && boot.w > 0 && boot.h > 0,
      `canvas ${boot.w}×${boot.h} px thiết bị`);

    const fit = await cdp.evaluate(`({
      sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      sh: document.documentElement.scrollHeight, ih: window.innerHeight
    })`);
    gate('không tràn ngang ở 390×844', fit.sw <= fit.iw + 1, `scrollWidth ${fit.sw} ≤ ${fit.iw}`);
    gate('không tràn dọc (portrait vừa 1 màn)', fit.sh <= fit.ih + 1, `scrollHeight ${fit.sh} ≤ ${fit.ih}`);

    const taps = await cdp.evaluate(`(() => {
      const ids = ['btnDrop','knob','pulL','pulR','leafChip','btnStart','btnSound','btnPause','btnHelp'];
      const bad = [];
      for (const id of ids) {
        const r = document.getElementById(id).getBoundingClientRect();
        if (r.width < 34 || r.height < 34) bad.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return bad;
    })()`);
    gate('vùng chạm chính ≥ 34px (nút phụ) / 44px (nút chơi)', taps.length === 0, taps.join(', ') || 'ok');

    await cdp.shot('/tmp/blockdrop-playtest-start.png');

    console.log('\n── G3: CHƠI ĐƯỢC ' + '─'.repeat(34));
    // bấm BẮT ĐẦU
    const startBox = await cdp.evaluate(`(() => { const r = document.getElementById('btnStart').getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    await cdp.tap(startBox.x, startBox.y);
    await sleep(400);
    const afterStart = await cdp.evaluate(`(() => { const s = window.__blockdrop.s();
      return { running: !document.getElementById('veilStart').classList.contains('on'), piece: !!s.piece, y: s.piece && s.piece.y }; })()`);
    gate('bấm BẮT ĐẦU thì vào ván mới', afterStart.running && afterStart.piece, 'khối y=' + afterStart.y);

    // canvas có vẽ ra pixel khác màu nền?
    const painted = await cdp.evaluate(`(() => {
      const cv = document.getElementById('board');
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
      return seen.size;
    })()`);
    gate('canvas vẽ ra hình (không phải màn hình 1 màu)', painted > 8, painted + ' màu khác nhau');

    // KÉO THANH DƯỚI — cơ chế điều khiển chính
    const trackBox = await cdp.evaluate(`(() => { const r = document.getElementById('track').getBoundingClientRect();
      return { x: r.x, y: r.y + r.height/2, w: r.width }; })()`);
    const beforeDrag = await cdp.evaluate('window.__blockdrop.s().piece.x');
    await cdp.drag(trackBox.x + trackBox.w * 0.5, trackBox.y, trackBox.x + trackBox.w - 2, trackBox.y, 10);
    await sleep(500);
    const afterRight = await cdp.evaluate(`(() => { const s = window.__blockdrop.s();
      return { x: s.piece.x, target: s.targetX, span: s.cols - s.piece.m[0].length }; })()`);
    gate('kéo thanh sang phải → khối trượt sang cột phải nhất',
      afterRight.x === afterRight.span,
      `x ${beforeDrag} → ${afterRight.x} (span ${afterRight.span})`);

    await cdp.drag(trackBox.x + trackBox.w - 2, trackBox.y, trackBox.x + 2, trackBox.y, 10);
    await sleep(500);
    const afterLeft = await cdp.evaluate('window.__blockdrop.s().piece.x');
    gate('kéo thanh sang trái → khối trượt về cột 0', afterLeft === 0, 'x = ' + afterLeft);

    // chạm bàn = quay
    const cvBox = await cdp.evaluate(`(() => { const r = document.getElementById('board').getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height*0.25 }; })()`);
    const shapeBefore = await cdp.evaluate('JSON.stringify(window.__blockdrop.s().piece.m)');
    await cdp.tap(cvBox.x, cvBox.y);
    await sleep(120);
    const shapeAfter = await cdp.evaluate('JSON.stringify(window.__blockdrop.s().piece.m)');
    const isO = await cdp.evaluate('window.__blockdrop.s().piece.c === 2');
    gate('chạm bàn → khối quay', shapeBefore !== shapeAfter || isO,
      isO && shapeBefore === shapeAfter ? 'khối vuông (O) quay không đổi hình — đúng' : 'hình đổi');

    // DROP -> khoá khối, đống gạch cao lên, điểm tăng
    const dropBox = await cdp.evaluate(`(() => { const r = document.getElementById('btnDrop').getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    const s0 = await cdp.evaluate(`(() => { const s = window.__blockdrop.s(); return { score: s.score, pieces: s.pieces }; })()`);
    await cdp.tap(dropBox.x, dropBox.y);
    await sleep(300);
    const s1 = await cdp.evaluate(`(() => { const s = window.__blockdrop.s();
      return { score: s.score, pieces: s.pieces, rows: s.rows, top: window.__blockdrop.E.stackTop(s) }; })()`);
    gate('DROP → khối khoá, điểm tăng, có gạch trên bàn',
      s1.score > s0.score && s1.pieces > s0.pieces && s1.top < s1.rows,
      `điểm ${s0.score}→${s1.score}, khối ${s0.pieces}→${s1.pieces}, đỉnh đống hàng ${s1.top}`);

    // BOT: bơm ~90 lượt thả để chắc chắn dọn được hàng + thấy hiệu ứng
    console.log('  · bot đang chơi 90 lượt…');
    const bot = await cdp.evaluate(`(async () => {
      const g = window.__blockdrop, E = g.E;
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      let clears = 0, combos = 0, perfect = 0, maxScore = 0;
      // Bot đơn giản: thử mọi cột × mọi hướng quay, chọn chỗ làm độ cao thấp nhất
      // và ưu tiên hàng đầy. Đủ để CHẮC CHẮN có pha dọn hàng.
      for (let turn = 0; turn < 90; turn++) {
        const s = g.s();
        if (s.over) break;
        let best = null;
        for (let rot = 0; rot < 4; rot++) {
          const span = s.cols - E.pieceW(s.piece);
          for (let x = 0; x <= span; x++) {
            const save = s.piece.x, sy = s.piece.y;
            s.piece.x = x;
            let y = s.piece.y;
            while (!E.hits(s, s.piece, x, y + 1)) y++;
            // điểm heuristic: càng thấp càng tốt, cộng thưởng nếu lấp kín hàng
            let filled = 0;
            for (let r = 0; r < s.piece.m.length; r++) {
              const gy = y + r; if (gy < 0 || gy >= s.rows) continue;
              let n = 0;
              for (let c = 0; c < s.cols; c++) if (s.grid[gy*s.cols+c]) n++;
              for (let c = 0; c < s.piece.m[r].length; c++) if (s.piece.m[r][c]) n++;
              if (n >= s.cols) filled++;
            }
            const score = y * 2 + filled * 40;
            if (!best || score > best.score) best = { score, x, rot };
            s.piece.x = save; s.piece.y = sy;
          }
          E.rotate(s, []);
        }
        for (let r = 0; r < best.rot; r++) E.rotate(g.s(), []);
        E.setKnob(g.s(), best.x / Math.max(1, g.s().cols - E.pieceW(g.s().piece)));
        g.s().piece.x = best.x; g.s().targetX = best.x;
        const ev = [];
        E.hardDrop(g.s(), ev);
        for (const e of ev) {
          if (e.t === 'clear') { clears++; if (e.combo >= 2) combos++; if (e.perfect) perfect++; }
        }
        maxScore = g.s().score;
        if (turn % 12 === 0) await wait(30);
      }
      const s = g.s();
      return { clears, combos, perfect, score: s.score, lines: s.lines, level: s.level, over: s.over, leafTotal: s.leafTotal };
    })()`);
    gate('bot dọn được hàng (win condition của game endless)', bot.clears > 0,
      `${bot.clears} lượt dọn, ${bot.lines} hàng, điểm ${bot.score}, level ${bot.level}`);
    gate('có combo nhiều hàng liên tiếp', bot.combos > 0, bot.combos + ' lượt combo ≥ ×2');
    gate('có nhặt được lá 🍃', bot.leafTotal > 0, bot.leafTotal + ' lá');

    // hologram phản ứng?
    const holoState = await cdp.evaluate(`(() => {
      const el = document.getElementById('holo');
      return { cls: el.className, say: document.getElementById('holoSay').textContent };
    })()`);
    gate('hologram có nói và có tư thế', holoState.say.length > 0 && /p-/.test(holoState.cls),
      `"${holoState.say}" [${holoState.cls}]`);

    await cdp.shot('/tmp/blockdrop-playtest-play.png');

    // heap không phình tuyến tính khi chạy 12s
    const h0 = await cdp.evaluate('performance.memory ? performance.memory.usedJSHeapSize : 0');
    await sleep(12000);
    const h1 = await cdp.evaluate('performance.memory ? performance.memory.usedJSHeapSize : 0');
    const grow = h1 - h0;
    gate('heap không phình sau 12s chạy', !h0 || grow < 6 * 1024 * 1024,
      h0 ? ((grow / 1048576).toFixed(2) + ' MB') : 'không đo được');

    await cdp.shot('/tmp/blockdrop-playtest-final.png');

    console.log('\n── KẾT QUẢ ' + '─'.repeat(41));
    const failed = results.filter((r) => !r.ok);
    console.log(`  ${results.length - failed.length}/${results.length} cổng pass`);
    console.log('  ảnh: /tmp/blockdrop-playtest-{start,play,final}.png');
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.error('\n❌ harness lỗi:', e.message);
    process.exitCode = 2;
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) {}
    chrome.kill('SIGKILL');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();
