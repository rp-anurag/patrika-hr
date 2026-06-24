const fs = require('fs');
const path = require('path');

// These files had UTF-8 content incorrectly re-encoded by PowerShell
// We fix by operating on raw Buffers — no string encoding confusion
const files = [
  '../views/form.ejs',
  '../views/admin/dashboard.ejs',
  '../views/admin/candidate-detail.ejs',
  '../views/admin/resume-parser.ejs',
  '../views/admin/login.ejs',
];

// Each entry: [bad bytes (hex), good bytes (hex)]
// Bad bytes = UTF-8 chars that are actually Windows-1252-misread UTF-8
const replacements = [
  // â€" (em dash —)  C3A2 E282AC E2809D  →  E28094
  ['c3a2e282ace2809d', 'e28094'],
  // â€" (en dash –)  C3A2 E282AC E2809C  →  E28093
  ['c3a2e282ace2809c', 'e28093'],
  // â‚¹ (₹ rupee)    C3A2 E2809A C2B9    →  E282B9
  ['c3a2e2809ac2b9',   'e282b9'],
  // Â· (· middle dot) C382 C2B7          →  C2B7
  ['c382c2b7',         'c2b7'],
  // â"€ (─ box drawing) C3A2 E294 80     →  2D (hyphen)
  ['c3a2e29480',       '2d'],
  // Â (spurious  before ·)
  ['c382',             ''],
];

function hexToBuffer(hex) {
  return Buffer.from(hex, 'hex');
}

function replaceBuffer(buf, fromBuf, toBuf) {
  let result = buf;
  let idx;
  while ((idx = result.indexOf(fromBuf)) !== -1) {
    result = Buffer.concat([result.slice(0, idx), toBuf, result.slice(idx + fromBuf.length)]);
  }
  return result;
}

files.forEach(f => {
  const file = path.join(__dirname, f);
  if (!fs.existsSync(file)) return;

  let buf = fs.readFileSync(file);
  const original = buf.toString('hex');

  for (const [bad, good] of replacements) {
    const fromBuf = hexToBuffer(bad);
    const toBuf   = hexToBuffer(good);
    buf = replaceBuffer(buf, fromBuf, toBuf);
  }

  if (buf.toString('hex') !== original) {
    fs.writeFileSync(file, buf);
    console.log('Fixed:', f);
  } else {
    console.log('Clean:', f);
  }
});
