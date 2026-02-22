// server.js — ToolFlix API (Render + Postgres)
// ✅ Corrigido para fluxo Premium 100% no Render:
// - POST /api/validar-token (token + userId) -> valida, marca token usado e registra premium_users
// - GET  /api/is-premium/:userId            -> checa se userId é premium
// - GET  /api/total-premium                -> total de usuários premium
// - (Alias) POST /api/validate-token        -> mesmo que /api/validar-token
//
// Mantém games como já estava.

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
  // games
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
    CREATE UNIQUE INDEX IF NOT EXISTS games_link_unique ON games(link);
  `);

  // tokens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens(
      token TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      used_by TEXT,
      used_at BIGINT
    );
  `);

  // premium users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS premium_users(
      user_id TEXT PRIMARY KEY,
      since BIGINT NOT NULL
    );
  `);

  // Helpful indexes (performance)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tokens_used_by_idx ON tokens(used_by);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tokens_expires_idx ON tokens(expires_at);
  `);
}

// Start after DB init to avoid race
initDb()
  .then(() => {
    console.log("✅ Banco OK");
    app.listen(PORT, () => console.log("ToolFlix API rodando na porta", PORT));
  })
  .catch((e) => {
    console.error("❌ Erro initDb:", e);
    // still start to expose error endpoint
    app.listen(PORT, () => console.log("ToolFlix API (COM ERRO DB) na porta", PORT));
  });
// Deletar jogo por link (admin)
app.post("/api/admin/games/delete", requireAdmin, async (req, res) => {
  try {
    const { link } = req.body || {};
    if (!link) return res.status(400).json({ ok: false, error: "link obrigatório" });

    const r = await pool.query(`DELETE FROM games WHERE link=$1`, [String(link).trim()]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) {
    console.error("DELETE_GAME_FAIL:", e);
    res.status(500).json({ ok: false, error: "DELETE_GAME_FAIL" });
  }
});

app.get("/", (req, res) => res.json({ ok: true, name: "ToolFlix API" }));

/* =========================
   GAMES
========================= */

app.get("/api/games", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM games ORDER BY created_at DESC;`);
    res.json({ ok: true, games: r.rows });
  } catch (e) {
    console.error("GAMES_GET_FAIL:", e);
    res.status(500).json({ ok: false, error: "GAMES_GET_FAIL" });
  }
});

app.post("/api/admin/clear-games", requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM games;`);
    res.json({ ok: true, cleared: true });
  } catch (e) {
    console.error("CLEAR_GAMES_FAIL:", e);
    res.status(500).json({ ok: false, error: "CLEAR_GAMES_FAIL" });
  }
});

app.post("/api/admin/games", requireAdmin, async (req, res) => {
  try {
    const { title, link, image = "", category = "" } = req.body || {};
    if (!title || !link) {
      return res.status(400).json({ ok: false, error: "title e link obrigatórios" });
    }

    const id = "g_" + Math.random().toString(36).slice(2, 10);
    const createdAt = Date.now();

    // upsert by link (unique index)
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
  } catch (e) {
    console.error("ADMIN_GAMES_UPSERT_FAIL:", e);
    res.status(500).json({ ok: false, error: "ADMIN_GAMES_UPSERT_FAIL" });
  }
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
    const jogos = Array.isArray(data) ? data : (data.jogos || []);

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
   TOKENS + PREMIUM (100% Render)
========================= */

// Admin: gerar token (grava no Postgres)
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

    res.json({ ok: true, token: { token, createdAt: now, expiresAt } });
  } catch (e) {
    console.error("ADMIN_TOKEN_CREATE_FAIL:", e);
    res.status(500).json({ ok: false, error: "ADMIN_TOKEN_CREATE_FAIL" });
  }
});

// Premium check: userId -> true/false
app.get("/api/is-premium/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").toString().trim();
    if (!userId) return res.status(400).json({ ok: false, error: "userId obrigatório" });

    const r = await pool.query(`SELECT user_id, since FROM premium_users WHERE user_id=$1 LIMIT 1`, [userId]);
    if (r.rowCount === 0) return res.json({ ok: true, premium: false });

    res.json({ ok: true, premium: true, since: Number(r.rows[0].since || 0) });
  } catch (e) {
    console.error("IS_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, error: "IS_PREMIUM_FAIL" });
  }
});

// Total premium users
app.get("/api/total-premium", async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS total FROM premium_users`);
    res.json({ ok: true, totalPremium: r.rows[0].total });
  } catch (e) {
    console.error("TOTAL_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, error: "TOTAL_PREMIUM_FAIL" });
  }
});

// Validar token (rota principal)
app.post("/api/validar-token", async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const userId = (req.body?.userId || "").toString().trim();

    if (!token || !userId) {
      return res.status(400).json({ ok: false, error: "token e userId obrigatórios" });
    }

    const r = await pool.query(`SELECT * FROM tokens WHERE token=$1`, [token]);
    if (r.rowCount === 0) {
      return res.json({ ok: false, valid: false, reason: "TOKEN_INEXISTENTE" });
    }

    const t = r.rows[0];
    const now = Date.now();

    if (now > Number(t.expires_at)) {
      return res.json({ ok: false, valid: false, reason: "TOKEN_EXPIRADO" });
    }

    // Se token já foi usado por outra pessoa, nega.
    if (t.used_by && t.used_by !== userId) {
      return res.json({ ok: false, valid: false, reason: "TOKEN_JA_USADO" });
    }

    // Marca token usado (idempotente para o mesmo userId)
    await pool.query(
      `UPDATE tokens
       SET used_by=$1, used_at=$2
       WHERE token=$3`,
      [userId, now, token]
    );

    // Registra premium do userId (não duplica)
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

// Alias (para facilitar se no front você usar outro nome)
app.post("/api/validate-token", async (req, res) => {
  // reusa o mesmo handler (sem duplicar lógica)
  req.url = "/api/validar-token";
  return app._router.handle(req, res, () => {});
});

