require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { router: authRoutes, requireAuth, requireAdmin } = require('./auth');
const createMessagesRouter = require('./messages');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/messages', createMessagesRouter(requireAuth, requireAdmin));

// Serve the static PrimeSphere site (index.html, jobs.html, css/, js/, etc.)
// which lives one directory up from this ledger-server folder. This makes
// the same Node app answer both the site itself and the /api/* routes, so
// Hostinger only needs the one app to serve the whole domain.
const SITE_ROOT = path.join(__dirname, '..', '..');
app.use(express.static(SITE_ROOT));

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 4000;

// Check the database connection before accepting traffic, but don't let a
// bad/missing Supabase config take the whole site down — the static pages
// should still load even if the API can't reach the database yet. API
// routes that need the database will simply return their own 500 errors
// (auth.js / messages.js already catch and report those individually).
db.initDb()
  .then(() => {
    console.log('Connected to the database.');
  })
  .catch(err => {
    console.error('⚠️  Could not connect to the database:', err.message);
    console.error('   Check SUPABASE_URL / SUPABASE_KEY, and make sure schema.sql');
    console.error('   has been run in your Supabase project\'s SQL Editor.');
    console.error('   The site will still serve static pages, but signup/login/messages will fail.');
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Ledger server listening on http://localhost:${PORT}`);
      if (!process.env.RESEND_API_KEY) {
        console.warn('⚠️  RESEND_API_KEY is not set — signup emails will fail to send.');
      }
      if (!process.env.JWT_SECRET) {
        console.warn('⚠️  JWT_SECRET is not set — set one before deploying.');
      }
      if (!process.env.ADMIN_EMAILS) {
        console.warn('⚠️  ADMIN_EMAILS is not set — nobody will have admin access to the message inbox.');
      }
    });
  });
