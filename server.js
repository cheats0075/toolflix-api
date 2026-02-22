// server.js — ToolFlix API (Render + Postgres)

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const https = require("https");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "ADMIN_UNAUTHORIZED" });
  }
  next();
}

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

async function initDb() {

  /* =========================
     GAMES
  ========================= */

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

  /* =========================
     TOKENS + PREMIUM USERS
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tokens_used_by_idx ON tokens(used_by);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tokens_expires_idx ON tokens(expires_at);
  `);

  /* =========================
     USERS (Login + XP)
  ========================= */

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
