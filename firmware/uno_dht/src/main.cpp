// Uno đọc DHT11 ở chân D8, làm I2C slave (địa chỉ 0x08) cho ESP32 đọc
// I2C Uno: A4 = SDA, A5 = SCL
// Dữ liệu trả về 4 byte: nhiệt độ x10 (int16), độ ẩm x10 (int16); lỗi = 0x7FFF
// Đồng thời in ra Serial (USB) để kiểm tra
#include <Arduino.h>
#include <Wire.h>
#include <DHT.h>

#define PIN_DHT  8
#define I2C_ADDR 0x08
DHT dht(PIN_DHT, DHT11);

volatile int16_t t10 = 0x7FFF, h10 = 0x7FFF;

void onRequest() {
  uint8_t buf[4] = {(uint8_t)(t10 >> 8), (uint8_t)t10, (uint8_t)(h10 >> 8), (uint8_t)h10};
  Wire.write(buf, 4);
}

void setup() {
  Serial.begin(9600);
  dht.begin();
  Wire.begin(I2C_ADDR);
  Wire.onRequest(onRequest);
}

void loop() {
  delay(2000);
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    t10 = h10 = 0x7FFF;
    Serial.println("ERR");
    return;
  }
  noInterrupts();
  t10 = (int16_t)(t * 10);
  h10 = (int16_t)(h * 10);
  interrupts();
  Serial.print("T:"); Serial.print(t, 1);
  Serial.print(",H:"); Serial.println(h, 0);
}
