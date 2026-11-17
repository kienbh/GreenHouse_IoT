#pragma once
// LCD 16x2 HD44780 qua mạch I2C PCF8574 (địa chỉ thường 0x27 hoặc 0x3F), dùng chung bus I2C với Uno.
// Tự viết gọn thay thư viện LiquidCrystal_I2C: thư viện đó gọi Wire.begin() mặc định (SDA21/SCL22)
// sẽ giành chân 21 của buzzer. Ở đây chỉ dùng Wire đã khởi động sẵn trên chân 33/32.
#include <Arduino.h>
#include <Wire.h>

namespace lcd {

uint8_t addr = 0;             // 0 = không tìm thấy LCD
const uint8_t BL = 0x08, EN = 0x04, RS = 0x01;   // chân PCF8574: đèn nền, Enable, Register Select

void out(uint8_t v) {
  Wire.beginTransmission(addr);
  Wire.write(v | BL);
  Wire.endTransmission();
}

void nibble(uint8_t v) {      // v: 4 bit cao là dữ liệu, 4 bit thấp là RS
  out(v | EN);
  delayMicroseconds(1);
  out(v & ~EN);
  delayMicroseconds(50);
}

void send(uint8_t b, uint8_t mode) {
  nibble((b & 0xF0) | mode);
  nibble(((b << 4) & 0xF0) | mode);
}

void cmd(uint8_t c) { send(c, 0); if (c <= 2) delay(2); }   // clear/home cần ~1.6 ms

// In một dòng (0 hoặc 1), tự đệm khoảng trắng cho đủ 16 ký tự để xoá chữ cũ
void line(uint8_t row, const char *s) {
  cmd(0x80 | (row ? 0x40 : 0x00));
  for (int i = 0; i < 16; i++) send(*s ? *s++ : ' ', RS);
}

// Dò địa chỉ PCF8574 (0x20-0x27 hoặc 0x38-0x3F), bỏ qua 0x08 của Uno. Trả về false nếu không có LCD.
bool begin() {
  for (uint8_t a : {0x27, 0x3F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { addr = a; break; }
  }
  if (!addr) return false;
  delay(50);
  // Chuỗi khởi tạo chế độ 4 bit theo datasheet HD44780
  nibble(0x30); delay(5);
  nibble(0x30); delayMicroseconds(150);
  nibble(0x30);
  nibble(0x20);
  cmd(0x28);    // 4 bit, 2 dòng, font 5x8
  cmd(0x0C);    // bật hiển thị, tắt con trỏ
  cmd(0x06);    // con trỏ tự sang phải
  cmd(0x01);    // xoá màn hình
  return true;
}

}  // namespace lcd
