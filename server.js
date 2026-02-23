// server.js — ToolFlix API (Render + Postgres) — ROLE MASTER VERSION

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
const JWT_SECRET = process.env.JWT_SECRET || "TOOLFLIX_SECRET_123";

const MASTER_NICK = "Srgokucheats";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   AUTH MIDDLEWARE
========================= */

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

function requireMaster(req, res, next) {
  if (!req.user || req.user.role !== "master") {
    return res.status(403).json({ ok: false, error: "MASTER_ONLY" });
  }
  next();
}

/* =========================
   DB INIT
========================= */

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      nick TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      xp BIGINT DEFAULT 0,
      role TEXT DEFAULT 'user',
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS users_nick_idx ON users(nick);`);

  // (restante do initDb permanece igual ao seu original)
}

initDb()
  .then(() => {
    console.log("✅ Banco OK");
    app.listen(PORT, () => console.log("ToolFlix API rodando na porta", PORT));
  })
  .catch((e) => {
    console.error("❌ Erro initDb:", e);
    app.listen(PORT, () => console.log("ToolFlix API (COM ERRO DB) na porta", PORT));
  });

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const nick = (req.body?.nick || "").toString().trim();
    const password = (req.body?.password || "").toString();

    if (!nick) return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: "PASS_MIN_6" });

    const hash = await bcrypt.hash(password, 10);
    const id = "u_" + Math.random().toString(36).slice(2, 10);
    const createdAt = Date.now();

    const role = nick === MASTER_NICK ? "master" : "user";

    await pool.query(
      `INSERT INTO users(id,nick,password_hash,xp,role,created_at)
       VALUES($1,$2,$3,0,$4,$5)`,
      [id, nick, hash, role, createdAt]
    );

    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: "NICK_EXISTS" });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const nick = (req.body?.nick || "").toString().trim();
    const password = (req.body?.password || "").toString();

    const r = await pool.query(`SELECT * FROM users WHERE nick=$1 LIMIT 1`, [nick]);
    if (r.rowCount === 0) return res.status(401).json({ ok: false, error: "INVALID" });

    const user = r.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ ok: false, error: "INVALID" });

    const token = jwt.sign(
      { id: user.id, nick: user.nick, role: user.role },
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
        role: user.role
      },
    });
  } catch (e) {
    console.error("LOGIN_FAIL:", e);
    res.status(500).json({ ok: false, error: "LOGIN_FAIL" });
  }
});

/* =========================
   ADMIN ROUTES (MASTER ONLY)
========================= */

// Exemplo aplicado (aplicar isso em TODAS suas rotas admin)
app.post("/api/admin/tokens", auth, requireMaster, async (req, res) => {
  try {
    const { days = 30 } = req.body || {};
    const now = Date.now();
    const expiresAt = now + Number(days) * 86400000;

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

    res.json({ ok: true, token });
  } catch (e) {
    console.error("ADMIN_TOKEN_CREATE_FAIL:", e);
    res.status(500).json({ ok: false, error: "ADMIN_TOKEN_CREATE_FAIL" });
  }
});
