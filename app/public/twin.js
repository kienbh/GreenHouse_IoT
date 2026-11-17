import { readView, subscribeView } from './dashboard.js';
const $ = (s) => document.querySelector(s);
const tele = () => readView().connection.ready ? readView().tele : null;
let inspected = '';
const INSPECT = { ledR: ['LED đỏ', 'Đèn báo đỏ. Thay đổi tại mục Đèn & tự động hóa.'], ledG: ['LED xanh', 'Đèn báo xanh. Thay đổi tại mục Đèn & tự động hóa.'], strip: ['Dải LED', 'Dải LED có ba chế độ: tắt, bật và nháy. Chọn chế độ trong dashboard.'], pump: ['Máy bơm', 'Quan sát trạng thái bơm tại dashboard. Bấm mô hình không chạy hay dừng bơm.'], sensor: ['Cảm biến nhiệt ẩm', 'Số liệu thực từ ESP32, thời gian cập nhật hiển thị trong dashboard.'], buzzer: ['Buzzer', 'Mở mục Âm thanh thiết bị để chọn bài hoặc dừng âm thanh.'], tank: ['Bình nước mô phỏng', 'Mực nước là hiệu ứng minh họa, không phải số đo từ cảm biến.'], plant: ['Chậu cây', 'Nước tưới và độ ẩm đất là hiệu ứng minh họa theo trạng thái bơm.'], board: ['Bo mạch ESP32', 'Nhận dữ liệu và gửi lệnh qua MQTT. Xem tình trạng kết nối ở đầu trang.'] };
function inspect(key) { inspected = key; const [title, text] = INSPECT[key]; $('#inspectTitle').textContent = title; $('#inspectText').textContent = text; }

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ===== Vị trí các bộ phận trên mô hình Meshy (đơn vị của model, x phải · y lên · z ra phía trước) =====
// Đo bằng Alt + bấm lên mô hình rồi sửa số ở đây nếu điểm tương tác lệch khỏi bộ phận thật
const SPOT = {
  sensor: [-0.70, 0.62, -0.30],                    // cụm cảm biến góc trên bên trái
  pump:   [0.43, -0.44, 0.40],                     // máy bơm nhỏ cạnh bình nước
  tank:   [0.66, 0.30, 0.13],                      // bình nước (vị trí nhãn)
  water:  { x: 0.658, z: 0.13, r: 0.15, y0: -0.45, y1: 0.10 },   // lòng bình: thân trụ đo bằng raycast trên mô hình
  plant:  [0.14, -0.50, -0.12],                     // tâm đáy chậu cây giữa khu trồng (y tự dò theo sàn mô hình khi tải)
  nozzle: [0.14, 0.02, -0.12],                      // vòi phun phía trên chậu cây
  hose:   [[0.43, -0.40, 0.40], [0.36, -0.40, 0.20], [0.34, -0.32, -0.30], [0.30, -0.02, -0.30], [0.20, 0.08, -0.20], [0.14, 0.08, -0.12], [0.14, 0.04, -0.12]],  // ống từ máy bơm lên vòi
  ledR:   [-0.42, -0.33, 0.60],
  ledG:   [-0.34, -0.33, 0.60],
  btns:   [-0.30, -0.56, 0.76],                    // bảng nút bấm 3D đặt trước bo mạch: nút đỏ / xanh bật tắt LED
  board:  [-0.58, -0.30, 0.30],                    // bo mạch điều khiển
  buzzer: [-0.54, -0.35, 0.52],                    // buzzer trên bo mạch (GPIO21)
  strip:  [[-0.22, 0.45, -0.50], [0.62, 0.45, -0.50], [-0.22, 0.45, -0.14], [0.62, 0.45, -0.14]],  // 2 đoạn dải LED trên nóc
};
const CAMS = { iso: [1.7, 1.1, 2.1], front: [0, 0.05, 3.3], top: [0, 3.4, 0.01], right: [3.3, 0.1, 0] };

// ===== Cảnh 3D =====
const host = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0xe9efeb);
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 0.6; controls.maxDistance = 12;
const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.MeshStandardMaterial({ color: 0xdce6df, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.67; scene.add(floor);

const q = new URLSearchParams(location.search);
resize();
function setCam(name) {
  const chosen = CAMS[name] ? name : 'iso';
  const k = Math.max(1, 1.05 / camera.aspect);
  camera.position.set(...CAMS[chosen].map((v) => v * k)); controls.target.set(0, -0.05, 0); controls.update();
  for (const button of document.querySelectorAll('[data-cam]')) { const on = button.dataset.cam === chosen; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); }
}
function resize() {
  const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.clearViewOffset(); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
setCam(q.get('cam') || 'iso');
for (const button of document.querySelectorAll('[data-cam]')) button.onclick = () => setCam(button.dataset.cam);

const V = (a) => new THREE.Vector3(...a);
const glow = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false });
const clickable = [];      // vật thể bấm được: mesh.userData.act = hàm xem thông tin, không gửi lệnh

function label(pos, html, act) {
  const el = document.createElement(act ? 'button' : 'div');
  el.className = 'tag'; el.innerHTML = html;
  if (act) el.onclick = act;
  const o = new CSS2DObject(el); o.position.copy(V(pos)); scene.add(o);
  el.obj = o;
  return el;
}

// LED đỏ / xanh: quả cầu phát sáng + đèn điểm chiếu ra xung quanh
// Quầng sáng: sprite gradient tròn, cộng màu nên thấy rõ cả khi LED nằm sát bo mạch
const haloTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function makeLed(pos, color, key) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.028, 20, 14), glow(0x333333));
  m.position.copy(V(pos)); m.userData.act = () => inspect(key); scene.add(m); clickable.push(m);
  const light = new THREE.PointLight(color, 0, 0.8); light.position.copy(m.position); scene.add(light);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
  halo.scale.setScalar(0.2); halo.position.copy(m.position); halo.visible = false; scene.add(halo);
  return { m, light, halo, color: new THREE.Color(color) };
}
const LED = { ledR: makeLed(SPOT.ledR, 0xff3b2f, 'ledR'), ledG: makeLed(SPOT.ledG, 0x31e06a, 'ledG') };

// Bảng nút bấm 3D trước bo mạch: bấm nút đỏ / xanh để xem thông tin LED
// Nút lún xuống khi bấm, phát sáng khi LED đang bật
const btnPanel = new THREE.Group(); btnPanel.position.copy(V(SPOT.btns)); btnPanel.rotation.x = 0.35; btnPanel.scale.setScalar(1.4); scene.add(btnPanel);
btnPanel.add(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.02, 0.13), new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.55, metalness: 0.2 })));
function makeBtn(x, color, key, text) {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.014, 36), new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.4 }));
  ring.position.set(x, 0.016, -0.01);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.035, 0.026, 36),
    new THREE.MeshStandardMaterial({ color, roughness: 0.3, emissive: color, emissiveIntensity: 0.05 }));
  cap.position.set(x, 0.03, -0.01);
  const act = () => { cap.userData.pressAt = performance.now(); inspect(key); };
  cap.userData.act = ring.userData.act = act;
  btnPanel.add(ring, cap); clickable.push(cap, ring);
  const el = document.createElement('div'); el.className = 'tag'; el.innerHTML = text; el.onclick = act; el.tabIndex = 0; el.setAttribute('role', 'button'); el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
  const o = new CSS2DObject(el); o.position.set(x * 1.6, 0, 0.09); btnPanel.add(o);
  return { cap, el, key, text };
}
const BTNS = [makeBtn(-0.075, 0xff3b2f, 'ledR', 'LED đỏ'), makeBtn(0.075, 0x2fd567, 'ledG', 'LED xanh')];

// Dải LED: 2 ống sáng dọc nóc
const stripMat = glow(0x2a2a22);
const stripLights = [];
for (let i = 0; i < SPOT.strip.length; i += 2) {
  const a = V(SPOT.strip[i]), b = V(SPOT.strip[i + 1]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 8, 0.012, 8), stripMat);
  tube.userData.act = () => inspect('strip'); scene.add(tube); clickable.push(tube);
  for (const t of [0.2, 0.8]) {
    const l = new THREE.PointLight(0xfff1c8, 0, 1.4); l.position.copy(a.clone().lerp(b, t)); scene.add(l); stripLights.push(l);
  }
}

// Máy bơm: vòng sáng đổi màu theo FSM (xám DỪNG · xanh CHẠY · đỏ LỖI), nước nhỏ giọt ở đầu tưới khi chạy
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 10, 48), glow(0x666666));
ring.position.copy(V(SPOT.pump)); ring.rotation.x = Math.PI / 2; scene.add(ring);
const pumpHit = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
pumpHit.position.copy(ring.position); pumpHit.userData.act = () => inspect('pump'); scene.add(pumpHit); clickable.push(pumpHit);

// Chậu cây giữa khu trồng: chậu đất nung, đất sẫm lại khi được tưới, cây lá đung đưa
const POT_H = 0.13, POT_R = 0.085;
const plant = new THREE.Group(); plant.position.copy(V(SPOT.plant)); plant.scale.setScalar(1.25); scene.add(plant);
const potProfile = [[0, 0], [POT_R * 0.72, 0], [POT_R, POT_H], [POT_R * 1.1, POT_H], [POT_R * 1.1, POT_H + 0.016], [POT_R * 0.96, POT_H + 0.016]];
const pot = new THREE.Mesh(new THREE.LatheGeometry(potProfile.map(([x, y]) => new THREE.Vector2(x, y)), 40),
  new THREE.MeshStandardMaterial({ color: 0xb8643c, roughness: 0.85, side: THREE.DoubleSide }));
const SOIL_DRY = new THREE.Color(0x8a5d3b), SOIL_WET = new THREE.Color(0x3a2415);
const soilMat = new THREE.MeshStandardMaterial({ color: SOIL_DRY.clone(), roughness: 1 });
const soil = new THREE.Mesh(new THREE.CircleGeometry(POT_R * 0.98, 32), soilMat);
soil.rotation.x = -Math.PI / 2; soil.position.y = POT_H - 0.006;
plant.add(pot, soil);
const leaves = new THREE.Group(); leaves.position.y = POT_H - 0.006; plant.add(leaves);
const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9e3a, roughness: 0.6, side: THREE.DoubleSide });
const stemMat = new THREE.MeshStandardMaterial({ color: 0x55802c, roughness: 0.7 });
const leafGeo = new THREE.SphereGeometry(1, 14, 8).scale(0.024, 0.004, 0.045).translate(0, 0, 0.042);
for (let i = 0; i < 11; i++) {
  const a = i * 2.4, h = 0.07 + ((i * 37) % 11) / 11 * 0.11, r = 0.015 + ((i * 53) % 7) / 7 * 0.045;
  const tip = new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r);
  const stem = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h * 0.7, 0), tip);
  leaves.add(new THREE.Mesh(new THREE.TubeGeometry(stem, 10, 0.0035, 6), stemMat));
  const leaf = new THREE.Mesh(leafGeo, leafMat);
  leaf.position.copy(tip);
  leaf.lookAt(tip.clone().add(new THREE.Vector3(Math.cos(a), 0.5 + (i % 3) * 0.3, Math.sin(a))));   // lá chưa có cha nên toạ độ cục bộ = thế giới
  leaves.add(leaf);
}
const potHit = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 12), new THREE.MeshBasicMaterial({ visible: false }));
potHit.position.y = 0.16; potHit.userData.act = () => inspect('plant'); plant.add(potHit); clickable.push(potHit);

// Ống dẫn từ máy bơm lên vòi phun: chuyển xanh khi có nước chảy
const hoseMat = new THREE.MeshStandardMaterial({ color: 0xbfd6e6, roughness: 0.3, transparent: true, opacity: 0.6 });
scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(SPOT.hose.map(V)), 80, 0.007, 8), hoseMat));
const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.35 }));
nozzle.position.copy(V(SPOT.nozzle)); scene.add(nozzle);

// Nước phun hình nón từ vòi xuống mặt đất trong chậu
const DROPS = 110;
const dropGeo = new THREE.BufferGeometry();
dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3));
const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: 0x6fb8ff, size: 0.014, transparent: true, opacity: 0.85 }));
drops.visible = false; scene.add(drops);
const dropSeed = Array.from({ length: DROPS }, () => [Math.random(), Math.random() * 2 * Math.PI, Math.sqrt(Math.random())]);
let wet = 0, lastT = 0;

// Mực nước trong bình (giả lập để demo, phần cứng chưa có cảm biến mức): cột nước nhìn xuyên vỏ bình
// Bình thường đứng ở 25%; bơm chạy thì hạ dần xuống 20%, tắt bơm thì hồi lại 25%
const W = SPOT.water, W_FULL = 25, W_RUN = 20, W_SPEED = 0.3;   // W_SPEED: tốc độ tiến về mức đích (1/giây)
let level = W_FULL;
const xray = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
const waterCol = new THREE.Mesh(new THREE.CylinderGeometry(W.r, W.r, 1, 40, 1, true).translate(0, 0.5, 0), xray(0x2f86ff, 0.38));
const waterTop = new THREE.Mesh(new THREE.CircleGeometry(W.r, 40), xray(0x8cc8ff, 0.55));
waterTop.rotation.x = -Math.PI / 2;
const rimPts = Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos(i / 48 * Math.PI * 2) * W.r, 0, Math.sin(i / 48 * Math.PI * 2) * W.r));
const rim = (y, op) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), xray(0xbfe0ff, op)); l.position.y = y; return l; };
const tankX = new THREE.Group(); tankX.position.set(W.x, W.y0, W.z);
tankX.add(waterCol, waterTop, rim(0, 0.35), rim(W.y1 - W.y0, 0.35));
tankX.traverse((o) => { o.renderOrder = 5; });
scene.add(tankX);

// Buzzer: đĩa đen trên bo mạch, phát vòng sóng âm và nốt nhạc khi đang phát bài
const SONG_NAMES = ['Happy Birthday', 'Twinkle Twinkle', 'Jingle Bells', 'Bíp'];   // giống firmware/src/melodies.h
const buzzer = new THREE.Group(); buzzer.position.copy(V(SPOT.buzzer)); scene.add(buzzer);
const buzzBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 28), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5 }));
const buzzTop = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), glow(0x555555));
buzzTop.rotation.x = -Math.PI / 2; buzzTop.position.y = 0.0155;
buzzer.add(buzzBody, buzzTop);
buzzBody.userData.act = () => inspect('buzzer'); clickable.push(buzzBody);
const waves = [0, 1, 2].map(() => {
  const w = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, depthWrite: false, toneMapped: false }));
  w.rotation.x = Math.PI / 2; w.position.y = 0.02; w.visible = false; buzzer.add(w);
  return w;
});
const notes = [0, 1, 2].map(() => {
  const el = document.createElement('div'); el.className = 'note'; el.textContent = '♪';
  const o = new CSS2DObject(el); o.visible = false; buzzer.add(o);
  return o;
});


// Nhãn nổi
const tagSensor = label(SPOT.sensor, 'Cảm biến <b>--</b>', () => inspect('sensor'));
const tagPump = label(SPOT.pump, 'Máy bơm <b>--</b>', () => inspect('pump'));
const tagStrip = label(SPOT.strip[1].map((v, i) => (i === 1 ? v + 0.06 : v)), 'Dải LED <b>--</b>',
  () => inspect('strip'));
const tagBoard = label(SPOT.board, 'Bo mạch · LED <b>--</b>', () => inspect('board'));

const tagBuzz = label([SPOT.buzzer[0] - 0.12, SPOT.buzzer[1] - 0.12, SPOT.buzzer[2] + 0.08], 'Buzzer', () => inspect('buzzer'));
const tagTank = label(SPOT.tank, 'Bình nước · mô phỏng', () => inspect('tank'));
const tagPlant = label([SPOT.plant[0], SPOT.plant[1] + 0.36, SPOT.plant[2]], 'Chậu cây', () => inspect('plant'));

// Mô hình Meshy
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('/models/nhakinh.glb', (g) => {
  g.scene.traverse((o) => { if (o.isMesh) { o.userData.model = true; clickable.push(o); } });
  scene.add(g.scene);
  // Đặt chậu cây đúng mặt sàn mô hình: chiếu tia thẳng xuống tại vị trí chậu
  const down = new THREE.Raycaster(new THREE.Vector3(SPOT.plant[0], 0.2, SPOT.plant[2]), new THREE.Vector3(0, -1, 0));
  const fh = down.intersectObject(g.scene, true)[0];
  if (fh) { plant.position.y = fh.point.y; tagPlant.obj.position.y = fh.point.y + 0.3; }
  document.getElementById('loading').remove();
}, undefined, (e) => { document.getElementById('loading').textContent = 'Không tải được mô hình: ' + e.message; });

// ===== Chuột: rê để sáng nhãn, bấm để xem thông tin, Alt + bấm để đo toạ độ =====
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function hit(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  return ray.intersectObjects(clickable, false);
}
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;   // đang kéo xoay
  const hits = hit(e);
  if (e.altKey && hits[0]) {
    const p = hits[0].point, s = `[${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]`;
    document.getElementById('pick').textContent = 'Toạ độ vừa bấm: ' + s;
    navigator.clipboard?.writeText(s).catch(() => {});
    return;
  }
  const act = hits.find((h) => h.object.userData.act);
  if (act && (!hits[0].object.userData.model || act.distance - hits[0].distance < 0.15)) act.object.userData.act();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const h = hit(e).find((x) => x.object.userData.act);
  renderer.domElement.style.cursor = h ? 'pointer' : '';
});

// Dashboard owns connection and selection. This module never sends hardware commands.
let previousDevice = null;
subscribeView(({ current, tele: x, connection }) => {
  if (previousDevice !== current) { previousDevice = current; inspected = ''; level = W_FULL; wet = 0; }
  const p = x?.pump || {};
  tagSensor.textContent = x ? (x.code ? `Cảm biến · lỗi E${x.code}` : `${x.t ?? '--'}°C · ${x.h ?? '--'}%`) : 'Cảm biến · --';
  tagPump.textContent = 'Bơm · ' + ({ DUNG: 'Dừng', CHAY: 'Chạy', LOI: 'Lỗi' }[p.st] || '--');
  tagPump.className = 'tag ' + (connection.ready ? p.st || '' : '');
  tagStrip.textContent = 'Dải LED · ' + (['tắt', 'bật', 'nháy'][x?.ledArray] || '--');
  tagBuzz.textContent = x?.song >= 0 ? 'Buzzer · đang phát' : 'Buzzer';
  tagBoard.textContent = 'ESP32';
  // Show all inspection labels on hover/focus without crowding the small viewport.
  tagSensor.title = 'Xem thông tin cảm biến';
});

// ===== Vòng vẽ: hiệu ứng theo trạng thái thật =====
const PUMP_COL = { DUNG: 0x666666, CHAY: 0x3ad17a, LOI: 0xff4433 };
const clock = new THREE.Clock();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
renderer.setAnimationLoop(() => {
  const t = reducedMotion.matches ? 0 : clock.getElapsedTime(), x = tele(), p = x?.pump || {};
  for (const k of ['ledR', 'ledG']) {
    const on = !!x?.[k];
    LED[k].m.material.color.set(on ? LED[k].color : 0x333333);
    LED[k].light.intensity = on ? 2 : 0;
    LED[k].halo.visible = on;
    if (on) LED[k].halo.scale.setScalar(0.2 + 0.02 * Math.sin(t * 6));
  }
  // Nút bấm 3D: lún 120 ms khi bấm, sáng theo trạng thái LED
  const now = performance.now();
  for (const b of BTNS) {
    const on = !!x?.[b.key], down = now - (b.cap.userData.pressAt || 0) < 120;
    b.cap.position.y = down ? 0.02 : 0.03;
    b.cap.material.emissiveIntensity = on ? 1.1 : 0.05;
    b.el.textContent = `${b.text} · ${!x ? '--' : on ? 'bật' : 'tắt'}`;
    b.el.className = 'tag' + (on ? ' CHAY' : '');
  }
  // Buzzer: 3 vòng sóng lan ra lệch pha nhau, nốt nhạc bay lên
  const playing = x?.song >= 0;
  buzzTop.material.color.set(playing ? 0xffd36b : 0x555555);
  waves.forEach((w, i) => {
    const f = (t * 1.2 + i / 3) % 1;
    w.visible = playing && !reducedMotion.matches; w.scale.setScalar(0.035 + f * 0.13); w.material.opacity = (1 - f) * 0.8;
  });
  notes.forEach((n, i) => {
    const f = (t * 0.6 + i / 3) % 1;
    n.visible = playing && !reducedMotion.matches;
    n.position.set(Math.sin(t * 2 + i * 2) * 0.04, 0.03 + f * 0.2, 0);
    n.element.style.opacity = playing ? String(1 - f) : '0';
  });
  // Dải LED: chu kỳ nháy giống firmware (BLINK_MS = 500 ms)
  const arrOn = x?.ledArray === 1 || (x?.ledArray === 2 && Math.floor(t * 2) % 2 === 0);
  stripMat.color.set(arrOn ? 0xfff4d0 : 0x2a2a22);
  for (const l of stripLights) l.intensity = arrOn ? 1.5 : 0;

  const run = p.st === 'CHAY';
  ring.material.color.set(PUMP_COL[p.st] ?? 0x666666);
  const k = run ? 1 + 0.25 * Math.sin(t * 8) : p.st === 'LOI' ? 1 + 0.15 * Math.sin(t * 14) : 1;
  ring.scale.set(k, k, k);
  // Bình nước: vơi dần khi bơm, cột nước + mặt nước gợn nhẹ
  const dtw = Math.min(t - lastT, 0.1);
  const goal = run ? W_RUN : W_FULL;
  level += (goal - level) * Math.min(1, dtw * W_SPEED);
  const hw = Math.max(0.002, (W.y1 - W.y0) * level / 100);
  waterCol.scale.y = hw; waterTop.position.y = hw + (run ? Math.sin(t * 10) * 0.003 : 0);
  waterTop.visible = waterCol.visible = level > 0;
  const lp = Math.round(level);
  tagTank.textContent = `Nước mô phỏng · ${lp}%`;
  $('#wBar').style.width = level + '%';
  $('#wPct').textContent = lp + '%';
  $('#wMsg').textContent = 'Chưa có cảm biến mực nước. Đây là mô phỏng, không dùng để quyết định tưới.';
  const spray = run;
  drops.visible = spray && !reducedMotion.matches;
  hoseMat.color.set(spray ? 0x4aa3ff : 0xbfd6e6);
  if (spray) {
    const a = dropGeo.attributes.position, [nx, ny, nz] = SPOT.nozzle, speed = 0.5 + (p.out || 50) / 100;
    const fall = ny - 0.015 - (plant.position.y + POT_H * plant.scale.y), spread = POT_R * plant.scale.x * 0.85;
    for (let i = 0; i < DROPS; i++) {
      const [s0, ang, rad] = dropSeed[i], f = (t * speed + s0) % 1;
      a.setXYZ(i, nx + Math.cos(ang) * rad * spread * f, ny - 0.015 - fall * f * f, nz + Math.sin(ang) * rad * spread * f);
    }
    a.needsUpdate = true;
  }
  // Đất ẩm dần khi tưới, khô chậm khi dừng; lá rung nhẹ theo dòng nước
  const dt = Math.min(t - lastT, 0.1); lastT = t;
  wet = spray ? Math.min(1, wet + dt * 0.35) : Math.max(0, wet - dt * 0.02);
  soilMat.color.lerpColors(SOIL_DRY, SOIL_WET, wet);
  leaves.rotation.z = Math.sin(t * 1.3) * 0.03 + (run ? Math.sin(t * 9) * 0.015 : 0);
  leaves.rotation.x = Math.sin(t * 1.1 + 1) * 0.025;
  tagPlant.textContent = spray ? 'Tưới · minh họa' : 'Chậu cây';
  controls.enableDamping = !reducedMotion.matches;
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
