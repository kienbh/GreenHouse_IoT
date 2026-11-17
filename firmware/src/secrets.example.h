#pragma once
// Chép file này thành secrets.h rồi điền thông tin thật (secrets.h không đưa lên git)
// WiFi phòng: ESP32 và PC chạy broker phải cùng mạng này (để trống = chỉ dùng AP, không có MQTT)
#define STA_SSID   "TEN_WIFI"
#define STA_PASS   "MAT_KHAU_WIFI"

// Broker Mosquitto trên PC: IP của PC in ra khi chạy mqtt_broker/start.sh
#define MQTT_HOST  "192.168.1.10"
#define MQTT_PORT  8883            // Bài 8: MQTT qua TLS (cổng 1883 không còn nhận tài khoản nhà kính)
#define MQTT_USER  "esp32-01"       // tài khoản riêng của node, tạo bằng mqtt_broker/setup.sh
#define MQTT_PASS  "DOI_MAT_KHAU"   // mật khẩu ngẫu nhiên trong mqtt_broker/accounts.local
