// File storage. On Vercel: Vercel Blob (needs BLOB_READ_WRITE_TOKEN, added automatically
// when you create a Blob store). On your own computer without a token: saved to public/uploads.
const path = require('path');
const fs = require('fs');

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
let blob = null;
if (useBlob) blob = require('@vercel/blob');

const localDir = path.join(__dirname, '..', 'public', 'uploads');

async function saveFile(file, folder) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const name = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  if (useBlob) {
    const r = await blob.put(name, file.buffer, { access: 'public', contentType: file.mimetype, addRandomSuffix: true });
    return r.url;
  }
  if (process.env.VERCEL) {
    throw new Error('File storage is not configured. Create a Blob store in Vercel (Storage tab) and redeploy.');
  }
  const full = path.join(localDir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, file.buffer);
  return '/uploads/' + name;
}

async function deleteFile(url) {
  if (!url) return;
  try {
    if (/^https?:\/\//.test(url)) { if (useBlob) await blob.del(url); return; }
    const full = path.resolve(localDir, '.' + url.replace(/^\/uploads/, ''));
    if (full.startsWith(localDir + path.sep)) fs.unlink(full, () => {});
  } catch (e) { console.error('deleteFile failed', e.message); }
}

module.exports = { saveFile, deleteFile };
