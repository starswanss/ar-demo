#!/usr/bin/env node
/*
  ตรวจไฟล์ targets.mind ว่ามีกี่ภาพ แต่ละภาพขนาดเท่าไหร่ และมีจุดสังเกตพอไหม

  วิธีใช้:
    node tools/inspect-mind.js assets/targets.mind

  ไฟล์ .mind คือ msgpack ดิบ โครงสร้าง { v: 2, dataList: [ {targetImage, trackingData, matchingData}, ... ] }
  สคริปต์นี้มี msgpack decoder ในตัว จึงไม่ต้องลง dependency อะไรเพิ่ม
*/

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('ใช้: node tools/inspect-mind.js <ไฟล์.mind>');
  process.exit(1);
}

const b = fs.readFileSync(file);
let p = 0;

function dec() {
  const t = b[p++];
  if (t <= 0x7f) return t;
  if (t >= 0xe0) return t - 256;
  if ((t & 0xf0) === 0x80) return map(t & 0x0f);
  if ((t & 0xf0) === 0x90) return arr(t & 0x0f);
  if ((t & 0xe0) === 0xa0) return str(t & 0x1f);
  switch (t) {
    case 0xc0: return null;
    case 0xc2: return false;
    case 0xc3: return true;
    case 0xc4: { const n = b[p++]; p += n; return { __bin: n }; }
    case 0xc5: { const n = b.readUInt16BE(p); p += 2 + n; return { __bin: n }; }
    case 0xc6: { const n = b.readUInt32BE(p); p += 4 + n; return { __bin: n }; }
    case 0xca: { const v = b.readFloatBE(p); p += 4; return v; }
    case 0xcb: { const v = b.readDoubleBE(p); p += 8; return v; }
    case 0xcc: return b[p++];
    case 0xcd: { const v = b.readUInt16BE(p); p += 2; return v; }
    case 0xce: { const v = b.readUInt32BE(p); p += 4; return v; }
    case 0xd0: return b.readInt8(p++);
    case 0xd1: { const v = b.readInt16BE(p); p += 2; return v; }
    case 0xd2: { const v = b.readInt32BE(p); p += 4; return v; }
    case 0xd9: { const n = b[p++]; return str(n); }
    case 0xda: { const n = b.readUInt16BE(p); p += 2; return str(n); }
    case 0xdb: { const n = b.readUInt32BE(p); p += 4; return str(n); }
    case 0xdc: { const n = b.readUInt16BE(p); p += 2; return arr(n); }
    case 0xdd: { const n = b.readUInt32BE(p); p += 4; return arr(n); }
    case 0xde: { const n = b.readUInt16BE(p); p += 2; return map(n); }
    case 0xdf: { const n = b.readUInt32BE(p); p += 4; return map(n); }
    default: throw new Error('msgpack type ที่ไม่รู้จัก 0x' + t.toString(16) + ' ที่ offset ' + (p - 1));
  }
}
function str(n) { const s = b.slice(p, p + n).toString('utf8'); p += n; return s; }
function arr(n) { const o = []; for (let i = 0; i < n; i++) o.push(dec()); return o; }
function map(n) { const o = {}; for (let i = 0; i < n; i++) { const k = dec(); o[k] = dec(); } return o; }

let root;
try {
  root = dec();
} catch (e) {
  console.error('อ่านไฟล์ไม่สำเร็จ ไฟล์อาจเสียหาย:', e.message);
  process.exit(1);
}

console.log('=== ' + file + ' ===');
console.log('ขนาดไฟล์      :', b.length.toLocaleString(), 'bytes');
console.log('เวอร์ชันฟอร์แมต:', root.v);
console.log('จำนวนภาพ      :', root.dataList.length);

if (p !== b.length) {
  console.log('\n!! เตือน: อ่านได้ ' + p.toLocaleString() + ' จาก ' + b.length.toLocaleString() +
    ' bytes — ไฟล์อาจไม่สมบูรณ์');
} else {
  console.log('อ่านครบทั้งไฟล์พอดี ไม่มีเศษเหลือ = ไฟล์สมบูรณ์');
}

root.dataList.forEach((t, i) => {
  const ti = t.targetImage;
  let match = 0;
  for (const L of t.matchingData) match += (L.maximaPoints || []).length + (L.minimaPoints || []).length;
  let track = 0;
  const trackPerLayer = t.trackingData.map(L => (L.points || []).length);
  for (const n of trackPerLayer) track += n;

  console.log('\n--- targetIndex: ' + i + ' ---');
  console.log('  ขนาดภาพต้นแบบ  : ' + ti.width + ' x ' + ti.height + ' px' +
    '  (สัดส่วนสูง/กว้าง ' + (ti.height / ti.width).toFixed(4) + ')');
  console.log('  จุดตรวจจับ     : ' + match.toLocaleString() +
    (match < 800 ? '   <-- น้อย อาจสแกนติดยาก' : ''));
  console.log('  จุดติดตาม      : ' + track + '  (แยกตามชั้น: ' + trackPerLayer.join(', ') + ')' +
    (track < 60 ? '   <-- น้อย โมเดลอาจสั่น' : ''));
});

console.log('\nหมายเหตุ: ไฟล์ .mind ไม่ได้เก็บตัวภาพหรือชื่อไฟล์ไว้ ดูย้อนหลังไม่ได้ว่า');
console.log('แต่ละ index มาจากภาพไหน ต้องจดลำดับตอนคอมไพล์ไว้เอง');
