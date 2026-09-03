import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = '610b5de57cdcfbcce9914c23e60a1cd357779a6f9582a1bcfcb035f8eb38509b';
const SOURCE = 'https://huggingface.co/notaneimu/onnx-image-models/resolve/main/rife_v4.25_lite_v2.onnx';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destDir = path.join(root, 'models');
const dest = path.join(destDir, 'rife_v4.25_lite_v2.onnx');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function downloadHttps(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) {
      reject(new Error('too many redirects'));
      return;
    }
    https.get(url, { headers: { 'User-Agent': 'opticx-fetch-models' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        downloadHttps(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function download(url) {
  if (typeof fetch === 'function') {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'opticx-fetch-models' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return downloadHttps(url);
}

fs.mkdirSync(destDir, { recursive: true });

if (fs.existsSync(dest) && sha256File(dest) === SHA256) {
  console.log(`${dest} ${fs.statSync(dest).size}`);
  process.exit(0);
}

const tmp = `${dest}.${process.pid}.part`;
try {
  const buf = await download(SOURCE);
  const digest = sha256Buf(buf);
  if (digest !== SHA256) {
    console.error(`checksum mismatch: ${digest}`);
    process.exit(1);
  }
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  console.log(`${dest} ${buf.length}`);
} catch (err) {
  try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
