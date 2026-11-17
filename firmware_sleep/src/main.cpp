// Bài 9: node CHỈ ĐO, chu kỳ thức -> đọc -> gửi (MQTT TLS) -> ngủ sâu -> đánh thức.
// Không được nạp cho node đang giữ an toàn cơ cấu: node này không điều khiển gì và ngủ phần lớn thời gian.
// Phòng khi lỡ nạp lên bo nhà kính: giữ chân máy bơm ở mức TẮT suốt lúc ngủ (gpio hold).
// Số đo: nhiệt độ bên trong chip ESP32 (temperatureRead) – chỉ để có giá trị thật đi qua chu kỳ,
// KHÔNG phải nhiệt độ môi trường. Chưa đo dòng điện thì KHÔNG kết luận mức tiết kiệm năng lượng.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <driver/gpio.h>
#include <esp_sleep.h>
#include "secrets.h"        // STA_SSID, STA_PASS, MQTT_HOST, MQTT_PORT (dùng chung firmware chính)
#include "ca_cert.h"
#include "sleep_secrets.h"  // SLEEP_USER, SLEEP_PASS

#define SLEEP_S    20                 // ngủ 20 s mỗi chu kỳ
#define PIN_WAKE   GPIO_NUM_0         // nút BOOT trên DevKit: bấm (mức thấp) để đánh thức sớm
#define PIN_PUMP_A 15                 // giữ LOW
#define PIN_PUMP_B 17                 // máy bơm tắt khi HIGH
const char *DEV = "sleep-01";

// Biến trong RTC slow memory: CÒN sau deep sleep, MẤT khi mất điện/reset cứng
RTC_DATA_ATTR uint32_t rtcBoot = 0, rtcSeq = 0, rtcFails = 0;
RTC_DATA_ATTR uint32_t rtcLastAwakeMs = 0;
uint32_t ramCounter = 0;              // biến RAM thường: luôn về 0 sau mỗi lần thức (để so sánh)

const char *wakeText(esp_sleep_wakeup_cause_t c) {
  switch (c) {
    case ESP_SLEEP_WAKEUP_TIMER: return "timer";
    case ESP_SLEEP_WAKEUP_EXT0: return "ext0_gpio0";
    case ESP_SLEEP_WAKEUP_UNDEFINED: return "power_on_or_reset";
    default: return "other";
  }
}

void holdPumpOff() {
  gpio_hold_dis((gpio_num_t)PIN_PUMP_A); gpio_hold_dis((gpio_num_t)PIN_PUMP_B);
  pinMode(PIN_PUMP_A, OUTPUT); digitalWrite(PIN_PUMP_A, LOW);
  pinMode(PIN_PUMP_B, OUTPUT); digitalWrite(PIN_PUMP_B, HIGH);
}

void sleepNow(unsigned long t0) {
  rtcLastAwakeMs = millis() - t0;
  Serial.printf("[%s] thuc %lums, ngu sau %d s (hoac bam BOOT)\n", DEV, rtcLastAwakeMs, SLEEP_S);
  Serial.flush();
  gpio_hold_en((gpio_num_t)PIN_PUMP_A); gpio_hold_en((gpio_num_t)PIN_PUMP_B);
  gpio_deep_sleep_hold_en();
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_S * 1000000ULL);
  esp_sleep_enable_ext0_wakeup(PIN_WAKE, 0);
  esp_deep_sleep_start();
}

void setup() {
  unsigned long t0 = millis();
  holdPumpOff();
  Serial.begin(115200);
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (cause == ESP_SLEEP_WAKEUP_UNDEFINED) rtcBoot++;     // khởi động thật -> lần chạy mới
  ramCounter++;
  uint32_t seq = ++rtcSeq;
  float chipT = temperatureRead();
  Serial.printf("\n[%s] boot %lu seq %lu wake=%s ramCounter=%lu (RAM mat sau ngu) lan thuc truoc %lums\n",
                DEV, rtcBoot, seq, wakeText(cause), ramCounter, rtcLastAwakeMs);

  WiFi.mode(WIFI_STA);
  WiFi.begin(STA_SSID, STA_PASS);
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) delay(50);
  unsigned long wifiMs = millis() - t0;
  if (WiFi.status() != WL_CONNECTED) { rtcFails++; Serial.printf("Khong vao WiFi sau %lums, ban ghi seq %lu mat\n", wifiMs, seq); sleepNow(t0); }

  WiFiClientSecure net;
  net.setCACert(CA_CERT);
  PubSubClient mqtt(net);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  String topic = String("vju/nhakinh/") + DEV;
  bool ok = mqtt.connect(DEV, SLEEP_USER, SLEEP_PASS);
  unsigned long mqttMs = millis() - t0;
  if (ok) {
    char buf[360];
    snprintf(buf, sizeof(buf),
      "{\"dev\":\"%s\",\"boot\":%lu,\"seq\":%lu,\"up_ms\":%lu,\"wake\":\"%s\",\"t_chip\":%.1f,\"t\":null,\"h\":null,"
      "\"valid\":false,\"note\":\"t_chip la nhiet do chip, khong phai moi truong\",\"wifi_ms\":%lu,\"mqtt_ms\":%lu,"
      "\"last_awake_ms\":%lu,\"fails\":%lu,\"ram_counter\":%lu,\"rssi\":%d}",
      DEV, rtcBoot, seq, millis(), wakeText(cause), chipT, wifiMs, mqttMs, rtcLastAwakeMs, rtcFails, ramCounter, WiFi.RSSI());
    ok = mqtt.publish((topic + "/telemetry").c_str(), buf);
    mqtt.loop();
    delay(100);                       // cho TCP gửi xong trước khi tắt radio
    mqtt.disconnect();
    Serial.printf("Gui %s: %s\n", ok ? "OK" : "LOI", buf);
  } else {
    rtcFails++;
    Serial.printf("MQTT loi (state %d) sau %lums, ban ghi seq %lu mat\n", mqtt.state(), mqttMs, seq);
  }
  sleepNow(t0);
}

void loop() {}
