# Block Drop

**Chơi ngay: https://drop.bomclaw.org**

Xếp khối kiểu Tetris nhưng **điều khiển bằng thanh kéo dưới màn hình**: kéo núm vàng
để chọn cột, khối đang rơi tự trượt tới đó rồi thả xuống. Bên phải là **bạn đồng hành
hologram** — cổ vũ, khen, nhắc nhở theo từng pha bạn đánh.

Portrait, mobile-first, vanilla JS, không build step: mở `index.html` là chạy.

## Chơi

| Thao tác | Việc |
|---|---|
| Kéo núm vàng trên thanh dưới | chọn cột — cơ chế điều khiển chính |
| Chạm hai bánh vàng hai đầu | nhích 1 cột |
| Chạm vào bàn | quay khối |
| `DROP` | thả nhanh, +2 điểm/ô |
| Chip 🍃 | dùng "gió lá": thổi bay 2 hàng dưới cùng |
| Bàn phím | ←/→ nhích · ↑/X quay · Space/↓ thả · Z gió lá · P tạm dừng |

## Luật và cân bằng

Bàn **8 × 18**. Mọi hằng số cân bằng nằm ở đầu `engine.js`, có đơn vị:

| Thứ | Giá trị |
|---|---|
| Rơi 1 ô | 850ms ở level 1, trừ 62ms mỗi level, sàn 130ms |
| Lock delay | 300ms (còn trượt được sau khi chạm đáy; quay được thì gia hạn) |
| Điểm dọn hàng | 100 / 300 / 500 / 800 × level |
| Combo | +50 × (combo−1) × level, đứt khi khoá khối mà không dọn được hàng |
| All clear | +2000 |
| Level | mỗi 1000 điểm |
| Lá 🍃 | 22% khối mang 1 ô lá · 5 lá = 1 lượt gió lá · gió lá xoá 2 hàng dưới |
| Báo nguy | đống cao tới hàng thứ 4 → viền đỏ nhấp nháy |

## Hologram

`hologram.js` **chỉ nhận sự kiện từ engine** (`clear`, `levelup`, `danger`, `power`, `over`…)
rồi đổi tư thế + câu thoại + tia sáng. Nó không đọc state, không biết luật — nên sửa lời
cổ vũ không có cách nào làm vỡ logic game. Mỗi loại sự kiện có **hạng ưu tiên**: pha nhỏ
(`nice`, `leaf`) không được cắt ngang lời khen lớn (`perfect`, `tetris`) đang hiện.

Tư thế: `idle · cheer · wow · worry · sad` — mascot là SVG inline, đổi bộ phận theo class,
không có ảnh nhị phân nào trong bundle.

## Kiến trúc

| File | Việc |
|---|---|
| `engine.js` | luật thuần: lưới, khối, quay + wall-kick, dọn hàng, combo, lá, level. Không chạm DOM, không đọc đồng hồ (thời gian vào qua `dt`) → test được bằng node |
| `game.js` | vẽ canvas + input. Hạt/chữ nổi/vệt sáng là **pool cấp phát sẵn**, gradient cache theo layout — không cấp phát trong vòng lặp render |
| `hologram.js` | panel cổ vũ |
| `sfx.js` | âm thanh tổng hợp bằng WebAudio, không file ngoài |
| `arcade-bridge.js` | nối platform Arcade (bảng xếp hạng + save cloud). Platform chết thì game vẫn chơi bằng `localStorage` |

Engine trả **mảng sự kiện** cho mỗi hành động thay vì tự gọi hiệu ứng. Đó là lý do UI, âm
thanh và hologram cắm vào được mà engine không biết chúng tồn tại.

## Chạy và verify

```bash
npm test                  # 17 test engine (luật, combo, lá, power, game over, fuzz)
node server.js            # standalone: http://127.0.0.1:8790/
node test/playtest.js     # cổng G2/G3 bằng Chrome headless: boot, 390×844, kéo thanh → state đổi, bot dọn hàng
```

`test/playtest.js` mở game thật trong Chrome headless, bơm ngón tay giả vào thanh kéo và
kiểm tra state **đổi** — đây là cổng bắt lỗi "vẽ đẹp mà không tương tác". Nó cũng chạy một
bot 90 lượt để chắc chắn dọn được hàng, có combo và nhặt được lá.

Trên platform: `http://127.0.0.1:8090/g/blockdrop/` · công khai: https://drop.bomclaw.org

Game được phục vụ bởi [platform Arcade](https://github.com/phanngoc) (backend dùng chung cho
nhiều game: guest auth, bảng xếp hạng, save cloud). Thêm game vào platform = 1 row DB +
1 dòng ingress cloudflared + 1 CNAME, không cần service riêng.

Nhưng game **không phụ thuộc** platform: `arcade-bridge.js` nuốt mọi lỗi, không có platform
thì kỷ lục lưu bằng `localStorage` và game chơi y như cũ. Chạy `node server.js` là đủ.
