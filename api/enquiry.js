// Serverless API for commission enquiries.
// POST  /api/enquiry           -> save a new enquiry (public, from the contact form)
// GET   /api/enquiry?key=...   -> list all enquiries (admin only, password-gated)
const { createPool } = require('@vercel/postgres');

const pool = createPool({
  connectionString:
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL,
});

// Lazily create the table once per warm instance.
let ready;
function ensureTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS enquiries (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        brand      TEXT,
        email      TEXT NOT NULL,
        budget     TEXT,
        vision     TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
  return ready;
}

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b || '{}'); } catch { return {}; }
  }
  return b;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    if (!pool.options || !(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL)) {
      res.status(500).json({ error: 'Database is not configured yet.' });
      return;
    }

    await ensureTable();

    if (req.method === 'POST') {
      const { name, brand, email, budget, vision } = readBody(req);
      if (!name || !email) {
        res.status(400).json({ error: 'A name and email are required.' });
        return;
      }
      await pool.query(
        `INSERT INTO enquiries (name, brand, email, budget, vision)
         VALUES ($1, $2, $3, $4, $5)`,
        [String(name).slice(0, 200), brand ? String(brand).slice(0, 200) : null,
         String(email).slice(0, 200), budget ? String(budget).slice(0, 100) : null,
         vision ? String(vision).slice(0, 4000) : null]
      );
      res.status(201).json({ ok: true });
      return;
    }

    if (req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.replace(/^Bearer\s+/i, '') || (req.query && req.query.key) || '';
      if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { rows } = await pool.query(
        `SELECT id, name, brand, email, budget, vision, created_at
         FROM enquiries ORDER BY created_at DESC`
      );
      res.status(200).json({ enquiries: rows });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('enquiry api error:', e);
    res.status(500).json({ error: 'Something went wrong on our end.' });
  }
};
