/**
 * Supabase-backed data store.
 *
 * Replaces the old file-backed JSON store (data/db.json) with real tables
 * in a Supabase (Postgres) database — the database Hostinger's "Connect
 * Database -> Supabase" flow wires up for you.
 *
 * Hostinger injects SUPABASE_URL and SUPABASE_KEY into your app's
 * environment automatically once you connect a Supabase project from the
 * Node.js app dashboard (Essentials -> Database -> Connect). Locally, copy
 * those same two values into .env (see .env.example) — find them in your
 * Supabase project under Project Settings -> API.
 *
 * IMPORTANT: this app does its own auth (bcrypt + JWT) rather than using
 * Supabase Auth, so the four tables below need Row Level Security turned
 * OFF (or a service_role key) so this server can read/write them freely.
 * schema.sql does that for you — run it once in the Supabase SQL Editor
 * before starting the server.
 *
 * Every exported function is async — call sites use `await db.something(...)`.
 */
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function throwIfError(error, context) {
  if (error) {
    throw new Error(`Supabase error (${context}): ${error.message}`);
  }
}

// initDb() only checks the connection/tables are reachable — unlike the old
// MySQL version, table creation happens once via schema.sql in the Supabase
// SQL Editor, not automatically on every boot (the JS client can't run DDL).
async function initDb() {
  const { error } = await supabase.from('accounts').select('id').limit(1);
  if (error) {
    throw new Error(
      `Could not read the "accounts" table (${error.message}). ` +
      `Make sure you ran schema.sql in your Supabase project's SQL Editor, ` +
      `and that SUPABASE_URL / SUPABASE_KEY are set correctly.`
    );
  }
}

// ---------------- accounts (verified users) ----------------

async function findAccountByEmail(email) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  throwIfError(error, 'findAccountByEmail');
  return data ? rowToAccount(data) : null;
}

async function createAccount({ name, email, passwordHash, role }) {
  const account = {
    id: newId('acct'),
    name,
    email: email.toLowerCase(),
    password_hash: passwordHash,
    role: role || 'jobseeker',
    verified: true,
  };
  const { data, error } = await supabase.from('accounts').insert(account).select().single();
  throwIfError(error, 'createAccount');
  return rowToAccount(data);
}

async function findAccountById(id) {
  const { data, error } = await supabase.from('accounts').select('*').eq('id', id).maybeSingle();
  throwIfError(error, 'findAccountById');
  return data ? rowToAccount(data) : null;
}

async function updateAccountRole(id, role) {
  const { data, error } = await supabase
    .from('accounts')
    .update({ role })
    .eq('id', id)
    .select()
    .maybeSingle();
  throwIfError(error, 'updateAccountRole');
  return data ? rowToAccount(data) : null;
}

function rowToAccount(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    verified: !!row.verified,
    createdAt: row.created_at,
  };
}

// ---------------- pending signups (awaiting email verification) ----------------

async function getPending(email) {
  const { data, error } = await supabase
    .from('pending_verifications')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  throwIfError(error, 'getPending');
  if (!data) return null;
  return {
    email: data.email,
    name: data.name,
    passwordHash: data.password_hash,
    code: data.code,
    attempts: data.attempts,
    expiresAt: Number(data.expires_at),
    lastSentAt: Number(data.last_sent_at),
  };
}

async function upsertPending(entry) {
  const row = {
    email: entry.email.toLowerCase(),
    name: entry.name,
    password_hash: entry.passwordHash,
    code: entry.code,
    attempts: entry.attempts || 0,
    expires_at: entry.expiresAt,
    last_sent_at: entry.lastSentAt,
  };
  const { error } = await supabase.from('pending_verifications').upsert(row, { onConflict: 'email' });
  throwIfError(error, 'upsertPending');
}

async function deletePending(email) {
  const { error } = await supabase.from('pending_verifications').delete().eq('email', email.toLowerCase());
  throwIfError(error, 'deletePending');
}

// ---------------- messages (jobseeker <-> admin, one thread per jobseeker) ----------------

async function ensureConversation(account) {
  let conv = await getConversation(account.id);
  if (!conv) {
    const { error } = await supabase
      .from('conversations')
      .upsert(
        { account_id: account.id, name: account.name, email: account.email },
        { onConflict: 'account_id', ignoreDuplicates: true }
      );
    throwIfError(error, 'ensureConversation');
    conv = await getConversation(account.id);
  }
  return conv;
}

async function getConversation(accountId) {
  const { data: convRow, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  throwIfError(error, 'getConversation');
  if (!convRow) return null;

  const { data: msgRows, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('account_id', accountId)
    .order('at', { ascending: true });
  throwIfError(msgError, 'getConversation:messages');

  return rowToConversation(convRow, msgRows || []);
}

async function listConversations() {
  const { data: convRows, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false });
  throwIfError(error, 'listConversations');

  const conversations = [];
  for (const row of convRows || []) {
    const { data: msgRows, error: msgError } = await supabase
      .from('messages')
      .select('*')
      .eq('account_id', row.account_id)
      .order('at', { ascending: true });
    throwIfError(msgError, 'listConversations:messages');
    conversations.push(rowToConversation(row, msgRows || []));
  }
  return conversations;
}

function rowToConversation(row, msgRows) {
  return {
    accountId: row.account_id,
    name: row.name,
    email: row.email,
    messages: msgRows.map(m => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      at: m.at,
    })),
    unreadForAdmin: row.unread_for_admin || 0,
    unreadForUser: row.unread_for_user || 0,
    updatedAt: row.updated_at,
  };
}

// sender: 'user' | 'admin'. accountMeta: { name, email } — used to create the
// conversation on first contact if it doesn't exist yet.
async function addMessage(accountId, accountMeta, sender, text) {
  const { error: upsertError } = await supabase
    .from('conversations')
    .upsert(
      { account_id: accountId, name: accountMeta.name, email: accountMeta.email },
      { onConflict: 'account_id', ignoreDuplicates: true }
    );
  throwIfError(upsertError, 'addMessage:ensureConversation');

  const nowIso = new Date().toISOString();
  const msg = { id: newId('msg'), account_id: accountId, sender, text, at: nowIso };
  const { error: insertError } = await supabase.from('messages').insert(msg);
  throwIfError(insertError, 'addMessage:insert');

  const unreadColumn = sender === 'user' ? 'unread_for_admin' : 'unread_for_user';
  const { data: current, error: readError } = await supabase
    .from('conversations')
    .select(unreadColumn)
    .eq('account_id', accountId)
    .maybeSingle();
  throwIfError(readError, 'addMessage:readUnread');

  const { error: updateError } = await supabase
    .from('conversations')
    .update({ [unreadColumn]: (current ? current[unreadColumn] : 0) + 1, updated_at: nowIso })
    .eq('account_id', accountId);
  throwIfError(updateError, 'addMessage:updateUnread');

  return { id: msg.id, sender: msg.sender, text: msg.text, at: msg.at };
}

// who: 'admin' | 'user' — clears the *other* side's unread count for them.
async function markRead(accountId, who) {
  const column = who === 'admin' ? 'unread_for_admin' : 'unread_for_user';
  const { error } = await supabase.from('conversations').update({ [column]: 0 }).eq('account_id', accountId);
  throwIfError(error, 'markRead');
}

module.exports = {
  supabase,
  initDb,
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
