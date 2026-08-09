require('dotenv').config();

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

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 4000;

// Create tables (if they don't already exist) before accepting traffic, so
// a fresh database is ready to go without any manual SQL step.
db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Ledger auth server listening on http://localhost:${PORT}`);
      console.log('Connected to the database.');
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
  })
  .catch(err => {
    console.error('❌ Could not connect to the database:', err.message);
    console.error('   Check SUPABASE_URL / SUPABASE_KEY in your .env file, and make sure');
    console.error('   schema.sql has been run in your Supabase project\'s SQL Editor.');
    process.exit(1);
  });
