const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const { sendVerificationEmail } = require('./email');

const router = express.Router();

const CODE_TTL_MS = Number(process.env.CODE_TTL_MINUTES || 10) * 60 * 1000;
const RESEND_COOLDOWN_MS = Number(process.env.CODE_RESEND_COOLDOWN_SECONDS || 45) * 1000;
const MAX_ATTEMPTS = Number(process.env.CODE_MAX_ATTEMPTS || 5);

// A reasonably strict, practical email regex (not a full RFC 5322 parser,
// but enough to reject obviously malformed input like "bob@" or "bob").
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Emails listed here (comma-separated in ADMIN_EMAILS) get the 'admin' role
// automatically on signup/login — that's what lets them see the admin inbox
// and reply to jobseekers. Anyone else is a plain 'jobseeker'.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

function signToken(account) {
  return jwt.sign(
    { sub: account.id, email: account.email, name: account.name, role: account.role || 'jobseeker' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    verified: account.verified,
    role: account.role || 'jobseeker',
  };
}

// Limit brute-force / spam on the sensitive endpoints. Tune to taste.
const startLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

/**
 * POST /api/auth/signup/start
 * body: { name, email, password }
 * Validates input, makes sure the email isn't already a verified account,
 * generates a code, emails it, and stashes a pending signup (with a
 * bcrypt-hashed password — never store or email plaintext passwords).
 */
router.post('/signup/start', startLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name) return res.status(400).json({ error: 'Full name is required.' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await db.findAccountByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists. Log in instead.' });
    }

    const pending = await db.getPending(email);
    if (pending && Date.now() - pending.lastSentAt < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - pending.lastSentAt)) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSec}s before requesting another code.` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const code = generateCode();

    await sendVerificationEmail(email, code);

    await db.upsertPending({
      email,
      name,
      passwordHash,
      code,
      attempts: 0,
      expiresAt: Date.now() + CODE_TTL_MS,
      lastSentAt: Date.now(),
    });

    return res.json({ message: 'Verification code sent.', email });
  } catch (err) {
    console.error('signup/start error:', err);
    return res.status(500).json({ error: 'Could not send verification email. Try again shortly.' });
  }
});

/**
 * POST /api/auth/signup/resend
 * body: { email }
 */
router.post('/signup/resend', startLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pending = await db.getPending(email);
    if (!pending) return res.status(404).json({ error: 'No pending signup for that email. Start again.' });

    if (Date.now() - pending.lastSentAt < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - pending.lastSentAt)) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSec}s before requesting another code.` });
    }

    const code = generateCode();
    await sendVerificationEmail(email, code);

    await db.upsertPending({
      ...pending,
      code,
      attempts: 0,
      expiresAt: Date.now() + CODE_TTL_MS,
      lastSentAt: Date.now(),
    });

    return res.json({ message: 'Verification code resent.' });
  } catch (err) {
    console.error('signup/resend error:', err);
    return res.status(500).json({ error: 'Could not resend verification email. Try again shortly.' });
  }
});

/**
 * POST /api/auth/signup/verify
 * body: { email, code }
 * Only creates the account once the code matches and hasn't expired —
 * this is the step that actually confirms the address is real and owned
 * by whoever is signing up.
 */
router.post('/signup/verify', verifyLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    const pending = await db.getPending(email);
    if (!pending) return res.status(404).json({ error: 'No pending signup for that email. Start again.' });

    if (Date.now() > pending.expiresAt) {
      await db.deletePending(email);
      return res.status(410).json({ error: 'That code expired. Request a new one.' });
    }

    if (pending.attempts >= MAX_ATTEMPTS) {
      await db.deletePending(email);
      return res.status(429).json({ error: 'Too many incorrect attempts. Start signup again.' });
    }

    if (code !== pending.code) {
      await db.upsertPending({ ...pending, attempts: pending.attempts + 1 });
      return res.status(400).json({ error: 'Incorrect code. Check your email and try again.' });
    }

    const account = await db.createAccount({
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
      role: isAdminEmail(pending.email) ? 'admin' : 'jobseeker',
    });
    await db.deletePending(email);

    const token = signToken(account);
    return res.json({ token, account: publicAccount(account) });
  } catch (err) {
    console.error('signup/verify error:', err);
    return res.status(500).json({ error: 'Could not verify code. Try again.' });
  }
});

/**
 * POST /api/auth/login
 * body: { email, password }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const account = await db.findAccountByEmail(email);
    if (!account) return res.status(401).json({ error: 'Incorrect email or password.' });

    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    // Keep role in sync with ADMIN_EMAILS in case it changed since this
    // account was created (e.g. an existing account was just made an admin).
    const effectiveRole = isAdminEmail(account.email) ? 'admin' : (account.role || 'jobseeker');
    if (effectiveRole !== account.role) {
      await db.updateAccountRole(account.id, effectiveRole);
      account.role = effectiveRole;
    }

    const token = signToken(account);
    return res.json({ token, account: publicAccount(account) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Could not log in. Try again.' });
  }
});

/**
 * GET /api/auth/me
 * header: Authorization: Bearer <token>
 */
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const account = await db.findAccountByEmail(payload.email);
    if (!account) return res.status(401).json({ error: 'Account no longer exists.' });
    return res.json({ account: publicAccount(account) });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
});

/**
 * Middleware: requires a valid Bearer token. Attaches the decoded payload
 * ({ sub, email, name, role }) to req.account. Used to protect the
 * messaging endpoints (and anything else that needs a logged-in user).
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.account = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

/**
 * Middleware: requires a valid token AND role === 'admin'. Used to protect
 * the admin inbox endpoints so jobseekers can't read other people's threads.
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.account.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

module.exports = { router, requireAuth, requireAdmin, isAdminEmail };
