# Bài tập nhóm: ESP32 MQTT client + dashboard lớp

Mỗi nhóm SV có 1 ESP32 + AHT20 (nhiệt độ, độ ẩm) + LED + nút nhấn, làm MQTT client.
Máy giảng viên chạy broker Mosquitto (dùng chung `../mqtt_broker`) và dashboard phát trực tiếp dữ liệu các nhóm.

```
ESP32 nhóm 01..12 ──MQTT 1883──► Mosquitto (máy GV) ◄── dashboard (lab_nhom/dashboard) ──SSE──► màn chiếu
```

## Chuẩn bị trước giờ học

1. **Broker:** `cd ../mqtt_broker && ./start.sh` (đang chạy thì bỏ qua).
   - SV kết nối **không cần tài khoản**.
   - File `acl` chỉ cho client không tài khoản dùng nhánh `vju/iot/#`, nên nhánh nhà kính `vju/nhakinh` vẫn chỉ tài khoản có mật khẩu mới ghi được.
2. **Dashboard:** `cd dashboard && ./start.sh`.
   - Mở http://localhost:3100 để xem dashboard.
   - Chiếu http://localhost:3100/huong-dan.html cho SV. Trang này tự hiện IP broker hiện tại.
3. **Thử trước khi có board:** `./sim.sh 8` giả lập 8 nhóm.
   - nhom07 rớt mạng mỗi phút.
   - nhom08 thỉnh thoảng gửi JSON hỏng.

Máy GV và các ESP32 phải cùng mạng WiFi. IP do DHCP cấp nên có thể đổi giữa các buổi học; nên nhờ IT giữ cố định IP cho máy GV.

## Quy ước (SV phải theo)

SV chỉ cần biết **IP máy GV** và **cổng 1883**. So với code mẫu Random Nerd Tutorials, SV sửa các chỗ sau:

| Code mẫu | Sửa thành (nhóm 01) |
|---|---|
| `mqtt_server = "YOUR_MQTT_BROKER_IP_ADDRESS"` | IP máy GV, ví dụ `"172.16.6.164"` |
| `client.connect("ESP8266Client")` | `client.connect("nhom01-esp32", "vju/iot/nhom01/status", 1, true, "offline")`: Client ID riêng + Last Will |
| `esp32/temperature`, `esp32/humidity` | 1 gói JSON lên `vju/iot/nhom01` |
| `esp32/output` (`on`/`off`) | `vju/iot/nhom01/output` (vẫn `on`/`off`) |

Gói JSON gửi mỗi 5 s và ngay khi LED/nút đổi:

```json
{"nhom": "nhom01", "temp": 26.4, "hum": 61.2, "led": 1, "btn": 0}
```

- `led`, `btn` nhận giá trị 0/1; `btn` = 1 nghĩa là đang nhấn.
- Kết nối xong gửi `online` (retained) vào `vju/iot/nhom01/status`.

Dashboard nhận mọi gói gửi lên `vju/iot/...`, không cần đăng ký trước. Gói sai không bị bỏ qua im lặng mà hiện cảnh báo màu cam trên thẻ nhóm và trong **Nhật ký MQTT**:
- JSON sai cú pháp.
- Thiếu `temp` hoặc `hum`.
- Khoá lạ.
- Giá trị ngoài dải đo.
- `nhom` trong JSON khác tên trên topic.

Nhóm nào vẫn gửi tách topic kiểu bài gốc (`vju/iot/nhom01/temperature`) thì dashboard vẫn nhận.

## Dashboard

- **Thẻ mỗi nhóm:** trạng thái (online, offline, im lặng > 30 s, chưa kết nối), nhiệt kế, vòng độ ẩm, bóng LED, nút nhấn kèm số lần nhấn, biểu đồ 15 phút, tải CSV.
- **Bấm bóng LED** trên thẻ → gửi `on`/`off` vào `vju/iot/<nhóm>/output`. Dùng để chấm phần subscribe của SV.
- **Dữ liệu:** ghi vào `dashboard/data/YYYY-MM-DD/<nhóm>.csv` (dạng `time,field,value`).
- **Số thẻ hiện sẵn:** mặc định 12 thẻ `nhom01..nhom12`; đổi bằng `GROUPS` trong `dashboard/.env`.

## Code mẫu (đáp án)

`sv_mau/nhom_mau/nhom_mau.ino`:
- Viết cho Arduino IDE, sửa từ code Random Nerd Tutorials.
- Thư viện: PubSubClient, ArduinoJson, Adafruit AHTX0.
- Chân: AHT20 SDA 21 / SCL 22, LED GPIO26, nút GPIO4 nối GND.
- Đã biên dịch thử cho ESP32.

Dashboard không phục vụ file này qua web. GV tự quyết có phát cho SV hay không.
