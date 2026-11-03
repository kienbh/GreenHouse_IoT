# So sánh timer phần cứng và millis()

Hướng dẫn cho thẻ **"Timer phần cứng vs millis()"** và **"Đồ thị thời gian thực"** trên trang `/ctrl` (Bài 3). Kết quả dùng để trả lời mục **4.3** trong README.

## 1. Mục tiêu

Đề bài yêu cầu:

> Dùng timer phần cứng tạo sự kiện định kỳ, đo chu kỳ thực tế và so với giá trị đã đặt. Đối chiếu độ ổn định chu kỳ của timer phần cứng với bản dùng `millis()` ở Bài 2.

Hai cách cùng tạo một sự kiện lặp lại mỗi **T ms** (mặc định 100 ms). Ta đo khoảng cách thực tế giữa hai lần sự kiện liên tiếp và xem cách nào đều hơn.

## 2. Hai cách tạo sự kiện định kỳ

### Cách 1: timer phần cứng

ESP32 có bộ đếm riêng chạy độc lập với chương trình. Khi đếm đủ T ms, nó gọi ngắt `onTimer()`, dù `loop()` đang làm gì.

```cpp
hwTimer = timerBegin(1, 80, true);                 // timer số 1, chia 80 MHz -> 1 nhịp = 1 µs
timerAttachInterrupt(hwTimer, onTimer, true);
timerAlarmWrite(hwTimer, timerMs * 1000ULL, true); // T ms = T*1000 nhịp, tự lặp lại
timerAlarmEnable(hwTimer);

void IRAM_ATTR onTimer() {      // ISR: chỉ ghi lại thời điểm, không in Serial, không delay
  uint32_t now = micros();
  ...                           // khoảng = now - lần trước
}
```

### Cách 2: millis() trong loop (như logger Bài 2)

`loop()` tự kiểm tra xem đã qua T ms chưa. Sự kiện chỉ xảy ra khi `loop()` **được chạy tới** dòng kiểm tra này.

```cpp
void updateLoopTimer() {
  if (millis() - loopTick < timerMs) return;
  loopTick += timerMs;                                     // giữ nhịp đều
  if (millis() - loopTick >= timerMs) loopTick = millis(); // trễ quá 1 chu kỳ thì bắt nhịp lại
  ...                                                      // khoảng = micros() - lần trước
}
```

### Cách đo

Cả hai cách cùng đo bằng `micros()`, độ phân giải 1 µs. Với mỗi lần sự kiện, ESP32 tính **khoảng = thời điểm lần này − thời điểm lần trước**, rồi:

- cộng vào thống kê: số lần, trung bình, nhỏ nhất, lớn nhất;
- lưu vào vòng đệm 512 điểm gần nhất để trang web vẽ đồ thị.

## 3. Giao diện

### Thẻ "Timer phần cứng vs millis()"

| Ô / nút | Ý nghĩa |
|---|---|
| **Chu kỳ đặt (10–2000 ms)** | Giá trị T. Bấm **Áp dụng** thì cả hai cách đổi chu kỳ và thống kê được đặt lại |
| **Số lần** | Số khoảng đã đo kể từ lần đặt lại |
| **TB (ms)** | Trung bình các khoảng, cho biết có **trôi** hay không |
| **Min / Max** | Khoảng ngắn nhất và dài nhất |
| **Lệch max** | Độ lệch xa nhất so với T: `max(Max − T, T − Min)` |
| **↺ Đặt lại** | Xoá thống kê và đồ thị, đo lại từ đầu |
| **📌 Ghi** | Ghi một dòng kết quả vào **Bảng kết quả** ở cuối trang |

### Thẻ "Đồ thị thời gian thực"

- **Trục ngang:** thời gian. Mép phải là "bây giờ", đồ thị tự cuộn.
- **Trục dọc:** khoảng đo được (ms). Mỗi điểm là một lần sự kiện.
- **Đường xanh dương:** timer phần cứng. **Đường cam:** millis() trong loop. **Vạch đứt:** chu kỳ đặt T.
- **Cửa sổ:** xem 10, 30, 60 hoặc 120 s gần nhất.
- **Trục dọc – Tự động:** co giãn để thấy cả gai rất lớn (vài nghìn ms).
- **Trục dọc – Phóng to ±25%:** chỉ xem quanh T để thấy dao động nhỏ. Điểm vượt khung hiện thành **▲/▼** ở mép kèm giá trị.
- **Chú thích dưới đồ thị:** số điểm, trung bình và lệch max **trong cửa sổ đang xem**.
- **⏸ Tạm dừng:** đứng hình để chụp hoặc đọc số. **⬇ Tải chart.png:** lưu ảnh đồ thị đang hiển thị.

> Một điểm nằm đúng trên vạch đứt nghĩa là sự kiện đến đúng hẹn. Điểm nằm cao hơn là đến muộn, thấp hơn là đến sớm (thường ngay sau một lần muộn).

## 4. Các bước làm thí nghiệm

Kết nối WiFi **NhaKinh-ESP32** (mật khẩu `12345678`), mở `http://192.168.4.1/ctrl`.

### Thí nghiệm A: chạy bình thường

1. Đặt chu kỳ **100 ms**, bấm **Áp dụng**.
2. Đồ thị chọn cửa sổ **30 s**, trục dọc **Phóng to ±25%**.
3. Chờ khoảng 1 phút, quan sát hai đường.
4. Bấm **📌 Ghi** ở thẻ timer, rồi **⏸ Tạm dừng** và **⬇ Tải chart.png**. Đổi tên ảnh thành `timer_normal.png`.

### Thí nghiệm B: CPU bận

1. Bấm **↺ Đặt lại**. Chuyển trục dọc sang **Tự động**.
2. Ở thẻ **Ngắt ngoài**, bấm **⏳ CPU bận 5 s + bấm 5 lần**. Trong 5 s này `loop()` bị chặn vì phải đọc cảm biến liên tục. Trang web cũng đứng, đó là bình thường.
3. Khi trang chạy lại, quan sát gai trên đường cam.
4. **📌 Ghi**, tạm dừng, tải ảnh và đặt tên `timer_busy.png`.

### Thí nghiệm C (tuỳ chọn): ảnh hưởng của ghi flash

1. Mở `/data`, bật ghi dữ liệu chu kỳ 1 s. Quay lại `/ctrl`, **Đặt lại**, xem ở chế độ **Phóng to** trong 1 phút.
2. Vào `/data` bấm **dừng ghi**, quay lại **Đặt lại**, xem thêm 1 phút.
3. So sánh số gai nhỏ trên **đường xanh** giữa hai lần.

### Thí nghiệm D (tuỳ chọn): đổi chu kỳ

Lặp lại thí nghiệm A với **10 ms** và **1000 ms**. Với chu kỳ càng nhỏ thì độ lệch tính theo **phần trăm** của millis() càng lớn.

## 5. Kết quả thường gặp và cách giải thích

| | Timer phần cứng | millis() trong loop |
|---|---|---|
| **TB** | ≈ T, gần như tuyệt đối (vd. 100.000 ms) | ≈ T |
| **Dao động bình thường** | Rất nhỏ, cỡ µs | Vài ms, tuỳ `loop()` đang bận gì |
| **Khi CPU bận 5 s** | Vẫn đều | Có 1 khoảng ≈ **5000 ms**, mất khoảng 49 sự kiện |
| **Khi ghi flash** | Thỉnh thoảng có cặp gai đối xứng (vd. 116.5 / 83.5 ms) | Cũng bị, lẫn trong dao động chung |

### Vì sao millis() kém đều?

`millis()` vẫn đếm thời gian chính xác. Vấn đề là **việc kiểm tra** nằm trong `loop()`. Khi `loop()` đang phục vụ web, đọc I2C, ghi log hoặc bị chặn thì sự kiện phải chờ. Độ trễ phụ thuộc vào chương trình, nên không đoán trước được.

### Vì sao timer phần cứng đều?

Bộ đếm chạy bằng phần cứng, độc lập với `loop()`. Đến hạn là nó ngắt ngay, kể cả khi `loop()` đang bị chặn 5 s.

### Cặp gai đối xứng trên đường xanh là gì?

Ví dụ một khoảng 116.5 ms rồi ngay sau là 83.5 ms, trung bình vẫn đúng 100 ms. Bộ đếm phần cứng **không sai**. Chỉ có **một lần ISR được chạy muộn** khoảng 16.5 ms. Lần sau vẫn đúng mốc của bộ đếm, nên khoảng sau ngắn lại đúng bằng phần đã muộn.

Lý do: khi ESP32 ghi hoặc xoá flash (LittleFS ở trang `/data`, nhật ký sự kiện), bộ nhớ đệm flash tạm tắt. Các ngắt có code nằm trong flash phải chờ ghi xong. Muốn tránh, có thể đăng ký ngắt với cờ `ESP_INTR_FLAG_IRAM` và để toàn bộ code ISR trong IRAM.

> Điểm khác biệt quan trọng: lỗi của timer phần cứng **không cộng dồn**, vì lần sau tự bù. Lỗi của millis() thì phụ thuộc vào chương trình và có thể làm **mất hẳn** sự kiện, như khi CPU bận.

## 6. Gợi ý viết README mục 4.3 (phần timer)

Thay số trong ngoặc vuông bằng số đo của em, lấy từ **Bảng kết quả** (nút 📋 Sao chép dán thẳng được vào README).

```markdown
## 4.3 Timer phần cứng và PWM

### Timer phần cứng
- Cấu hình: timer 1 của ESP32, chia tần 80 → 1 µs/nhịp, chu kỳ đặt [100] ms.
- Đo [1722] khoảng: TB [100.000] ms, min [99.98] ms, max [100.02] ms → lệch tối đa [0.02] ms ([0.02] %).
- Có [2] lần lệch ~[16.5] ms, trùng lúc ghi flash (dừng ghi ở /data thì hết).

### So sánh với millis() (Bài 2)
| | TB (ms) | Min (ms) | Max (ms) | Lệch max (ms) |
|---|---|---|---|---|
| Timer phần cứng | [100.000] | [..] | [..] | [..] |
| millis() trong loop | [100.0xx] | [..] | [..] | [..] |
| millis() khi CPU bận 5 s | – | – | [5000] | [4900] |

![Bình thường](timer_normal.png)
![CPU bận](timer_busy.png)

Nhận xét: [Timer phần cứng giữ chu kỳ ổn định vì ngắt do bộ đếm phần cứng tạo ra, không phụ
thuộc loop(); millis() chỉ được kiểm tra khi loop() chạy tới nên bị trễ theo tải của chương
trình, và khi CPU bận 5 s thì mất toàn bộ sự kiện trong khoảng đó.]
```

## 7. Câu hỏi thường gặp

**Trang đứng khi bấm "CPU bận"?** Đúng như thiết kế. Web server cũng chạy trong `loop()` nên bị chặn theo. Sau 5 s trang tự chạy lại.

**Đồ thị trống?** Kiểm tra dòng trạng thái đầu trang có báo "Đã kết nối" không. Nếu vừa bấm Đặt lại hoặc Áp dụng thì chờ 1–2 s cho có điểm mới.

**Chu kỳ 10 ms thì đồ thị dày quá?** Chọn cửa sổ 10 s. Trên 150 điểm thì đồ thị chỉ vẽ đường, không vẽ chấm.

**Số trong bảng khác số trong chú thích đồ thị?** Bảng tính từ lần **Đặt lại** gần nhất. Chú thích chỉ tính các điểm **trong cửa sổ đang xem**.

**Máy bơm có bị ảnh hưởng không?** Không. Thẻ timer và nút CPU bận gửi lệnh qua `/api/lab`, tách khỏi máy trạng thái máy bơm. Nút CPU bận bị từ chối khi bơm đang CHẠY.
