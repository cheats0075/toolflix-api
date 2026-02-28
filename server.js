// server.js — ToolFlix API (Render + Postgres)
// 🔥 SUPER ADMIN TOTAL (Srgokucheats)
// 🔐 Admin normal via ADMIN_KEY
// 👑 Srgokucheats tem TODOS poderes sem ADMIN_KEY

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const https = require("https");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const corsOptions = {
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key", "x-admin-key"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Backup “na marra” (evita render/proxy comer header)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-key, X-Admin-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
}));
app.options("*", cors());

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";
const JWT_SECRET = process.env.JWT_SECRET || "TOOLFLIX_SECRET_123";

// 👑 SUPER ADMIN FIXO
const MASTER_NICK = "Srgokucheats";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   MIDDLEWARES
========================= */

// Auth normal (JWT obrigatório)
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token)
    return res.status(401).json({ ok: false, error: "NO_TOKEN" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "TOKEN_INVALID" });
  }
}

// 🔥 Auth opcional (para permitir ADMIN_KEY ou JWT)
function authOptional(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return next();

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {}
  next();
}

// 🔐 ADMIN OU SUPER ADMIN
function requireAdminOrMaster(req, res, next) {

  // 1️⃣ Admin normal via key
  const key = req.headers["x-admin-key"];
  if (key && key === ADMIN_KEY) return next();

  // 2️⃣ Super Admin via JWT
  if (req.user && req.user.nick === MASTER_NICK) return next();

  return res.status(403).json({ ok: false, error: "ADMIN_OR_MASTER_REQUIRED" });
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
     CHAT
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
  `);
  // 🔥 garante coluna de última atividade (para ordenar chats como WhatsApp)
  await pool.query(`
    ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS last_activity_at BIGINT NOT NULL DEFAULT 0;
  `);

  // backfill: se estiver 0, usa created_at ou última mensagem
  await pool.query(`
    UPDATE chats c
    SET last_activity_at = COALESCE(
      (SELECT MAX(created_at) FROM chat_messages m WHERE m.chat_id = c.id),
      c.created_at
    )
    WHERE c.last_activity_at = 0
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
  /* =========================
     VISITAS (CONTADOR GLOBAL)
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_stats(
      key TEXT PRIMARY KEY,
      value BIGINT NOT NULL
    );
  `);

  // garante a chave "visits"
  await pool.query(`
    INSERT INTO site_stats(key, value)
    VALUES('visits', 0)
    ON CONFLICT (key) DO NOTHING;
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
   USER + XP
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
   GAMES
========================= */

app.get("/api/games", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM games ORDER BY created_at DESC`
    );
    res.json({ ok: true, games: r.rows });
  } catch (e) {
    console.error("GAMES_GET_FAIL:", e);
    res.status(500).json({ ok: false, error: "GAMES_GET_FAIL" });
  }
});

/* 🔥 ADMIN ROUTES (AGORA SUPER ADMIN TOTAL) */

// Limpar jogos
app.post(
  "/api/admin/clear-games",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      await pool.query(`DELETE FROM games`);
      res.json({ ok: true });
    } catch (e) {
      console.error("CLEAR_GAMES_FAIL:", e);
      res.status(500).json({ ok: false });
    }
  }
);

// Criar ou atualizar jogo
app.post(
  "/api/admin/games",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      const body = req.body || {};
      const title = (body.title || "").toString().trim();
      const link = (body.link || "").toString().trim();
      const image = (body.image || "").toString().trim();
      const category = (body.category || "").toString().trim();
      const premium = !!body.premium;

      if (!title || !link)
        return res.status(400).json({
          ok: false,
          error: "title e link obrigatórios"
        });

      const id = "g_" + Math.random().toString(36).slice(2, 10);

      await pool.query(
        `
        INSERT INTO games(id,title,link,image,category,premium,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (link) DO UPDATE
        SET title = EXCLUDED.title,
            image = EXCLUDED.image,
            category = EXCLUDED.category,
            premium = EXCLUDED.premium
        `,
        [id, title, link, image, category, premium, Date.now()]
      );

      res.json({ ok: true });

    } catch (e) {
      console.error("ADMIN_GAMES_FAIL:", e);
      res.status(500).json({ ok: false });
    }
  }
);

// Deletar jogo
app.post(
  "/api/admin/games/delete",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      const { link } = req.body || {};
      if (!link)
        return res.status(400).json({
          ok: false,
          error: "link obrigatório"
        });

      await pool.query(
        `DELETE FROM games WHERE link=$1`,
        [String(link).trim()]
      );

      res.json({ ok: true });

    } catch (e) {
      console.error("DELETE_GAME_FAIL:", e);
      res.status(500).json({ ok: false });
    }
  }
);
/* =========================
   TOKENS + PREMIUM
========================= */

app.post(
  "/api/admin/tokens",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
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

      res.json({ ok: true, token, expiresAt });

    } catch (e) {
      console.error("TOKEN_CREATE_FAIL:", e);
      res.status(500).json({ ok: false });
    }
  }
);

app.post("/api/validar-token", async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const userId = (req.body?.userId || "").toString().trim();

    if (!token || !userId)
      return res.status(400).json({ ok: false });

    const r = await pool.query(
      `SELECT * FROM tokens WHERE token=$1`,
      [token]
    );

    if (r.rowCount === 0)
      return res.json({ ok: false, reason: "TOKEN_INEXISTENTE" });

    const t = r.rows[0];
    const now = Date.now();

    if (now > Number(t.expires_at))
      return res.json({ ok: false, reason: "TOKEN_EXPIRADO" });

    if (t.used_by && t.used_by !== userId)
      return res.json({ ok: false, reason: "TOKEN_JA_USADO" });

    await pool.query(
      `UPDATE tokens SET used_by=$1, used_at=$2 WHERE token=$3`,
      [userId, now, token]
    );

    await pool.query(
      `INSERT INTO premium_users(user_id,since)
       VALUES($1,$2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, now]
    );

    res.json({ ok: true, valid: true });

  } catch (e) {
    console.error("VALIDAR_TOKEN_FAIL:", e);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/is-premium/:userId", async (req, res) => {
  const r = await pool.query(
    `SELECT user_id FROM premium_users WHERE user_id=$1 LIMIT 1`,
    [req.params.userId]
  );

  res.json({ ok: true, premium: r.rowCount > 0 });
});

app.get("/api/total-premium", async (req, res) => {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total FROM premium_users`
  );

  res.json({ ok: true, totalPremium: r.rows[0].total });
});

/* =========================
   VISITAS (CONTADOR REAL)
========================= */

// Incrementa 1 visita por sessão (o front já evita duplicar).
// Retorna { ok:true, count: <total> }
app.post("/api/visits", async (req, res) => {
  try {
    const r = await pool.query(`
      INSERT INTO site_stats(key, value)
      VALUES('visits', 1)
      ON CONFLICT (key) DO UPDATE
      SET value = site_stats.value + 1
      RETURNING value::bigint AS count
    `);

    const count = Number(r.rows[0]?.count || 0);
    res.json({ ok: true, count });
  } catch (e) {
    console.error("VISITS_POST_FAIL:", e);
    res.status(500).json({ ok: false, error: "VISITS_POST_FAIL" });
  }
});

// Apenas consulta o total
app.get("/api/visits", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT value::bigint AS count FROM site_stats WHERE key='visits' LIMIT 1`
    );
    const count = Number(r.rows[0]?.count || 0);
    res.json({ ok: true, count });
  } catch (e) {
    console.error("VISITS_GET_FAIL:", e);
    res.status(500).json({ ok: false, error: "VISITS_GET_FAIL" });
  }
});



/* =========================
   CHAT SYSTEM
========================= */

const CHAT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_SPAM_MS = 30 * 1000;

async function cleanupExpiredChats() {
  const now = Date.now();

  await pool.query(`
    DELETE FROM chat_messages
    WHERE chat_id IN (SELECT id FROM chats WHERE expires_at < $1)
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
    `SELECT * FROM chats WHERE user_id=$1 AND expires_at >= $2 LIMIT 1`,
    [userId, now]
  );

  if (r.rowCount > 0) return r.rows[0];

  const chatId = "c_" + Math.random().toString(36).slice(2, 10);
  const expiresAt = now + CHAT_TTL_MS;

  await pool.query(
    `INSERT INTO chats(id,user_id,created_at,expires_at,last_activity_at)
     VALUES($1,$2,$3,$4,$5)`,
    [chatId, userId, now, expiresAt, now]
  );

  return { id: chatId, expires_at: expiresAt };
}

/* USER SEND */

app.post("/api/chat/send", auth, async (req, res) => {
  const text = (req.body?.message || "").toString().trim();
  if (!text) return res.status(400).json({ ok: false });

  const chat = await getOrCreateActiveChat(req.user.id);
  const now = Date.now();

  const last = await pool.query(
    `SELECT created_at FROM chat_messages
     WHERE chat_id=$1 AND sender='user'
     ORDER BY created_at DESC LIMIT 1`,
    [chat.id]
  );

  if (last.rowCount > 0) {
    const lastAt = Number(last.rows[0].created_at);
    if (now - lastAt < CHAT_SPAM_MS)
      return res.status(429).json({ ok: false, error: "SPAM" });
  }

  const msgId = "m_" + Math.random().toString(36).slice(2, 10);

  await pool.query(
    `INSERT INTO chat_messages(id,chat_id,sender,message,created_at)
     VALUES($1,$2,'user',$3,$4)`,
    [msgId, chat.id, text, now]
  );

  // atualiza última atividade do chat
  await pool.query(`UPDATE chats SET last_activity_at=$1 WHERE id=$2`, [now, chat.id]);

  res.json({ ok: true });
});

/* USER READ */

app.get("/api/chat/messages", auth, async (req, res) => {
  const chat = await getOrCreateActiveChat(req.user.id);

  const msgs = await pool.query(
    `SELECT sender,message,created_at
     FROM chat_messages
     WHERE chat_id=$1
     ORDER BY created_at ASC`,
    [chat.id]
  );

  res.json({ ok: true, messages: msgs.rows });
});

/* 🔥 SUPER ADMIN VÊ TODOS CHATS (mesma rota admin) */

app.get(
  "/api/admin/chats",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    await cleanupExpiredChats();

    const r = await pool.query(`
      SELECT c.id, c.user_id, u.nick, c.created_at, c.expires_at, c.last_activity_at
      FROM chats c
      LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.last_activity_at DESC, c.created_at DESC
    `);

    res.json({ ok: true, chats: r.rows });
  }
);

app.get(
  "/api/admin/chats/:chatId/messages",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    const msgs = await pool.query(
      `SELECT sender,message,created_at
       FROM chat_messages
       WHERE chat_id=$1
       ORDER BY created_at ASC`,
      [req.params.chatId]
    );

    res.json({ ok: true, messages: msgs.rows });
  }
);

app.post(
  "/api/admin/chats/:chatId/send",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    const text = (req.body?.message || "").toString().trim();
    if (!text) return res.status(400).json({ ok: false });

    const msgId = "m_" + Math.random().toString(36).slice(2, 10);

    await pool.query(
      `INSERT INTO chat_messages(id,chat_id,sender,message,created_at)
       VALUES($1,$2,'admin',$3,$4)`,
      [msgId, req.params.chatId, text, Date.now()]
    );

    // atualiza última atividade do chat
    await pool.query(`UPDATE chats SET last_activity_at=$1 WHERE id=$2`, [Date.now(), req.params.chatId]);

    res.json({ ok: true });
  }
);


