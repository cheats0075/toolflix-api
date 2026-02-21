const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// CORS (depois a gente restringe para seu domínio)
app.use(cors({ origin: "*" }));

// Banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Admin
const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";
function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "ADMIN_UNAUTHORIZED" });
  next();
}

// Criar tabelas
async function initDb() {
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

app.get("/", (req, res) => {
  res.json({ ok: true, name: "ToolFlix API", time: new Date().toISOString() });
});

/* ========= GAMES ========= */

// Listar jogos
app.get("/api/games", async (req, res) => {
  const r = await pool.query(`SELECT * FROM games ORDER BY created_at DESC;`);
  res.json({ ok: true, games: r.rows });
});

// Adicionar jogo (admin)
app.post("/api/admin/games", requireAdmin, async (req, res) => {
  const { title, link, image = "" } = req.body || {};
  if (!title || !link) return res.status(400).json({ ok: false, error: "title e link são obrigatórios" });

  const id = "g_" + Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();

  await pool.query(
    `INSERT INTO games(id,title,link,image,created_at) VALUES($1,$2,$3,$4,$5)`,
    [id, title, link, image, createdAt]
  );

  res.json({ ok: true, game: { id, title, link, image, created_at: createdAt } });
});

/* ========= TOKENS + PREMIUM ========= */

// Gerar token (admin)
app.post("/api/admin/tokens", requireAdmin, async (req, res) => {
  const { days = 30 } = req.body || {};
  const now = Date.now();
  const expiresAt = now + Number(days) * 24 * 60 * 60 * 1000;

  const token =
    "TFX-" +
    Math.random().toString(36).toUpperCase().slice(2, 8) +
    "-" +
    Math.random().toString(36).toUpperCase().slice(2, 8);

  await pool.query(
    `INSERT INTO tokens(token,created_at,expires_at,used_by,used_at) VALUES($1,$2,$3,NULL,NULL)`,
    [token, now, expiresAt]
  );

  res.json({ ok: true, token: { token, createdAt: now, expiresAt, usedBy: null, usedAt: null } });
});

// Validar token (público)
app.post("/api/validar-token", async (req, res) => {
  const { token, userId } = req.body || {};
  if (!token || !userId) return res.status(400).json({ ok: false, error: "token e userId são obrigatórios" });

  const r = await pool.query(`SELECT * FROM tokens WHERE token=$1`, [token]);
  if (r.rowCount === 0) return res.json({ ok: false, valid: false, reason: "TOKEN_INEXISTENTE" });

  const t = r.rows[0];
  if (Date.now() > Number(t.expires_at)) return res.json({ ok: false, valid: false, reason: "TOKEN_EXPIRADO" });
  if (t.used_by && t.used_by !== userId) return res.json({ ok: false, valid: false, reason: "TOKEN_JA_USADO" });

  await pool.query(`UPDATE tokens SET used_by=$1, used_at=$2 WHERE token=$3`, [userId, Date.now(), token]);

  await pool.query(
    `INSERT INTO premium_users(user_id, since) VALUES($1,$2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, Date.now()]
  );

  res.json({ ok: true, valid: true, userId });
});

// Total premium
app.get("/api/total-premium", async (req, res) => {
  const r = await pool.query(`SELECT COUNT(*)::int AS total FROM premium_users;`);
  res.json({ ok: true, totalPremium: r.rows[0].total });
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => app.listen(PORT, () => console.log("ToolFlix API rodando na porta", PORT)))
  .catch((e) => {
    console.error("Erro initDb:", e);
    process.exit(1);
  });
