// server.js — ToolFlix API (Render + Postgres) — COMPLETO
// ✅ Agora suporta PREMIUM como campo separado (sem virar "categoria Premium")
// ✅ Admin games: salva { title, link, image, category, premium }
// ✅ Delete por link: POST /api/admin/games/delete
// ✅ Tokens/Premium users continuam funcionando

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

  await pool.query(`
    ALTER TABLE games
    ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
  `);

  // ✅ NOVO: premium separado (não depende da categoria)
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tokens_used_by_idx ON tokens(used_by);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tokens_expires_idx ON tokens(expires_at);
  `);
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

// ✅ Salvar/atualizar por link (UPsert)
app.post("/api/admin/games", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const title = (body.title || "").toString().trim();
    const link = (body.link || "").toString().trim();
    const image = (body.image || "").toString().trim();
    const category = (body.category || "").toString().trim();
    const premium = !!body.premium;

    if (!title || !link) {
      return res.status(400).json({ ok: false, error: "title e link obrigatórios" });
    }

    const id = "g_" + Math.random().toString(36).slice(2, 10);
    const createdAt = Date.now();

    await pool.query(
      `
      INSERT INTO games(id,title,link,image,category,premium,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (link) DO UPDATE
      SET title = EXCLUDED.title,
          image = COALESCE(NULLIF(EXCLUDED.image,''), games.image),
          category = COALESCE(NULLIF(EXCLUDED.category,''), games.category),
          premium = EXCLUDED.premium
      `,
      [id, title, link, image, category, premium, createdAt]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN_GAMES_UPSERT_FAIL:", e);
    res.status(500).json({ ok: false, error: "ADMIN_GAMES_UPSERT_FAIL" });
  }
});

// ✅ Deletar por link
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

/* =========================
   IMPORT DO GITHUB (toolflix_backup.json)
   FORMATO REAL:
   { nome, capa, link, categoria, premium? }
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

      // ✅ premium pode vir de j.premium; compatibilidade: categoria "Premium" marca premium
      const premium = !!j.premium || category === "Premium";

      if (!title || !link) {
        skipped++;
        continue;
      }

      const exists = await pool.query(
        `SELECT title, image, category, premium FROM games WHERE link=$1 LIMIT 1`,
        [link]
      );

      if (exists.rowCount > 0) {
        const cur = exists.rows[0];
        const needUpdate =
          (image && image !== (cur.image || "")) ||
          (category && category !== (cur.category || "")) ||
          (title && title !== (cur.title || "")) ||
          (premium !== !!cur.premium);

        if (needUpdate) {
          await pool.query(
            `UPDATE games SET title=$1, image=$2, category=$3, premium=$4 WHERE link=$5`,
            [title, image || cur.image || "", category || cur.category || "", premium, link]
          );
          updated++;
        }
        continue;
      }

      const id = "g_" + Math.random().toString(36).slice(2, 10);
      const createdAt = Date.now();

      await pool.query(
        `INSERT INTO games(id,title,link,image,category,premium,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, title, link, image, category, premium, createdAt]
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
   TOKENS + PREMIUM USERS
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

    res.json({ ok: true, token: { token, createdAt: now, expiresAt } });
  } catch (e) {
    console.error("ADMIN_TOKEN_CREATE_FAIL:", e);
    res.status(500).json({ ok: false, error: "ADMIN_TOKEN_CREATE_FAIL" });
  }
});

app.post("/api/validar-token", async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const userId = (req.body?.userId || "").toString().trim();

    if (!token || !userId) {
      return res.status(400).json({ ok: false, error: "token e userId obrigatórios" });
    }

    const r = await pool.query(`SELECT * FROM tokens WHERE token=$1`, [token]);
    if (r.rowCount === 0) return res.json({ ok: false, valid: false, reason: "TOKEN_INEXISTENTE" });

    const t = r.rows[0];
    const now = Date.now();

    if (now > Number(t.expires_at)) return res.json({ ok: false, valid: false, reason: "TOKEN_EXPIRADO" });
    if (t.used_by && t.used_by !== userId) return res.json({ ok: false, valid: false, reason: "TOKEN_JA_USADO" });

    await pool.query(`UPDATE tokens SET used_by=$1, used_at=$2 WHERE token=$3`, [userId, now, token]);

    await pool.query(
      `INSERT INTO premium_users(user_id, since) VALUES($1,$2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, now]
    );

    res.json({ ok: true, valid: true, userId });
  } catch (e) {
    console.error("VALIDAR_TOKEN_FAIL:", e);
    res.status(500).json({ ok: false, error: "VALIDAR_TOKEN_FAIL" });
  }
});

app.post("/api/validate-token", async (req, res) => {
  req.url = "/api/validar-token";
  return app._router.handle(req, res, () => {});
});

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

app.get("/api/total-premium", async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS total FROM premium_users`);
    res.json({ ok: true, totalPremium: r.rows[0].total });
  } catch (e) {
    console.error("TOTAL_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, error: "TOTAL_PREMIUM_FAIL" });
  }
});
