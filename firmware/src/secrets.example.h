#pragma once
// Chép file này thành secrets.h rồi điền thông tin thật (secrets.h không đưa lên git)
// WiFi phòng: ESP32 và PC chạy broker phải cùng mạng này (để trống = chỉ dùng AP, không có MQTT)
#define STA_SSID   "TEN_WIFI"
#define STA_PASS   "MAT_KHAU_WIFI"

// Broker Mosquitto trên PC: IP của PC in ra khi chạy mqtt_broker/start.sh
#define MQTT_HOST  "192.168.1.10"
#define MQTT_PORT  1883
#define MQTT_USER  "esp32"            // tài khoản tạo bằng mqtt_broker/setup.sh
#define MQTT_PASS  "esp32pass"
