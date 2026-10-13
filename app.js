const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db');
const { saveFile } = require('./storage');

const NOW = db.NOW;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
if (isProd && !process.env.SESSION_SECRET) {
  console.error('WARNING: SESSION_SECRET is not set. Set it in Vercel > Settings > Environment Variables.');
}

app.use(express.json({ limit: '1mb' }));
// Stateless signed-cookie session (serverless-safe: nothing is stored on the server).
app.use(cookieSession({
  name: 'tlm_session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me-before-deploying'],
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd,
  maxAge: 1000 * 60 * 60 * 8 // 8 hours
}));
// Make sure tables exist before handling any /api request.
app.use('/api', async (req, res, next) => {
  try { await db.ready(); next(); } catch (e) { next(e); }
});

// Local development only: Vercel serves /public itself.
if (!process.env.VERCEL) app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// =========================================================
// AUTH MIDDLEWARE
// =========================================================
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

// =========================================================
// UPLOADS (kept in memory, then sent to Vercel Blob)
// Vercel limits a request body to ~4.5 MB, so keep files small.
// =========================================================
const MAX_FILE = 2 * 1024 * 1024; // 2 MB each for admissions (photo + document = 4 MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 2 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});
const handleUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 2 MB or smaller.' : (err.message || 'Upload failed.');
  res.status(400).json({ error: msg });
});

// =========================================================
// AUTH ROUTES
// =========================================================
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const user = await db.one('SELECT * FROM users WHERE username = $1', [username]);
  if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password, or account is inactive.' });
  }
  req.session.user = {
    id: user.id, username: user.username, role: user.role,
    full_name: user.full_name, must_change_password: !!user.must_change_password
  };
  res.json({ role: user.role, mustChangePassword: !!user.must_change_password });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

app.post('/api/auth/change-password', requireAuth, wrap(async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run(`UPDATE users SET password_hash = $1, must_change_password = 0, updated_at = ${NOW} WHERE id = $2`, [hash, req.session.user.id]);
  req.session.user = { ...req.session.user, must_change_password: false };
  res.json({ ok: true });
}));

// =========================================================
// ADMIN: ACCOUNT MANAGEMENT
// =========================================================
async function findOrCreateClass(label, c) {
  if (!label || !String(label).trim()) return null;
  const name = String(label).trim();
  const q = c || db.pool;
  const existing = (await q.query('SELECT id FROM classes WHERE name = $1 LIMIT 1', [name])).rows[0];
  if (existing) return existing.id;
  return (await q.query('INSERT INTO classes (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
}

app.post('/api/admin/accounts', requireRole('admin'), wrap(async (req, res) => {
  const { full_name, username, temp_password, role, subject, class_name, roll_no, guardian_name, guardian_contact, is_active } = req.body || {};
  if (!full_name || !username || !temp_password || !role) {
    return res.status(400).json({ error: 'Full name, username, temporary password, and role are required.' });
  }
  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, teacher, or student.' });
  }
  if (temp_password.length < 6) {
    return res.status(400).json({ error: 'Temporary password must be at least 6 characters.' });
  }
  const exists = await db.one('SELECT id FROM users WHERE username = $1', [username]);
  if (exists) return res.status(409).json({ error: 'That username is already taken.' });

  const hash = bcrypt.hashSync(temp_password, 10);
  try {
    const userId = await db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO users (username, password_hash, role, full_name, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
        [username, hash, role, full_name, is_active === false ? 0 : 1]);
      const id = r.rows[0].id;
      if (role === 'teacher') {
        await c.query('INSERT INTO teachers (user_id, full_name, subject) VALUES ($1, $2, $3)', [id, full_name, subject || 'Information coming soon']);
      } else if (role === 'student') {
        const classId = await findOrCreateClass(class_name, c);
        await c.query(
          `INSERT INTO students (user_id, full_name, class_id, roll_no, guardian_name, guardian_contact)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, full_name, classId, roll_no || null, guardian_name || null, guardian_contact || null]);
      }
      return id;
    });
    res.status(201).json({ id: userId });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That username or roll number is already taken.' });
    res.status(500).json({ error: 'Could not create the account.' });
  }
}));

app.get('/api/admin/accounts', requireRole('admin'), wrap(async (req, res) => {
  const { role, q } = req.query;
  let sql = `
    SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.must_change_password, u.created_at,
           t.subject AS teacher_subject,
           c.name AS student_class
    FROM users u
    LEFT JOIN teachers t ON t.user_id = u.id
    LEFT JOIN students s ON s.user_id = u.id
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE 1=1
  `;
  const params = [];
  if (role && ['admin', 'teacher', 'student'].includes(role)) {
    params.push(role); sql += ` AND u.role = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`); const n = params.length;
    sql += ` AND (u.full_name ILIKE $${n} OR u.username ILIKE $${n})`;
  }
  sql += ' ORDER BY u.created_at DESC, u.id DESC';
  res.json(await db.all(sql, params));
}));

app.put('/api/admin/accounts/:id', requireRole('admin'), wrap(async (req, res) => {
  const { full_name, username, subject, class_name, roll_no, guardian_name, guardian_contact } = req.body || {};
  const user = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  if (username && username !== user.username) {
    const clash = await db.one('SELECT id FROM users WHERE username = $1 AND id != $2', [username, user.id]);
    if (clash) return res.status(409).json({ error: 'That username is already taken.' });
  }

  try {
    await db.tx(async (c) => {
      await c.query(
        `UPDATE users SET full_name = COALESCE($1, full_name), username = COALESCE($2, username), updated_at = ${NOW} WHERE id = $3`,
        [full_name || null, username || null, user.id]);
      if (user.role === 'teacher' && subject !== undefined) {
        await c.query('UPDATE teachers SET subject = $1, full_name = COALESCE($2, full_name) WHERE user_id = $3',
          [subject, full_name || null, user.id]);
      }
      if (user.role === 'student') {
        const classId = class_name !== undefined ? await findOrCreateClass(class_name, c) : null;
        await c.query(
          `UPDATE students SET
             class_id = COALESCE($1, class_id),
             full_name = COALESCE($2, full_name),
             roll_no = COALESCE($3, roll_no),
             guardian_name = COALESCE($4, guardian_name),
             guardian_contact = COALESCE($5, guardian_contact)
           WHERE user_id = $6`,
          [classId, full_name || null, roll_no || null, guardian_name || null, guardian_contact || null, user.id]);
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the account.' });
  }
}));

app.patch('/api/admin/accounts/:id/status', requireRole('admin'), wrap(async (req, res) => {
  const { is_active } = req.body || {};
  const r = await db.run(`UPDATE users SET is_active = $1, updated_at = ${NOW} WHERE id = $2`, [is_active ? 1 : 0, req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true });
}));

app.patch('/api/admin/accounts/:id/reset-password', requireRole('admin'), wrap(async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  const r = await db.run(`UPDATE users SET password_hash = $1, must_change_password = 1, updated_at = ${NOW} WHERE id = $2`, [hash, req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true });
}));

app.get('/api/admin/classes', requireRole('admin'), wrap(async (req, res) => {
  res.json(await db.all('SELECT id, name FROM classes ORDER BY name'));
}));

app.get('/api/admin/teachers', requireRole('admin'), wrap(async (req, res) => {
  res.json(await db.all(`
    SELECT t.id, t.full_name, t.subject FROM teachers t
    JOIN users u ON u.id = t.user_id WHERE u.is_active = 1 ORDER BY t.full_name
  `));
}));

app.get('/api/admin/class-assignments', requireRole('admin'), wrap(async (req, res) => {
  res.json(await db.all(`
    SELECT cts.id, t.full_name AS teacher_name, c.name AS class_name, cts.subject
    FROM class_teacher_subject cts
    JOIN teachers t ON t.id = cts.teacher_id
    JOIN classes c ON c.id = cts.class_id
    ORDER BY c.name, cts.subject
  `));
}));

app.post('/api/admin/class-assignments', requireRole('admin'), wrap(async (req, res) => {
  const { teacher_id, class_name, subject } = req.body || {};
  if (!teacher_id || !class_name || !subject) {
    return res.status(400).json({ error: 'teacher_id, class_name, and subject are required.' });
  }
  try {
    const classId = await findOrCreateClass(class_name);
    const r = await db.one('INSERT INTO class_teacher_subject (class_id, teacher_id, subject) VALUES ($1, $2, $3) RETURNING id',
      [classId, teacher_id, subject]);
    res.status(201).json({ id: r.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the assignment.' });
  }
}));

app.delete('/api/admin/class-assignments/:id', requireRole('admin'), wrap(async (req, res) => {
  const r = await db.run('DELETE FROM class_teacher_subject WHERE id = $1', [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

// =========================================================
// ADMISSIONS
// =========================================================
async function nextApplicationId() {
  const year = new Date().getFullYear();
  const row = await db.one(
    `SELECT COALESCE(MAX(CAST(split_part(application_id, '-', 3) AS INTEGER)), 0) + 1 AS n
     FROM admissions WHERE application_id LIKE $1`, [`LM-${year}-%`]);
  return `LM-${year}-${String(row.n).padStart(4, '0')}`;
}

app.post('/api/admissions',
  handleUpload(upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'document', maxCount: 1 }])),
  wrap(async (req, res) => {
    const b = req.body || {};
    const required = ['student_name', 'dob', 'gender', 'class_applied_for', 'guardian_name', 'guardian_relationship', 'guardian_contact', 'home_address'];
    for (const field of required) {
      if (!b[field] || !String(b[field]).trim()) return res.status(400).json({ error: `Missing required field: ${field}` });
    }

    let photoPath = null, documentPath = null;
    try {
      if (req.files?.photo?.[0]) photoPath = await saveFile(req.files.photo[0], 'admissions');
      if (req.files?.document?.[0]) documentPath = await saveFile(req.files.document[0], 'admissions');
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not upload the files. Please try again or submit without files.' });
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const applicationId = await nextApplicationId();
      try {
        await db.run(`
          INSERT INTO admissions (application_id, student_name, dob, gender, previous_school, class_applied_for,
            guardian_name, guardian_relationship, guardian_contact, guardian_email, home_address, additional_info,
            photo_path, document_path, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')`,
          [applicationId, b.student_name, b.dob, b.gender, b.previous_school || null, b.class_applied_for,
           b.guardian_name, b.guardian_relationship, b.guardian_contact, b.guardian_email || null,
           b.home_address, b.additional_info || null, photoPath, documentPath]);
        return res.status(201).json({ applicationId, status: 'pending' });
      } catch (err) {
        if (err.code === '23505' && attempt < 3) continue; // two applications at the same moment: retry
        console.error(err);
        return res.status(500).json({ error: 'Could not save application. Please try again.' });
      }
    }
  }));

app.get('/api/admissions', requireRole('admin'), wrap(async (req, res) => {
  const { status, q } = req.query;
  let sql = 'SELECT * FROM admissions WHERE 1=1';
  const params = [];
  if (status && ['pending', 'approved', 'rejected'].includes(status)) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (q) {
    params.push(`%${q}%`); const n = params.length;
    sql += ` AND (student_name ILIKE $${n} OR application_id ILIKE $${n} OR guardian_name ILIKE $${n})`;
  }
  sql += ' ORDER BY submitted_at DESC, id DESC';
  res.json(await db.all(sql, params));
}));

app.get('/api/admissions/:id', requireRole('admin'), wrap(async (req, res) => {
  const row = await db.one('SELECT * FROM admissions WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

app.patch('/api/admissions/:id', requireRole('admin'), wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const r = await db.run(`UPDATE admissions SET status = $1, decided_at = ${NOW}, decided_by = $2 WHERE id = $3`,
    [status, req.session.user.id, req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, status });
}));

app.delete('/api/admissions/:id', requireRole('admin'), wrap(async (req, res) => {
  const row = await db.one('DELETE FROM admissions WHERE id = $1 RETURNING photo_path, document_path', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { deleteFile } = require('./storage');
  await deleteFile(row.photo_path); await deleteFile(row.document_path);
  res.json({ ok: true });
}));

// =========================================================
// ANNOUNCEMENTS
// =========================================================
app.get('/api/announcements', wrap(async (req, res) => {
  res.json(await db.all(`
    SELECT id, title, body, audience, posted_by, announcement_date
    FROM announcements WHERE is_published = 1 AND audience = 'all' ORDER BY announcement_date DESC, id DESC
  `));
}));

app.get('/api/dashboard/announcements', requireAuth, wrap(async (req, res) => {
  const u = req.session.user;
  let rows;
  if (u.role === 'admin') {
    rows = await db.all('SELECT * FROM announcements ORDER BY announcement_date DESC, id DESC');
  } else if (u.role === 'teacher') {
    rows = await db.all(`SELECT * FROM announcements WHERE is_published = 1 AND audience IN ('all','teachers')
      ORDER BY announcement_date DESC, id DESC`);
  } else {
    const student = await db.one(
      'SELECT c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.user_id = $1', [u.id]);
    const className = student?.class_name;
    rows = await db.all(`SELECT * FROM announcements WHERE is_published = 1 AND (audience IN ('all','students') OR audience = $1)
      ORDER BY announcement_date DESC, id DESC`, [`class:${className || '__none__'}`]);
  }
  res.json(rows);
}));

app.get('/api/announcements/all', requireRole('admin'), wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM announcements ORDER BY created_at DESC, id DESC'));
}));

app.post('/api/announcements', requireRole('admin'), wrap(async (req, res) => {
  const { title, body, audience, posted_by, announcement_date, is_published } = req.body || {};
  if (!title || !body || !posted_by) return res.status(400).json({ error: 'title, body, and posted_by are required' });
  const r = await db.one(`
    INSERT INTO announcements (title, body, audience, posted_by, announcement_date, is_published)
    VALUES ($1, $2, $3, $4, COALESCE($5::text, ${NOW}), $6) RETURNING id`,
    [title, body, audience || 'all', posted_by, announcement_date || null, is_published ? 1 : 0]);
  res.status(201).json({ id: r.id });
}));

app.post('/api/teacher/announcements', requireRole('teacher'), wrap(async (req, res) => {
  const { title, body, audience } = req.body || {};
  if (!title || !body || !audience) return res.status(400).json({ error: 'title, body, and audience are required' });
  if (audience !== 'students' && !audience.startsWith('class:')) {
    return res.status(403).json({ error: "Teachers may only post to 'students' or a specific class." });
  }
  const r = await db.one(`
    INSERT INTO announcements (title, body, audience, posted_by, announcement_date, is_published)
    VALUES ($1, $2, $3, $4, ${NOW}, 1) RETURNING id`, [title, body, audience, req.session.user.full_name]);
  res.status(201).json({ id: r.id });
}));

app.put('/api/announcements/:id', requireRole('admin'), wrap(async (req, res) => {
  const { title, body, audience, posted_by, announcement_date } = req.body || {};
  const r = await db.run(`
    UPDATE announcements SET title = $1, body = $2, audience = $3, posted_by = $4, announcement_date = $5, updated_at = ${NOW} WHERE id = $6`,
    [title, body, audience, posted_by, announcement_date, req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

app.patch('/api/announcements/:id/publish', requireRole('admin'), wrap(async (req, res) => {
  const { is_published } = req.body || {};
  const r = await db.run(`UPDATE announcements SET is_published = $1, updated_at = ${NOW} WHERE id = $2`, [is_published ? 1 : 0, req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

app.delete('/api/announcements/:id', requireRole('admin'), wrap(async (req, res) => {
  const r = await db.run('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

// =========================================================
// TEACHER DASHBOARD DATA
// =========================================================
app.get('/api/teacher/me', requireRole('teacher'), wrap(async (req, res) => {
  const t = await db.one('SELECT * FROM teachers WHERE user_id = $1', [req.session.user.id]);
  const classes = await db.all(`
    SELECT cts.subject, c.name AS class_name FROM class_teacher_subject cts
    JOIN classes c ON c.id = cts.class_id WHERE cts.teacher_id = $1`, [t?.id || -1]);
  res.json({ ...req.session.user, teacher: t || null, classes });
}));

app.put('/api/teacher/me', requireRole('teacher'), wrap(async (req, res) => {
  const { bio } = req.body || {};
  await db.run('UPDATE teachers SET bio = $1 WHERE user_id = $2', [bio || null, req.session.user.id]);
  res.json({ ok: true });
}));

app.get('/api/teacher/students', requireRole('teacher'), wrap(async (req, res) => {
  const t = await db.one('SELECT id FROM teachers WHERE user_id = $1', [req.session.user.id]);
  if (!t) return res.json([]);
  res.json(await db.all(`
    SELECT DISTINCT s.id, s.full_name, s.roll_no, c.name AS class_name
    FROM class_teacher_subject cts
    JOIN classes c ON c.id = cts.class_id
    JOIN students s ON s.class_id = c.id
    WHERE cts.teacher_id = $1
    ORDER BY c.name, s.full_name`, [t.id]));
}));

// =========================================================
// STUDENT DASHBOARD DATA
// =========================================================
app.get('/api/student/me', requireRole('student'), wrap(async (req, res) => {
  const s = await db.one(
    'SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.user_id = $1',
    [req.session.user.id]);
  res.json({ ...req.session.user, student: s || null });
}));

// =========================================================
// DYNAMIC SITE CONTENT (principal, teacher profiles, gallery)
// =========================================================
app.use(require('../routes/content')({ requireRole, wrap }));

// Unknown API route -> JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler: always answer with JSON, never a crash page.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Server error. Please try again.' });
});

module.exports = app;
