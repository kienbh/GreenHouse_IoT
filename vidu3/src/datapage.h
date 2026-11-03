#pragma once
// Trang /data: đo & ghi dữ liệu cảm biến, biểu đồ, bộ lọc, xuất CSV/PNG, demo sự cố
// Vẽ biểu đồ bằng canvas thuần (AP không có Internet nên không dùng thư viện CDN)
const char DATA_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dữ liệu cảm biến</title>
<style>
:root{--bg:#f2f5f1;--card:#fff;--fg:#1d2b22;--mute:#6b7a70;--acc:#2e8b57;--line:#dde5df;--bad:#e03131;--warn:#f08c00}
@media(prefers-color-scheme:dark){:root{--bg:#121714;--card:#1b231e;--fg:#e4ece6;--mute:#93a399;--acc:#4cc27f;--line:#2b362f;--bad:#ff6b6b;--warn:#fcc419}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:16px 16px 4px;max-width:1100px}h1{margin:0;font-size:21px}
header a{color:var(--acc);text-decoration:none;font-size:14px}
#st{margin:4px 0 0;color:var(--mute);font-size:13px}#st.warn{color:var(--bad);font-weight:600}
#note{display:none;margin:8px 16px 0;max-width:1068px;padding:10px 12px;border-radius:10px;background:var(--card);border:1px solid var(--warn)}
main{display:grid;gap:12px;padding:12px 16px 28px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));max-width:1100px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;min-width:0}
.wide{grid-column:1/-1}
.card h2{margin:0 0 10px;font-size:15px;color:var(--mute);font-weight:600}
.big{display:flex;gap:24px}.big b{font-size:32px}.big small{color:var(--mute);display:block}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0;flex-wrap:wrap}
.ctl{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:end;margin-bottom:10px}
.ctl label{display:flex;flex-direction:column;font-size:12px;color:var(--mute);gap:3px}
button{border:1px solid var(--line);background:transparent;color:var(--fg);padding:9px 14px;border-radius:10px;font:inherit;cursor:pointer}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
button.on{background:var(--bad);border-color:var(--bad);color:#fff}
select,input{padding:7px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit}
input[type=number]{width:84px}
.btns{display:flex;flex-wrap:wrap;gap:8px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:13px;font-weight:600;color:#fff;background:var(--acc)}
.badge.err{background:var(--bad)}
.note{color:var(--mute);font-size:12.5px}
canvas{width:100%;height:520px;display:block;border-radius:10px}
@media(max-width:600px){canvas{height:440px}}
.leg{font-size:12.5px;color:var(--mute);margin-top:6px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:12px;overflow:auto;max-height:140px;margin:8px 0 0}
#ev{font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)}
#ev .ln{cursor:pointer;white-space:pre-wrap;word-break:break-word;padding:1px 0}
#ev .E{color:var(--bad)}#ev .W{color:var(--warn)}#ev .B{color:var(--acc);font-weight:600}
ol{padding-left:20px;margin:8px 0}li{margin:4px 0}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#222;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;display:none}
</style></head><body>
<header><a href="/">← Bảng điều khiển</a>
<h1>📈 Đo &amp; ghi dữ liệu cảm biến</h1><p id="st">Đang kết nối…</p></header>
<div id="note"></div>
<main>
<section class="card"><h2>Phiên đo</h2>
 <div class="big"><div><small>Nhiệt độ</small><b id="t">--</b> °C</div><div><small>Độ ẩm</small><b id="h">--</b> %</div></div>
 <p style="margin:8px 0"><span class="badge" id="sens">--</span></p>
 <div class="row"><span>Chu kỳ lấy mẫu (giây)</span><span><input type="number" id="iv" min="1" max="3600" step="1"> <button id="ivb">Áp dụng</button></span></div>
 <div class="row"><button class="pri" id="run">▶ Bắt đầu ghi</button><span id="cnt" class="note"></span></div>
 <p class="note" id="stat"></p>
 <p class="note">DHT11 chỉ cập nhật khoảng 2 s/lần, chu kỳ &lt; 2 s sẽ lặp lại giá trị cũ. Dữ liệu lưu trong flash của ESP32 nên mất điện vẫn còn.</p>
 <button id="clr">🗑 Xoá dữ liệu</button>
</section>

<section class="card"><h2>Xuất dữ liệu</h2>
 <div class="ctl">
  <label>Đại lượng<select id="cq"><option value="t">Nhiệt độ</option><option value="h">Độ ẩm</option><option value="both">Cả hai</option></select></label>
  <label>Nội dung<select id="ck"><option value="goc">Gốc: thô + chuyển đổi (không lọc)</option><option value="loc">Đã lọc (converted = giá trị lọc)</option><option value="full">Đầy đủ: thô, không lọc, đã lọc, mã lỗi</option></select></label>
 </div>
 <div class="btns"><button class="pri" id="csv">⬇ Tải data.csv</button><button id="png">⬇ Tải chart.png</button></div>
 <pre id="pv">(chưa có dữ liệu)</pre>
 <p class="note">Bộ lọc dùng khi xuất là bộ lọc đang chọn ở biểu đồ. Ảnh chart.png giống biểu đồ đang hiển thị.</p>
</section>

<section class="card wide"><h2>Biểu đồ</h2>
 <div class="ctl">
  <label>Hiển thị<select id="mode"><option value="both">So sánh trước / sau lọc</option><option value="conv">Không lọc (°C, %)</option><option value="filt">Đã lọc</option><option value="raw">Dữ liệu thô (×10 từ Uno)</option></select></label>
  <label>Bộ lọc<select id="fk"><option value="median">Trung vị (median)</option><option value="ma">Trung bình trượt</option><option value="ema">EMA (hàm mũ)</option><option value="none">Không lọc</option></select></label>
  <label id="fpl">Cửa sổ N<input type="number" id="fp" value="5" min="2" max="51" step="1"></label>
  <label>Khoảng thời gian<select id="win"><option value="0">Tất cả</option><option value="5">5 phút gần nhất</option><option value="15">15 phút</option><option value="60">60 phút</option></select></label>
 </div>
 <canvas id="cv"></canvas>
 <p class="leg">Nét mờ = trước lọc, nét đậm = sau lọc · <span style="color:var(--bad)">▲</span> mẫu lỗi (valid = 0) · <span style="color:var(--warn)">◯</span> gai nhiễu giả lập · vùng đỏ nhạt + vạch ⚡ = mất điện rồi khởi động lại</p>
</section>

<section class="card"><h2>Demo sự cố</h2>
 <div class="btns">
  <button id="flt">⚠ Giả lập lỗi cảm biến</button>
  <button id="spk">〽 Chèn gai nhiễu +8 °C</button>
  <button id="rbt">⚡ Mô phỏng mất điện</button>
 </div>
 <ol class="note">
  <li>Đặt chu kỳ 2 s, bấm <b>Bắt đầu ghi</b>, chờ khoảng 1 phút.</li>
  <li><b>Lỗi cảm biến thật:</b> rút dây DATA của DHT11 (D8 của Uno). Mẫu bị ghi <i>valid = 0</i>, nhật ký báo E2. Cắm lại thì nhật ký báo “phục hồi sau N mẫu lỗi”.</li>
  <li><b>Mất liên lạc Uno:</b> rút dây SDA/SCL. Nhật ký báo E1.</li>
  <li><b>Mất điện thật:</b> rút nguồn ESP32 khoảng 20 s rồi cắm lại. ESP32 ghi “Khởi động: Cấp điện (power-on)” và <b>tự ghi tiếp</b>, dữ liệu cũ vẫn còn. Trên biểu đồ có vạch ⚡ và vùng đỏ là khoảng mất điện. Điện thoại phải kết nối lại WiFi NhaKinh-ESP32 thì trang mới cập nhật.</li>
  <li><b>Bộ lọc:</b> chèn gai nhiễu, chọn “So sánh trước/sau lọc”, rồi đổi giữa Trung vị và Trung bình trượt để so sánh.</li>
 </ol>
 <p class="note">Nút “Mô phỏng mất điện” chỉ reset mềm ESP32 (nhật ký ghi “Reset mềm”). Muốn có log “Cấp điện” thật thì làm như bước 4.</p>
</section>

<section class="card"><h2>Nhật ký sự kiện</h2>
 <div id="ev"><span class="note">(trống)</span></div>
 <div class="btns" style="margin-top:8px"><button id="cpy">📋 Sao chép toàn bộ</button></div>
 <p class="note">Bấm vào 1 dòng để sao chép (dùng cho mục 4.2). Giờ lấy từ điện thoại/máy tính lúc kết nối; dòng ghi dạng boot#N +giây là lúc ESP32 chưa biết giờ.</p>
</section>
</main>
<div id="toast"></div>
<script>
const $=id=>document.getElementById(id);
let S=null,rows=[],bases={},events=[],reasons={},evSize=-1,lastBoot=null,loading=false;
const LV={B:"BOOT",E:"ERR",W:"WARN",I:"INFO"};
const ERR={1:"E1 Mất liên lạc I2C với Uno",2:"E2 DHT11 đọc lỗi",3:"E3 Ngoài dải đo"};
const pad=(n,w=2)=>String(n).padStart(w,"0");
function fmtTime(ms){const d=new Date(ms);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+hms(ms)+"."+pad(d.getMilliseconds(),3)}
function hms(ms){const d=new Date(ms);return pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds())}
async function get(url,text){const ac=new AbortController(),to=setTimeout(()=>ac.abort(),4000);
 try{const r=await fetch(url,{cache:"no-store",signal:ac.signal});return text?r.text():r.json()}finally{clearTimeout(to)}}
function toast(m){const t=$("toast");t.textContent=m;t.style.display="block";clearTimeout(t._h);t._h=setTimeout(()=>t.style.display="none",1800)}
function note(m){const n=$("note");n.textContent=m;n.style.display="block"}
function save(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)}
function copy(txt){const ok=()=>toast("Đã sao chép");
 if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(txt).then(ok);
 else{const ta=document.createElement("textarea");ta.value=txt;document.body.append(ta);ta.select();document.execCommand("copy");ta.remove();ok()}}

// ===== Dữ liệu =====
async function loadLog(){if(loading)return;loading=true;
 try{if(S.log.n<rows.length){rows=[];bases={}}
  while(rows.length<S.log.n){const r=await get(`/api/log?from=${rows.length}&n=400`);
   for(const k in r.bases)if(r.bases[k]>0)bases[k]=r.bases[k];
   if(!r.rows.length)break;
   r.rows.forEach(a=>rows.push({boot:a[0],ms:a[1],t:a[2],h:a[3],f:a[4]}))}
 }catch(e){}finally{loading=false}
 prep();drawScreen();showStats();preview()}
// Quy đổi (lần khởi động, ms) sang giờ thật; nếu chưa biết giờ thì ước lượng nối tiếp
function prep(){let p=null;
 for(const r of rows){const b=bases[r.boot];
  if(b>0){r.ts=b+r.ms;r.ap=0}
  else{r.ts=p?(p.boot==r.boot?p.ts+(r.ms-p.ms):p.ts+1000):r.ms;r.ap=1}
  if(p&&r.ts<=p.ts){r.ts=p.ts+1;r.ap=1}
  r.ok=r.f&1;r.code=(r.f>>1)&3;r.sim=!!(r.f&16);r.spk=!!(r.f&32);p=r}}
// Bộ lọc chạy trên các mẫu hợp lệ, bỏ qua mẫu lỗi, khởi động lại cửa sổ sau mỗi lần mất điện
function filt(vals){const k=$("fk").value,p=+$("fp").value||1,out=[];let win=[],e=null,boot=null;
 vals.forEach((v,i)=>{if(rows[i].boot!==boot){boot=rows[i].boot;win=[];e=null}
  if(v==null||k=="none"){out.push(v);return}
  if(k=="ema"){e=e==null?v:p*v+(1-p)*e;out.push(e);return}
  win.push(v);if(win.length>p)win.shift();
  if(k=="ma")out.push(win.reduce((a,b)=>a+b,0)/win.length);
  else{const s=[...win].sort((a,b)=>a-b),m=s.length>>1;out.push(s.length%2?s[m]:(s[m-1]+s[m])/2)}});
 return out}
function fname(){const k=$("fk").value,p=$("fp").value;return k=="none"?"none":k=="ema"?"ema"+p:k+p}
function fdesc(){const k=$("fk").value,p=$("fp").value;return{none:"không lọc",median:"trung vị N="+p,ma:"trung bình trượt N="+p,ema:"EMA α="+p}[k]}
const conv=q=>rows.map(r=>r.ok?r[q]/10:null);
function view(){const b=rows.length-1,w=+$("win").value;let a=0;
 if(w){const lim=rows[b].ts-w*60000;a=b;while(a>0&&rows[a-1].ts>=lim)a--}return{a,b}}

// ===== Biểu đồ =====
function pal(light){const cs=getComputedStyle(document.documentElement),g=k=>cs.getPropertyValue(k).trim();
 if(light||!matchMedia("(prefers-color-scheme: dark)").matches)
  return{bg:"#ffffff",fg:"#1d2b22",mute:"#6b7a70",grid:"#e6ece8",t:"#d9480f",h:"#1971c2",bad:"#e03131",off:"rgba(224,49,49,.10)",spk:"#f08c00"};
 return{bg:g("--card"),fg:g("--fg"),mute:g("--mute"),grid:"#2b362f",t:"#ff8a4c",h:"#4dabf7",bad:"#ff6b6b",off:"rgba(255,107,107,.15)",spk:"#fcc419"}}
function panel(c,x,y,w,h,q,P,v,x0,x1,top){
 const mode=$("mode").value,hue=q=="t"?P.t:P.h,{a,b}=v;
 const raw=rows.map(r=>r[q]==32767?null:r[q]),cv=conv(q),f=filt(cv);
 const ser=mode=="raw"?[{d:raw,lw:1.6}]:mode=="conv"?[{d:cv,lw:1.6}]:mode=="filt"?[{d:f,lw:2.2}]:[{d:cv,lw:1.2,al:.35},{d:f,lw:2.4}];
 let lo=1e9,hi=-1e9;ser.forEach(s=>{for(let i=a;i<=b;i++){const z=s.d[i];if(z!=null){lo=Math.min(lo,z);hi=Math.max(hi,z)}}});
 const mn=mode=="raw"?10:1;if(lo>hi){lo=0;hi=mn}if(hi-lo<mn){const m=(hi+lo)/2;lo=m-mn/2;hi=m+mn/2}
 const pd=(hi-lo)*.1;lo-=pd;hi+=pd;
 const L=x+50,R=x+w-12,T=y+24,B=y+h-24,X=t=>L+(t-x0)/(x1-x0)*(R-L),Y=z=>B-(z-lo)/(hi-lo)*(B-T);
 c.fillStyle=P.fg;c.font="600 13px system-ui";c.textAlign="left";
 c.fillText((q=="t"?"Nhiệt độ":"Độ ẩm")+" ("+(mode=="raw"?"thô ×10":q=="t"?"°C":"%")+")",L,y+15);
 c.lineWidth=1;c.font="11px system-ui";
 for(let k=0;k<=4;k++){const z=lo+(hi-lo)*k/4,yy=Y(z);c.strokeStyle=P.grid;c.beginPath();c.moveTo(L,yy);c.lineTo(R,yy);c.stroke();
  c.fillStyle=P.mute;c.textAlign="right";c.fillText(z.toFixed(mode=="raw"?0:1),L-6,yy+4)}
 for(let k=0;k<=4;k++){const t=x0+(x1-x0)*k/4;c.textAlign=k?k<4?"center":"right":"left";c.fillText(hms(t),X(t),B+16)}
 for(let i=Math.max(a,1);i<=b;i++)if(rows[i].boot!=rows[i-1].boot){
  const xa=Math.max(L,X(rows[i-1].ts)),xb=X(rows[i].ts);
  c.fillStyle=P.off;c.fillRect(xa,T,Math.max(3,xb-xa),B-T);
  c.strokeStyle=P.bad;c.setLineDash([4,3]);c.beginPath();c.moveTo(xb,T);c.lineTo(xb,B);c.stroke();c.setLineDash([]);
  if(top){c.fillStyle=P.bad;c.textAlign="left";c.font="600 11px system-ui";
   const s="⚡ #"+rows[i].boot+(reasons[rows[i].boot]?" "+reasons[rows[i].boot]:"");c.fillText(s,Math.min(xb+4,R-c.measureText(s).width),T+11)}}
 ser.forEach(s=>{c.strokeStyle=c.fillStyle=hue;c.globalAlpha=s.al||1;c.lineWidth=s.lw;c.lineJoin="round";c.beginPath();let pen=false;
  for(let i=a;i<=b;i++){const z=s.d[i];if(z==null||(i>a&&rows[i].boot!=rows[i-1].boot))pen=false;if(z==null)continue;
   const px=X(rows[i].ts),py=Y(z);pen?c.lineTo(px,py):c.moveTo(px,py);pen=true}
  c.stroke();
  if(b-a<90)for(let i=a;i<=b;i++){const z=s.d[i];if(z!=null){c.beginPath();c.arc(X(rows[i].ts),Y(z),s.lw*.9+.8,0,7);c.fill()}}
  c.globalAlpha=1});
 for(let i=a;i<=b;i++){const r=rows[i],px=X(r.ts);
  if(!r.ok){c.fillStyle=P.bad;c.beginPath();c.moveTo(px,B-9);c.lineTo(px-5,B);c.lineTo(px+5,B);c.fill()}
  if(r.spk&&q=="t"&&ser[0].d[i]!=null){c.strokeStyle=P.spk;c.lineWidth=2;c.beginPath();c.arc(px,Y(ser[0].d[i]),7,0,7);c.stroke()}}
 c.strokeStyle=P.mute;c.lineWidth=1;c.beginPath();c.moveTo(L,B);c.lineTo(R,B);c.stroke()}
function chart(c,W,H,P){c.fillStyle=P.bg;c.fillRect(0,0,W,H);
 c.fillStyle=P.fg;c.font="700 15px system-ui";c.textAlign="left";c.fillText("Nhiệt độ & độ ẩm · DHT11 → Uno → I2C → ESP32",12,22);
 c.fillStyle=P.mute;c.font="12px system-ui";
 if(!rows.length){c.fillText("Chưa có dữ liệu. Bấm “Bắt đầu ghi”.",12,42);return}
 const v=view(),x0=rows[v.a].ts,x1=Math.max(rows[v.b].ts,x0+1000);
 const md=$("mode").selectedOptions[0].text;
 c.fillText(`${md} · lọc: ${fdesc()} · lấy mẫu ${S?S.log.iv:"?"} s · ${v.b-v.a+1} mẫu · ${fmtTime(x0).slice(0,19)} → ${hms(x1)}`,12,40);
 if(W>=760){c.textAlign="right";c.fillStyle=P.mute;c.fillText("▲ mẫu lỗi   ◯ gai nhiễu   ⚡ khởi động lại",W-12,22)}
 const ph=(H-52)/2;panel(c,0,50,W,ph,"t",P,v,x0,x1,1);panel(c,0,50+ph,W,ph,"h",P,v,x0,x1,0)}
function drawScreen(){const cv=$("cv"),W=cv.clientWidth,H=cv.clientHeight,d=window.devicePixelRatio||1;
 cv.width=W*d;cv.height=H*d;const c=cv.getContext("2d");c.setTransform(d,0,0,d,0,0);chart(c,W,H,pal(0))}
window.addEventListener("resize",drawScreen);

// ===== Thống kê chu kỳ thực tế (mục 4.4) =====
function showStats(){if(!rows.length){$("stat").textContent="";return}
 const {a,b}=view();let bad=0,dts=[];
 for(let i=a;i<=b;i++){if(!rows[i].ok)bad++;if(i>a&&rows[i].boot==rows[i-1].boot)dts.push(rows[i].ms-rows[i-1].ms)}
 let s=`Mẫu lỗi: ${bad}/${b-a+1} (${(100*bad/(b-a+1)).toFixed(1)}%)`;
 if(dts.length){const m=dts.reduce((x,y)=>x+y,0)/dts.length,sd=Math.sqrt(dts.reduce((x,y)=>x+(y-m)**2,0)/dts.length);
  s+=` · Chu kỳ thực tế: TB ${m.toFixed(1)} ms, min ${Math.min(...dts)}, max ${Math.max(...dts)}, độ lệch chuẩn ${sd.toFixed(1)} ms`}
 $("stat").textContent=s}

// ===== CSV =====
function buildCsv(){const q=$("cq").value,k=$("ck").value,qs=q=="both"?["t","h"]:[q],F={t:filt(conv("t")),h:filt(conv("h"))};
 const head={goc:"timestamp,raw,converted,unit,valid",loc:"timestamp,raw,converted,unit,valid,filter",full:"timestamp,raw,converted,filtered,unit,valid,error,boot,note"}[k];
 const out=[head];
 rows.forEach((r,i)=>qs.forEach(x=>{const raw=r[x]==32767?"":r[x],cv=r.ok?(r[x]/10).toFixed(1):"",f=F[x][i],fs=f==null?"":f.toFixed(2),u=x=="t"?"°C":"%",ts=fmtTime(r.ts);
  if(k=="goc")out.push([ts,raw,cv,u,r.ok].join(","));
  else if(k=="loc")out.push([ts,raw,fs,u,r.ok,fname()].join(","));
  else out.push([ts,raw,cv,fs,u,r.ok,r.ok?"":"E"+r.code,r.boot,[r.sim?"gia_lap_loi":"",r.spk?"gai_nhieu":"",r.ap?"gio_uoc_luong":""].filter(Boolean).join("|")].join(","))}));
 return out.join("\r\n")+"\r\n"}
function preview(){$("pv").textContent=rows.length?buildCsv().split("\r\n").slice(0,6).join("\n")+(rows.length>5?"\n…":""):"(chưa có dữ liệu)"}
$("csv").onclick=()=>{if(!rows.length)return toast("Chưa có dữ liệu");save(new Blob(["﻿"+buildCsv()],{type:"text/csv"}),"data.csv")};
$("png").onclick=()=>{if(!rows.length)return toast("Chưa có dữ liệu");const c=document.createElement("canvas");c.width=1400;c.height=800;
 chart(c.getContext("2d"),1400,800,pal(1));c.toBlob(b=>save(b,"chart.png"))};

// ===== Nhật ký =====
async function loadEvents(){try{const t=await get("/api/events",1);
 events=t.trim().split("\n").filter(Boolean).map(l=>{const p=l.split(",");return{boot:+p[0],ms:+p[1],lv:p[2],msg:p.slice(3).join(",")}});
 reasons={};events.forEach(e=>{if(e.lv=="B")reasons[e.boot]=e.msg.split(": ")[1]||""});showEvents();drawScreen()}catch(e){}}
function evLine(e){const b=bases[e.boot]||(S&&e.boot==S.log.boot?S.log.base:0);
 return (b>0?fmtTime(b+e.ms):`boot#${e.boot} +${(e.ms/1000).toFixed(3)}s`)+` [${LV[e.lv]||e.lv}] ${e.msg}`}
function showEvents(){const box=$("ev");box.innerHTML="";
 if(!events.length){box.innerHTML='<span class="note">(trống)</span>';return}
 events.slice(-100).reverse().forEach(e=>{const d=document.createElement("div");d.className="ln "+e.lv;d.textContent=evLine(e);d.title="Bấm để sao chép";d.onclick=()=>copy(d.textContent);box.append(d)})}
$("cpy").onclick=()=>copy(events.map(evLine).join("\n"));

// ===== Điều khiển =====
async function cmd(url){try{S=await get(url);render()}catch(e){}}
$("run").onclick=()=>cmd("/api/logcfg?run="+(S&&S.log.run?0:1)+"&iv="+$("iv").value);
$("ivb").onclick=()=>cmd("/api/logcfg?iv="+$("iv").value);
$("clr").onclick=()=>{if(confirm("Xoá toàn bộ dữ liệu và nhật ký trên ESP32?"))cmd("/api/logcfg?clear=1")};
$("flt").onclick=()=>cmd("/api/sim?fault="+(S&&S.log.fault?0:1));
$("spk").onclick=()=>cmd("/api/sim?spike=1");
$("rbt").onclick=()=>{if(confirm("Khởi động lại ESP32 để mô phỏng mất điện?")){fetch("/api/sim?reboot=1").catch(()=>{});note("⚡ Đã gửi lệnh khởi động lại. Chờ ESP32 lên lại (điện thoại có thể phải kết nối lại WiFi).")}};
function fpSync(){const e=$("fk").value=="ema",p=$("fp");$("fpl").firstChild.textContent=e?"Hệ số α (0–1)":"Cửa sổ N";
 if(e){p.min=.05;p.max=1;p.step=.05;if(+p.value>1)p.value=.3}else{p.min=2;p.max=51;p.step=1;if(+p.value<2)p.value=5}
 $("fpl").style.display=$("fk").value=="none"?"none":""}
$("fk").onchange=()=>{fpSync();redraw()};
["fp","mode","win","cq","ck"].forEach(id=>$(id).onchange=redraw);
function redraw(){drawScreen();showStats();preview()}

function render(){const s=S;
 $("t").textContent=s.t??"--";$("h").textContent=s.h??"--";
 const sb=$("sens");sb.textContent=s.code?ERR[s.code]+(s.log.fault?" (giả lập)":""):"Cảm biến OK";sb.className="badge"+(s.code?" err":"");
 $("run").textContent=s.log.run?"⏸ Dừng ghi":"▶ Bắt đầu ghi";$("run").className=s.log.run?"":"pri";
 if(document.activeElement!==$("iv"))$("iv").value=s.log.iv;
 $("cnt").textContent=`${s.log.n} / ${s.log.max} mẫu`+(s.log.run?" · đang ghi":"");
 $("flt").className=s.log.fault?"on":"";
 $("st").className="";$("st").textContent=`Đã kết nối · ${s.ip} · khởi động #${s.log.boot}`+(s.log.base?"":" · đang đồng bộ giờ…")}

async function poll(){try{S=await get("/api/state");
  if(!S.log.base)fetch("/api/time?ms="+Date.now()).catch(()=>{});else bases[S.log.boot]=S.log.base;
  if(lastBoot!=null&&S.log.boot!=lastBoot)note(`⚡ ESP32 vừa khởi động lại (#${S.log.boot}). Dữ liệu cũ vẫn còn, ${S.log.run?"việc ghi đã tự chạy tiếp":"việc ghi chưa bật"}.`);
  lastBoot=S.log.boot;render();
  if(S.log.n!=rows.length)await loadLog();
  if(S.log.ev!=evSize){evSize=S.log.ev;await loadEvents()}
 }catch(e){$("st").className="warn";$("st").textContent="⚠ Mất kết nối với ESP32 (mất điện hoặc mất WiFi), đang chờ…"}
 setTimeout(poll,1000)}
fpSync();drawScreen();poll();
</script></body></html>)HTML";
