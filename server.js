const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const https = require("https");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 3000;

// Banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Admin
const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";
function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY)
    return res.status(401).json({ ok: false, error: "ADMIN_UNAUTHORIZED" });
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

app.listen(PORT, () => console.log("ToolFlix API rodando na porta", PORT));

initDb()
  .then(() => console.log("Banco OK"))
  .catch((e) => console.error("Erro initDb:", e));

app.get("/", (req, res) => {
  res.json({ ok: true, name: "ToolFlix API" });
});

/* ========= GAMES ========= */

app.get("/api/games", async (req, res) => {
  const r = await pool.query(`SELECT * FROM games ORDER BY created_at DESC;`);
  res.json({ ok: true, games: r.rows });
});

app.post("/api/admin/games", requireAdmin, async (req, res) => {
  const { title, link, image = "" } = req.body || {};
  if (!title || !link)
    return res.status(400).json({ ok: false, error: "title e link obrigatórios" });

  const id = "g_" + Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();

  await pool.query(
    `INSERT INTO games(id,title,link,image,created_at) VALUES($1,$2,$3,$4,$5)`,
    [id, title, link, image, createdAt]
  );

  res.json({ ok: true });
});

/* ========= IMPORTAR DO GITHUB ========= */

app.post("/api/admin/import-github-games", requireAdmin, async (req, res) => {

  const url = "https://raw.githubusercontent.com/cheats0075/toolflix/main/toolflix_backup.json";

  function fetchJson(u){
    return new Promise((resolve, reject)=>{
      https.get(u, (resp)=>{
        let data = "";
        resp.on("data", chunk => data += chunk);
        resp.on("end", ()=>{
          try { resolve(JSON.parse(data)); }
          catch(e){ reject(e); }
        });
      }).on("error", reject);
    });
  }

  try{
    const data = await fetchJson(url);
    const jogos = Array.isArray(data) ? data : (data.jogos || []);

    let inserted = 0;

    for(const j of jogos){
      const title = j.title || j.nome || "";
      const link  = j.link  || j.url  || "";
      const image = j.image || j.img || j.capa || j.thumb || j.imagem || j.cover || j.thumbnail || "";

      if(!title || !link) continue;

      const exists = await pool.query(
        `SELECT 1 FROM games WHERE link=$1 LIMIT 1`,
        [link]
      );
      if(exists.rowCount > 0) continue;

      const id = "g_" + Math.random().toString(36).slice(2, 10);
      const createdAt = Date.now();

      await pool.query(
        `INSERT INTO games(id,title,link,image,created_at)
         VALUES($1,$2,$3,$4,$5)`,
        [id, title, link, image, createdAt]
      );

      inserted++;
    }

    res.json({ ok: true, inserted });

  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error:"IMPORT_FAIL" });
  }
});

/* ========= TOKENS ========= */

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
    `INSERT INTO tokens(token,created_at,expires_at)
     VALUES($1,$2,$3)`,
    [token, now, expiresAt]
  );

  res.json({ ok: true, token });
});

app.post("/api/validar-token", async (req, res) => {
  const { token, userId } = req.body || {};
  if (!token || !userId)
    return res.status(400).json({ ok: false });

  const r = await pool.query(`SELECT * FROM tokens WHERE token=$1`, [token]);
  if (r.rowCount === 0)
    return res.json({ ok:false, valid:false });

  const t = r.rows[0];

  if (Date.now() > Number(t.expires_at))
    return res.json({ ok:false, valid:false });

  if (t.used_by && t.used_by !== userId)
    return res.json({ ok:false, valid:false });

  await pool.query(
    `UPDATE tokens SET used_by=$1, used_at=$2 WHERE token=$3`,
    [userId, Date.now(), token]
  );

  await pool.query(
    `INSERT INTO premium_users(user_id,since)
     VALUES($1,$2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, Date.now()]
  );

  res.json({ ok:true, valid:true });
});

app.get("/api/total-premium", async (req, res) => {
  const r = await pool.query(`SELECT COUNT(*)::int AS total FROM premium_users`);
  res.json({ ok:true, totalPremium:r.rows[0].total });
});

