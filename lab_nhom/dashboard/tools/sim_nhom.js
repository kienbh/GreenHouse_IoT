// Giả lập nhiều nhóm SV để thử dashboard trước giờ học, kết nối broker không tài khoản giống ESP32 của SV
// Chạy: ./sim.sh [số nhóm, mặc định 8]
//  - Mỗi nhóm là 1 MQTT client riêng, Last Will "offline", gửi JSON vào vju/iot/nhomXX mỗi 5 s
//  - nhom07 rớt mạng 20 s mỗi phút,
//    nhom08 thỉnh thoảng gửi JSON hỏng / giá trị NaN để thấy cảnh báo trên dashboard
//  - Nhận "on"/"off" ở vju/iot/nhomXX/output rồi báo lại trạng thái
import mqtt from 'mqtt';

const URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const BASE = process.env.MQTT_BASE || 'vju/iot';
const N = Number(process.argv[2] || 8);

function group(i) {
  const name = `nhom${String(i).padStart(2, '0')}`, T = `${BASE}/${name}`;
  const s = { temp: 25 + Math.random() * 4, hum: 55 + Math.random() * 15, led: 0, btn: 0 };
  const flaky = i === 7, buggy = i === 8;
  let c, timers = [];

  function send() {
    s.temp += (Math.random() - 0.5) * 0.3; s.hum += (Math.random() - 0.5) * 0.8;
    if (buggy && Math.random() < 0.15) return c.publish(T, `{"nhom":"${name}","temp":nan,"hum":${s.hum.toFixed(1)}}`);
    const d = { nhom: name, temp: +s.temp.toFixed(1), hum: +s.hum.toFixed(1), led: s.led, btn: s.btn };
    c.publish(T, JSON.stringify(d));
  }
  function press() {   // nhấn giữ 0.3-1 s, nhấn thì đảo LED giống code mẫu
    s.btn = 1; s.led ^= 1; send();
    setTimeout(() => { s.btn = 0; if (c.connected) send(); }, 300 + Math.random() * 700);
  }
  function start() {
    c = mqtt.connect(URL, { clientId: `${name}-sim`, will: { topic: `${T}/status`, payload: 'offline', retain: true, qos: 1 } });
    c.on('connect', () => {
      c.publish(`${T}/status`, 'online', { retain: true });
      c.subscribe(`${T}/output`);
      send();
      timers = [setInterval(send, 5000), setInterval(() => Math.random() < 0.35 && press(), 4000 + i * 300)];
      console.log(`${name}: online`);
    });
    c.on('message', (_t, buf) => {
      s.led = buf.toString() === 'on' ? 1 : 0;
      send();
      console.log(`${name}: output ${buf} -> led ${s.led}`);
    });
    c.on('error', (e) => console.log(`${name}: ${e.message}`));
  }
  start();
  // nhom07: mất mạng đột ngột (không ngắt lịch sự) để broker tự gửi Last Will "offline"
  if (flaky) setInterval(() => {
    console.log(`${name}: gia lap rot mang 20 s`);
    timers.forEach(clearInterval); c.stream.destroy(); c.end(true);
    setTimeout(start, 20000);
  }, 60000);
}

for (let i = 1; i <= N; i++) setTimeout(() => group(i), i * 250);
console.log(`Gia lap ${N} nhom -> ${URL}, Ctrl+C de dung`);
