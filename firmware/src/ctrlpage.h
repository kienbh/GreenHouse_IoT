#pragma once
// Trang /ctrl: Bài 3 - điều khiển máy bơm an toàn (máy trạng thái DỪNG/CHẠY/LỖI, PWM),
// thí nghiệm ngắt ngoài + chống dội, timer phần cứng so với millis()
const char CTRL_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Điều khiển an toàn</title>
<style>
:root{--bg:#f2f5f1;--card:#fff;--fg:#1d2b22;--mute:#6b7a70;--acc:#2e8b57;--line:#dde5df;--bad:#e03131;--warn:#f08c00;--idle:#6b7a70}
@media(prefers-color-scheme:dark){:root{--bg:#121714;--card:#1b231e;--fg:#e4ece6;--mute:#93a399;--acc:#4cc27f;--line:#2b362f;--bad:#ff6b6b;--warn:#fcc419;--idle:#93a399}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:16px 16px 4px;max-width:1100px}h1{margin:0;font-size:21px}
header a{color:var(--acc);text-decoration:none;font-size:14px}
#st{margin:4px 0 0;color:var(--mute);font-size:13px}
main{display:grid;gap:12px;padding:12px 16px 28px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));max-width:1100px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;min-width:0}
.wide{grid-column:1/-1}
.card h2{margin:0 0 10px;font-size:15px;color:var(--mute);font-weight:600}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0;flex-wrap:wrap}
.btns{display:flex;flex-wrap:wrap;gap:8px}
button{border:1px solid var(--line);background:transparent;color:var(--fg);padding:9px 14px;border-radius:10px;font:inherit;cursor:pointer}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
button.stop{background:var(--bad);border-color:var(--bad);color:#fff}
button.on{outline:2px solid var(--acc);outline-offset:1px;font-weight:700}
input,select{padding:7px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit}
input[type=number]{width:84px}
.note{color:var(--mute);font-size:12.5px}
.fsm{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:6px;margin:4px 0 12px}
.box{border:2px solid var(--line);border-radius:12px;padding:10px 6px;text-align:center;opacity:.5;transition:.2s}
.box b{display:block;font-size:20px}.box small{color:var(--mute);font-size:12px}
.box.act{opacity:1}#b0.act{border-color:var(--idle)}#b1.act{border-color:var(--acc);background:color-mix(in srgb,var(--acc) 14%,transparent)}
#b2.act{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 14%,transparent)}
.arr{color:var(--mute);font-size:20px}
.bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--acc);transition:width .4s}
.bar.cool i{background:var(--warn)}
#msg{font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:10px;word-break:break-word}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px}.kv span{color:var(--mute)}
.big{font-size:30px;font-weight:700}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}
th{color:var(--mute);font-weight:600}
.rules li{margin:5px 0}.rules{padding-left:18px;margin:6px 0}
#ev{font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg);white-space:pre-wrap;word-break:break-word}
#ev .E{color:var(--bad)}#ev .W{color:var(--warn)}#ev .B{color:var(--acc);font-weight:600}
#tc{width:100%;height:340px;display:block;border-radius:10px}
.leg{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;margin-top:6px}.leg i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:6px;border-radius:2px}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#222;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;display:none}
</style></head><body>
<header><a href="/">← Bảng điều khiển</a>
<h1>🛡 Bài 3 · Điều khiển máy bơm an toàn</h1><p id="st">Đang kết nối…</p></header>
<main>
<section class="card wide"><h2>Máy trạng thái</h2>
 <div class="fsm">
  <div class="box" id="b0"><b>DỪNG</b><small>tải tắt · an toàn</small></div><div class="arr">⇄</div>
  <div class="box" id="b1"><b>CHẠY</b><small>có giới hạn giờ</small></div><div class="arr">→</div>
  <div class="box" id="b2"><b>LỖI</b><small>cảm biến / lệnh sai</small></div>
 </div>
 <div class="row"><span id="runTxt" class="note">Thời gian chạy</span><span id="coolTxt" class="note"></span></div>
 <div class="bar" id="bar"><i id="barI"></i></div>
 <div class="row" style="margin-top:12px">
  <div class="btns"><button class="pri" id="start">▶ Chạy</button><button class="stop" id="stop">■ Dừng</button></div>
  <span class="note" id="sens"></span>
 </div>
 <div id="msg">--</div>
</section>

<section class="card"><h2>Mức PWM (duty cycle)</h2>
 <div class="row"><span>Đang xuất ra máy bơm</span><span class="big" id="out">0%</span></div>
 <div class="row"><span>Duty khi chạy (1–100 %)</span><span><input type="number" id="duty" min="1" max="100" step="1"> <button id="dutyB">Áp dụng</button></span></div>
 <div class="btns" id="pre"></div>
 <div class="row"><span>Tần số PWM (Hz)</span><span><select id="hz"></select> <input type="number" id="hzIn" min="20" max="20000" style="display:none"></span></div>
 <div class="row"><span>Mồi khởi động 100% (ms, 0 = tắt)</span><span><input type="number" id="kick" min="0" max="2000" step="50"> <button id="kickB">Áp dụng</button></span></div>
 <p class="note" id="pwmNote"></p>
 <p class="note">Bơm chỉ kêu “u u” mà không quay: duty quá thấp không đủ lực mở máy, hoặc mạch công suất không đáp ứng kịp tần số. Thử hạ tần số (50–100 Hz) và bật mồi khởi động; ghi lại duty nhỏ nhất bơm còn chạy được.</p>
 <div class="row"><input id="obs" placeholder="Quan sát: tốc độ / tiếng bơm / lưu lượng…" style="flex:1;min-width:0"><button id="pwmRec">📌 Ghi</button></div>
</section>

<section class="card"><h2>Giới hạn an toàn</h2>
 <div class="row"><span>Thời gian chạy tối đa (3–300 s)</span><input type="number" id="lim" min="3" max="300"></div>
 <div class="row"><span>Thời gian nghỉ – cooldown (0–600 s)</span><input type="number" id="cd" min="0" max="600"></div>
 <div class="btns"><button id="cfgB">Lưu</button></div>
 <p class="note">Lưu vào flash, khởi động lại vẫn giữ. Đề gợi ý tối đa 10–30 s cho máy bơm mô hình; mặc định 15 s chạy, 10 s nghỉ.</p>
</section>

<section class="card"><h2>Khi nào chuyển trạng thái?</h2>
 <ol class="rules note">
  <li><b>DỪNG → CHẠY</b>: bấm Chạy, và cả 3 điều kiện: hết thời gian nghỉ, cảm biến đọc tốt, duty hợp lệ. Thiếu điều kiện nào thì giữ DỪNG và báo lý do.</li>
  <li><b>CHẠY → DỪNG</b>: bấm Dừng (không phải nghỉ), hoặc <b>tự động khi hết giờ</b> (sau đó phải nghỉ hết cooldown).</li>
  <li><b>DỪNG/CHẠY → LỖI</b>: cảm biến báo lỗi (E1 mất I2C, E2 DHT11 trả NaN, E3 ngoài dải), ở bất kỳ trạng thái nào. Đang CHẠY mà nhận lệnh sai định dạng cũng vào LỖI (lúc DỪNG thì chỉ bỏ qua lệnh). Tải tắt ngay; nếu đang chạy thì bắt đầu tính nghỉ.</li>
  <li><b>LỖI → DỪNG</b>: <b>tự động</b> khi đã hết lỗi và ở LỖI ít nhất <span id="hold">3</span> s. Không tự chạy lại, phải bấm Chạy.</li>
  <li>LỖI và hết giờ có ưu tiên cao nhất: lệnh Chạy gửi lúc đang LỖI/đang nghỉ bị từ chối; gửi Chạy lúc đang CHẠY cũng không gia hạn thời gian.</li>
 </ol>
</section>

<section class="card"><h2>Ba ca thử</h2>
 <table><tr><th>Ca</th><th>Cách tạo</th><th>Kỳ vọng</th><th></th></tr>
  <tr><td>1</td><td>Đang DỪNG, hết nghỉ → bấm <b>▶ Chạy</b></td><td>→ CHẠY</td><td><button data-ca="1">📌</button></td></tr>
  <tr><td>2</td><td>Để CHẠY, không bấm Dừng, chờ quá thời gian tối đa</td><td>tự → DỪNG</td><td><button data-ca="2">📌</button></td></tr>
  <tr><td>3</td><td>Đang CHẠY: rút dây DATA DHT11 (Uno D8), hoặc dùng nút bên dưới</td><td>LỖI → DỪNG</td><td><button data-ca="3">📌</button></td></tr>
 </table>
 <div class="btns" style="margin-top:10px"><button id="flt">⚠ Giả lập lỗi cảm biến</button><button id="badB">✖ Gửi lệnh sai (duty=abc)</button></div>
 <div class="row"><input id="raw" placeholder="Lệnh thô, vd: cmd=start · duty=150 · cmd=chay" style="flex:1;min-width:0"><button id="rawB">Gửi</button></div>
 <p class="note">Lệnh hợp lệ: <code>cmd=start</code>, <code>cmd=stop</code>, <code>duty=1..100</code>, <code>lim=3..300</code>, <code>cd=0..600</code>. Lỗi cảm biến giả lập chỉ hiện sau lần đọc kế tiếp (≤ 2 s). Nút 📌 ghi trạng thái hiện tại vào bảng kết quả.</p>
</section>

<section class="card"><h2>Ngắt ngoài &amp; chống dội</h2>
 <div class="kv">
  <span>Lần gọi ISR (2 cạnh)</span><b id="calls">0</b>
  <span>Cạnh xuống – chưa chống dội</span><b id="fall">0</b>
  <span>Lần bấm – đã chống dội</span><b id="cnt">0</b>
  <span>Lần bấm giả lập đã tạo</span><b id="simd">0</b>
 </div>
 <div class="row"><span>Chống dội (ms, 0 = tắt)</span><span><input type="number" id="deb" min="0" max="500"> <button id="debB">Áp dụng</button></span></div>
 <div class="btns"><button class="pri" id="sim10">👆 Giả lập bấm 10 lần</button><button id="sim1">1 lần</button><button id="busy">⏳ CPU bận 5 s + bấm 5 lần</button><button id="rstB">↺ Đặt lại</button></div>
 <p class="note" id="bmsg"></p>
 <div class="row"><span class="note">Số lần bấm thật (nếu bấm tay)</span><span><input type="number" id="real" value="10" min="0"> <button id="btnRec">📌 Ghi</button></span></div>
 <p class="note">Nút thật: nối GPIO<span id="bpin">4</span> với GND (dùng INPUT_PULLUP). Không có nút thì bấm “Giả lập”: ESP32 tự kéo chân xuống/thả ra 3–8 lần mỗi lần bấm (dội 50–400 µs) qua chế độ open-drain, nên cắm nút thật song song vẫn an toàn. So sánh: đặt chống dội 0 → giả lập 10 lần → 📌; đặt 50 ms → đặt lại → giả lập 10 lần → 📌.</p>
</section>

<section class="card"><h2>Timer phần cứng vs millis()</h2>
 <div class="row"><span>Chu kỳ đặt (10–2000 ms)</span><span><input type="number" id="tms" min="10" max="2000"> <button id="tmsB">Áp dụng</button></span></div>
 <table><tr><th></th><th>Số lần</th><th>TB (ms)</th><th>Min</th><th>Max</th><th>Lệch max</th></tr>
  <tr><td>Timer phần cứng</td><td id="hn"></td><td id="ha"></td><td id="hmi"></td><td id="hma"></td><td id="hj"></td></tr>
  <tr><td>millis() trong loop</td><td id="ln"></td><td id="la"></td><td id="lmi"></td><td id="lma"></td><td id="lj"></td></tr>
 </table>
 <div class="btns" style="margin-top:8px"><button id="tRst">↺ Đặt lại</button><button id="tmrRec">📌 Ghi</button></div>
 <p class="note">Đo bằng micros() tại mỗi lần ngắt timer / mỗi lần loop bắt được mốc millis(). Bấm “CPU bận 5 s” ở thẻ bên rồi xem cột Max của millis() tăng vọt còn timer phần cứng vẫn đều.</p>
</section>

<section class="card wide"><h2>Đồ thị thời gian thực: khoảng cách giữa 2 lần ngắt</h2>
 <div class="row" style="justify-content:flex-start;gap:14px">
  <label class="note">Cửa sổ <select id="twin"><option value="10">10 s</option><option value="30" selected>30 s</option><option value="60">60 s</option><option value="120">120 s</option></select></label>
  <label class="note">Trục dọc <select id="tsc"><option value="auto">Tự động (thấy cả gai lớn)</option><option value="zoom">Phóng to quanh chu kỳ ±25%</option></select></label>
  <button id="tPause">⏸ Tạm dừng</button><button id="tPng">⬇ Tải chart.png</button>
 </div>
 <canvas id="tc"></canvas>
 <div class="leg"><span><i style="background:#1c7ed6"></i>Timer phần cứng <b id="lgH"></b></span><span><i style="background:#f08c00"></i>millis() trong loop <b id="lgL"></b></span><span><i style="border-top:2px dashed var(--mute);height:0"></i>chu kỳ đặt</span></div>
 <p class="note">Mỗi điểm là 1 khoảng đo được, cập nhật mỗi 0,5 s. Nằm trên vạch đứt = đúng chu kỳ. Thử: bấm “⏳ CPU bận 5 s” rồi xem đường cam vọt lên còn đường xanh vẫn phẳng; gai nhỏ trên đường xanh thường trùng lúc ghi flash (trang /data đang ghi). Ở chế độ phóng to, điểm vượt khung hiện thành ▲/▼ ở mép.</p>
</section>

<section class="card wide"><h2>Bảng kết quả (lưu trên trình duyệt này)</h2>
 <table id="res"><tr><th>Giờ</th><th>Mục</th><th>Kết quả</th></tr></table>
 <div class="btns" style="margin-top:8px"><button id="resCp">📋 Sao chép (Markdown cho README)</button><button id="resClr">🗑 Xoá bảng</button></div>
</section>

<section class="card wide"><h2>Nhật ký (log Serial cùng nội dung)</h2>
 <label class="note"><input type="checkbox" id="only" checked> Chỉ dòng của Bài 3</label>
 <div id="ev" style="margin-top:6px">(trống)</div>
 <div class="btns" style="margin-top:8px"><button id="evCp">📋 Sao chép làm serial_log.txt</button></div>
</section>
</main>
<div id="toast"></div>
<script>
const $=id=>document.getElementById(id);
let S=null,evSize=-1,evTxt="",busy=0;
const NAME=["DỪNG","CHẠY","LỖI"],ERR={1:"E1 mất I2C với Uno",2:"E2 DHT11 lỗi",3:"E3 ngoài dải đo"};
async function get(url,text){const ac=new AbortController(),to=setTimeout(()=>ac.abort(),7000);
 try{const r=await fetch(url,{cache:"no-store",signal:ac.signal});return text?r.text():r.json()}finally{clearTimeout(to)}}
function toast(m){const t=$("toast");t.textContent=m;t.style.display="block";clearTimeout(t._h);t._h=setTimeout(()=>t.style.display="none",1800)}
function copy(txt){const ok=()=>toast("Đã sao chép");
 if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(txt).then(ok);
 else{const ta=document.createElement("textarea");ta.value=txt;document.body.append(ta);ta.select();document.execCommand("copy");ta.remove();ok()}}
async function send(path,q){busy=1;try{render(await get(path+"?"+(typeof q=="string"?q:new URLSearchParams(q))))}catch(e){toast("Không gửi được")}finally{busy=0}}
const ctrl=q=>send("/api/ctrl",q),lab=q=>send("/api/lab",q);

// ----- Bảng kết quả -----
let rows=[];try{rows=JSON.parse(localStorage.getItem("b3rows")||"[]")}catch(e){}
function rec(kind,text){rows.push([new Date().toLocaleTimeString("vi-VN"),kind,text]);try{localStorage.setItem("b3rows",JSON.stringify(rows))}catch(e){}showRows();toast("Đã ghi vào bảng")}
function showRows(){const t=$("res");while(t.rows.length>1)t.deleteRow(1);
 rows.forEach(r=>{const tr=t.insertRow();r.forEach(c=>tr.insertCell().textContent=c)})}
$("resCp").onclick=()=>copy("| Giờ | Mục | Kết quả |\n|---|---|---|\n"+rows.map(r=>"| "+r.join(" | ")+" |").join("\n"));
$("resClr").onclick=()=>{if(confirm("Xoá bảng kết quả?")){rows=[];try{localStorage.removeItem("b3rows")}catch(e){}showRows()}};

// ----- Điều khiển -----
$("start").onclick=()=>ctrl({cmd:"start"});
$("stop").onclick=()=>ctrl({cmd:"stop"});
$("dutyB").onclick=()=>ctrl({duty:$("duty").value.trim()});
$("duty").onkeydown=e=>{if(e.key=="Enter")$("dutyB").click()};
[25,50,75,100].forEach(v=>{const b=document.createElement("button");b.textContent=v+"%";b.dataset.v=v;b.onclick=()=>{$("duty").value=v;ctrl({duty:v})};$("pre").append(b)});
[[50,"50"],[100,"100 (mặc định)"],[200,"200"],[500,"500"],[1000,"1000"],[5000,"5000"],[20000,"20000 (không nghe tiếng)"],[0,"Khác…"]].forEach(([v,t])=>$("hz").add(new Option(t,v)));
$("hz").onchange=e=>{if(+e.target.value)ctrl({hz:e.target.value});else{$("hzIn").style.display="";$("hzIn").focus()}};
$("hzIn").onchange=e=>{ctrl({hz:e.target.value.trim()});e.target.style.display="none"};
$("kickB").onclick=()=>ctrl({kick:$("kick").value.trim()});
$("cfgB").onclick=()=>ctrl({lim:$("lim").value.trim(),cd:$("cd").value.trim()});
$("pwmRec").onclick=()=>rec("PWM","duty "+S.fsm.duty+"% @ "+S.fsm.hz+" Hz, mồi "+S.fsm.kick+" ms, đang xuất "+S.fsm.out+"% · "+($("obs").value||"(chưa ghi quan sát)"));
$("flt").onclick=()=>send("/api/sim",{fault:S.log.fault?0:1});
$("badB").onclick=()=>ctrl("duty=abc");
$("rawB").onclick=()=>{const v=$("raw").value.trim();if(v)ctrl(v.replace(/^\?/,""))};
$("raw").onkeydown=e=>{if(e.key=="Enter")$("rawB").click()};
document.querySelectorAll("[data-ca]").forEach(b=>b.onclick=()=>{const F=S.fsm;
 rec("Ca "+b.dataset.ca,"Trạng thái "+NAME[F.st]+(F.cool>0?" (nghỉ còn "+Math.ceil(F.cool/1000)+" s)":"")+" · "+F.msg)});

// ----- Ngắt ngoài, timer -----
$("debB").onclick=()=>lab({deb:$("deb").value});
$("sim10").onclick=()=>lab({sim:10});
$("sim1").onclick=()=>lab({sim:1});
$("busy").onclick=()=>{lab({sim:5,busy:1});toast("ESP32 bận 5 s, trang sẽ đứng một lúc")};
$("rstB").onclick=()=>lab({reset:"btn"});
$("btnRec").onclick=()=>{const B=S.btn,real=B.sim||+$("real").value;
 rec("Ngắt ngoài","chống dội "+(B.deb?B.deb+" ms":"TẮT")+": "+real+" lần bấm thật → ISR gọi "+B.calls+", cạnh xuống "+B.fall+", đếm được "+B.cnt+(B.cnt==real?" (đúng)":" (sai lệch "+(B.cnt-real)+")"))};
$("tmsB").onclick=()=>{TH=[];TL=[];lab({tms:$("tms").value})};
$("tRst").onclick=()=>{TH=[];TL=[];lab({reset:"tmr"})};
const ms=us=>(us/1000).toFixed(3);
$("tmrRec").onclick=()=>{const T=S.tmr;
 rec("Timer","đặt "+T.ms+" ms · phần cứng TB "+ms(T.avg)+" (min "+ms(T.min)+", max "+ms(T.max)+") · millis() TB "+ms(T.lavg)+" (min "+ms(T.lmin)+", max "+ms(T.lmax)+") ms")};

// ----- Nhật ký -----
async function loadEvents(){try{evTxt=await get("/api/events",1);showEvents()}catch(e){}}
function showEvents(){const box=$("ev"),only=$("only").checked;box.innerHTML="";
 const ls=evTxt.trim().split("\n").filter(l=>l&&(!only||l.includes(",B3 ")||/,B,/.test(l))).slice(-80);
 if(!ls.length){box.textContent="(trống)";return}
 ls.forEach(l=>{const p=l.split(","),d=document.createElement("div");d.className=p[2];
  d.textContent="["+p[2]+"] boot#"+p[0]+" +"+(p[1]/1000).toFixed(3)+"s "+p.slice(3).join(",");box.append(d)});
 box.scrollTop=box.scrollHeight}
$("only").onchange=showEvents;
$("evCp").onclick=()=>copy([...$("ev").children].map(d=>d.textContent).join("\n"));

// ----- Hiển thị -----
function setIn(id,v){if(document.activeElement!==$(id))$(id).value=v}
function render(s){S=s;const F=s.fsm,B=s.btn,T=s.tmr;
 [0,1,2].forEach(i=>$("b"+i).classList.toggle("act",F.st==i));
 const bar=$("bar");
 if(F.st==1){bar.className="bar";$("barI").style.width=Math.min(100,F.el/(F.lim*10))+"%";
  $("runTxt").textContent="Đang chạy "+(F.el/1000).toFixed(1)+" / "+F.lim+" s · còn "+Math.max(0,Math.ceil((F.lim*1000-F.el)/1000))+" s"}
 else if(F.cool>0){bar.className="bar cool";$("barI").style.width=Math.min(100,F.cool/(F.cd*10))+"%";
  $("runTxt").textContent="Đang nghỉ (cooldown) · còn "+Math.ceil(F.cool/1000)+" s mới cho chạy lại"}
 else{bar.className="bar";$("barI").style.width="0";$("runTxt").textContent=F.st==2?"LỖI: tải đã tắt, chờ hết lỗi":"Sẵn sàng · tối đa "+F.lim+" s/lần"}
 $("coolTxt").textContent="nghỉ "+F.cd+" s sau hết giờ/lỗi";
 $("sens").textContent="Cảm biến: "+(s.code?ERR[s.code]:(s.t==null?"chưa có dữ liệu":s.t+" °C · "+s.h+" %"))+(s.log.fault?" · đang giả lập lỗi":"");
 $("sens").style.color=s.code?"var(--bad)":"";
 $("msg").textContent=F.msg;
 $("out").textContent=F.out>0?F.out+"%":"0% (tắt)";
 setIn("duty",F.duty);setIn("lim",F.lim);setIn("cd",F.cd);setIn("deb",B.deb);setIn("tms",T.ms);
 [...$("pre").children].forEach(b=>b.classList.toggle("on",+b.dataset.v==F.duty));
 setIn("kick",F.kick);
 if(document.activeElement!==$("hz")&&$("hzIn").style.display=="none")$("hz").value=[...$("hz").options].some(o=>+o.value==F.hz)?F.hz:0;
 $("pwmNote").textContent="PWM "+F.hz+" Hz, 10 bit, xuất trên GPIO17 (kích mức thấp nên phần cứng nhận duty đảo). Đổi duty lúc đang chạy có hiệu lực ngay; duty sai lúc đang chạy → LỖI.";
 $("hold").textContent=F.hold/1000;
 $("flt").textContent=s.log.fault?"✓ Tắt giả lập lỗi cảm biến":"⚠ Giả lập lỗi cảm biến";
 $("calls").textContent=B.calls;$("fall").textContent=B.fall;$("cnt").textContent=B.cnt;
 $("simd").textContent=B.sim+(B.simLeft?" (đang tạo, còn "+B.simLeft+")":"");$("bpin").textContent=B.pin;
 $("bmsg").textContent=B.busy?"⏳ CPU đang bận…":B.bmsg;
 $("hn").textContent=T.n;$("ha").textContent=ms(T.avg);$("hmi").textContent=ms(T.min);$("hma").textContent=ms(T.max);
 $("hj").textContent=T.n?ms(Math.max(T.max-T.ms*1000,T.ms*1000-T.min)):"";
 $("ln").textContent=T.ln;$("la").textContent=ms(T.lavg);$("lmi").textContent=ms(T.lmin);$("lma").textContent=ms(T.lmax);
 $("lj").textContent=T.ln?ms(Math.max(T.lmax-T.ms*1000,T.ms*1000-T.lmin)):"";
 $("st").textContent="Đã kết nối · "+s.ip+" · trạng thái "+NAME[F.st];
 if(s.log.ev!=evSize){evSize=s.log.ev;loadEvents()}
}
async function poll(){if(busy)return;try{render(await get("/api/state"))}catch(e){$("st").textContent="Mất kết nối…"}}
// ----- Đồ thị thời gian thực -----
let TH=[],TL=[],hs=null,ls=null,tNow=0,tAt=0,tPer=100,tPaused=false,tBusy=false;
async function pollTmr(){if(tPaused||tBusy)return;tBusy=true;
 try{const r=await get("/api/tmr"+(hs==null?"":"?hs="+hs+"&ls="+ls));
  if(hs!=null&&(r.hs<hs||r.ls<ls)){TH=[];TL=[]}   // ESP32 vừa khởi động lại
  TH.push(...r.h);TL.push(...r.l);hs=r.hs;ls=r.ls;tNow=r.now;tAt=performance.now();tPer=r.ms;
  const cut=tNow-125000;while(TH.length&&TH[0][0]<cut)TH.shift();while(TL.length&&TL[0][0]<cut)TL.shift();
 }catch(e){}finally{tBusy=false}}
function draw(){const cv=$("tc"),dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;
 if(cv.width!=Math.round(W*dpr)||cv.height!=Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
 const c=cv.getContext("2d"),cs=getComputedStyle(document.documentElement),col=n=>cs.getPropertyValue(n).trim();
 c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle=col("--card");c.fillRect(0,0,W,H);
 const win=$("twin").value*1000,now=tPaused?tNow:tNow+Math.min(1000,performance.now()-tAt),t0=now-win;
 const h=TH.filter(p=>p[0]>=t0),l=TL.filter(p=>p[0]>=t0),per=tPer;
 let lo,hi;
 if($("tsc").value=="zoom"){lo=per*.75;hi=per*1.25}
 else{lo=hi=per;for(const p of h.concat(l)){const v=p[1]/1000;if(v<lo)lo=v;if(v>hi)hi=v}
  const pad=Math.max((hi-lo)*.1,per*.02);lo=Math.max(0,lo-pad);hi+=pad}
 const L=62,R=12,T=12,B=26,pw=W-L-R,ph=H-T-B,X=t=>L+(t-t0)/win*pw,Y=v=>T+(hi-v)/(hi-lo)*ph;
 c.font="11px system-ui,sans-serif";c.lineWidth=1;
 const span=hi-lo,dec=span<1?3:span<10?2:span<100?1:0;
 for(let i=0;i<=5;i++){const v=lo+span*i/5,y=Y(v);c.strokeStyle=col("--line");c.beginPath();c.moveTo(L,y);c.lineTo(W-R,y);c.stroke();
  c.fillStyle=col("--mute");c.textAlign="right";c.fillText(v.toFixed(dec)+" ms",L-6,y+4)}
 for(let i=0;i<=6;i++){const t=t0+win*i/6,x=X(t);c.fillStyle=col("--mute");c.textAlign="center";c.fillText(i==6?"bây giờ":"-"+((now-t)/1000).toFixed(0)+" s",x,H-8)}
 c.strokeStyle=col("--mute");c.setLineDash([6,4]);c.beginPath();c.moveTo(L,Y(per));c.lineTo(W-R,Y(per));c.stroke();c.setLineDash([]);
 c.save();c.beginPath();c.rect(L,T,pw,ph);c.clip();
 for(const [pts,color] of [[l,"#f08c00"],[h,"#1c7ed6"]]){
  c.strokeStyle=c.fillStyle=color;c.lineWidth=1.6;c.beginPath();
  pts.forEach((p,i)=>{const x=X(p[0]),y=Math.min(T+ph,Math.max(T,Y(p[1]/1000)));i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();
  if(pts.length<150)pts.forEach(p=>{c.beginPath();c.arc(X(p[0]),Math.min(T+ph,Math.max(T,Y(p[1]/1000))),2.2,0,7);c.fill()});
  pts.forEach(p=>{const v=p[1]/1000;if(v>hi||v<lo){const x=X(p[0]),up=v>hi;c.beginPath();c.moveTo(x,up?T:T+ph);c.lineTo(x-5,up?T+9:T+ph-9);c.lineTo(x+5,up?T+9:T+ph-9);c.fill();
   c.textAlign="left";c.fillText(v.toFixed(1),x+7,up?T+10:T+ph-3)}})}
 c.restore();
 const st=a=>{if(!a.length)return"(chưa có)";let s=0,m=0;a.forEach(p=>{const v=p[1]/1000;s+=v;m=Math.max(m,Math.abs(v-per))});return a.length+" điểm · TB "+(s/a.length).toFixed(3)+" ms · lệch max "+m.toFixed(3)+" ms"};
 $("lgH").textContent=st(h);$("lgL").textContent=st(l);
 requestAnimationFrame(draw)}
$("tPause").onclick=()=>{tPaused=!tPaused;$("tPause").textContent=tPaused?"▶ Tiếp tục":"⏸ Tạm dừng";if(!tPaused)pollTmr()};
$("tPng").onclick=()=>$("tc").toBlob(b=>{const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="chart.png";document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)});

showRows();poll();setInterval(poll,500);pollTmr();setInterval(pollTmr,500);requestAnimationFrame(draw);
</script></body></html>)HTML";
