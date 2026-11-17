# Nhà kính IoT – Bài 4–10: MQTT, dashboard, luật tự động, bảo mật, chịu lỗi

Báo cáo và kết quả thử Bài 6–10: [docs/BAI6-10.md](docs/BAI6-10.md) · sơ đồ: [docs/uml/](docs/uml/)

```
ESP32 (firmware/) ──MQTTS 8883──► Mosquitto trên PC (mqtt_broker/) ◄──MQTTS── App (app/) ──► http://localhost:3000 · https://<IP>:3443
```

| Thư mục | Nội dung |
|---|---|
| `mqtt_broker/` | Cấu hình Mosquitto + script: `setup.sh` (cài, tạo tài khoản), `start.sh` (chạy broker), `sub.sh` / `pub.sh` (thử bằng dòng lệnh) |
| `firmware/` | PlatformIO, kế thừa vidu3 (web /, /data, /ctrl giữ nguyên) + MQTT client. Thông tin WiFi/broker ở `src/secrets.h` |
| `app/` | Node.js: nhận dữ liệu, ghi CSV `data/<thiết bị>/`, dashboard `/` và bản sao số 3D `/3d.html`. `sim.sh` giả lập 1 ESP32 |
| `assess/` | Model gốc từ Meshy AI (81 MB). Bản nén cho web: `app/public/models/nhakinh.glb` (3.5 MB) |
| `vidu3/` | Bản gốc Bài 1–3, không sửa |

## Chạy (3 terminal)

```sh
mqtt_broker/start.sh          # 1. broker, in ra IP của PC
app/start.sh                  # 2. app, mở http://localhost:3000 rồi đăng nhập
cd firmware && pio run -t upload -t monitor   # 3. nạp ESP32 (sửa src/secrets.h trước)
```

Lần đầu trên máy mới (Bài 8, không còn mật khẩu mặc định):

```sh
mqtt_broker/tls/make-certs.sh && mqtt_broker/tls/ca-header.sh   # CA nhóm + chứng chỉ server theo IP hiện tại
mqtt_broker/setup.sh            # mật khẩu MQTT ngẫu nhiên -> accounts.local, app/.env, firmware/src/secrets.h
cd app && node tools/user.js init   # 3 tài khoản dashboard: xem / van-hanh / quan-tri -> app/data/accounts-app.local
```

**IP của PC đổi** (DHCP): chạy lại `mqtt_broker/tls/make-certs.sh`, sửa `MQTT_HOST` trong `firmware/src/secrets.h`, khởi động lại broker + app, nạp lại ESP32. CA giữ nguyên.
Điện thoại trong mạng LAN: mở `https://<IP>:3443/ca.crt`, cài và tin cậy chứng chỉ (iOS: Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng nhận), rồi vào `https://<IP>:3443`.

Chưa có board: chạy `app/sim.sh` thay cho bước 3.

## Topic (T = `vju/nhakinh/esp32-01`)

| Topic | Hướng | Nội dung |
|---|---|---|
| `T/status` | ESP32 → | `online` / `offline` (retained, `offline` do broker gửi nhờ Last Will) |
| `T/telemetry` | ESP32 → | JSON mỗi 5 s: `t`, `h`, `code`, `ledR`, `ledG`, `ledArray`, `auto`, `th`, `pump{st,duty,out,lim,cd,el,cool,msg}`, `rssi`, `up` |
| `T/event` | ESP32 → | JSON từng dòng nhật ký: `{"lv":"E","msg":"B3 FSM CHAY -> LOI: ..."}` |
| `T/cmd` | → ESP32 | JSON, khóa giống `/api/set` và `/api/ctrl`: `{"ledR":1}` `{"ledArray":2}` `{"auto":1,"th":29}` `{"cmd":"start"}` `{"duty":60,"lim":20}`; dịch vụ thêm `cmd_id`, `src` (Bài 6–7). Khóa mới: `lock`, `period`, `testT`, `testFault`, `outage`+`mode` |
| `T/ack` | ESP32 → | `{"cmd_id","status":"applied\|rejected\|duplicate","reason","state"}` gửi sau khi đã ghi đầu ra (Bài 6) |

Lệnh máy bơm vẫn đi qua máy trạng thái Bài 3: lệnh sai khi đang CHẠY → LỖI, hết `lim` giây tự dừng kể cả khi mất mạng.

## Tài khoản (Bài 8)

- Broker (cổng 8883, TLS): `app` (dịch vụ, bên duy nhất được gửi lệnh), `viewer` (chỉ đọc), `esp32-01`, `sim-01`, `sleep-01` (mỗi node chỉ ghi nhánh của mình). Mật khẩu ngẫu nhiên trong `mqtt_broker/accounts.local`; quyền trong `mqtt_broker/acl`. Đổi: `mqtt_broker/setup.sh <tên> <mật khẩu>`.
- Cổng 1883 không mã hóa chỉ còn cho bài tập nhóm `lab_nhom` (vô danh, nhánh `vju/iot/#`).
- Dashboard: `xem` (viewer), `van-hanh` (operator), `quan-tri` (admin), mật khẩu trong `app/data/accounts-app.local`.
- Kiểm thử phân quyền: trang đăng nhập liệt kê tài khoản, vai, quyền và nút "Dùng". Mật khẩu chỉ hiện khi `SHOW_TEST_PASSWORDS=1` trong `app/.env` **và** mở từ chính máy chạy app (qua mạng không bao giờ hiện). **Đặt `0` trước khi demo/nộp.** Thêm/đổi: `node app/tools/user.js add <tên> <viewer|operator|admin>`.
- Thử lại bảng ca TLS/ACL: `mqtt_broker/test-acl.sh`.

## Công cụ thử Bài 6–9 (trong `app/`)

```sh
node tools/lab-tests.js bai6 sim-01        # vòng lệnh: hợp lệ, mất ack, sai quyền, lệnh trùng (esp32-01: thêm ALLOW_PUMP=1 để thử bơm thật)
node tools/lab-tests.js bai7 esp32-01      # luật 30/28 °C bằng dữ liệu thử, khóa an toàn, tự động/thủ công
node tools/outage-test.js esp32-01 20 wifi # mất mạng có chủ đích, đối chiếu theo seq; 90 wifi = vượt bộ đệm; 20 clean = ngắt chủ động
node tools/seq-report.js esp32-01 2026-11-17T08:00:00Z
node tools/backup.js backup && node tools/backup.js verify backups/<file>.sqlite
npm test                                   # 20 test cách ly (broker giả, thư mục tạm)
```

## Lỗi thường gặp

- ESP32 báo `MQTT loi ket noi (state -2, TLS: ...)`: IP PC đã đổi (hay gặp nhất, xem mục đổi IP), chứng chỉ server không ghi IP đó, PC và ESP32 khác mạng, tường lửa macOS chặn cổng 8883, hoặc WiFi bật cách ly thiết bị (client isolation).
- `state 5`: sai tài khoản/mật khẩu MQTT.

## Bản sao số 3D (`http://localhost:3000/3d.html`)

Three.js (cài trong `node_modules`, không cần internet) hiển thị model Meshy, trạng thái thật lấy từ MQTT:
LED đỏ/xanh sáng, dải LED bật/nháy, vòng sáng máy bơm (xám DỪNG · xanh CHẠY · đỏ LỖI) và nước nhỏ giọt khi bơm chạy,
nhãn nhiệt ẩm trên cảm biến. Mô hình 3D nằm trong khung nhỏ cạnh dashboard rộng hơn; bấm bộ phận hoặc nhãn chỉ xem thông tin. Gửi lệnh bằng các nút rõ ràng trong dashboard.

Giao diện `/` và `/3d.html` dùng chung bố cục responsive: chỉ số, biểu đồ 30 phút, điều khiển, nhật ký và công cụ MQTT/JSON thu gọn. Khi đổi thiết bị, dữ liệu chưa có được xóa về `--`, không giữ số liệu của thiết bị trước. Điều khiển tạm khóa khi mất ứng dụng/broker, thiết bị không online hoặc telemetry quá 15 giây. Đây là bảo vệ ở giao diện, không thay thế xác thực hay kiểm tra lệnh ở server/firmware. Bình nước và độ ẩm đất 3D là mô phỏng, không phải cảm biến thực.

Model là 1 khối liền nên các bộ phận tương tác được đặt chồng lên theo toạ độ trong bảng `SPOT` đầu file `3d.html`.
Lệch thì Alt + bấm lên mô hình để lấy toạ độ (tự chép vào clipboard) rồi sửa số trong `SPOT`.

Nén lại model khi xuất bản mới từ Meshy:
```sh
npx @gltf-transform/cli optimize assess/<file>.glb app/public/models/nhakinh.glb \
  --simplify-ratio 0.1 --texture-size 2048 --texture-compress webp --compress meshopt
```

## Lưu MQTT vào SQLite

App lưu **mỗi bản tin nhận được** thuộc 4 topic sẵn có:
`vju/nhakinh/+/status`, `vju/nhakinh/+/telemetry`, `vju/nhakinh/+/event`, `vju/nhakinh/+/cmd`.
Dấu `+` là tên thiết bị, ví dụ `esp32-01` hoặc `sim-01`; nếu đặt `MQTT_BASE` thì dùng tiền tố đó.
Không đổi chu kỳ gửi, không loại bỏ giá trị lặp, không gộp mẫu và không tự xóa lịch sử.
Lệnh `cmd` chỉ được quan sát để lưu, không được phát lại hoặc thực thi bởi bộ lưu trữ.

- File mặc định: `app/data/mqtt.sqlite` (file `-wal` / `-shm` cạnh đó là file phụ SQLite khi app chạy).
- Bảng `mqtt_messages`: `id`, `received_at` (UTC ISO 8601, lúc app nhận), `topic`, `payload`, `qos`, `retain`, `dup`.
- `payload` là BLOB để giữ nguyên byte nhận được, kể cả JSON sai. Khi xem nội dung chữ, dùng `CAST(payload AS TEXT)`.
- CSV, dashboard và bản sao số 3D vẫn giữ nguyên. Không nhập ngược CSV cũ vào bảng MQTT vì CSV không còn đủ payload gốc.
- Sau khi cập nhật, chạy `cd app && npm install --cache .npm-cache` rồi khởi động lại app bằng `./start.sh`.
- Chạy kiểm thử cách ly: `cd app && npm test`. Kiểm thử dùng broker giả trên localhost và thư mục tạm, không gửi lệnh tới ESP32.
- Có thể đặt `DATA_DIR` để đổi thư mục lưu cả SQLite và CSV (hữu ích khi kiểm thử).

Xem bản tin mới nhất từ thư mục gốc dự án:

```sh
sqlite3 -header -column app/data/mqtt.sqlite \
  'SELECT id, received_at, topic, CAST(payload AS TEXT) AS payload FROM mqtt_messages ORDER BY id DESC LIMIT 10;'
```

SQLite chỉ lưu những gì app thực sự nhận được. Firmware hiện phát telemetry/event ở QoS 0, nên các bản tin phát trong lúc app/broker/mạng ngắt không được bảo đảm lưu bù. Tin retained nhận lại khi kết nối sẽ có hàng riêng và cờ `retain` để phân biệt. Đừng gửi mật khẩu, token hay bí mật cấu hình qua các topic này vì kho lưu giữ nguyên payload.
