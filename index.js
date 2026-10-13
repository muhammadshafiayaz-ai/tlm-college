// PostgreSQL (Neon / Vercel Postgres / Supabase - any Postgres works).
// Set DATABASE_URL (or POSTGRES_URL) in the environment.
const { Pool } = require('pg');
const schema = require('./schema');
const NOW = schema.NOW;

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!raw) console.error('WARNING: DATABASE_URL is not set. Database calls will fail.');

function buildConfig() {
  if (!raw) return {};
  let local = /localhost|127\.0\.0\.1/.test(raw);
  let cs = raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    cs = u.toString();
  } catch (e) { /* leave as is */ }
  return { connectionString: cs, ssl: local ? false : { rejectUnauthorized: false } };
}

const pool = new Pool({ ...buildConfig(), max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
pool.on('error', (e) => console.error('pg pool error', e.message));

const all = async (sql, params = []) => (await pool.query(sql, params)).rows;
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const run = (sql, params = []) => pool.query(sql, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally { client.release(); }
}

// Create tables + one-time seed. Runs once per server instance.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(7270001)'); // avoid races between cold starts
        await client.query(schema);
        const seeded = await client.query(`SELECT value FROM content_meta WHERE key = 'seeded_v1'`);
        if (!seeded.rows.length) {
          await client.query('BEGIN');
          await client.query(`INSERT INTO principal (id, name, title, message) VALUES (1, $1, $2, '') ON CONFLICT (id) DO NOTHING`,
            ['Sir Hader', 'Principal, The Learning Minds Higher Secondary School']);
          const staff = [
            ['Sir Saddam', 'Mathematics Teacher'],
            ['Sir Bashir', 'Physics Teacher'],
            ['Sir Babar', 'Islamiat & Computer Science Teacher'],
            ['Sir Nowroz', 'Urdu Teacher'],
            ['Sir Nake Alam', 'Computer Science Teacher']
          ];
          for (let i = 0; i < staff.length; i++) {
            await client.query(`INSERT INTO staff_profiles (name, designation, bio, sort_order) VALUES ($1, $2, '', $3)`, [staff[i][0], staff[i][1], i + 1]);
          }
          await client.query(`INSERT INTO content_meta (key, value) VALUES ('seeded_v1', '1') ON CONFLICT (key) DO NOTHING`);
          await client.query('COMMIT');
        }
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        readyPromise = null; // retry on next request
        throw e;
      } finally {
        try { await client.query('SELECT pg_advisory_unlock(7270001)'); } catch (_) {}
        client.release();
      }
    })();
  }
  return readyPromise;
}

module.exports = { pool, all, one, run, tx, ready, NOW };
