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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      image TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );
  `);

  // add category
  await pool.query(`
    ALTER TABLE games
    ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
  `);

  // ensure link uniqueness by index (prevents duplicates)
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

app.listen(PORT, () => console.log("ToolFlix API rodando na porta", PORT));

initDb()
  .then(() => console.log("✅ Banco OK"))
  .catch((e) => console.error("❌ Erro initDb:", e));

app.get("/", (req, res) => res.json({ ok: true, name: "ToolFlix API" }));

/* =========================
   GAMES
========================= */

app.get("/api/games", async (req, res) => {
  const r = await pool.query(`SELECT * FROM games ORDER BY created_at DESC;`);
  res.json({ ok: true, games: r.rows });
});

app.post("/api/admin/clear-games", requireAdmin, async (req, res) => {
  await pool.query(`DELETE FROM games;`);
  res.json({ ok: true, cleared: true });
});

app.post("/api/admin/games", requireAdmin, async (req, res) => {
  const { title, link, image = "", category = "" } = req.body || {};
  if (!title || !link) return res.status(400).json({ ok: false, error: "title e link obrigatórios" });

  const id = "g_" + Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();

  // upsert by link
  await pool.query(
    `
    INSERT INTO games(id,title,link,image,category,created_at)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (link) DO UPDATE
    SET title = EXCLUDED.title,
        image = COALESCE(NULLIF(EXCLUDED.image,''), games.image),
        category = COALESCE(NULLIF(EXCLUDED.category,''), games.category)
    `,
    [id, title, link, image, category, createdAt]
  );

  res.json({ ok: true });
});

/* =========================
   IMPORT DO GITHUB (toolflix_backup.json)
   FORMATO REAL:
   { nome, capa, link, categoria }
========================= */

app.post("/api/admin/import-github-games", requireAdmin, async (req, res) => {
  const url = "https://raw.githubusercontent.com/cheats0075/toolflix/main/toolflix_backup.json";

  try {
    const data = await fetchJson(url);
    const jogos = Array.isArray(data) ? data : [];

    if (!Array.isArray(jogos) || jogos.length === 0) {
      return res.json({ ok: false, error: "SEM_JOGOS_NO_JSON" });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const j of jogos) {
      const title = (j.nome || "").toString().trim();
      const link = (j.link || "").toString().trim();
      const image = (j.capa || "").toString().trim();
      const category = (j.categoria || "").toString().trim();

      if (!title || !link) {
        skipped++;
        continue;
      }

      // Se existir, atualiza (inclusive se mudou)
      const exists = await pool.query(
        `SELECT title, image, category FROM games WHERE link=$1 LIMIT 1`,
        [link]
      );

      if (exists.rowCount > 0) {
        const cur = exists.rows[0];
        const needUpdate =
          (image && image !== (cur.image || "")) ||
          (category && category !== (cur.category || "")) ||
          (title && title !== (cur.title || ""));

        if (needUpdate) {
          await pool.query(
            `UPDATE games SET title=$1, image=$2, category=$3 WHERE link=$4`,
            [title, image || cur.image || "", category || cur.category || "", link]
          );
          updated++;
        }
        continue;
      }

      // Inserir novo
      const id = "g_" + Math.random().toString(36).slice(2, 10);
      const createdAt = Date.now();

      await pool.query(
        `INSERT INTO games(id,title,link,image,category,created_at)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [id, title, link, image, category, createdAt]
      );

      inserted++;
    }

    res.json({ ok: true, totalNoJson: jogos.length, inserted, updated, skipped });
  } catch (e) {
    console.error("IMPORT_FAIL:", e);
    res.status(500).json({ ok: false, error: "IMPORT_FAIL", details: String(e) });
  }
});

/* =========================
   TOKENS + PREMIUM
========================= */

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
    `INSERT INTO tokens(token,created_at,expires_at,used_by,used_at)
     VALUES($1,$2,$3,NULL,NULL)`,
    [token, now, expiresAt]
  );

  res.json({ ok: true, token: { token, createdAt: now, expiresAt } });
});

app.post("/api/validar-token", async (req, res) => {
  const { token, userId } = req.body || {};
  if (!token || !userId) return res.status(400).json({ ok: false, error: "token e userId obrigatórios" });

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

app.get("/api/total-premium", async (req, res) => {
  const r = await pool.query(`SELECT COUNT(*)::int AS total FROM premium_users`);
  res.json({ ok: true, totalPremium: r.rows[0].total });
});
