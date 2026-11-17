// Chuyển mô hình CAD STEP (SolidWorks) -> GLB cho bản sao số, GIỮ cây lắp ghép, tên chi tiết và màu CAD.
// Cần thư viện riêng (không có trong package.json của app), chạy trong một thư mục tạm:
//   npm i occt-import-js@0.0.23 @gltf-transform/core@4.1.1 @gltf-transform/functions@4.1.1
//   node --max-old-space-size=8192 step-to-glb.mjs ../smart_farm_lap_ghep.STEP smart_farm.glb 0.002
//   npx @gltf-transform/cli@4.1.1 meshopt smart_farm.glb public/models/nhakinh-cad.glb   (KHÔNG dùng "optimize": nó gộp node, mất tên)
// Kết quả 17/11/2026: 1582 mesh, 478k tam giác, 11 MB -> 3,2 MB sau meshopt, ~70 s.
import fs from 'node:fs';
import occtimportjs from 'occt-import-js';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, weld, prune } from '@gltf-transform/functions';
const [inp, out, defl = '0.002'] = process.argv.slice(2);
const t0 = Date.now();
const occt = await occtimportjs();
const r = occt.ReadStepFile(new Uint8Array(fs.readFileSync(inp)), {
  linearUnit: 'meter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: +defl, angularDeflection: 0.5 });
if (!r.success) throw new Error('doc STEP that bai');
console.log(`OCCT: ${r.meshes.length} mesh, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene('smart_farm');
const mats = new Map();
const mat = (c) => { const k = c ? c.map((v) => v.toFixed(3)).join(',') : 'none';
  if (!mats.has(k)) mats.set(k, doc.createMaterial('c_' + k).setBaseColorFactor(c ? [...c, 1] : [0.75, 0.75, 0.78, 1]).setMetallicFactor(0.1).setRoughnessFactor(0.7));
  return mats.get(k); };
let tris = 0;
const meshes = r.meshes.map((m, i) => {
  const mesh = doc.createMesh(m.name || `mesh${i}`);
  const pos = new Float32Array(m.attributes.position.array), idx = new Uint32Array(m.index.array);
  const nor = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
  const P = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf);
  const N = nor && doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf);
  // tách theo màu từng mặt (brep_faces) để giữ màu CAD
  const groups = new Map();
  if (m.brep_faces?.length) for (const f of m.brep_faces) { const k = f.color ? f.color.join() : m.color?.join() ?? ''; (groups.get(k) || groups.set(k, { c: f.color || m.color, tr: [] }).get(k)).tr.push([f.first, f.last]); }
  else groups.set('', { c: m.color, tr: [[0, idx.length / 3 - 1]] });
  for (const g of groups.values()) {
    const sub = []; for (const [a, b] of g.tr) for (let t = a; t <= b; t++) sub.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
    tris += sub.length / 3;
    const prim = doc.createPrimitive().setAttribute('POSITION', P).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(sub)).setBuffer(buf)).setMaterial(mat(g.c));
    if (N) prim.setAttribute('NORMAL', N);
    mesh.addPrimitive(prim);
  }
  return mesh;
});
const names = [];
function walk(n, depth) {
  const node = doc.createNode(n.name || 'node');
  names.push('  '.repeat(depth) + (n.name || '?') + (n.meshes.length ? ` [${n.meshes.length}]` : ''));
  for (const mi of n.meshes) node.addChild(doc.createNode(r.meshes[mi].name || n.name).setMesh(meshes[mi]));
  for (const c of n.children) node.addChild(walk(c, depth + 1));
  return node;
}
scene.addChild(walk(r.root, 0));
await doc.transform(weld(), dedup(), prune());
await new NodeIO().write(out, doc);
fs.writeFileSync(out.replace(/\.glb$/, '.tree.txt'), names.join('\n'));
console.log(`GLB ${out}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${tris} tam giac, ${mats.size} vat lieu, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
