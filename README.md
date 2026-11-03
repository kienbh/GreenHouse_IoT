# Nhà kính IoT – Bài 4: MQTT

```
ESP32 (firmware/) ──MQTT 1883──► Mosquitto trên PC (mqtt_broker/) ◄──MQTT── App local (app/) ──► http://localhost:3000
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
app/start.sh                  # 2. app, mở http://localhost:3000
cd firmware && pio run -t upload -t monitor   # 3. nạp ESP32 (sửa src/secrets.h trước)
```

Chưa có board: chạy `app/sim.sh` thay cho bước 3.

## Topic (T = `vju/nhakinh/esp32-01`)

| Topic | Hướng | Nội dung |
|---|---|---|
| `T/status` | ESP32 → | `online` / `offline` (retained, `offline` do broker gửi nhờ Last Will) |
| `T/telemetry` | ESP32 → | JSON mỗi 5 s: `t`, `h`, `code`, `ledR`, `ledG`, `ledArray`, `auto`, `th`, `pump{st,duty,out,lim,cd,el,cool,msg}`, `rssi`, `up` |
| `T/event` | ESP32 → | JSON từng dòng nhật ký: `{"lv":"E","msg":"B3 FSM CHAY -> LOI: ..."}` |
| `T/cmd` | → ESP32 | JSON, khóa giống `/api/set` và `/api/ctrl`: `{"ledR":1}` `{"ledArray":2}` `{"auto":1,"th":29}` `{"cmd":"start"}` `{"duty":60,"lim":20}` |

Lệnh máy bơm vẫn đi qua máy trạng thái Bài 3: lệnh sai khi đang CHẠY → LỖI, hết `lim` giây tự dừng kể cả khi mất mạng.

## Tài khoản broker mặc định

`esp32 / esp32pass` (firmware), `app / apppass` (app, sub.sh, pub.sh). Đổi: `mqtt_broker/setup.sh <tên> <mật khẩu>`.

## Lỗi thường gặp

- ESP32 báo `MQTT loi ket noi (state -2)`: sai IP trong `secrets.h`, PC và ESP32 khác mạng, tường lửa macOS chặn cổng 1883, hoặc WiFi bật cách ly thiết bị (client isolation).
- `state 5`: sai tài khoản/mật khẩu MQTT.

## Bản sao số 3D (`http://localhost:3000/3d.html`)

Three.js (cài trong `node_modules`, không cần internet) hiển thị model Meshy, trạng thái thật lấy từ MQTT:
LED đỏ/xanh sáng, dải LED bật/nháy, vòng sáng máy bơm (xám DỪNG · xanh CHẠY · đỏ LỖI) và nước nhỏ giọt khi bơm chạy,
nhãn nhiệt ẩm trên cảm biến. Bấm vào LED, dải LED, máy bơm hoặc nhãn để gửi lệnh.

Model là 1 khối liền nên các bộ phận tương tác được đặt chồng lên theo toạ độ trong bảng `SPOT` đầu file `3d.html`.
Lệch thì Alt + bấm lên mô hình để lấy toạ độ (tự chép vào clipboard) rồi sửa số trong `SPOT`.

Nén lại model khi xuất bản mới từ Meshy:
```sh
npx @gltf-transform/cli optimize assess/<file>.glb app/public/models/nhakinh.glb \
  --simplify-ratio 0.1 --texture-size 2048 --texture-compress webp --compress meshopt
```
