#pragma once
// Giao diện web nhúng trong ESP32 (không dùng CDN vì AP không có Internet)
const char INDEX_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nhà kính ESP32</title>
<style>
:root{--bg:#f2f5f1;--card:#fff;--fg:#1d2b22;--mute:#6b7a70;--acc:#2e8b57;--line:#dde5df;--on:#2e8b57}
@media(prefers-color-scheme:dark){:root{--bg:#121714;--card:#1b231e;--fg:#e4ece6;--mute:#93a399;--acc:#4cc27f;--line:#2b362f;--on:#4cc27f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:18px 16px 6px}h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:var(--mute);font-size:13px}
main{display:grid;gap:12px;padding:12px 16px 24px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));max-width:1100px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.card h2{margin:0 0 10px;font-size:15px;color:var(--mute);font-weight:600}
.big{display:flex;gap:24px}.big b{font-size:34px;font-weight:700}.big small{color:var(--mute);display:block}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0}
.btns{display:flex;flex-wrap:wrap;gap:8px}
button{border:1px solid var(--line);background:transparent;color:var(--fg);padding:9px 14px;border-radius:10px;font:inherit;cursor:pointer}
button.on{background:var(--on);border-color:var(--on);color:#fff}
.sw{width:52px;height:30px;border-radius:15px;padding:0;position:relative}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--mute);transition:.15s}
.sw.on::after{left:25px;background:#fff}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;vertical-align:-1px}
input[type=number]{width:80px;padding:6px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);font:inherit}
.note{color:var(--mute);font-size:12px}
.mbtns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.mbtns button{padding:12px 6px}
button:disabled{opacity:.45;cursor:not-allowed}
.lnk{display:inline-block;margin-top:6px;color:var(--acc);font-weight:600;text-decoration:none}
</style></head><body>
<header><h1>🌱 Nhà kính mini</h1><p id="st">Đang kết nối…</p>
 <p><a class="lnk" href="/data" target="_blank">📈 Đo &amp; ghi dữ liệu cảm biến (tab mới) →</a></p>
 <p><a class="lnk" href="/ctrl" target="_blank">🛡 Bài 3: Điều khiển máy bơm an toàn (tab mới) →</a></p></header>
<main>
<section class="card"><h2>Cảm biến</h2>
 <div class="big"><div><small>Nhiệt độ</small><b id="t">--</b> °C</div><div><small>Độ ẩm</small><b id="h">--</b> %</div></div>
</section>

<section class="card"><h2>Tự động</h2>
 <div class="row"><span>Báo nhiệt bằng đèn</span><button class="sw" id="auto"></button></div>
 <div class="row"><span>Ngưỡng nhiệt độ (°C)</span><input type="number" id="th" step="0.5"></div>
 <p class="note">Khi bật: nóng ≥ ngưỡng → LED đỏ sáng; mát → LED xanh sáng.</p>
</section>

<section class="card"><h2>Đèn</h2>
 <div class="row"><span><i class="dot" style="background:#e5484d"></i>LED đỏ</span><button class="sw" id="ledR"></button></div>
 <div class="row"><span><i class="dot" style="background:#30a46c"></i>LED xanh</span><button class="sw" id="ledG"></button></div>
 <div class="row"><span><i class="dot" style="background:#f5d90a"></i>Dải LED</span></div>
 <div class="mbtns" id="ledArray"></div>
</section>


<section class="card"><h2>Máy bơm</h2>
 <div class="row"><span>Bật / tắt</span><button class="sw" id="pump"></button></div>
 <p class="note" id="pst"></p>
</section>

<section class="card"><h2>Âm nhạc</h2>
 <div class="btns" id="songs"></div>
 <div class="btns" style="margin-top:8px"><button id="stop">⏹ Dừng</button></div>
</section>
</main>
<script>
const $=id=>document.getElementById(id);let S={},busy=0,fastUntil=0;
const STRIP=[[0,"Tắt"],[1,"Bật"],[2,"✦ Nháy"]];
function set(q){busy=1;fastUntil=Date.now()+1500;fetch("/api/set?"+new URLSearchParams(q)).then(r=>r.json()).then(render).catch(()=>{}).finally(()=>busy=0)}
const SW=["ledR","ledG","pump","auto"];
SW.forEach(id=>$(id).onclick=()=>set({[id]:S[id]?0:1}));
STRIP.forEach(([v,m])=>{const b=document.createElement("button");b.textContent=m;b.onclick=()=>set({ledArray:v});b.dataset.v=v;$("ledArray").append(b)});
$("th").onchange=e=>set({th:e.target.value});
$("stop").onclick=()=>set({stop:1});
function mark(box,v){[...$(box).children].forEach(b=>b.classList.toggle("on",+b.dataset.v===v))}
function render(s){S=s;
 $("t").textContent=s.t??"--";$("h").textContent=s.h??"--";
 SW.forEach(k=>$(k).classList.toggle("on",!!s[k]));
 // Đang tự động: LED R/G và quạt do ESP32 điều khiển
 $("ledR").disabled=$("ledG").disabled=!!s.auto;
 mark("ledArray",s.ledArray);
 const F=s.fsm;$("pst").textContent=["DỪNG","CHẠY","LỖI"][F.st]+(F.st==1?" · "+F.duty+"% · còn "+Math.ceil((F.lim*1000-F.el)/1000)+" s":"")+(F.cool>0?" · nghỉ "+Math.ceil(F.cool/1000)+" s":"")+" — chi tiết ở trang Bài 3";
 if(document.activeElement!==$("th"))$("th").value=s.th;
 if(!$("songs").children.length)s.songs.slice(0,-1).forEach((n,i)=>{const b=document.createElement("button");b.textContent="♪ "+n;b.dataset.v=i;b.onclick=()=>set({play:i});$("songs").append(b)});
 mark("songs",s.song);
 $("st").textContent="Đã kết nối · "+s.ip;
}
function poll(){if(!busy)fetch("/api/state").then(r=>r.json()).then(render).catch(()=>$("st").textContent="Mất kết nối…")}
// Ngay sau khi bấm thì cập nhật nhanh
let tick=0;setInterval(()=>{if(Date.now()<fastUntil||++tick%7==0)poll()},300);poll();
</script></body></html>)HTML";
