/*
  Bài tập nhóm: ESP32 + AHT20 + LED + nút nhấn làm MQTT client
  Dựa theo: https://randomnerdtutorials.com/esp32-mqtt-publish-subscribe-arduino-ide/
  (bài gốc dùng BME280 và gửi mỗi đại lượng 1 topic; ở đây đổi sang AHT20 (nhiệt độ, độ ẩm) và gửi gộp 1 gói JSON)

  Thư viện (Arduino IDE > Library Manager):
    - PubSubClient (Nick O'Leary)
    - ArduinoJson (Benoit Blanchon)
    - Adafruit AHTX0

  Quy ước của lớp (thay nhom01 bằng số nhóm):
    vju/iot/nhom01          -> {"nhom":"nhom01","temp":26.4,"hum":61.2,"led":1,"btn":0}
                               gửi mỗi 5 s và ngay khi LED / nút đổi trạng thái
    vju/iot/nhom01/status   -> "online" (retained), "offline" là Last Will do broker tự gửi khi mất kết nối
    vju/iot/nhom01/output   <- "on" / "off" từ dashboard của giảng viên (giống esp32/output của bài gốc)
*/
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>

// ===== SỬA THEO LỚP =====
const char *ssid = "VJU Office";
const char *password = "MAT_KHAU_WIFI";
const char *mqtt_server = "IP_BROKER";       // IP giảng viên chiếu trên màn hình, ví dụ "172.16.6.164"
#define NHOM "nhom01"                         // nhom01 ... nhom12

const char *TOPIC_DATA = "vju/iot/" NHOM;
const char *TOPIC_STATUS = "vju/iot/" NHOM "/status";
const char *TOPIC_OUTPUT = "vju/iot/" NHOM "/output";

// ===== Chân =====
const int LED_PIN = 26;
const int BUTTON_PIN = 4;                     // nút nối GPIO4 - GND, dùng điện trở kéo lên trong
// AHT20: SDA = GPIO21, SCL = GPIO22 (I2C mặc định của ESP32)

WiFiClient espClient;
PubSubClient client(espClient);
Adafruit_AHTX0 aht;

int ledState = 0, btnState = 0;
int lastButton = HIGH;
unsigned long lastMsg = 0, lastDebounce = 0;

// Đóng gói toàn bộ trạng thái thành 1 JSON và gửi
void publishData() {
  sensors_event_t humidity, temp;
  aht.getEvent(&humidity, &temp);

  JsonDocument doc;
  doc["nhom"] = NHOM;
  doc["temp"] = round(temp.temperature * 10) / 10.0;          // làm tròn 1 chữ số thập phân
  doc["hum"] = round(humidity.relative_humidity * 10) / 10.0;
  doc["led"] = ledState;
  doc["btn"] = btnState;

  char buf[160];
  serializeJson(doc, buf);
  client.publish(TOPIC_DATA, buf);
  Serial.printf("-> %s %s\n", TOPIC_DATA, buf);
}

void setLed(int on) {
  ledState = on ? 1 : 0;
  digitalWrite(LED_PIN, ledState);
  publishData();                              // báo ngay trạng thái mới lên dashboard
}

void setup_wifi() {
  Serial.printf("\nKet noi WiFi %s", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi OK, IP: %s\n", WiFi.localIP().toString().c_str());
}

// Nhận lệnh từ dashboard: "on" / "off" (giữ cách làm của bài gốc)
void callback(char *topic, byte *message, unsigned int length) {
  String messageTemp;
  for (unsigned int i = 0; i < length; i++) messageTemp += (char)message[i];
  Serial.printf("<- %s %s\n", topic, messageTemp.c_str());
  if (String(topic) == TOPIC_OUTPUT) {
    if (messageTemp == "on") setLed(1);
    else if (messageTemp == "off") setLed(0);
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Ket noi MQTT...");
    // Client ID phải khác nhau giữa các nhóm; Last Will: mất điện/mất mạng thì broker tự gửi "offline"
    if (client.connect(NHOM "-esp32", TOPIC_STATUS, 1, true, "offline")) {
      Serial.println(" OK");
      client.publish(TOPIC_STATUS, "online", true);
      client.subscribe(TOPIC_OUTPUT);
      publishData();
    } else {
      // -2: không tới được broker (sai IP hoặc ESP32 khác mạng WiFi với máy giảng viên)
      Serial.printf(" loi rc=%d, thu lai sau 5 s\n", client.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Wire.begin();
  if (!aht.begin()) Serial.println("Khong tim thay AHT20, kiem tra day SDA/SCL!");

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // Nút nhấn: chống dội 30 ms, gửi ngay khi nhấn/thả; nhấn thì đảo LED
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton && millis() - lastDebounce > 30) {
    lastDebounce = millis();
    lastButton = b;
    btnState = (b == LOW);
    if (btnState) setLed(!ledState);
    else publishData();
  }

  // Định kỳ mỗi 5 s
  if (millis() - lastMsg > 5000) {
    lastMsg = millis();
    publishData();
  }
}
