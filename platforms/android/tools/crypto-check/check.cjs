'use strict';
/* Same fixed inputs as CryptoCheck.java, through the real service code.
   Usage: node check.cjs <java output file> */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, '../../../../service/magis.js'), 'utf8');
// magis.js keeps these helpers private: expose them without changing the file.
const m = { exports: {} };
new Function('module', 'exports', 'require', src + '\nmodule.exports.__t = { encryptBody, decryptBlob, liveDigestHex, signO3 };')(
  m, m.exports, (id) => require(id.startsWith('.') ? path.join(__dirname, '../../../../service', id) : id));
const t = m.exports.__t;
const out = [];
const plains = ['{"portalCode":"masnew","userId":"","sn":"abc","sdkVer":33}', '', 'a', 'ñandú 日本 é',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef!'];
for (const p of plains) { const e = t.encryptBody(p); out.push('enc ' + e, 'dec ' + t.decryptBlob(e)); }
for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200]) {
  const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
  out.push('dig ' + n + ' ' + t.liveDigestHex(b));
}
out.push('o3 ' + t.signO3('0123456789abcdef0123456789abcdef', 1731264000123));
out.push('o3 ' + t.signO3('', 0));
out.push('md5 ' + crypto.createHash('md5').update('snTokenXYZ' + 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28').digest('hex'));
const b64u = (v) => Buffer.from(String(v), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
out.push('b64u ' + b64u('https://cdn.example.com/live/a b?x=1&y=ñ'));
out.push('b64ud https://cdn.example.com/live/a b?x=1&y=ñ');
const java = fs.readFileSync(process.argv[2], 'utf8').replace(/\r/g, '').trim().split('\n');
let bad = 0;
out.forEach((line, i) => { if (line !== java[i]) { bad++; console.log('DIFF ' + i + '\n node ' + line + '\n java ' + java[i]); } });
if (java.length !== out.length) { bad++; console.log('line count node ' + out.length + ' java ' + java.length); }
console.log(bad ? 'MISMATCH (' + bad + ')' : 'OK: ' + out.length + ' lines identical');
process.exit(bad ? 1 : 0);
