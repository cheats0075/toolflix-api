// server.js — ToolFlix API (Render + Postgres)

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";

/* =========================
   ADMIN
========================= */

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "ADMIN_UNAUTHORIZED" });
  }
  next();
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "TOKEN_EXPIRED" });
  }
}

/* =========================
   INIT DB
========================= */

async function initDb() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      nick TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      xp BIGINT DEFAULT 0,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_nick_idx ON users(nick);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      image TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE games
    ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE games
    ADD COLUMN IF NOT EXISTS premium BOOLEAN DEFAULT false;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS games_link_unique ON games(link);
  `);

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

initDb().then(() => {
  console.log("✅ Banco OK");
  app.listen(PORT, () =>
    console.log("ToolFlix API rodando na porta", PORT)
  );
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const { nick, password } = req.body;

    if (!nick || !password)
      return res.status(400).json({ ok: false, error: "Dados obrigatórios" });

    const hash = await bcrypt.hash(password, 10);
    const id = "u_" + Math.random().toString(36).slice(2, 10);
    const createdAt = Date.now();

    await pool.query(
      `INSERT INTO users(id,nick,password_hash,xp,created_at)
       VALUES($1,$2,$3,0,$4)`,
      [id, nick.trim(), hash, createdAt]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: "Nick já existe" });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { nick, password } = req.body;

    const r = await pool.query(
      `SELECT * FROM users WHERE nick=$1 LIMIT 1`,
      [nick.trim()]
    );

    if (r.rowCount === 0)
      return res.status(401).json({ ok: false, error: "Usuário inválido" });

    const user = r.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ ok: false, error: "Senha inválida" });

    const token = jwt.sign(
      { id: user.id, nick: user.nick },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nick: user.nick,
        xp: Number(user.xp)
      }
    });

  } catch {
    res.status(500).json({ ok: false, error: "LOGIN_FAIL" });
  }
});

/* =========================
   GET PROFILE
========================= */

app.get("/api/me", auth, async (req, res) => {
  const r = await pool.query(
    `SELECT id,nick,xp FROM users WHERE id=$1`,
    [req.user.id]
  );

  if (r.rowCount === 0)
    return res.status(404).json({ ok: false });

  res.json({ ok: true, user: r.rows[0] });
});

/* =========================
   ADD XP (Tempo real)
========================= */

app.post("/api/add-xp", auth, async (req, res) => {
  const { amount } = req.body;
  const xpGain = Number(amount) || 0;

  if (xpGain <= 0 || xpGain > 1000)
    return res.status(400).json({ ok: false });

  await pool.query(
    `UPDATE users SET xp = xp + $1 WHERE id=$2`,
    [xpGain, req.user.id]
  );

  const r = await pool.query(
    `SELECT xp FROM users WHERE id=$1`,
    [req.user.id]
  );

  res.json({ ok: true, xp: Number(r.rows[0].xp) });
});

/* =========================
   ROOT
========================= */

app.get("/", (req, res) =>
  res.json({ ok: true, name: "ToolFlix API" })
);
