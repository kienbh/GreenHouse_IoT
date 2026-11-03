// Nhà kính mini - ESP32 tự host giao diện web điều khiển
// Buzzer phát nhạc, LED R/G, dải LED đơn sắc, máy bơm, quạt thông gió, nhiệt ẩm từ Uno qua I2C
// Bài 3 (/ctrl): máy bơm PWM có máy trạng thái DỪNG/CHẠY/LỖI, ngắt ngoài, timer phần cứng
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <driver/gpio.h>
#include "config.h"
#include "melodies.h"
#include "webpage.h"
#include "datapage.h"
#include "ctrlpage.h"

#define CH_BUZZER 0   // kênh LEDC cho buzzer

WebServer server(80);

// ===== Trạng thái =====
float temperature = NAN, humidity = NAN;
bool ledR = false, ledG = false;
int ledArray = 0;              // dải LED: 0 tắt, 1 bật, 2 nháy
bool autoMode = false;
float tempThreshold = 30.0;

// ===== Trình phát nhạc không chặn (non-blocking) =====
const Note *song = nullptr;
int songLen = 0, songIdx = 0, songId = -1;
unsigned long noteEnd = 0;
bool inGap = false;

void playSong(int id) {
  if (id < 0 || id >= SONG_COUNT) return;
  song = SONGS[id].notes;
  songLen = SONGS[id].len;
  songIdx = 0;
  songId = id;
  noteEnd = 0;
  inGap = true;   // để vòng lặp bắt đầu nốt đầu tiên ngay
}

void stopSong() {
  song = nullptr;
  songId = -1;
  ledcWriteTone(CH_BUZZER, 0);
}

void updateSong() {
  if (!song || millis() < noteEnd) return;
  if (!inGap) {  // vừa hết nốt -> nghỉ ngắn để tách các nốt
    ledcWriteTone(CH_BUZZER, 0);
    inGap = true;
    noteEnd = millis() + song[songIdx].ms / 8;
    songIdx++;
    return;
  }
  if (songIdx >= songLen) { stopSong(); return; }
  ledcWriteTone(CH_BUZZER, song[songIdx].freq);
  noteEnd = millis() + song[songIdx].ms;
  inGap = false;
}

// ===== LED, quạt, máy bơm =====
void applyOutputs() {
  digitalWrite(PIN_LED_R, ledR);
  digitalWrite(PIN_LED_G, ledG);
  if (ledArray != 2) digitalWrite(PIN_LED_ARRAY, ledArray == 1);   // chế độ nháy do updateBlink lo
  digitalWrite(PIN_PUMP_A, LOW);     // chân B do máy trạng thái Bài 3 điều khiển (pumpWrite)
}

void updateBlink() {
  static unsigned long last = 0;
  static bool on = false;
  if (ledArray != 2 || millis() - last < BLINK_MS) return;
  last = millis();
  on = !on;
  digitalWrite(PIN_LED_ARRAY, on);
}

// ===== Cảm biến + chế độ tự động =====
// Uno đọc DHT11 rồi trả 4 byte qua I2C: nhiệt độ x10, độ ẩm x10 (int16); 0x7FFF = lỗi cảm biến
enum { E_OK = 0, E_I2C = 1, E_DHT = 2, E_RANGE = 3 };
const char *ERR_TXT[] = {"OK", "E1 I2C: Uno khong phan hoi (0x08)",
                         "E2 DHT11: doc loi (Uno tra 0x7FFF)", "E3 Ngoai dai do DHT11 (0-50C, 0-100%)"};
bool simFault = false;    // giả lập lỗi cảm biến (trang /data)
int sensCode = E_OK;      // mã lỗi lần đọc gần nhất, để web hiện

int checkRange(int16_t t, int16_t h) {
  return (t < 0 || t > 500 || h < 0 || h > 1000) ? E_RANGE : E_OK;
}

// Đọc thô từ Uno: t, h là giá trị x10; trả về mã lỗi
int readUno(int16_t &t, int16_t &h) {
  t = h = 0x7FFF;
  if (simFault) return E_DHT;
  if (Wire.requestFrom(UNO_I2C_ADDR, 4) != 4) return E_I2C;
  uint8_t b[4];
  for (int i = 0; i < 4; i++) b[i] = Wire.read();   // đọc lần lượt, tránh thứ tự tính toán không xác định
  t = (int16_t)(b[0] << 8 | b[1]);
  h = (int16_t)(b[2] << 8 | b[3]);
  if (t == 0x7FFF || h == 0x7FFF) return E_DHT;
  return checkRange(t, h);
}

void updateSensor() {
  static unsigned long last = 0;
  static int fails = 0;
  if (millis() - last < 2000) return;
  last = millis();
  int16_t t, h;
  sensCode = readUno(t, h);
  bool ok = sensCode == E_OK;
  if (ok) { temperature = t / 10.0; humidity = h / 10.0; }
  fails = ok ? 0 : fails + 1;
  if (fails >= 5) temperature = humidity = NAN;   // mất dữ liệu ~10s thì web hiện "--"
  if (!ok) return;   // lỗi đã được logger ghi vào nhật ký

  // Tự động: nóng thì LED đỏ, mát thì LED xanh
  if (autoMode) {
    if (temperature >= tempThreshold) ledR = true;
    else if (temperature <= tempThreshold - 1.0) ledR = false;   // trễ 1°C để đèn không đổi liên tục
    ledG = !ledR;
    applyOutputs();
  }
}

// ===== Ghi dữ liệu =====
String stateJson();
// Mỗi mẫu lưu thẳng vào flash (LittleFS) nên mất điện vẫn còn. Thời gian lưu dạng
// (lần khởi động, ms từ lúc khởi động); trình duyệt gửi giờ thật qua /api/time để quy đổi.
struct Rec {
  uint32_t ms;      // millis() lúc lấy mẫu
  int16_t t, h;     // giá trị thô x10 từ Uno (0x7FFF = lỗi)
  uint16_t boot;    // số lần khởi động
  uint8_t flags;    // bit0 hợp lệ, bit1-2 mã lỗi, bit4 lỗi giả lập, bit5 gai nhiễu giả lập
  uint8_t pad;
};

Preferences prefs;
uint16_t bootNo = 0;
bool logging = false;
uint32_t logInterval = 5;    // giây
uint32_t logCount = 0;
unsigned long logLast = 0;
double bootBase = 0;         // giờ thật (epoch ms) tại millis()=0 của lần khởi động này; 0 = chưa biết
bool spikeNext = false;
int lastLogCode = -1;
uint32_t errRun = 0;

void saveCfg() {
  prefs.begin("log", false);
  prefs.putBool("run", logging);
  prefs.putUInt("iv", logInterval);
  prefs.end();
}

// Ghi 1 dòng nhật ký: B = khởi động, E = lỗi, W = cảnh báo, I = thông tin
void logEvent(char lv, const char *fmt, ...) {
  char msg[120];
  va_list ap; va_start(ap, fmt); vsnprintf(msg, sizeof(msg), fmt, ap); va_end(ap);
  unsigned long ms = millis();
  Serial.printf("[%c] boot#%u +%lu.%03lus %s\n", lv, bootNo, ms / 1000, ms % 1000, msg);
  File f = LittleFS.open(EVT_FILE, FILE_READ);
  bool full = f && f.size() > EVT_MAX_BYTES;
  if (f) f.close();
  if (full) LittleFS.remove(EVT_FILE);
  f = LittleFS.open(EVT_FILE, FILE_APPEND);
  if (!f) return;
  if (full) f.printf("%u,%lu,W,Nhat ky day, da xoa phan cu\n", bootNo, ms);
  f.printf("%u,%lu,%c,%s\n", bootNo, ms, lv, msg);
  f.close();
}

size_t eventsSize() {
  File f = LittleFS.open(EVT_FILE, FILE_READ);
  size_t n = f ? f.size() : 0;
  if (f) f.close();
  return n;
}

void startLogging(bool on) {
  if (on && !logging) logEvent('I', "Bat dau ghi, chu ky %lus", logInterval);
  if (!on && logging) logEvent('I', "Dung ghi (%lu mau)", logCount);
  logging = on;
  logLast = millis() - logInterval * 1000UL;   // lấy mẫu đầu tiên ngay
  saveCfg();
}

void logSample() {
  Rec r = {millis(), 0, 0, bootNo, 0, 0};
  int code = readUno(r.t, r.h);
  if (simFault) r.flags |= 0x10;
  if (spikeNext && code == E_OK) {           // cộng gai nhiễu vào mẫu hợp lệ để thử bộ lọc
    r.t += SPIKE_RAW;
    code = checkRange(r.t, r.h);
    r.flags |= 0x20;
    spikeNext = false;
  }
  r.flags |= (code << 1) | (code == E_OK);

  // Nhật ký chỉ ghi lúc đổi trạng thái, Serial thì in từng mẫu
  if (code != E_OK) {
    errRun++;
    if (code != lastLogCode) logEvent('E', "%s%s", ERR_TXT[code], simFault ? " [gia lap]" : "");
  } else if (lastLogCode > 0) {
    logEvent('I', "Cam bien phuc hoi sau %lu mau loi", errRun);
    errRun = 0;
  }
  lastLogCode = code;
  Serial.printf("boot#%u +%lums raw_t=%d raw_h=%d t=%.1fC h=%.1f%% valid=%d\n",
                bootNo, r.ms, r.t, r.h, r.t / 10.0, r.h / 10.0, code == E_OK);

  if (logCount >= LOG_MAX) {
    logEvent('W', "Bo nho day (%d mau), dung ghi", LOG_MAX);
    startLogging(false);
    return;
  }
  File f = LittleFS.open(LOG_FILE, FILE_APPEND);
  if (!f) return;
  f.write((uint8_t *)&r, sizeof(r));
  f.close();
  logCount++;
}

void updateLogger() {
  if (!logging) return;
  unsigned long iv = logInterval * 1000UL;
  if (millis() - logLast < iv) return;
  logLast += iv;                                   // giữ nhịp đều, không trôi theo thời gian xử lý
  if (millis() - logLast >= iv) logLast = millis();  // bị trễ quá 1 chu kỳ thì bắt nhịp lại
  logSample();
}

const char *resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "Cap dien (power-on)";
    case ESP_RST_SW:       return "Reset mem (ESP.restart)";
    case ESP_RST_EXT:      return "Nut EN/RST";
    case ESP_RST_BROWNOUT: return "Sut ap (brownout)";
    case ESP_RST_PANIC:    return "Loi phan mem (panic)";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "Watchdog";
    case ESP_RST_DEEPSLEEP: return "Thuc day tu deep sleep";
    default:               return "Khac";
  }
}

void setupLogger() {
  if (!LittleFS.begin(true)) Serial.println("LittleFS loi, khong ghi duoc du lieu");
  prefs.begin("log", false);
  bootNo = prefs.getUShort("boot", 0) + 1;
  prefs.putUShort("boot", bootNo);
  logging = prefs.getBool("run", false);
  logInterval = prefs.getUInt("iv", 5);
  prefs.end();
  File f = LittleFS.open(LOG_FILE, FILE_READ);
  logCount = f ? f.size() / sizeof(Rec) : 0;
  if (f) f.close();
  logEvent('B', "Khoi dong #%u: %s", bootNo, resetReasonText());
  if (logging) {
    logEvent('I', "Tu dong ghi tiep sau khoi dong (da co %lu mau, chu ky %lus)", logCount, logInterval);
    logLast = millis() - logInterval * 1000UL;
  }
}

double baseOf(uint16_t boot) {
  if (boot == bootNo) return bootBase;
  char key[8]; snprintf(key, sizeof(key), "b%u", boot);
  prefs.begin("bases", true);
  double b = prefs.getDouble(key, 0);
  prefs.end();
  return b;
}

// /api/time?ms=<giờ trình duyệt> : lần đầu trong mỗi lần khởi động thì lưu mốc giờ thật
void handleTime() {
  double now = server.arg("ms").toDouble();
  if (bootBase == 0 && now > 1e12) {
    bootBase = now - millis();
    char key[8]; snprintf(key, sizeof(key), "b%u", bootNo);
    prefs.begin("bases", false);
    prefs.putDouble(key, bootBase);
    prefs.end();
  }
  server.send(200, "text/plain", "ok");
}

// /api/log?from=i&n=k : trả về các mẫu từ vị trí i
void handleLog() {
  uint32_t from = server.arg("from").toInt();
  uint32_t n = constrain(server.arg("n").toInt(), 1, 400);
  String s = "{\"total\":" + String(logCount) + ",\"rows\":[";
  uint16_t boots[16]; int nb = 0;
  File f = LittleFS.open(LOG_FILE, FILE_READ);
  if (f && f.seek(from * sizeof(Rec))) {
    Rec r;
    for (uint32_t i = 0; i < n && f.read((uint8_t *)&r, sizeof(r)) == sizeof(r); i++) {
      if (i) s += ',';
      char row[48];
      snprintf(row, sizeof(row), "[%u,%lu,%d,%d,%u]", r.boot, (unsigned long)r.ms, r.t, r.h, r.flags);
      s += row;
      bool seen = false;
      for (int k = 0; k < nb; k++) seen |= boots[k] == r.boot;
      if (!seen && nb < 16) boots[nb++] = r.boot;
    }
  }
  if (f) f.close();
  s += "],\"bases\":{";
  for (int k = 0; k < nb; k++) {
    if (k) s += ',';
    s += '"' + String(boots[k]) + "\":" + String(baseOf(boots[k]), 0);
  }
  s += "}}";
  server.send(200, "application/json", s);
}

void handleEvents() {
  File f = LittleFS.open(EVT_FILE, FILE_READ);
  if (!f) { server.send(200, "text/plain", ""); return; }
  server.streamFile(f, "text/plain; charset=utf-8");
  f.close();
}

// /api/logcfg?run=0|1&iv=giây&clear=1
void handleLogCfg() {
  if (server.hasArg("iv")) {
    uint32_t iv = constrain(server.arg("iv").toInt(), 1, 3600);
    if (iv != logInterval) {
      logInterval = iv;
      logEvent('I', "Doi chu ky lay mau: %lus", iv);
      logLast = millis() - iv * 1000UL;
      saveCfg();
    }
  }
  if (server.hasArg("clear")) {
    LittleFS.remove(LOG_FILE);
    LittleFS.remove(EVT_FILE);
    prefs.begin("bases", false); prefs.clear(); prefs.end();
    bootBase = 0;   // trình duyệt sẽ gửi lại giờ ngay sau đó
    logCount = 0; lastLogCode = -1; errRun = 0;
    logEvent('I', "Da xoa du lieu cu");
  }
  if (server.hasArg("run")) startLogging(server.arg("run").toInt());
  server.send(200, "application/json", stateJson());
}

// /api/sim?fault=0|1 | spike=1 | reboot=1
void handleSim() {
  if (server.hasArg("fault")) {
    bool on = server.arg("fault").toInt();
    if (on != simFault) logEvent('W', on ? "Bat gia lap loi cam bien" : "Tat gia lap loi cam bien");
    simFault = on;
  }
  if (server.hasArg("spike")) { spikeNext = true; logEvent('W', "Chen gai nhieu +%.1fC vao mau ke tiep", SPIKE_RAW / 10.0); }
  if (server.hasArg("reboot")) {
    logEvent('W', "Mo phong mat dien: khoi dong lai ESP32");
    server.send(200, "application/json", stateJson());
    delay(300);
    ESP.restart();
  }
  server.send(200, "application/json", stateJson());
}

// ===== Bài 3: máy bơm DC qua mạch công suất, máy trạng thái DỪNG · CHẠY · LỖI =====
// Quy tắc (ưu tiên từ trên xuống, xét lại mỗi vòng loop bằng millis(), không delay):
//  1. CHẠY + cảm biến lỗi hoặc lệnh sai định dạng -> LỖI (tắt tải ngay, bắt đầu nghỉ)
//  2. CHẠY quá runLimit giây                      -> DỪNG (tự động, bắt đầu nghỉ)
//  3. LỖI đã hết lỗi và ở LỖI >= FAULT_HOLD_MS     -> DỪNG (tự động)
//  4. Lệnh dừng: CHẠY -> DỪNG. Lệnh chạy chỉ nhận khi đang DỪNG, hết thời gian nghỉ, cảm biến tốt
enum { ST_STOP = 0, ST_RUN = 1, ST_FAULT = 2 };
const char *ST_NAME[] = {"DUNG", "CHAY", "LOI"};
int pst = ST_STOP;
int duty = 50;                         // % PWM khi chạy (1-100)
uint32_t pwmHz = PUMP_PWM_HZ;
uint32_t kickMs = KICK_MS;             // bơm DC cần lực mở máy lớn, duty thấp đứng yên chỉ kêu
unsigned long kickUntil = 0;
uint32_t runLimit = RUN_LIMIT_S;       // giây
uint32_t cooldown = COOLDOWN_S;        // giây
unsigned long stSince = 0, coolUntil = 0;
int cmdReq = 0;                        // lệnh web chờ xử lý: 1 chạy, 2 dừng
char badCmd[48] = "";                  // lệnh sai định dạng chờ xử lý
char stMsg[110] = "Khoi dong: tai tat (DUNG)";
int outDuty = -1;                      // duty đang xuất ra chân máy bơm

// pct = 0: tắt hẳn bằng GPIO thường (mức HIGH); 1-100: PWM. Máy bơm kích mức thấp nên đảo duty.
void pumpWrite(int pct) {
  static bool pwmOn = false;
  if (pct <= 0) {
    if (pwmOn) { ledcDetachPin(PIN_PUMP_B); pwmOn = false; }
    pinMode(PIN_PUMP_B, OUTPUT);
    digitalWrite(PIN_PUMP_B, HIGH);
    return;
  }
  const uint32_t top = (1 << PUMP_PWM_BITS) - 1;
  ledcWrite(CH_PUMP, top - top * pct / 100);   // ghi duty trước rồi mới nối chân, tránh xung bật nhầm
  if (!pwmOn) { ledcAttachPin(PIN_PUMP_B, CH_PUMP); pwmOn = true; }
}

void saveCtrl() {
  prefs.begin("ctrl", false);
  prefs.putInt("duty", duty);
  prefs.putUInt("lim", runLimit);
  prefs.putUInt("cd", cooldown);
  prefs.putUInt("hz", pwmHz);
  prefs.putUInt("kick", kickMs);
  prefs.end();
}

void setState(int s, const char *fmt, ...) {
  char why[80];
  va_list ap; va_start(ap, fmt); vsnprintf(why, sizeof(why), fmt, ap); va_end(ap);
  snprintf(stMsg, sizeof(stMsg), "%s -> %s: %s", ST_NAME[pst], ST_NAME[s], why);
  logEvent(s == ST_FAULT ? 'E' : 'I', "B3 FSM %s", stMsg);
  pst = s;
  stSince = millis();
}

void reject(const char *fmt, ...) {
  char why[80];
  va_list ap; va_start(ap, fmt); vsnprintf(why, sizeof(why), fmt, ap); va_end(ap);
  snprintf(stMsg, sizeof(stMsg), "Giu %s, tu choi: %s", ST_NAME[pst], why);
  logEvent('W', "B3 %s", stMsg);
}

void updateState() {
  unsigned long now = millis();
  bool sensOk = sensCode == E_OK && !isnan(temperature);
  const char *sensTxt = sensCode == E_OK ? "chua co du lieu cam bien" : ERR_TXT[sensCode];

  // Cảm biến báo lỗi (E1/E2/E3) -> LỖI dù đang DỪNG hay CHẠY; lúc mới khởi động chưa có dữ liệu thì không tính.
  // Lệnh sai định dạng chỉ đưa vào LỖI khi đang CHẠY, lúc DỪNG thì bỏ qua.
  bool sensBad = sensCode != E_OK, runBad = pst == ST_RUN && badCmd[0];
  if (pst != ST_FAULT && (sensBad || runBad)) {
    if (pst == ST_RUN) coolUntil = now + cooldown * 1000UL;
    if (runBad) { setState(ST_FAULT, "lenh sai '%s'", badCmd); badCmd[0] = 0; }
    else setState(ST_FAULT, "%s", sensTxt);
    cmdReq = 0;                        // LỖI không bị lệnh chạy đi kèm ghi đè
  } else if (pst == ST_RUN && now - stSince >= runLimit * 1000UL) {
    coolUntil = now + cooldown * 1000UL;
    setState(ST_STOP, "het gio %lus, nghi %lus", runLimit, cooldown);
  } else if (pst == ST_FAULT && sensOk && now - stSince >= FAULT_HOLD_MS) {
    long left = (long)(coolUntil - now);
    if (left > 0) setState(ST_STOP, "het loi, con nghi %lds", (left + 999) / 1000);
    else setState(ST_STOP, "het loi");
  }

  if (badCmd[0]) {                     // lệnh sai khi không chạy: chỉ bỏ qua
    reject("lenh sai '%s'", badCmd);
    badCmd[0] = 0;
    cmdReq = 0;
  }
  if (cmdReq == 2) {
    if (pst == ST_RUN) setState(ST_STOP, "lenh dung");
  } else if (cmdReq == 1) {
    long coolLeft = (long)(coolUntil - now);
    if (pst == ST_FAULT) reject("dang LOI");
    else if (pst == ST_RUN) reject("dang CHAY, khong gia han gio");
    else if (coolLeft > 0) reject("dang nghi, con %lds", (coolLeft + 999) / 1000);
    else if (!sensOk) reject("%s", sensTxt);
    else setState(ST_RUN, "lenh chay, duty %d%%, toi da %lus", duty, runLimit);
  }
  cmdReq = 0;

  int want = pst == ST_RUN ? duty : 0;
  if (want > 0 && outDuty <= 0) kickUntil = now + kickMs;   // vừa bật: mồi 100%
  if (want > 0 && (long)(kickUntil - now) > 0) want = 100;
  if (want != outDuty) {
    if (outDuty > 0 && want > 0 && want == duty) logEvent('I', "B3 Doi duty %d%% -> %d%%", outDuty, want);
    pumpWrite(want);
    outDuty = want;
  }
}

// Số nguyên dương thuần chữ số trong [lo, hi]; "abc", "5.5", "-1", "" đều sai
bool parseNum(const String &v, long lo, long hi, long &out) {
  if (v.length() == 0 || v.length() > 6) return false;
  for (char c : v) if (!isDigit(c)) return false;
  out = v.toInt();
  return out >= lo && out <= hi;
}

// /api/ctrl?cmd=start|stop & duty=1..100 & lim=3..300 & cd=0..600
// Tham số lạ hoặc giá trị sai -> lệnh sai định dạng (đang CHẠY thì chuyển LỖI)
void handleCtrl() {
  String bad;
  bool cfg = false;
  for (int i = 0; i < server.args(); i++) {
    String k = server.argName(i), v = server.arg(i);
    long x;
    if (k == "cmd" && v == "start") cmdReq = 1;
    else if (k == "cmd" && v == "stop") cmdReq = 2;
    else if (k == "duty" && parseNum(v, 1, 100, x)) { duty = x; cfg = true; }
    else if (k == "lim" && parseNum(v, 3, 300, x)) { runLimit = x; cfg = true; }
    else if (k == "cd" && parseNum(v, 0, 600, x)) { cooldown = x; cfg = true; }
    else if (k == "hz" && parseNum(v, 20, 20000, x)) { pwmHz = x; ledcChangeFrequency(CH_PUMP, x, PUMP_PWM_BITS); cfg = true; }
    else if (k == "kick" && parseNum(v, 0, 2000, x)) { kickMs = x; cfg = true; }
    else if (bad.isEmpty()) bad = k + (v.length() ? "=" + v : "");
  }
  if (bad.length()) {
    if (cmdReq == 1) cmdReq = 0;       // lệnh chạy kèm tham số sai thì không chạy; lệnh dừng vẫn giữ
    strlcpy(badCmd, bad.c_str(), sizeof(badCmd));
    for (char *c = badCmd; *c; c++) if (*c == '"' || *c == '\\' || *c < 32) *c = '?';
  }
  if (cfg) {
    saveCtrl();
    logEvent('I', "B3 Cau hinh: duty %d%%, PWM %luHz, moi %lums, toi da %lus, nghi %lus",
             duty, pwmHz, kickMs, runLimit, cooldown);
  }
  updateState();
  server.send(200, "application/json", stateJson());
}

// ----- Ngắt ngoài: nút ở PIN_BUTTON, ngắt cả 2 cạnh -----
// ISR chỉ cập nhật bộ đếm. Chống dội bằng thời gian: cạnh xuống chỉ tính là 1 lần bấm khi chân đã
// ở mức cao (nhả) liên tục >= debUs và cách lần bấm trước >= debUs. debUs = 0 là tắt chống dội.
volatile uint32_t btnCalls = 0, btnFall = 0, btnCnt = 0;
volatile uint32_t btnRiseUs = 0, btnAccUs = 0, debUs = 50000;
volatile int simLeft = 0;              // số lần bấm giả lập còn phải tạo
volatile uint32_t simDone = 0;
bool busyReq = false;
char busyMsg[100] = "";

void IRAM_ATTR onButton() {
  uint32_t now = micros();
  btnCalls++;
  if (digitalRead(PIN_BUTTON)) { btnRiseUs = now; return; }
  btnFall++;
  if (now - btnRiseUs >= debUs && now - btnAccUs >= debUs) { btnCnt++; btnAccUs = now; }
}

// Giả lập nút bị dội: chân để open-drain + kéo lên, task kéo xuống/thả ra nhiều lần trong vài ms.
// Nút thật nối song song vẫn an toàn vì chân không bao giờ chủ động xuất mức cao.
void bounceTo(int level) {
  int n = random(3, 9);
  for (int i = 0; i < n; i++) {
    gpio_set_level((gpio_num_t)PIN_BUTTON, level);
    delayMicroseconds(random(80, 400));
    gpio_set_level((gpio_num_t)PIN_BUTTON, !level);
    delayMicroseconds(random(50, 300));
  }
  gpio_set_level((gpio_num_t)PIN_BUTTON, level);
}

void simTask(void *) {
  for (;;) {
    if (simLeft > 0) {
      bounceTo(0); vTaskDelay(pdMS_TO_TICKS(150));   // bấm, giữ 150 ms
      bounceTo(1); vTaskDelay(pdMS_TO_TICKS(350));   // nhả
      simLeft--; simDone++;
    } else vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// Thử khi CPU bận: loop bị chặn 5 s đọc cảm biến liên tục, ISR vẫn phải đếm được
void cpuBusyTest() {
  uint32_t c0 = btnCnt, f0 = btnFall;
  unsigned long t0 = millis();
  int n = 0;
  int16_t t, h;
  while (millis() - t0 < 5000) { readUno(t, h); n++; }
  snprintf(busyMsg, sizeof(busyMsg), "CPU ban 5s (%d lan doc I2C): ISR ghi nhan %lu lan bam (%lu canh xuong)",
           n, btnCnt - c0, btnFall - f0);
  logEvent('I', "B3 %s", busyMsg);
}

// ----- Timer phần cứng so với millis() -----
struct Stat { uint32_t n, mn, mx, last; uint64_t sum; };
volatile Stat hwSt = {0, UINT32_MAX, 0, 0, 0};
Stat loopSt = {0, UINT32_MAX, 0, 0, 0};
portMUX_TYPE tmrMux = portMUX_INITIALIZER_UNLOCKED;
hw_timer_t *hwTimer = nullptr;
uint32_t timerMs = TIMER_MS;
unsigned long loopTick = 0;

// Lưu RING_N khoảng đo gần nhất để trang /ctrl vẽ đồ thị thời gian thực
#define RING_N 512
struct Pt { uint32_t t, d; };          // t: millis() lúc kết thúc khoảng, d: độ dài khoảng (µs)
Pt hwRing[RING_N], loopRing[RING_N];
volatile uint32_t hwSeq = 0;           // tổng số điểm đã ghi (vị trí ghi = seq % RING_N)
uint32_t loopSeq = 0;

// Trả về độ dài khoảng vừa đo (µs), 0 nếu là lần đầu sau khi đặt lại
uint32_t IRAM_ATTR addStat(volatile Stat &s, uint32_t now) {
  uint32_t d = 0;
  if (s.last) {
    d = now - s.last;
    s.n++; s.sum += d;
    if (d < s.mn) s.mn = d;
    if (d > s.mx) s.mx = d;
  }
  s.last = now;
  return d;
}

void IRAM_ATTR onTimer() {
  uint32_t now = micros(), ms = millis();
  portENTER_CRITICAL_ISR(&tmrMux);
  uint32_t d = addStat(hwSt, now);
  if (d) { hwRing[hwSeq % RING_N] = {ms, d}; hwSeq++; }
  portEXIT_CRITICAL_ISR(&tmrMux);
}

void resetTimerStats() {
  portENTER_CRITICAL(&tmrMux);
  hwSt.n = hwSt.mx = hwSt.last = 0; hwSt.sum = 0; hwSt.mn = UINT32_MAX;
  portEXIT_CRITICAL(&tmrMux);
  loopSt = {0, UINT32_MAX, 0, 0, 0};
  loopTick = millis();
}

// Bản dùng millis() giống logger Bài 2: gọi trong loop nên bị trễ khi loop bận
void updateLoopTimer() {
  if (millis() - loopTick < timerMs) return;
  loopTick += timerMs;
  if (millis() - loopTick >= timerMs) loopTick = millis();
  uint32_t d = addStat(loopSt, micros());
  if (d) { loopRing[loopSeq % RING_N] = {millis(), d}; loopSeq++; }
}

// Ghi các điểm từ vị trí from tới seq thành mảng JSON [[t,d],...]; client gửi lại seq để chỉ lấy phần mới
void ringJson(String &s, const Pt *ring, uint32_t seq, uint32_t from) {
  if (from > seq || seq - from > RING_N) from = seq > RING_N ? seq - RING_N : 0;
  s += '[';
  char b[24];
  for (uint32_t i = from; i < seq; i++) {
    const Pt &p = ring[i % RING_N];
    snprintf(b, sizeof(b), "%s[%lu,%lu]", i == from ? "" : ",", (unsigned long)p.t, (unsigned long)p.d);
    s += b;
  }
  s += ']';
}

// /api/tmr?hs=..&ls=.. : điểm mới của timer phần cứng (h) và millis() (l)
void handleTmr() {
  static Pt hwCopy[RING_N];
  uint32_t hs = server.hasArg("hs") ? server.arg("hs").toInt() : UINT32_MAX;
  uint32_t ls = server.hasArg("ls") ? server.arg("ls").toInt() : UINT32_MAX;
  portENTER_CRITICAL(&tmrMux);           // chép nhanh vòng đệm của ISR rồi mới định dạng
  uint32_t seq = hwSeq;
  memcpy(hwCopy, hwRing, sizeof(hwRing));
  portEXIT_CRITICAL(&tmrMux);
  String s;
  s.reserve(12000);
  s = "{\"now\":" + String(millis()) + ",\"ms\":" + String(timerMs) + ",\"hs\":" + String(seq) +
      ",\"ls\":" + String(loopSeq) + ",\"h\":";
  ringJson(s, hwCopy, seq, hs);
  s += ",\"l\":";
  ringJson(s, loopRing, loopSeq, ls);
  s += '}';
  server.send(200, "application/json", s);
}

void setTimerMs(uint32_t ms) {
  timerMs = ms;
  timerAlarmWrite(hwTimer, ms * 1000ULL, true);   // timer đếm 1 µs/nhịp
  resetTimerStats();
}

// /api/lab?deb=ms & sim=n & busy=1 & reset=btn|tmr & tms=ms  (thí nghiệm, không ảnh hưởng máy bơm)
void handleLab() {
  if (server.hasArg("deb")) {
    debUs = constrain(server.arg("deb").toInt(), 0, 500) * 1000UL;
    logEvent('I', "B3 Chong doi %lu ms", debUs / 1000);
  }
  if (server.hasArg("sim")) simLeft += constrain(server.arg("sim").toInt(), 1, 20);
  if (server.arg("reset") == "btn") { btnCalls = btnFall = btnCnt = 0; simDone = 0; busyMsg[0] = 0; }
  if (server.arg("reset") == "tmr") resetTimerStats();
  if (server.hasArg("tms")) setTimerMs(constrain(server.arg("tms").toInt(), 10, 2000));
  if (server.hasArg("busy")) {
    if (pst == ST_RUN) strlcpy(busyMsg, "Dang CHAY bom, khong cho CPU ban (may trang thai se dung 5s)", sizeof(busyMsg));
    else busyReq = true;
  }
  server.send(200, "application/json", stateJson());
}

void setupCtrl() {
  prefs.begin("ctrl", false);   // false: tạo vùng nhớ nếu chưa có
  duty = constrain(prefs.getInt("duty", 50), 1, 100);
  runLimit = constrain(prefs.getUInt("lim", RUN_LIMIT_S), 3, 300);
  cooldown = constrain(prefs.getUInt("cd", COOLDOWN_S), 0, 600);
  pwmHz = constrain(prefs.getUInt("hz", PUMP_PWM_HZ), 20, 20000);
  kickMs = constrain(prefs.getUInt("kick", KICK_MS), 0, 2000);
  prefs.end();
  ledcSetup(CH_PUMP, pwmHz, PUMP_PWM_BITS);
  updateState();                       // xuất trạng thái DỪNG: chân máy bơm HIGH
  logEvent('I', "B3 FSM khoi dong o DUNG (duty %d%%, toi da %lus, nghi %lus)", duty, runLimit, cooldown);

  pinMode(PIN_BUTTON, INPUT_PULLUP);
  gpio_set_direction((gpio_num_t)PIN_BUTTON, GPIO_MODE_INPUT_OUTPUT_OD);
  gpio_set_level((gpio_num_t)PIN_BUTTON, 1);
  attachInterrupt(PIN_BUTTON, onButton, CHANGE);
  xTaskCreatePinnedToCore(simTask, "btnsim", 2048, nullptr, 1, nullptr, 0);

  hwTimer = timerBegin(1, 80, true);   // timer 1, chia 80 MHz -> 1 MHz
  timerAttachInterrupt(hwTimer, onTimer, true);
  timerAlarmWrite(hwTimer, timerMs * 1000ULL, true);
  timerAlarmEnable(hwTimer);
  resetTimerStats();
}

String ctrlJson() {
  Stat h, l = loopSt;
  portENTER_CRITICAL(&tmrMux);
  h.n = hwSt.n; h.mn = hwSt.mn; h.mx = hwSt.mx; h.sum = hwSt.sum;
  portEXIT_CRITICAL(&tmrMux);
  unsigned long now = millis();
  long coolLeft = (long)(coolUntil - now);
  char buf[1000];
  snprintf(buf, sizeof(buf),
    ",\"fsm\":{\"st\":%d,\"duty\":%d,\"out\":%d,\"lim\":%lu,\"cd\":%lu,\"el\":%lu,\"cool\":%ld,"
    "\"hz\":%lu,\"kick\":%lu,\"hold\":%d,\"msg\":\"%s\"},"
    "\"btn\":{\"pin\":%d,\"calls\":%lu,\"fall\":%lu,\"cnt\":%lu,\"deb\":%lu,\"simLeft\":%d,\"sim\":%lu,"
    "\"busy\":%d,\"bmsg\":\"%s\"},"
    "\"tmr\":{\"ms\":%lu,\"n\":%lu,\"avg\":%.1f,\"min\":%lu,\"max\":%lu,"
    "\"ln\":%lu,\"lavg\":%.1f,\"lmin\":%lu,\"lmax\":%lu}",
    pst, duty, outDuty, runLimit, cooldown, pst == ST_RUN ? now - stSince : 0UL,
    coolLeft > 0 ? coolLeft : 0L, pwmHz, kickMs, FAULT_HOLD_MS, stMsg,
    PIN_BUTTON, btnCalls, btnFall, btnCnt, debUs / 1000, simLeft, simDone, busyReq, busyMsg,
    timerMs, h.n, h.n ? (double)h.sum / h.n : 0.0, h.n ? h.mn : 0, h.mx,
    l.n, l.n ? (double)l.sum / l.n : 0.0, l.n ? l.mn : 0, l.mx);
  return buf;
}

// ===== Web =====
String stateJson() {
  char buf[300];
  snprintf(buf, sizeof(buf),
    "{\"t\":%s,\"h\":%s,\"ledR\":%d,\"ledG\":%d,\"ledArray\":%d,"
    "\"pump\":%d,\"auto\":%d,\"th\":%.1f,\"song\":%d,\"songs\":[",
    isnan(temperature) ? "null" : String(temperature, 1).c_str(),
    isnan(humidity) ? "null" : String(humidity, 0).c_str(),
    ledR, ledG, ledArray, pst == ST_RUN, autoMode, tempThreshold, songId);
  String s = buf;
  for (int i = 0; i < SONG_COUNT; i++) {
    if (i) s += ',';
    s += '"'; s += SONGS[i].name; s += '"';
  }
  char lg[220];
  snprintf(lg, sizeof(lg),
    "],\"code\":%d,\"log\":{\"run\":%d,\"iv\":%lu,\"n\":%lu,\"max\":%d,\"boot\":%u,"
    "\"base\":%.0f,\"fault\":%d,\"ev\":%u}",
    sensCode, logging, logInterval, logCount, LOG_MAX, bootNo, bootBase, simFault, (unsigned)eventsSize());
  s += lg;
  s += ctrlJson();
  s += ",\"ip\":\"";
  s += WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
  s += "\"}";
  return s;
}

void handleSet() {
  if (server.hasArg("auto")) autoMode = server.arg("auto").toInt();
  if (server.hasArg("th")) tempThreshold = server.arg("th").toFloat();
  // Khi đang tự động thì LED R/G và quạt do ESP32 tự quyết
  if (!autoMode) {
    if (server.hasArg("ledR")) ledR = server.arg("ledR").toInt();
    if (server.hasArg("ledG")) ledG = server.arg("ledG").toInt();
  }
  if (server.hasArg("ledArray")) ledArray = constrain(server.arg("ledArray").toInt(), 0, 2);
  if (server.hasArg("pump")) cmdReq = server.arg("pump").toInt() ? 1 : 2;   // qua máy trạng thái
  if (server.hasArg("play")) playSong(server.arg("play").toInt());
  if (server.hasArg("stop")) stopSong();
  applyOutputs();
  updateState();
  server.send(200, "application/json", stateJson());
}

void setupWiFi() {
  if (strlen(STA_SSID) > 0) {
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(STA_SSID, STA_PASS);
    Serial.printf("Dang ket noi WiFi %s", STA_SSID);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED)
      Serial.printf("WiFi phong: http://%s\n", WiFi.localIP().toString().c_str());
    else
      Serial.println("Khong vao duoc WiFi phong, chi dung AP");
  } else {
    WiFi.mode(WIFI_AP);
  }
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("AP: %s / %s -> http://%s\n", AP_SSID, AP_PASS, WiFi.softAPIP().toString().c_str());
  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("Hoac: http://%s.local\n", MDNS_NAME);
  }
}

void setup() {
  Serial.begin(115200);
  digitalWrite(PIN_PUMP_B, HIGH);   // giữ máy bơm tắt ngay từ lúc khởi động
  for (int p : {PIN_LED_R, PIN_LED_G, PIN_LED_ARRAY, PIN_PUMP_A, PIN_PUMP_B})
    pinMode(p, OUTPUT);
  applyOutputs();

  ledcSetup(CH_BUZZER, 2000, 8);
  ledcAttachPin(PIN_BUZZER, CH_BUZZER);
  ledcWriteTone(CH_BUZZER, 0);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
  Wire.setTimeOut(50);

  setupLogger();
  setupCtrl();
  setupWiFi();

  server.on("/", []() { server.send_P(200, "text/html; charset=utf-8", INDEX_HTML); });
  server.on("/api/state", []() { server.send(200, "application/json", stateJson()); });
  server.on("/api/set", handleSet);
  server.on("/data", []() { server.send_P(200, "text/html; charset=utf-8", DATA_HTML); });
  server.on("/api/time", handleTime);
  server.on("/api/log", handleLog);
  server.on("/api/events", handleEvents);
  server.on("/api/logcfg", handleLogCfg);
  server.on("/api/sim", handleSim);
  server.on("/ctrl", []() { server.send_P(200, "text/html; charset=utf-8", CTRL_HTML); });
  server.on("/api/ctrl", handleCtrl);
  server.on("/api/lab", handleLab);
  server.on("/api/tmr", handleTmr);
  server.onNotFound([]() { server.sendHeader("Location", "/"); server.send(302); });
  server.begin();

  playSong(SONG_COUNT - 1);   // tiếng "bíp" báo đã khởi động xong
}

void loop() {
  server.handleClient();
  updateSong();
  updateSensor();
  updateState();
  updateLogger();
  updateLoopTimer();
  if (busyReq) { cpuBusyTest(); busyReq = false; }
  updateBlink();
}
