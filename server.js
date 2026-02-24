// server.js — ToolFlix API (Render + Postgres) — COMPLETO
// ✅ Games + Tokens + Premium
// ✅ Login (nick+senha) + JWT 30 dias
// ✅ XP sincronizado via /api/add-xp
// ✅ CHAT 7 dias
// ✅ MASTER ACCOUNT (Srgokucheats pode ver chats sem admin key)

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const https = require("https");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";
const JWT_SECRET = process.env.JWT_SECRET || "TOOLFLIX_SECRET_123";

// 👑 MASTER USER
const MASTER_NICK = "Srgokucheats";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   MIDDLEWARES
========================= */

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "ADMIN_UNAUTHORIZED" });
  }
  next();
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "TOKEN_INVALID" });
  }
}

// 👑 MASTER (somente Srgokucheats)
function requireMaster(req, res, next) {
  if (!req.user || req.user.nick !== MASTER_NICK) {
    return res.status(403).json({ ok: false, error: "MASTER_ONLY" });
  }
  next();
}

/* =========================
   HELPERS
========================= */

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}
/* =========================
   INIT DATABASE
========================= */

async function initDb() {

  // USERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      nick TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      xp BIGINT DEFAULT 0,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS users_nick_idx ON users(nick);`);

  /* =========================
     CHAT (7 dias)
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS chats_expires_idx ON chats(expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages(
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_messages_chat_idx 
    ON chat_messages(chat_id, created_at);
  `);

  /* =========================
     GAMES
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      image TEXT DEFAULT '',
      category TEXT DEFAULT '',
      premium BOOLEAN DEFAULT false,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS games_link_unique 
    ON games(link);
  `);

  /* =========================
     TOKENS + PREMIUM
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens(
      token TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      used_by TEXT,
      used_at BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS premium_users(
      user_id TEXT PRIMARY KEY,
      since BIGINT NOT NULL
    );
  `);
}

initDb()
  .then(() => {
    console.log("✅ Banco OK");
    app.listen(PORT, () =>
      console.log("ToolFlix API rodando na porta", PORT)
    );
  })
  .catch((e) => {
    console.error("❌ Erro initDb:", e);
    app.listen(PORT, () =>
      console.log("ToolFlix API (COM ERRO DB) na porta", PORT)
    );
  });

app.get("/", (req, res) =>
  res.json({ ok: true, name: "ToolFlix API" })
);

/* =========================
   AUTH (REGISTER / LOGIN)
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const nick = (req.body?.nick || "").toString().trim();
    const password = (req.body?.password || "").toString();

    if (!nick)
      return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });

    if (!password || password.length < 6)
      return res.status(400).json({ ok: false, error: "PASS_MIN_6" });

    const hash = await bcrypt.hash(password, 10);
    const id = "u_" + Math.random().toString(36).slice(2, 10);

    await pool.query(
      `INSERT INTO users(id,nick,password_hash,xp,created_at)
       VALUES($1,$2,$3,0,$4)`,
      [id, nick, hash, Date.now()]
    );

    res.json({ ok: true });

  } catch {
    res.status(400).json({ ok: false, error: "NICK_EXISTS" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const nick = (req.body?.nick || "").toString().trim();
    const password = (req.body?.password || "").toString();

    const r = await pool.query(
      `SELECT * FROM users WHERE nick=$1 LIMIT 1`,
      [nick]
    );

    if (r.rowCount === 0)
      return res.status(401).json({ ok: false, error: "INVALID" });

    const user = r.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match)
      return res.status(401).json({ ok: false, error: "INVALID" });

    const token = jwt.sign(
      {
        id: user.id,
        nick: user.nick,
        role: user.nick === MASTER_NICK ? "master" : "user"
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nick: user.nick,
        xp: Number(user.xp || 0),
      },
    });

  } catch (e) {
    console.error("LOGIN_FAIL:", e);
    res.status(500).json({ ok: false, error: "LOGIN_FAIL" });
  }
});
/* =========================
   XP + USER
========================= */

app.get("/api/me", auth, async (req, res) => {
  const r = await pool.query(
    `SELECT id,nick,xp FROM users WHERE id=$1 LIMIT 1`,
    [req.user.id]
  );

  if (r.rowCount === 0)
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  res.json({ ok: true, user: r.rows[0] });
});

app.post("/api/add-xp", auth, async (req, res) => {
  const amount = Number(req.body?.amount || 0);

  if (amount <= 0 || amount > 1000)
    return res.status(400).json({ ok: false, error: "AMOUNT_INVALID" });

  await pool.query(
    `UPDATE users SET xp = xp + $1 WHERE id=$2`,
    [amount, req.user.id]
  );

  const r = await pool.query(
    `SELECT xp FROM users WHERE id=$1 LIMIT 1`,
    [req.user.id]
  );

  res.json({ ok: true, xp: Number(r.rows[0]?.xp || 0) });
});

/* =========================
   CHAT HELPERS
========================= */

const CHAT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_SPAM_MS = 30 * 1000;

async function cleanupExpiredChats() {
  const now = Date.now();

  await pool.query(`
    DELETE FROM chat_messages
    WHERE chat_id IN (
      SELECT id FROM chats WHERE expires_at < $1
    )
  `, [now]);

  await pool.query(
    `DELETE FROM chats WHERE expires_at < $1`,
    [now]
  );
}

async function getOrCreateActiveChat(userId) {
  const now = Date.now();

  await cleanupExpiredChats();

  const r = await pool.query(
    `SELECT * FROM chats 
     WHERE user_id=$1 AND expires_at >= $2 
     LIMIT 1`,
    [userId, now]
  );

  if (r.rowCount > 0) return r.rows[0];

  const chatId = "c_" + Math.random().toString(36).slice(2, 10);

  const expiresAt = now + CHAT_TTL_MS;

  await pool.query(
    `INSERT INTO chats(id,user_id,created_at,expires_at)
     VALUES($1,$2,$3,$4)`,
    [chatId, userId, now, expiresAt]
  );

  return {
    id: chatId,
    user_id: userId,
    created_at: now,
    expires_at: expiresAt,
  };
}

/* =========================
   CHAT (USER)
========================= */

app.post("/api/chat/send", auth, async (req, res) => {
  try {
    const text = (req.body?.message || "").toString().trim();
    if (!text)
      return res.status(400).json({ ok: false, error: "EMPTY" });

    if (text.length > 500)
      return res.status(400).json({ ok: false, error: "TOO_LONG" });

    const userId = req.user.id;
    const chat = await getOrCreateActiveChat(userId);
    const now = Date.now();

    const last = await pool.query(
      `SELECT created_at FROM chat_messages
       WHERE chat_id=$1 AND sender='user'
       ORDER BY created_at DESC LIMIT 1`,
      [chat.id]
    );

    if (last.rowCount > 0) {
      const lastAt = Number(last.rows[0].created_at || 0);
      const left = (lastAt + CHAT_SPAM_MS) - now;

      if (left > 0) {
        return res.status(429).json({
          ok: false,
          error: "SPAM",
          waitMs: left,
        });
      }
    }

    const msgId = "m_" + Math.random().toString(36).slice(2, 10);

    await pool.query(
      `INSERT INTO chat_messages(id,chat_id,sender,message,created_at)
       VALUES($1,$2,'user',$3,$4)`,
      [msgId, chat.id, text, now]
    );

    res.json({
      ok: true,
      chatId: chat.id,
      expiresAt: Number(chat.expires_at),
    });

  } catch (e) {
    console.error("CHAT_SEND_FAIL:", e);
    res.status(500).json({ ok: false, error: "CHAT_SEND_FAIL" });
  }
});

app.get("/api/chat/messages", auth, async (req, res) => {
  try {
    const chat = await getOrCreateActiveChat(req.user.id);

    const msgs = await pool.query(
      `SELECT sender,message,created_at
       FROM chat_messages
       WHERE chat_id=$1
       ORDER BY created_at ASC
       LIMIT 200`,
      [chat.id]
    );

    res.json({
      ok: true,
      chatId: chat.id,
      expiresAt: Number(chat.expires_at),
      messages: msgs.rows,
    });

  } catch (e) {
    console.error("CHAT_MESSAGES_FAIL:", e);
    res.status(500).json({ ok: false, error: "CHAT_MESSAGES_FAIL" });
  }
});

/* =========================
   👑 MASTER CHAT ROUTES
   (SOMENTE Srgokucheats)
========================= */

// Lista todos chats ativos (MASTER)
app.get("/api/master/chats", auth, requireMaster, async (req, res) => {
  try {
    await cleanupExpiredChats();
    const now = Date.now();

    const r = await pool.query(
      `SELECT c.id, c.user_id, c.created_at, c.expires_at,
              u.nick
       FROM chats c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.expires_at >= $1
       ORDER BY c.created_at DESC`,
      [now]
    );

    res.json({ ok: true, chats: r.rows });

  } catch (e) {
    console.error("MASTER_CHATS_FAIL:", e);
    res.status(500).json({ ok: false, error: "MASTER_CHATS_FAIL" });
  }
});

// Ler mensagens de qualquer chat (MASTER)
app.get("/api/master/chats/:chatId/messages",
  auth,
  requireMaster,
  async (req, res) => {
    try {
      const chatId = (req.params.chatId || "").toString().trim();

      const msgs = await pool.query(
        `SELECT sender,message,created_at
         FROM chat_messages
         WHERE chat_id=$1
         ORDER BY created_at ASC
         LIMIT 300`,
        [chatId]
      );

      res.json({ ok: true, messages: msgs.rows });

    } catch (e) {
      console.error("MASTER_CHAT_MESSAGES_FAIL:", e);
      res.status(500).json({ ok: false, error: "MASTER_CHAT_MESSAGES_FAIL" });
    }
  }
);
/* =========================
   👑 MASTER RESPONDER CHAT
========================= */

app.post(
  "/api/master/chats/:chatId/send",
  auth,
  requireMaster,
  async (req, res) => {
    try {
      await cleanupExpiredChats();

      const chatId = (req.params.chatId || "").toString().trim();
      const text = (req.body?.message || "").toString().trim();

      if (!chatId)
        return res.status(400).json({ ok: false, error: "NO_CHATID" });

      if (!text)
        return res.status(400).json({ ok: false, error: "EMPTY" });

      if (text.length > 500)
        return res.status(400).json({ ok: false, error: "TOO_LONG" });

      const c = await pool.query(
        `SELECT id, expires_at FROM chats WHERE id=$1 LIMIT 1`,
        [chatId]
      );

      if (c.rowCount === 0)
        return res.status(404).json({ ok: false, error: "CHAT_NOT_FOUND" });

      const now = Date.now();

      if (now > Number(c.rows[0].expires_at || 0))
        return res.status(410).json({ ok: false, error: "CHAT_EXPIRED" });

      const msgId = "m_" + Math.random().toString(36).slice(2, 10);

      await pool.query(
        `INSERT INTO chat_messages(id,chat_id,sender,message,created_at)
         VALUES($1,$2,'admin',$3,$4)`,
        [msgId, chatId, text, now]
      );

      res.json({ ok: true });

    } catch (e) {
      console.error("MASTER_CHAT_SEND_FAIL:", e);
      res.status(500).json({ ok: false, error: "MASTER_CHAT_SEND_FAIL" });
    }
  }
);

/* =========================
   TOKENS + PREMIUM
========================= */

app.post("/api/admin/tokens", requireAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.body || {};
    const now = Date.now();
    const expiresAt = now + Number(days) * 24 * 60 * 60 * 1000;

    const token =
      "TFX-" +
      Math.random().toString(36).toUpperCase().slice(2, 8) +
      "-" +
      Math.random().toString(36).toUpperCase().slice(2, 8);

    await pool.query(
      `INSERT INTO tokens(token,created_at,expires_at,used_by,used_at)
       VALUES($1,$2,$3,NULL,NULL)`,
      [token, now, expiresAt]
    );

    res.json({
      ok: true,
      token: { token, createdAt: now, expiresAt },
    });

  } catch (e) {
    console.error("ADMIN_TOKEN_CREATE_FAIL:", e);
    res.status(500).json({ ok: false, error: "ADMIN_TOKEN_CREATE_FAIL" });
  }
});

app.post("/api/validar-token", async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const userId = (req.body?.userId || "").toString().trim();

    if (!token || !userId)
      return res.status(400).json({
        ok: false,
        error: "token e userId obrigatórios",
      });

    const r = await pool.query(
      `SELECT * FROM tokens WHERE token=$1`,
      [token]
    );

    if (r.rowCount === 0)
      return res.json({
        ok: false,
        valid: false,
        reason: "TOKEN_INEXISTENTE",
      });

    const t = r.rows[0];
    const now = Date.now();

    if (now > Number(t.expires_at))
      return res.json({
        ok: false,
        valid: false,
        reason: "TOKEN_EXPIRADO",
      });

    if (t.used_by && t.used_by !== userId)
      return res.json({
        ok: false,
        valid: false,
        reason: "TOKEN_JA_USADO",
      });

    await pool.query(
      `UPDATE tokens SET used_by=$1, used_at=$2 WHERE token=$3`,
      [userId, now, token]
    );

    await pool.query(
      `INSERT INTO premium_users(user_id, since)
       VALUES($1,$2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, now]
    );

    res.json({ ok: true, valid: true, userId });

  } catch (e) {
    console.error("VALIDAR_TOKEN_FAIL:", e);
    res.status(500).json({ ok: false, error: "VALIDAR_TOKEN_FAIL" });
  }
});

app.get("/api/is-premium/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").toString().trim();

    if (!userId)
      return res.status(400).json({
        ok: false,
        error: "userId obrigatório",
      });

    const r = await pool.query(
      `SELECT user_id, since 
       FROM premium_users 
       WHERE user_id=$1 
       LIMIT 1`,
      [userId]
    );

    if (r.rowCount === 0)
      return res.json({ ok: true, premium: false });

    res.json({
      ok: true,
      premium: true,
      since: Number(r.rows[0].since || 0),
    });

  } catch (e) {
    console.error("IS_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, error: "IS_PREMIUM_FAIL" });
  }
});

app.get("/api/total-premium", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS total FROM premium_users`
    );

    res.json({
      ok: true,
      totalPremium: r.rows[0].total,
    });

  } catch (e) {
    console.error("TOTAL_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, error: "TOTAL_PREMIUM_FAIL" });
  }
});
