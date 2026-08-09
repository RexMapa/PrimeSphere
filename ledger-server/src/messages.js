const express = require('express');
const db = require('./db');

const MAX_LEN = 4000;

/**
 * Messaging routes — one chat thread per jobseeker, with a single shared
 * admin inbox on the other side.
 *
 *   Jobseeker side:
 *     GET  /api/messages/mine                     -> my thread
 *     POST /api/messages                           -> send a message { text }
 *
 *   Admin side:
 *     GET  /api/messages/conversations              -> list of all threads
 *     GET  /api/messages/conversations/:accountId    -> one thread
 *     POST /api/messages/conversations/:accountId/reply  -> reply { text }
 *
 * Takes the requireAuth / requireAdmin middleware from auth.js so both
 * files share one JWT-verification implementation.
 */
module.exports = function createMessagesRouter(requireAuth, requireAdmin) {
  const router = express.Router();

  function serializeConversation(conv) {
    return {
      accountId: conv.accountId,
      name: conv.name,
      email: conv.email,
      messages: conv.messages,
      unreadForAdmin: conv.unreadForAdmin || 0,
      unreadForUser: conv.unreadForUser || 0,
      updatedAt: conv.updatedAt,
    };
  }

  // ---------------- jobseeker side ----------------

  router.get('/mine', requireAuth, async (req, res) => {
    try {
      const account = { id: req.account.sub, name: req.account.name, email: req.account.email };
      const conv = await db.ensureConversation(account);
      await db.markRead(account.id, 'user');
      return res.json({ conversation: serializeConversation(conv) });
    } catch (err) {
      console.error('GET /messages/mine error:', err);
      return res.status(500).json({ error: 'Could not load conversation.' });
    }
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const text = String((req.body && req.body.text) || '').trim();
      if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
      if (text.length > MAX_LEN) return res.status(400).json({ error: 'Message is too long.' });

      const account = { id: req.account.sub, name: req.account.name, email: req.account.email };
      const msg = await db.addMessage(account.id, account, 'user', text);
      return res.json({ message: msg });
    } catch (err) {
      console.error('POST /messages error:', err);
      return res.status(500).json({ error: 'Could not send message.' });
    }
  });

  // ---------------- admin side ----------------

  router.get('/conversations', requireAdmin, async (req, res) => {
    try {
      const list = (await db.listConversations()).map(c => ({
        accountId: c.accountId,
        name: c.name,
        email: c.email,
        lastMessage: c.messages.length ? c.messages[c.messages.length - 1] : null,
        unreadForAdmin: c.unreadForAdmin || 0,
        updatedAt: c.updatedAt,
      }));
      return res.json({ conversations: list });
    } catch (err) {
      console.error('GET /messages/conversations error:', err);
      return res.status(500).json({ error: 'Could not load conversations.' });
    }
  });

  router.get('/conversations/:accountId', requireAdmin, async (req, res) => {
    try {
      const conv = await db.getConversation(req.params.accountId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      await db.markRead(req.params.accountId, 'admin');
      return res.json({ conversation: serializeConversation(conv) });
    } catch (err) {
      console.error('GET /messages/conversations/:accountId error:', err);
      return res.status(500).json({ error: 'Could not load conversation.' });
    }
  });

  router.post('/conversations/:accountId/reply', requireAdmin, async (req, res) => {
    try {
      const text = String((req.body && req.body.text) || '').trim();
      if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
      if (text.length > MAX_LEN) return res.status(400).json({ error: 'Message is too long.' });

      const conv = await db.getConversation(req.params.accountId);
      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found. The jobseeker must message in first.' });
      }

      const msg = await db.addMessage(req.params.accountId, { name: conv.name, email: conv.email }, 'admin', text);
      return res.json({ message: msg });
    } catch (err) {
      console.error('POST /messages/conversations/:accountId/reply error:', err);
      return res.status(500).json({ error: 'Could not send reply.' });
    }
  });

  return router;
};
