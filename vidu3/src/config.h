#pragma once
// ===== Sơ đồ chân (theo sodo.md) =====
#define PIN_BUZZER     21
#define PIN_LED_R      26
#define PIN_LED_G      27
#define PIN_LED_ARRAY  12   // dải LED đơn sắc, chỉ bật/tắt
#define PIN_PUMP_A     15   // Máy bơm: giữ LOW
#define PIN_PUMP_B     17   // Máy bơm bật khi chân này LOW (kích mức thấp), tắt khi HIGH
// Nhiệt độ/độ ẩm: Uno đọc DHT11 (D8) rồi gửi qua I2C, Uno là slave
#define PIN_I2C_SDA    33   // nối Uno A4
#define PIN_I2C_SCL    32   // nối Uno A5
#define UNO_I2C_ADDR   0x08

#define BLINK_MS       500  // chu kỳ nháy dải LED (sáng 500ms, tắt 500ms)

// ===== WiFi =====
// Luôn phát WiFi riêng (AP) để điện thoại kết nối thẳng vào ESP32:
#define AP_SSID   "NhaKinh-ESP32"
#define AP_PASS   "12345678"      // tối thiểu 8 ký tự
// Nếu muốn ESP32 vào thêm WiFi của phòng thì điền vào đây (để trống = chỉ dùng AP)
#define STA_SSID  ""
#define STA_PASS  ""
#define MDNS_NAME "nhakinh"       // truy cập http://nhakinh.local

// ===== Ghi dữ liệu (trang /data) =====
#define LOG_FILE       "/log.bin"     // mỗi mẫu 12 byte, lưu trong LittleFS nên mất điện không mất
#define EVT_FILE       "/events.csv"  // nhật ký sự kiện: boot,ms,mức,nội dung
#define LOG_MAX        20000          // số mẫu tối đa (~11 giờ ở chu kỳ 2 s)
#define EVT_MAX_BYTES  16384
#define SPIKE_RAW      80             // gai nhiễu giả lập: +8.0 °C

// ===== Bài 3: điều khiển máy bơm an toàn (trang /ctrl) =====
#define CH_PUMP        2      // kênh LEDC cho PWM máy bơm (kênh 0 buzzer dùng timer khác)
#define PUMP_PWM_HZ    100    // tần số PWM mặc định (đổi được trên web: 20-20000 Hz). Mạch chậm dùng tần số thấp
#define KICK_MS        300    // mồi khởi động: chạy 100% bao lâu trước khi về duty đặt (0 = tắt)
#define PUMP_PWM_BITS  10     // 0..1023, đủ mịn cho bước 1%
#define RUN_LIMIT_S    15     // thời gian chạy tối đa mặc định (đổi được trên web: 3-300 s)
#define COOLDOWN_S     10     // thời gian nghỉ sau khi hết giờ/lỗi (đổi được: 0-600 s)
#define FAULT_HOLD_MS  3000   // ở LỖI tối thiểu 3 s rồi mới tự về DỪNG (khi đã hết lỗi)
#define PIN_BUTTON     4      // nút nhấn ngắt ngoài: nối GPIO4 - GND, dùng INPUT_PULLUP
#define TIMER_MS       100    // chu kỳ timer phần cứng mặc định
