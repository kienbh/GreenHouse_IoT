import json
FN = r'''
let g = flow.get('groups') || {};
let sel = flow.get('sel') || '';
const t = msg.topic.split('/');
if (t[0] !== 'vju' || t[1] !== 'iot' || !t[2]) return null;
const name = t[2];
const sub = (t[3] || '').toLowerCase();
const num = (v) => { const x = parseFloat(v); return isNaN(x) ? null : x; };
const bl = (v) => { v = ('' + v).toLowerCase(); return ['1','on','true'].includes(v) ? 1 : ['0','off','false'].includes(v) ? 0 : null; };
let n = g[name] || { nhom: name, status: '?', temp: null, hum: null, led: null, btn: null };
let p = msg.payload;
if (sub === 'status') { n.status = ('' + p).toLowerCase() === 'offline' ? 'offline' : 'online'; }
else if (sub === '') {
  let o = (p && typeof p === 'object') ? p : null;
  if (!o) { try { o = JSON.parse(p); } catch (e) { o = null; } }
  if (o) {
    if ('temp' in o || 'temperature' in o) n.temp = num(o.temp != null ? o.temp : o.temperature);
    if ('hum' in o || 'humidity' in o) n.hum = num(o.hum != null ? o.hum : o.humidity);
    if ('led' in o) n.led = bl(o.led);
    if ('btn' in o) n.btn = bl(o.btn);
    n.status = 'online';
  }
} else if (sub === 'temperature' || sub === 'temp') { n.temp = num(p); n.status = 'online'; }
else if (sub === 'humidity' || sub === 'hum') { n.hum = num(p); n.status = 'online'; }
else if (sub === 'led') { n.led = bl(p); n.status = 'online'; }
else if (sub === 'button' || sub === 'btn') { n.btn = bl(p); n.status = 'online'; }
else { return null; }
n.seen = Date.now();
g[name] = n; flow.set('groups', g);
const rows = Object.values(g).sort((a,b)=>a.nhom.localeCompare(b.nhom)).map(x=>({
  'Nhom': x.nhom, 'Trang thai': x.status,
  'Nhiet do': x.temp==null?'--':x.temp, 'Do am': x.hum==null?'--':x.hum,
  'LED': x.led==null?'--':(x.led?'BAT':'tat'), 'Nut': x.btn==null?'--':(x.btn?'nhan':'tha') }));
const isSel = (name === sel);
return [
  {payload: rows},
  (n.temp!=null)?{topic:name, payload:n.temp}:null,
  (n.hum!=null)?{topic:name, payload:n.hum}:null,
  (isSel && n.temp!=null)?{payload:n.temp}:null,
  (isSel && n.hum!=null)?{payload:n.hum}:null,
  isSel?{payload:(n.led==null?'--':(n.led?'BAT':'tat'))}:null,
  isSel?{payload:(n.btn==null?'--':(n.btn?'dang nhan':'tha'))}:null
];
'''
FN2 = r'''
const sel = flow.get('sel');
if (!sel) { node.warn('Chua chon nhom o o Chi tiet'); return null; }
return { topic: `vju/iot/${sel}/output`, payload: msg.payload };
'''
def node(**k): return k
flows = []
# config nodes
flows.append(node(id="brk", type="mqtt-broker", name="broker local", broker="localhost", port="1883",
    clientid="nodered-lop", autoConnect=True, usetls=False, protocolVersion="4", keepalive="60", cleansession=True,
    birthTopic="", birthQos="0", birthPayload="", closeTopic="", willTopic="", willQos="0", willPayload=""))
flows.append(node(id="utab", type="ui_tab", name="Lop IoT", icon="dashboard", order=1, disabled=False, hidden=False))
flows.append(node(id="gov", type="ui_group", name="Tong quan cac nhom", tab="utab", order=1, disp=True, width=12, collapse=False))
flows.append(node(id="gdet", type="ui_group", name="Chi tiet nhom", tab="utab", order=2, disp=True, width=6, collapse=False))
flows.append(node(id="gctl", type="ui_group", name="Dieu khien", tab="utab", order=3, disp=True, width=6, collapse=False))
# flow tab
flows.append(node(id="f1", type="tab", label="Lop IoT MQTT", disabled=False, info=""))
# mqtt in -> fn
flows.append(node(id="min", type="mqtt in", z="f1", name="vju/iot/#", topic="vju/iot/#", qos="0", datatype="auto-detect",
    broker="brk", nl=False, rap=True, rh=0, inputs=0, x=120, y=120, wires=[["fn"]]))
flows.append(node(id="fn", type="function", z="f1", name="gom nhom", func=FN, outputs=7, timeout=0, noerr=0, initialize="", finalize="", libs=[],
    x=320, y=200, wires=[["tbl"],["chT"],["chH"],["gT"],["gH"],["txL"],["txB"]]))
# overview widgets
flows.append(node(id="tbl", type="ui_table", z="f1", group="gov", name="Bang nhom", order=1, width=12, height=6,
    columns=[], outputs=0, cts=False, x=560, y=80, wires=[]))
flows.append(node(id="chT", type="ui_chart", z="f1", group="gov", name="Nhiet do", order=2, width=6, height=5,
    label="Nhiet do cac nhom (C)", chartType="line", legend="true", xformat="HH:mm:ss", interpolate="linear",
    nodata="cho du lieu", dot=False, ymin="", ymax="", removeOlder="10", removeOlderPoints="", removeOlderUnit="60",
    cutout=0, useOneColor=False, useUTC=False, colors=["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#17becf","#bcbd22","#7f7f7f","#aec7e8","#ffbb78"],
    outputs=1, useDifferentColor=False, className="", x=560, y=160, wires=[[]]))
flows.append(node(id="chH", type="ui_chart", z="f1", group="gov", name="Do am", order=3, width=6, height=5,
    label="Do am cac nhom (%)", chartType="line", legend="true", xformat="HH:mm:ss", interpolate="linear",
    nodata="cho du lieu", dot=False, ymin="", ymax="", removeOlder="10", removeOlderPoints="", removeOlderUnit="60",
    cutout=0, useOneColor=False, useUTC=False, colors=["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#17becf","#bcbd22","#7f7f7f","#aec7e8","#ffbb78"],
    outputs=1, useDifferentColor=False, className="", x=560, y=240, wires=[[]]))
# detail widgets
flows.append(node(id="gT", type="ui_gauge", z="f1", group="gdet", name="Gauge nhiet", order=1, width=3, height=3,
    gtype="gage", title="Nhiet do", label="C", format="{{value}}", min=0, max="50",
    colors=["#00b500","#e6e600","#ca3838"], seg1="30", seg2="40", diff=False, className="", x=560, y=340, wires=[]))
flows.append(node(id="gH", type="ui_gauge", z="f1", group="gdet", name="Gauge am", order=2, width=3, height=3,
    gtype="gage", title="Do am", label="%", format="{{value}}", min=0, max="100",
    colors=["#ca3838","#e6e600","#00b5e2"], seg1="30", seg2="70", diff=False, className="", x=560, y=400, wires=[]))
flows.append(node(id="txL", type="ui_text", z="f1", group="gdet", order=3, width=3, height=1, name="LED",
    label="LED", format="{{msg.payload}}", layout="row-spread", className="", x=560, y=460, wires=[]))
flows.append(node(id="txB", type="ui_text", z="f1", group="gdet", order=4, width=3, height=1, name="Nut",
    label="Nut nhan", format="{{msg.payload}}", layout="row-spread", className="", x=560, y=500, wires=[]))
# control: dropdown + change -> flow.sel ; buttons -> fn2 -> mqtt out
opts=[{"label":f"nhom{str(i).zfill(2)}","value":f"nhom{str(i).zfill(2)}","type":"str"} for i in range(1,13)]
flows.append(node(id="dd", type="ui_dropdown", z="f1", name="Chon nhom", label="Nhom", tooltip="", place="Chon nhom",
    group="gctl", order=1, width=6, height=1, passthru=True, multiple=False, options=opts, payload="", topic="topic",
    topicType="msg", className="", x=140, y=380, wires=[["chg"]]))
flows.append(node(id="chg", type="change", z="f1", name="luu nhom chon", rules=[{"t":"set","p":"sel","pt":"flow","to":"payload","tot":"msg"}],
    action="", property="", **{"from":"","to":"","reg":False}, x=360, y=380, wires=[["gact"]]))
# after selecting, re-emit stored values so gauges refresh ngay
GACT = r'''
const g = flow.get('groups')||{}; const n = g[flow.get('sel')]; if(!n) return [null,null,null,null];
return [ n.temp!=null?{payload:n.temp}:null, n.hum!=null?{payload:n.hum}:null,
  {payload:(n.led==null?'--':(n.led?'BAT':'tat'))}, {payload:(n.btn==null?'--':(n.btn?'dang nhan':'tha'))} ];
'''
flows.append(node(id="gact", type="function", z="f1", name="refresh gauge", func=GACT, outputs=4, timeout=0, noerr=0,
    initialize="", finalize="", libs=[], x=560, y=380, wires=[["gT"],["gH"],["txL"],["txB"]]))
flows.append(node(id="bOn", type="ui_button", z="f1", name="Bat LED", group="gctl", order=2, width=3, height=1,
    passthru=False, label="Bat LED", tooltip="", color="", bgcolor="#2e7d32", className="", icon="", payload="on",
    payloadType="str", topic="", topicType="str", x=140, y=440, wires=[["fn2"]]))
flows.append(node(id="bOff", type="ui_button", z="f1", name="Tat LED", group="gctl", order=3, width=3, height=1,
    passthru=False, label="Tat LED", tooltip="", color="", bgcolor="#b23b3b", className="", icon="", payload="off",
    payloadType="str", topic="", topicType="str", x=140, y=500, wires=[["fn2"]]))
flows.append(node(id="fn2", type="function", z="f1", name="tao lenh", func=FN2, outputs=1, timeout=0, noerr=0,
    initialize="", finalize="", libs=[], x=360, y=470, wires=[["mout"]]))
flows.append(node(id="mout", type="mqtt out", z="f1", name="gui lenh", topic="", qos="0", retain="", respTopic="",
    contentType="", userProps="", correl="", expiry="", broker="brk", x=560, y=470, wires=[]))
open("flows.json","w").write(json.dumps(flows, ensure_ascii=False, indent=1))
print("flows.json:", len(flows), "nodes")
