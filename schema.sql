-- PrimeSphere / Ledger auth server — Supabase (Postgres) schema
--
-- Run this once in your Supabase project's SQL Editor (Supabase dashboard ->
-- SQL Editor -> New query -> paste this whole file -> Run) before starting
-- the server. Unlike the old MySQL setup, the Node app can't create tables
-- for you automatically (the supabase-js client only reads/writes rows), so
-- this step is required.
--
-- This app does its own authentication (bcrypt password hashing + JWTs) —
-- it does NOT use Supabase Auth — so these tables must have Row Level
-- Security OFF (the ALTER TABLE ... DISABLE ROW LEVEL SECURITY lines below)
-- and the server must connect with the service_role key, not the anon key.
-- Otherwise Supabase's default policies will silently block every read and
-- write this server tries to make.

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'jobseeker',
  verified      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_verifications (
  email          TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  code           TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  expires_at     BIGINT NOT NULL,
  last_sent_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  account_id        TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  unread_for_admin  INTEGER NOT NULL DEFAULT 0,
  unread_for_user   INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES conversations(account_id) ON DELETE CASCADE,
  sender      TEXT NOT NULL,
  text        TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_verifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
