// Dynamic website content: principal message, teacher profiles, gallery.
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { saveFile, deleteFile } = require('../lib/storage');

const NOW = db.NOW;
// Vercel rejects request bodies over ~4.5 MB, so one image per request, max 4 MB.
const MAX_IMG = 4 * 1024 * 1024;
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMG, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = IMAGE_EXT.includes(path.extname(file.originalname).toLowerCase()) && /^image\//.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
  }
});

const handle = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 4 MB or smaller.'
    : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' ? 'Please upload one image at a time.'
    : err.message || 'Upload failed.';
  res.status(400).json({ error: msg });
});

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

module.exports = function contentRoutes({ requireRole, wrap }) {
  const router = express.Router();
  const admin = requireRole('admin');

  // ---------- PUBLIC (read-only) ----------
  router.get('/api/content/principal', wrap(async (req, res) => {
    res.json((await db.one('SELECT name, title, message, photo_path FROM principal WHERE id = 1')) || null);
  }));
  router.get('/api/content/teachers', wrap(async (req, res) => {
    res.json(await db.all('SELECT id, name, designation, bio, photo_path, sort_order FROM staff_profiles ORDER BY sort_order, id'));
  }));
  router.get('/api/content/gallery', wrap(async (req, res) => {
    res.json(await db.all('SELECT id, caption, image_path FROM gallery_images ORDER BY id DESC'));
  }));

  // ---------- ADMIN: PRINCIPAL ----------
  router.put('/api/admin/content/principal', admin, handle(upload.single('photo')), wrap(async (req, res) => {
    const name = clean(req.body.name, 120), title = clean(req.body.title, 160), message = clean(req.body.message, 6000);
    if (!name || !title) return res.status(400).json({ error: 'Name and title are required.' });
    const cur = await db.one('SELECT photo_path FROM principal WHERE id = 1');
    let photo = cur ? cur.photo_path : null;
    const oldPhoto = photo;
    if (req.file) photo = await saveFile(req.file, 'content');
    else if (req.body.remove_photo === '1') photo = null;
    await db.run(`
      INSERT INTO principal (id, name, title, message, photo_path, updated_at) VALUES (1, $1, $2, $3, $4, ${NOW})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, title = EXCLUDED.title, message = EXCLUDED.message,
        photo_path = EXCLUDED.photo_path, updated_at = ${NOW}`, [name, title, message, photo]);
    if (photo !== oldPhoto) await deleteFile(oldPhoto);
    res.json({ ok: true, photo_path: photo });
  }));

  // ---------- ADMIN: TEACHERS ----------
  router.post('/api/admin/content/teachers', admin, handle(upload.single('photo')), wrap(async (req, res) => {
    const name = clean(req.body.name, 120), designation = clean(req.body.designation, 160), bio = clean(req.body.bio, 3000);
    if (!name || !designation) return res.status(400).json({ error: 'Name and designation are required.' });
    const next = (await db.one('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM staff_profiles')).n;
    const parsed = parseInt(req.body.sort_order, 10);
    const order = Number.isFinite(parsed) ? parsed : next;
    const photo = req.file ? await saveFile(req.file, 'content') : null;
    const r = await db.one('INSERT INTO staff_profiles (name, designation, bio, photo_path, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, designation, bio, photo, order]);
    res.status(201).json({ id: r.id });
  }));

  router.put('/api/admin/content/teachers/:id', admin, handle(upload.single('photo')), wrap(async (req, res) => {
    const row = await db.one('SELECT * FROM staff_profiles WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Teacher not found.' });
    const name = clean(req.body.name, 120), designation = clean(req.body.designation, 160), bio = clean(req.body.bio, 3000);
    if (!name || !designation) return res.status(400).json({ error: 'Name and designation are required.' });
    const parsed = parseInt(req.body.sort_order, 10);
    const order = Number.isFinite(parsed) ? parsed : row.sort_order;
    let photo = row.photo_path;
    if (req.file) photo = await saveFile(req.file, 'content');
    else if (req.body.remove_photo === '1') photo = null;
    await db.run(`UPDATE staff_profiles SET name = $1, designation = $2, bio = $3, photo_path = $4, sort_order = $5, updated_at = ${NOW} WHERE id = $6`,
      [name, designation, bio, photo, order, row.id]);
    if (photo !== row.photo_path) await deleteFile(row.photo_path);
    res.json({ ok: true });
  }));

  router.delete('/api/admin/content/teachers/:id', admin, wrap(async (req, res) => {
    const row = await db.one('DELETE FROM staff_profiles WHERE id = $1 RETURNING photo_path', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Teacher not found.' });
    await deleteFile(row.photo_path);
    res.json({ ok: true });
  }));

  // ---------- ADMIN: GALLERY (one image per request; the admin page sends them one by one) ----------
  router.post('/api/admin/content/gallery', admin, handle(upload.single('images')), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Please choose at least one image.' });
    const caption = clean(req.body.caption, 200);
    const url = await saveFile(req.file, 'content');
    await db.run('INSERT INTO gallery_images (caption, image_path) VALUES ($1, $2)', [caption, url]);
    res.status(201).json({ added: 1 });
  }));

  router.put('/api/admin/content/gallery/:id', admin, wrap(async (req, res) => {
    const r = await db.run('UPDATE gallery_images SET caption = $1 WHERE id = $2', [clean(req.body && req.body.caption, 200), req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Image not found.' });
    res.json({ ok: true });
  }));

  router.delete('/api/admin/content/gallery/:id', admin, wrap(async (req, res) => {
    const row = await db.one('DELETE FROM gallery_images WHERE id = $1 RETURNING image_path', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Image not found.' });
    await deleteFile(row.image_path);
    res.json({ ok: true });
  }));

  return router;
};
