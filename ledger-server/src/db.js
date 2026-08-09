/**
 * Minimal file-backed data store.
 *
 * This keeps the scaffold dependency-free and easy to run anywhere. It is
 * fine for a demo / small deployment, but for real production traffic swap
 * this module out for a proper database (Postgres, MySQL, SQLite via a
 * driver, etc.) — the functions below are the only thing you'd need to
 * reimplement; nothing else in the app talks to the file directly.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function readRaw() {
  if (!fs.existsSync(DB_PATH)) {
    return { accounts: [], pendingVerifications: [], conversations: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!data.conversations) data.conversations = {};
    return data;
  } catch (e) {
    console.error('Failed to read db.json, starting fresh:', e.message);
    return { accounts: [], pendingVerifications: [], conversations: {} };
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------------- accounts (verified users) ----------------

function findAccountByEmail(email) {
  const db = readRaw();
  return db.accounts.find(a => a.email.toLowerCase() === email.toLowerCase()) || null;
}

function createAccount({ name, email, passwordHash, role }) {
  const db = readRaw();
  const account = {
    id: 'acct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: role || 'jobseeker',
    verified: true,
    createdAt: new Date().toISOString(),
  };
  db.accounts.push(account);
  writeRaw(db);
  return account;
}

function findAccountById(id) {
  const db = readRaw();
  return db.accounts.find(a => a.id === id) || null;
}

function updateAccountRole(id, role) {
  const db = readRaw();
  const account = db.accounts.find(a => a.id === id);
  if (account) {
    account.role = role;
    writeRaw(db);
  }
  return account || null;
}

// ---------------- pending signups (awaiting email verification) ----------------

function getPending(email) {
  const db = readRaw();
  return db.pendingVerifications.find(p => p.email.toLowerCase() === email.toLowerCase()) || null;
}

function upsertPending(entry) {
  const db = readRaw();
  const idx = db.pendingVerifications.findIndex(
    p => p.email.toLowerCase() === entry.email.toLowerCase()
  );
  if (idx >= 0) db.pendingVerifications[idx] = entry;
  else db.pendingVerifications.push(entry);
  writeRaw(db);
}

function deletePending(email) {
  const db = readRaw();
  db.pendingVerifications = db.pendingVerifications.filter(
    p => p.email.toLowerCase() !== email.toLowerCase()
  );
  writeRaw(db);
}

// ---------------- messages (jobseeker <-> admin, one thread per jobseeker) ----------------

function ensureConversation(account) {
  const db = readRaw();
  let conv = db.conversations[account.id];
  if (!conv) {
    conv = {
      accountId: account.id,
      name: account.name,
      email: account.email,
      messages: [],
      unreadForAdmin: 0,
      unreadForUser: 0,
      updatedAt: new Date().toISOString(),
    };
    db.conversations[account.id] = conv;
    writeRaw(db);
  }
  return conv;
}

function getConversation(accountId) {
  const db = readRaw();
  return db.conversations[accountId] || null;
}

function listConversations() {
  const db = readRaw();
  return Object.values(db.conversations).sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

// sender: 'user' | 'admin'. accountMeta: { name, email } — used to create the
// conversation on first contact if it doesn't exist yet.
function addMessage(accountId, accountMeta, sender, text) {
  const db = readRaw();
  let conv = db.conversations[accountId];
  if (!conv) {
    conv = {
      accountId,
      name: accountMeta.name,
      email: accountMeta.email,
      messages: [],
      unreadForAdmin: 0,
      unreadForUser: 0,
      updatedAt: new Date().toISOString(),
    };
    db.conversations[accountId] = conv;
  }
  const msg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    sender,
    text,
    at: new Date().toISOString(),
  };
  conv.messages.push(msg);
  conv.updatedAt = msg.at;
  if (sender === 'user') conv.unreadForAdmin = (conv.unreadForAdmin || 0) + 1;
  else conv.unreadForUser = (conv.unreadForUser || 0) + 1;
  writeRaw(db);
  return msg;
}

// who: 'admin' | 'user' — clears the *other* side's unread count for them.
function markRead(accountId, who) {
  const db = readRaw();
  const conv = db.conversations[accountId];
  if (!conv) return;
  if (who === 'admin') conv.unreadForAdmin = 0;
  else conv.unreadForUser = 0;
  writeRaw(db);
}

module.exports = {
  findAccountByEmail,
  findAccountById,
  createAccount,
  updateAccountRole,
  getPending,
  upsertPending,
  deletePending,
  ensureConversation,
  getConversation,
  listConversations,
  addMessage,
  markRead,
};
