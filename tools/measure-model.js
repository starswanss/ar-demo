#!/usr/bin/env node
/*
  วัดไฟล์ .glb แล้วบอกค่า rotation / scale / position ที่ต้องใส่ใน index.html

  วิธีใช้:
    node tools/measure-model.js assets/model.glb
    node tools/measure-model.js assets/model2.glb 1.5     <- อยากให้กว้าง 1.5 เท่าของภาพ

  ทำไมต้องมีสคริปต์นี้:
  โปรแกรมดูโมเดลทั่วไปอ่านค่า min/max ที่ "เขียนกำกับไว้" ในไฟล์ ซึ่งบางตัวแปลง
  ไฟล์ (เช่น ImageToStl.com) เขียนค่านี้ผิดโดยสลับแกน สคริปต์นี้จึงถอดรหัสพิกัด
  ของ vertex ทุกจุดจากบัฟเฟอร์จริงมาคำนวณเอง ไม่เชื่อค่ากำกับ
*/

const fs = require('fs');

const file = process.argv[2];
const FRAC = parseFloat(process.argv[3] || '1.0');

if (!file) {
  console.error('ใช้: node tools/measure-model.js <ไฟล์.glb> [อัตราส่วนความกว้างเทียบภาพ]');
  process.exit(1);
}

// ---------- อ่าน GLB ----------
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  console.error('ไฟล์นี้ไม่ใช่ .glb (ไม่พบ magic "glTF")');
  process.exit(1);
}
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen;
const bin = buf.slice(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff));

// ---------- เดินตาม node hierarchy เพื่อได้ world matrix ----------
const ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function fromTRS(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const r = [
    1 - 2*(y*y + z*z), 2*(x*y + z*w),     2*(x*z - y*w),
    2*(x*y - z*w),     1 - 2*(x*x + z*z), 2*(y*z + x*w),
    2*(x*z + y*w),     2*(y*z - x*w),     1 - 2*(x*x + y*y),
  ];
  return [r[0]*sx, r[1]*sx, r[2]*sx, 0,
          r[3]*sy, r[4]*sy, r[5]*sy, 0,
          r[6]*sz, r[7]*sz, r[8]*sz, 0,
          tx, ty, tz, 1];
}
const xform = (m, p) => [
  m[0]*p[0] + m[4]*p[1] + m[8]*p[2]  + m[12],
  m[1]*p[0] + m[5]*p[1] + m[9]*p[2]  + m[13],
  m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14],
];

// ---------- รวบรวมพิกัดจริงของทุก vertex ----------
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
let verts = 0, tris = 0, drawCalls = 0;

function readPositions(acc, world) {
  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || 12;
  for (let i = 0; i < acc.count; i++) {
    const p = [
      bin.readFloatLE(base + i * stride),
      bin.readFloatLE(base + i * stride + 4),
      bin.readFloatLE(base + i * stride + 8),
    ];
    const w = xform(world, p);
    for (let k = 0; k < 3; k++) {
      if (w[k] < min[k]) min[k] = w[k];
      if (w[k] > max[k]) max[k] = w[k];
    }
  }
  verts += acc.count;
}

function visit(idx, parent) {
  const node = gltf.nodes[idx];
  const world = mul(parent, fromTRS(node));
  if (node.mesh !== undefined) {
    for (const p of gltf.meshes[node.mesh].primitives) {
      drawCalls++;
      const acc = gltf.accessors[p.attributes.POSITION];
      if (acc) readPositions(acc, world);
      tris += p.indices !== undefined
        ? gltf.accessors[p.indices].count / 3
        : (acc ? acc.count / 3 : 0);
    }
  }
  for (const c of node.children || []) visit(c, world);
}
for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, ident());

// ---------- สรุปผล ----------
const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const f = (n) => Number(n.toFixed(4));
const nf = (n) => Math.round(n).toLocaleString('en-US');

console.log('=== ' + file + ' ===');
console.log('ต่ำสุด :', min.map(f).join(', '));
console.log('สูงสุด :', max.map(f).join(', '));
console.log('ขนาด   : X=' + f(size[0]) + '  Y=' + f(size[1]) + '  Z=' + f(size[2]));

// แกนไหนคือ "ขึ้น" ดูจากแกนที่ฐานแตะ 0 พอดี
const upAxis = Math.abs(min[1]) < 1e-6 ? 1 : (Math.abs(min[2]) < 1e-6 ? 2 : -1);
const upName = ['X', 'Y', 'Z'][upAxis];
console.log('แกนขึ้น: ' + (upAxis === -1
  ? 'เดาไม่ได้ (ไม่มีแกนไหนที่ฐานอยู่ที่ 0 พอดี) ต้องเปิดดูใน Blender'
  : upName + '-up  (ฐานอยู่ที่ ' + upName + '=0 พอดี)'));

console.log('\n--- ประสิทธิภาพ ---');
console.log('draw calls :', nf(drawCalls), drawCalls > 100
  ? '  <-- เยอะเกินไป ควรยุบด้วย glTF-Transform ก่อน (ดู README)' : '  (โอเค)');
console.log('สามเหลี่ยม :', nf(tris));
console.log('vertices   :', nf(verts));
console.log('ขนาดไฟล์   :', (buf.length / 1048576).toFixed(2), 'MB');

if (upAxis === -1) process.exit(0);

// ---------- คำนวณค่าที่ต้องใส่ ----------
// ระนาบ target กว้าง 1 หน่วย จุดกึ่งกลางที่ 0,0,0 และ +Z พุ่งออกจากกระดาษ
// Y-up ต้องหมุน 90 องศารอบ X : (x,y,z) -> (x,-z,y)
// Z-up ตรงกับระนาบอยู่แล้ว ไม่ต้องหมุน
const rotX = upAxis === 1 ? 90 : 0;
const rot = (p) => (rotX === 90 ? [p[0], -p[2], p[1]] : p);

const wmin = [Infinity, Infinity, Infinity];
const wmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < 8; i++) {
  const c = [(i & 1) ? max[0] : min[0], (i & 2) ? max[1] : min[1], (i & 4) ? max[2] : min[2]];
  const w = rot(c);
  for (let k = 0; k < 3; k++) {
    if (w[k] < wmin[k]) wmin[k] = w[k];
    if (w[k] > wmax[k]) wmax[k] = w[k];
  }
}

const widest = wmax[0] - wmin[0];
const scale = Number((FRAC / widest).toPrecision(3));
const off = [
  Number((-(wmin[0] + wmax[0]) / 2 * scale).toFixed(4)),
  Number((-(wmin[1] + wmax[1]) / 2 * scale).toFixed(4)),
  0,
];

console.log('\n--- ค่าที่ต้องใส่ใน index.html (ตั้งให้กว้าง ' + FRAC + ' เท่าของความกว้างภาพ) ---');
console.log('<a-gltf-model');
console.log('  rotation="' + rotX + ' 0 0"');
console.log('  position="' + off.join(' ') + '"');
console.log('  scale="' + scale + ' ' + scale + ' ' + scale + '"');
console.log('  src="#ชื่อโมเดลของคุณ"');
console.log('></a-gltf-model>');

console.log('\nตรวจผลลัพธ์ (กระดาษกิน X -0.5..0.5):');
for (let k = 0; k < 3; k++) {
  console.log('  ' + 'XYZ'[k] + ': ' + f(wmin[k] * scale + off[k]) +
    '  ถึง  ' + f(wmax[k] * scale + off[k]) +
    '   (ขนาด ' + f((wmax[k] - wmin[k]) * scale) + ')');
}
console.log('  แกน Z เริ่มที่ 0 = ฐานอาคารวางแนบบนกระดาษพอดี');
