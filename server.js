// server.js — ToolFlix API (Render + Postgres)
// 🔥 SUPER ADMIN TOTAL (Srgokucheats)
// 🔐 Admin normal via ADMIN_KEY
// 👑 Srgokucheats tem TODOS poderes sem ADMIN_KEY

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const https = require("https");
const fs = require("fs");
const path = require("path");
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

function getVisitorKey(req) {
  const bodyKey = (req.body?.guestKey || "").toString().trim();
  const queryKey = (req.query?.guestKey || "").toString().trim();

  if (req.user?.id) return `user:${req.user.id}`;
  if (bodyKey) return `guest:${bodyKey}`;
  if (queryKey) return `guest:${queryKey}`;

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "guest")
    .toString()
    .split(",")[0]
    .trim();

  return `guest:${ip}`;
}

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

async function cleanupExpiredPremiumAccounts() {
  const now = Date.now();
  await pool.query(`
    UPDATE users
    SET premium = false,
        premium_removed_at = COALESCE(premium_removed_at, $1),
        premium_removed_by = COALESCE(premium_removed_by, 'auto_expire')
    WHERE premium = true
      AND premium_until IS NOT NULL
      AND premium_until <= $1
  `, [now]);
}

function maskToken(token) {
  const t = (token || '').toString().trim();
  if (!t) return null;
  if (t.length <= 8) return t;
  return `${t.slice(0,4)}...${t.slice(-4)}`;
}

function xpToLevel(xp) {
  xp = Number(xp || 0);
  if (xp < 100) return 1;
  if (xp < 250) return 2;
  if (xp < 500) return 3;
  if (xp < 750) return 4;
  if (xp < 1250) return 5;
  let level = 6;
  let max = 1900;
  while (xp >= max) {
    level++;
    const delta = 650 + (level - 7) * 150;
    max += delta;
    if (level > 1000) break;
  }
  return level;
}

function levelToAvatar(level, slot = 1) {
  const n = Math.max(1, Math.min(15, Number(level || 1)));
  const s = Math.max(1, Math.min(3, Number(slot || 1)));
  return `level-${n}-${s}.webp`;
}

function normalizeAvatarFilename(raw, levelFallback = 1) {
  const clean = String(raw || "").trim().toLowerCase();

  const multi = clean.match(/^level-(\d+)-([1-3])\.webp$/i);
  if (multi) {
    const n = Math.max(1, Math.min(15, Number(multi[1] || 1)));
    const s = Math.max(1, Math.min(3, Number(multi[2] || 1)));
    return `level-${n}-${s}.webp`;
  }

  const old = clean.match(/^level-(\d+)(?:-([1-3]))?\.webp$/i);
  if (old) {
    const n = Math.max(1, Math.min(15, Number(old[1] || 1)));
    return `level-${n}-1.webp`;
  }

  return levelToAvatar(levelFallback, 1);
}

const PROFILE_ACHIEVEMENTS = [
  { id: "yt_1", type: "youtube", need: 1 },
  { id: "yt_5", type: "youtube", need: 5 },
  { id: "yt_15", type: "youtube", need: 15 },
  { id: "yt_30", type: "youtube", need: 30 },
  { id: "yt_60", type: "youtube", need: 60 },
  { id: "yt_120", type: "youtube", need: 120 },
  { id: "dl_3", type: "downloads", need: 3 },
  { id: "dl_10", type: "downloads", need: 10 },
  { id: "dl_25", type: "downloads", need: 25 },
  { id: "dl_50", type: "downloads", need: 50 },
  { id: "dl_100", type: "downloads", need: 100 },
  { id: "dl_200", type: "downloads", need: 200 },
  { id: "fv_5", type: "favorites", need: 5 },
  { id: "fv_15", type: "favorites", need: 15 },
  { id: "fv_30", type: "favorites", need: 30 },
  { id: "fv_60", type: "favorites", need: 60 },
  { id: "fv_100", type: "favorites", need: 100 },
  { id: "fv_200", type: "favorites", need: 200 },
  { id: "th_1", type: "themes", need: 1 },
  { id: "th_5", type: "themes", need: 5 },
  { id: "th_15", type: "themes", need: 15 },
  { id: "th_30", type: "themes", need: 30 },
  { id: "th_60", type: "themes", need: 60 },
  { id: "th_120", type: "themes", need: 120 },
  { id: "pr_1", type: "premium", need: 1 },
];

function buildProfileStatsRow(row) {
  const xp = Number(row?.xp || 0);
  const level = xpToLevel(xp);
  const counts = {
    downloads: Number(row?.downloads_count || 0),
    favorites: Number(row?.favorites_count || 0),
    themes: Number(row?.themes_count || 0),
    youtube: Number(row?.youtube_count || 0),
    premium: row?.premium ? 1 : 0,
  };

  let unlocked = 0;
  for (const ach of PROFILE_ACHIEVEMENTS) {
    if (Number(counts[ach.type] || 0) >= Number(ach.need || 0)) unlocked++;
  }
  const platinum = unlocked === PROFILE_ACHIEVEMENTS.length && PROFILE_ACHIEVEMENTS.length > 0;

  return {
    id: row.id,
    nick: row.nick,
    xp,
    level,
    avatar: normalizeAvatarFilename(row?.avatar, level),
    premium: !!row.premium,
    premiumUntil: row.premium_until ? Number(row.premium_until) : null,
    passwordTemp: !!row.password_temp,
    createdAt: row.created_at ? Number(row.created_at) : null,
    lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
    stats: counts,
    achievements: {
      unlockedCount: unlocked + (platinum ? 1 : 0),
      totalCount: PROFILE_ACHIEVEMENTS.length + 1,
      platinum,
    }
  };
}

function parsePs3TsvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return [];

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (!cols.length) continue;
      const titleId = (cols[0] || "").trim();
      const region = (cols[1] || "").trim();
      const name = (cols[2] || "").trim();
      const pkgLink = (cols[3] || "").trim();
      const rap = (cols[4] || "").trim();
      const contentId = (cols[5] || "").trim();
      const modifiedAt = (cols[6] || "").trim();
      const rapFile = (cols[7] || "").trim();
      const fileSize = Number(cols[8] || 0) || 0;
      const sha256 = (cols[9] || "").trim();
      if (!titleId || !name) continue;
      rows.push({ titleId, region, name, pkgLink, rap, contentId, modifiedAt, rapFile, fileSize, sha256 });
    }
    return rows;
  } catch (e) {
    console.error("PS3_TSV_PARSE_FAIL:", e);
    return [];
  }
}

function buildPs3Description(row) {
  const parts = [
    `Região: ${row.region || "N/D"}`,
    `Title ID: ${row.titleId || "N/D"}`,
    row.contentId ? `Content ID: ${row.contentId}` : "",
    row.fileSize ? `Tamanho: ${row.fileSize} bytes` : "",
    row.modifiedAt ? `Última modificação: ${row.modifiedAt}` : "",
    row.rap && row.rap !== "MISSING" ? `RAP: ${row.rap}` : "",
    row.sha256 ? `SHA256: ${row.sha256}` : ""
  ].filter(Boolean);
  return parts.join(" • ");
}

async function importPs3GamesFromFile() {
  try {
    const candidates = [
      path.join(__dirname, "PS3_GAMES.tsv"),
      path.join(process.cwd(), "PS3_GAMES.tsv"),
      "/mnt/data/PS3_GAMES.tsv"
    ];
    const filePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      console.warn("PS3_TSV_NOT_FOUND");
      return;
    }

    const rows = parsePs3TsvFile(filePath);
    if (!rows.length) {
      console.warn("PS3_TSV_EMPTY");
      return;
    }

    for (const row of rows) {
      const id = `ps3_${row.titleId.toLowerCase()}`;
      const safeLink = row.pkgLink && row.pkgLink !== "MISSING" ? row.pkgLink : "";
      const image = `https://via.placeholder.com/512x512.png?text=${encodeURIComponent(row.titleId)}`;
      await pool.query(
        `
        INSERT INTO ps3_games(
          id, title_id, region, title, pkg_link, rap, content_id, last_modification_date,
          rap_file_link, file_size, sha256, image, description, created_at, updated_at
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (title_id) DO UPDATE
        SET region = EXCLUDED.region,
            title = EXCLUDED.title,
            pkg_link = EXCLUDED.pkg_link,
            rap = EXCLUDED.rap,
            content_id = EXCLUDED.content_id,
            last_modification_date = EXCLUDED.last_modification_date,
            rap_file_link = EXCLUDED.rap_file_link,
            file_size = EXCLUDED.file_size,
            sha256 = EXCLUDED.sha256,
            image = EXCLUDED.image,
            description = EXCLUDED.description,
            updated_at = EXCLUDED.updated_at
        `,
        [
          id, row.titleId, row.region, row.name, safeLink, row.rap, row.contentId, row.modifiedAt,
          row.rapFile, row.fileSize, row.sha256, image, buildPs3Description(row), Date.now(), Date.now()
        ]
      );
    }

    console.log(`✅ PS3 games importados: ${rows.length}`);
  } catch (e) {
    console.error("PS3_IMPORT_FAIL:", e);
  }
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

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS premium BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS premium_since BIGINT,
    ADD COLUMN IF NOT EXISTS premium_until BIGINT,
    ADD COLUMN IF NOT EXISTS premium_token_used TEXT,
    ADD COLUMN IF NOT EXISTS premium_removed_at BIGINT,
    ADD COLUMN IF NOT EXISTS premium_removed_by TEXT,
    ADD COLUMN IF NOT EXISTS downloads_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS favorites_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS themes_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS youtube_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_login_at BIGINT,
    ADD COLUMN IF NOT EXISTS password_temp BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS password_temp_set_at BIGINT,
    ADD COLUMN IF NOT EXISTS avatar TEXT;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS users_premium_idx ON users(premium);`);

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


  await pool.query(`
    ALTER TABLE games
    ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS trailer_url TEXT DEFAULT '';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ps3_games(
      id TEXT PRIMARY KEY,
      title_id TEXT UNIQUE NOT NULL,
      region TEXT DEFAULT '',
      title TEXT NOT NULL,
      pkg_link TEXT DEFAULT '',
      rap TEXT DEFAULT '',
      content_id TEXT DEFAULT '',
      last_modification_date TEXT DEFAULT '',
      rap_file_link TEXT DEFAULT '',
      file_size BIGINT DEFAULT 0,
      sha256 TEXT DEFAULT '',
      image TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS ps3_games_title_idx ON ps3_games(title);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ps3_games_region_idx ON ps3_games(region);`);

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

  /* =========================
     VISITANTES / ONLINE
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_visitors(
      id BIGSERIAL PRIMARY KEY,
      visitor_key TEXT NOT NULL,
      user_id TEXT,
      nick TEXT NOT NULL,
      xp BIGINT DEFAULT 0,
      is_guest BOOLEAN DEFAULT true,
      first_seen_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS site_visitors_visitor_key_unique
    ON site_visitors(visitor_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS site_visitors_last_seen_idx
    ON site_visitors(last_seen_at DESC);
  `);

  /* =========================
     GLOBAL CHAT
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS global_chat(
      id TEXT PRIMARY KEY,
      sender_key TEXT NOT NULL,
      user_id TEXT,
      nick TEXT NOT NULL,
      xp BIGINT DEFAULT 0,
      level BIGINT DEFAULT 1,
      is_guest BOOLEAN DEFAULT true,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS global_chat_created_idx
    ON global_chat(created_at ASC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS global_chat_sender_idx
    ON global_chat(sender_key, created_at DESC);
  `);

}

// 🚀 INICIA O SERVIDOR PRIMEIRO (ESSENCIAL PRO RENDER)
app.listen(PORT, () => {
  console.log("ToolFlix API rodando na porta", PORT);
});

// 🔥 DEPOIS INICIALIZA BANCO E PS3
initDb()
  .then(async () => {
    await importPs3GamesFromFile();
    console.log("✅ Banco e PS3 carregados");
  })
  .catch((e) => {
    console.error("❌ Erro initDb:", e);
  });

app.get("/", (req, res) =>
  res.json({ ok: true, name: "ToolFlix API" })
);

app.get("/ping", (req, res) => {
  res.status(200).send("ok");
});

// UptimeRobot e alguns proxies usam HEAD. Vamos responder bonito.
app.head("/ping", (req, res) => res.sendStatus(200));
app.head("/", (req, res) => res.sendStatus(200));


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

    await pool.query(
      `UPDATE users SET last_login_at=$2 WHERE id=$1`,
      [user.id, Date.now()]
    );

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
        avatar: normalizeAvatarFilename(user.avatar, xpToLevel(Number(user.xp || 0))),
        password_temp: !!user.password_temp,
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
    `SELECT id,nick,xp,premium,premium_until,created_at,last_login_at,
            downloads_count,favorites_count,themes_count,youtube_count,password_temp,avatar
       FROM users WHERE id=$1 LIMIT 1`,
    [req.user.id]
  );

  if (r.rowCount === 0)
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const user = buildProfileStatsRow(r.rows[0]);
  res.json({ ok: true, user });
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
    `SELECT xp, avatar FROM users WHERE id=$1 LIMIT 1`,
    [req.user.id]
  );

  const xp = Number(r.rows[0]?.xp || 0);
  const level = xpToLevel(xp);
  res.json({ ok: true, xp, level, avatar: normalizeAvatarFilename(r.rows[0]?.avatar, level) });
});

app.get("/api/profile/me", auth, async (req, res) => {
  try {
    await cleanupExpiredPremiumAccounts();
    const r = await pool.query(
      `SELECT id,nick,xp,premium,premium_until,created_at,last_login_at,
              downloads_count,favorites_count,themes_count,youtube_count,password_temp,avatar
         FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (r.rowCount === 0)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const profile = buildProfileStatsRow(r.rows[0]);
    delete profile.passwordTemp;
    return res.json({ ok: true, profile });
  } catch (e) {
    console.error("PROFILE_ME_FAIL:", e);
    return res.status(500).json({ ok: false, error: "PROFILE_ME_FAIL" });
  }
});

app.get("/api/profile/:nick", async (req, res) => {
  try {
    await cleanupExpiredPremiumAccounts();
    const nick = (req.params.nick || "").toString().trim();
    const r = await pool.query(
      `SELECT id,nick,xp,premium,premium_until,created_at,last_login_at,
              downloads_count,favorites_count,themes_count,youtube_count,password_temp,avatar
         FROM users
         WHERE LOWER(nick)=LOWER($1)
         LIMIT 1`,
      [nick]
    );

    if (r.rowCount === 0)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const profile = buildProfileStatsRow(r.rows[0]);
    delete profile.passwordTemp;
    return res.json({ ok: true, profile });
  } catch (e) {
    console.error("PROFILE_PUBLIC_FAIL:", e);
    return res.status(500).json({ ok: false, error: "PROFILE_PUBLIC_FAIL" });
  }
});

app.post("/api/profile/avatar", auth, async (req, res) => {
  try {
    const avatar = normalizeAvatarFilename(req.body?.avatar, 1);
    const requestedLevel = Number((avatar.match(/^level-(\d+)(?:-([1-3]))?\.webp$/i) || [])[1] || 1);

    const userR = await pool.query(
      `SELECT id,nick,xp,premium,premium_until,created_at,last_login_at,
              downloads_count,favorites_count,themes_count,youtube_count,password_temp,avatar
         FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (userR.rowCount === 0)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const user = userR.rows[0];
    const level = xpToLevel(Number(user.xp || 0));

    if (requestedLevel > level) {
      return res.status(403).json({ ok: false, error: "AVATAR_LOCKED", needLevel: requestedLevel, currentLevel: level });
    }

    await pool.query(`UPDATE users SET avatar=$2 WHERE id=$1`, [req.user.id, avatar]);

    const r = await pool.query(
      `SELECT id,nick,xp,premium,premium_until,created_at,last_login_at,
              downloads_count,favorites_count,themes_count,youtube_count,password_temp,avatar
         FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    return res.json({ ok: true, profile: buildProfileStatsRow(r.rows[0]) });
  } catch (e) {
    console.error("PROFILE_AVATAR_FAIL:", e);
    return res.status(500).json({ ok: false, error: "PROFILE_AVATAR_FAIL" });
  }
});

app.post("/api/profile/action", auth, async (req, res) => {
  try {
    const type = (req.body?.type || "").toString().trim().toLowerCase();
    let amount = Number(req.body?.amount || 1);
    if (!Number.isFinite(amount) || amount <= 0) amount = 1;
    amount = Math.min(amount, 50);

    const columnMap = {
      download: "downloads_count",
      downloads: "downloads_count",
      favorite: "favorites_count",
      favorites: "favorites_count",
      theme: "themes_count",
      themes: "themes_count",
      youtube: "youtube_count",
    };

    const col = columnMap[type];
    if (!col) {
      return res.status(400).json({ ok: false, error: "ACTION_INVALID" });
    }

    await pool.query(
      `UPDATE users SET ${col} = COALESCE(${col}, 0) + $1 WHERE id=$2`,
      [amount, req.user.id]
    );

    const r = await pool.query(
      `SELECT id,nick,xp,premium,premium_until,created_at,last_login_at,
              downloads_count,favorites_count,themes_count,youtube_count,password_temp,avatar
         FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (r.rowCount === 0)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, profile: buildProfileStatsRow(r.rows[0]) });
  } catch (e) {
    console.error("PROFILE_ACTION_FAIL:", e);
    return res.status(500).json({ ok: false, error: "PROFILE_ACTION_FAIL" });
  }
});

app.post("/api/change-password", auth, async (req, res) => {
  try {
    const currentPassword = (req.body?.currentPassword || "").toString();
    const newPassword = (req.body?.newPassword || "").toString();

    if (!currentPassword) return res.status(400).json({ ok: false, error: "CURRENT_PASSWORD_REQUIRED" });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ ok: false, error: "NEW_PASSWORD_MIN_6" });

    const r = await pool.query(`SELECT id, password_hash FROM users WHERE id=$1 LIMIT 1`, [req.user.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const user = r.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(401).json({ ok: false, error: "CURRENT_PASSWORD_INVALID" });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users
       SET password_hash=$2,
           password_temp=false,
           password_temp_set_at=NULL
       WHERE id=$1`,
      [req.user.id, hash]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("CHANGE_PASSWORD_FAIL:", e);
    return res.status(500).json({ ok: false, error: "CHANGE_PASSWORD_FAIL" });
  }
});

app.post("/api/forgot-password-request", async (req, res) => {
  try {
    const nick = (req.body?.nick || "").toString().trim();
    if (!nick) return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });

    const userR = await pool.query(
      `SELECT id, nick FROM users WHERE LOWER(nick)=LOWER($1) LIMIT 1`,
      [nick]
    );
    if (userR.rowCount === 0) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const user = userR.rows[0];
    const chat = await getOrCreateActiveChat(user.id);
    const now = Date.now();
    const recent = await pool.query(
      `SELECT created_at FROM chat_messages
       WHERE chat_id=$1 AND sender='user' AND message LIKE '🔐 RECUPERAR_SENHA:%'
       ORDER BY created_at DESC LIMIT 1`,
      [chat.id]
    );
    if (recent.rowCount > 0) {
      const lastAt = Number(recent.rows[0].created_at || 0);
      if (now - lastAt < 5 * 60 * 1000) {
        return res.json({ ok: true, sent: false, waitMs: 5 * 60 * 1000 - (now - lastAt) });
      }
    }

    const msgId = "m_" + Math.random().toString(36).slice(2, 10);
    const text = `🔐 RECUPERAR_SENHA: ${user.nick}`;
    await pool.query(
      `INSERT INTO chat_messages(id,chat_id,sender,message,created_at)
       VALUES($1,$2,'user',$3,$4)`,
      [msgId, chat.id, text, now]
    );
    await pool.query(`UPDATE chats SET last_activity_at=$1 WHERE id=$2`, [now, chat.id]);

    return res.json({ ok: true, sent: true, chatId: chat.id, nick: user.nick });
  } catch (e) {
    console.error("FORGOT_PASSWORD_REQUEST_FAIL:", e);
    return res.status(500).json({ ok: false, error: "FORGOT_PASSWORD_REQUEST_FAIL" });
  }
});

app.get(
  "/api/admin/find-user-by-nick",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      const nick = (req.query?.nick || "").toString().trim();
      if (!nick) return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });

      const r = await pool.query(
        `SELECT id,nick,xp,premium,password_temp,created_at,last_login_at
         FROM users
         WHERE LOWER(nick)=LOWER($1)
         LIMIT 1`,
        [nick]
      );
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

      const row = r.rows[0];
      return res.json({
        ok: true,
        user: {
          id: row.id,
          nick: row.nick,
          xp: Number(row.xp || 0),
          premium: !!row.premium,
          password_temp: !!row.password_temp,
          created_at: Number(row.created_at || 0),
          last_login_at: Number(row.last_login_at || 0),
        }
      });
    } catch (e) {
      console.error("ADMIN_FIND_USER_FAIL:", e);
      return res.status(500).json({ ok: false, error: "ADMIN_FIND_USER_FAIL" });
    }
  }
);

app.post(
  "/api/admin/reset-password-temp",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      const nick = (req.body?.nick || "").toString().trim();
      let tempPassword = (req.body?.tempPassword || "").toString().trim();
      if (!nick) return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });

      const r = await pool.query(`SELECT id,nick FROM users WHERE LOWER(nick)=LOWER($1) LIMIT 1`, [nick]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      const user = r.rows[0];

      if (!tempPassword) {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        tempPassword = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      }

      const hash = await bcrypt.hash(tempPassword, 10);
      await pool.query(
        `UPDATE users
         SET password_hash=$2,
             password_temp=true,
             password_temp_set_at=$3
         WHERE id=$1`,
        [user.id, hash, Date.now()]
      );

      return res.json({ ok: true, nick: user.nick, tempPassword });
    } catch (e) {
      console.error("ADMIN_RESET_PASSWORD_TEMP_FAIL:", e);
      return res.status(500).json({ ok: false, error: "ADMIN_RESET_PASSWORD_TEMP_FAIL" });
    }
  }
);


app.get("/api/recovery-chat/:nick", async (req, res) => {
  try {
    const nick = (req.params.nick || "").toString().trim();
    if (!nick) return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });

    const userR = await pool.query(
      `SELECT id, nick, password_temp FROM users WHERE LOWER(nick)=LOWER($1) LIMIT 1`,
      [nick]
    );
    if (userR.rowCount === 0) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const user = userR.rows[0];
    const now = Date.now();

    const chatR = await pool.query(
      `SELECT id
         FROM chats
        WHERE user_id=$1
          AND expires_at >= $2
        ORDER BY last_activity_at DESC, created_at DESC
        LIMIT 1`,
      [user.id, now]
    );

    if (chatR.rowCount === 0) {
      return res.json({ ok: true, nick: user.nick, passwordTemp: !!user.password_temp, messages: [] });
    }

    const chatId = chatR.rows[0].id;
    const reqR = await pool.query(
      `SELECT created_at
         FROM chat_messages
        WHERE chat_id=$1
          AND sender='user'
          AND message LIKE '🔐 RECUPERAR_SENHA:%'
        ORDER BY created_at DESC
        LIMIT 1`,
      [chatId]
    );

    if (reqR.rowCount === 0) {
      return res.json({ ok: true, nick: user.nick, passwordTemp: !!user.password_temp, messages: [] });
    }

    const since = Number(reqR.rows[0].created_at || 0);
    const msgs = await pool.query(
      `SELECT sender, message, created_at
         FROM chat_messages
        WHERE chat_id=$1
          AND created_at >= $2
        ORDER BY created_at ASC`,
      [chatId, since]
    );

    const messages = msgs.rows.map((m) => {
      const raw = String(m.message || "");
      return {
        sender: m.sender,
        message: raw.startsWith("🔐 RECUPERAR_SENHA:")
          ? "Pedido de recuperação enviado. Aguarde a resposta do administrador."
          : raw,
        created_at: Number(m.created_at || 0),
      };
    });

    return res.json({
      ok: true,
      nick: user.nick,
      passwordTemp: !!user.password_temp,
      messages,
    });
  } catch (e) {
    console.error("RECOVERY_CHAT_GET_FAIL:", e);
    return res.status(500).json({ ok: false, error: "RECOVERY_CHAT_GET_FAIL" });
  }
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

app.get("/api/ps3-games", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query?.page || 1) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 24) || 24));
    const offset = (page - 1) * limit;
    const search = (req.query?.search || "").toString().trim().toLowerCase();

    const params = [];
    let where = "";
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE LOWER(title) LIKE $${params.length} OR LOWER(title_id) LIKE $${params.length}`;
    }

    const totalQuery = `SELECT COUNT(*)::int AS total FROM ps3_games ${where}`;
    const totalResult = await pool.query(totalQuery, params);
    const total = Number(totalResult.rows[0]?.total || 0);

    params.push(limit);
    params.push(offset);

    const dataQuery = `
      SELECT title_id, region, title, pkg_link, rap, content_id, last_modification_date,
             rap_file_link, file_size, sha256, image, description, created_at, updated_at
      FROM ps3_games
      ${where}
      ORDER BY title ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const r = await pool.query(dataQuery, params);
    const games = r.rows.map((row) => ({
      title: row.title,
      category: "PAINEL PS3",
      link: row.pkg_link,
      image: row.image,
      description: row.description,
      trailer_url: "",
      premium: false,
      created_at: Number(row.updated_at || row.created_at || 0),
      title_id: row.title_id,
      region: row.region,
      file_size: Number(row.file_size || 0),
      sha256: row.sha256 || ""
    }));

    res.json({ ok: true, games, total, page, limit, hasMore: offset + games.length < total });
  } catch (e) {
    console.error("PS3_GAMES_GET_FAIL:", e);
    res.status(500).json({ ok: false, error: "PS3_GAMES_GET_FAIL" });
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
      const description = (body.description || "").toString().trim();
      const trailerUrl = (body.trailer_url || body.trailerUrl || body.trailer || "").toString().trim();
      const premium = !!body.premium;

      if (!title || !link)
        return res.status(400).json({
          ok: false,
          error: "title e link obrigatórios"
        });

      const id = "g_" + Math.random().toString(36).slice(2, 10);

      await pool.query(
        `
        INSERT INTO games(id,title,link,image,category,description,trailer_url,premium,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (link) DO UPDATE
        SET title = EXCLUDED.title,
            image = EXCLUDED.image,
            category = EXCLUDED.category,
            description = EXCLUDED.description,
            trailer_url = EXCLUDED.trailer_url,
            premium = EXCLUDED.premium
        `,
        [id, title, link, image, category, description, trailerUrl, premium, Date.now()]
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
  const client = await pool.connect();
  try {
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const userId = (req.body?.userId || "").toString().trim();

    if (!token || !userId) {
      return res.status(400).json({ ok: false, reason: "TOKEN_OU_USUARIO_INVALIDO" });
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, nick FROM users WHERE id=$1 LIMIT 1`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, reason: "USUARIO_NAO_ENCONTRADO" });
    }

    const tokenResult = await client.query(
      `SELECT * FROM tokens WHERE token=$1 LIMIT 1`,
      [token]
    );

    if (tokenResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, reason: "TOKEN_INEXISTENTE" });
    }

    const t = tokenResult.rows[0];
    const now = Date.now();

    if (now > Number(t.expires_at)) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, reason: "TOKEN_EXPIRADO" });
    }

    if (t.used_by) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, reason: "TOKEN_JA_USADO" });
    }

    await client.query(
      `UPDATE tokens SET used_by=$1, used_at=$2 WHERE token=$3`,
      [userId, now, token]
    );

    await client.query(
      `UPDATE users
       SET premium = true,
           premium_since = $2,
           premium_until = $3,
           premium_token_used = $4,
           premium_removed_at = NULL,
           premium_removed_by = NULL
       WHERE id = $1`,
      [userId, now, Number(t.expires_at), token]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, valid: true, premiumUntil: Number(t.expires_at) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("VALIDAR_TOKEN_FAIL:", e);
    return res.status(500).json({ ok: false, reason: "VALIDAR_TOKEN_FAIL" });
  } finally {
    client.release();
  }
});

app.get("/api/is-premium/:userId", async (req, res) => {
  try {
    await cleanupExpiredPremiumAccounts();
    const r = await pool.query(
      `SELECT premium, premium_until FROM users WHERE id=$1 LIMIT 1`,
      [req.params.userId]
    );

    const row = r.rows[0];
    const premium = !!(row && row.premium && (!row.premium_until || Number(row.premium_until) > Date.now()));
    res.json({ ok: true, premium, premiumUntil: row?.premium_until || null });
  } catch (e) {
    console.error("IS_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, premium: false });
  }
});

app.get("/api/total-premium", async (req, res) => {
  try {
    await cleanupExpiredPremiumAccounts();
    const now = Date.now();
    const r = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users
       WHERE premium = true
         AND (premium_until IS NULL OR premium_until > $1)`,
      [now]
    );

    res.json({ ok: true, totalPremium: Number(r.rows[0]?.total || 0) });
  } catch (e) {
    console.error("TOTAL_PREMIUM_FAIL:", e);
    res.status(500).json({ ok: false, totalPremium: 0 });
  }
});

app.get(
  "/api/admin/premium-users",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      await cleanupExpiredPremiumAccounts();
      const now = Date.now();
      const r = await pool.query(
        `SELECT id AS user_id,
                nick,
                xp,
                premium_since AS since,
                premium_until AS expires_at,
                premium_token_used AS token_used,
                premium_removed_at AS removed_at,
                premium_removed_by AS removed_by,
                false AS orphan
         FROM users
         WHERE premium = true
           AND (premium_until IS NULL OR premium_until > $1)
         ORDER BY premium_since DESC NULLS LAST, created_at DESC`,
        [now]
      );

      const premiumUsers = r.rows.map((row) => ({
        ...row,
        token_masked: maskToken(row.token_used),
      }));

      res.json({
        ok: true,
        totalPremium: premiumUsers.length,
        premiumUsers,
        users: premiumUsers,
        removedPremiumUsers: [],
      });
    } catch (e) {
      console.error("ADMIN_PREMIUM_USERS_FAIL:", e);
      res.status(500).json({ ok: false, error: "ADMIN_PREMIUM_USERS_FAIL" });
    }
  }
);

app.post(
  "/api/admin/premium-users/remove",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const userId = (req.body?.userId || req.body?.id || "").toString().trim();
      if (!userId) {
        return res.status(400).json({ ok: false, error: "USER_ID_REQUIRED" });
      }

      const removedBy = req.user?.nick === MASTER_NICK ? MASTER_NICK : "admin_key";
      const now = Date.now();
      await client.query("BEGIN");

      const userUpdate = await client.query(
        `UPDATE users
         SET premium = false,
             premium_removed_at = $2,
             premium_removed_by = $3
         WHERE id = $1
         RETURNING id, nick`,
        [userId, now, removedBy]
      );

      await client.query("COMMIT");
      res.json({
        ok: true,
        removed: true,
        userId,
        nick: userUpdate.rows[0]?.nick || null,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("ADMIN_REMOVE_PREMIUM_FAIL:", e);
      res.status(500).json({ ok: false, error: "ADMIN_REMOVE_PREMIUM_FAIL" });
    } finally {
      client.release();
    }
  }
);


app.post(
  "/api/admin/premium-reset-all",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const removedBy = req.user?.nick === MASTER_NICK ? MASTER_NICK : "admin_key";
      const now = Date.now();
      await client.query("BEGIN");

      const usersReset = await client.query(
        `UPDATE users
         SET premium = false,
             premium_since = NULL,
             premium_until = NULL,
             premium_token_used = NULL,
             premium_removed_at = $1,
             premium_removed_by = $2
         WHERE premium = true`,
        [now, removedBy]
      );

      const legacyCleared = await client.query(`DELETE FROM premium_users`);

      await client.query("COMMIT");
      res.json({
        ok: true,
        reset: true,
        usersUpdated: usersReset.rowCount || 0,
        legacyDeleted: legacyCleared.rowCount || 0,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("ADMIN_PREMIUM_RESET_ALL_FAIL:", e);
      res.status(500).json({ ok: false, error: "ADMIN_PREMIUM_RESET_ALL_FAIL" });
    } finally {
      client.release();
    }
  }
);

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
   VISITANTES / ONLINE
========================= */

app.post("/api/visitor", authOptional, async (req, res) => {
  try {
    const now = Date.now();
    const visitorKey = getVisitorKey(req);
    const nick = req.user?.nick || "Visitante";
    const userId = req.user?.id || null;

    let xp = 0;
    if (userId) {
      const ur = await pool.query(`SELECT xp FROM users WHERE id=$1 LIMIT 1`, [userId]);
      xp = Number(ur.rows[0]?.xp || 0);
    }

    await pool.query(
      `INSERT INTO site_visitors(visitor_key,user_id,nick,xp,is_guest,first_seen_at,last_seen_at)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (visitor_key) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           nick = EXCLUDED.nick,
           xp = EXCLUDED.xp,
           is_guest = EXCLUDED.is_guest,
           last_seen_at = EXCLUDED.last_seen_at`,
      [visitorKey, userId, nick, xp, !userId, now]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("VISITOR_POST_FAIL:", e);
    res.status(500).json({ ok: false, error: "VISITOR_POST_FAIL" });
  }
});

app.get("/api/visitors", async (req, res) => {
  try {
    const now = Date.now();
    const onlineMin = now - ONLINE_WINDOW_MS;

    const onlineR = await pool.query(
      `SELECT nick, xp, is_guest, last_seen_at
       FROM site_visitors
       WHERE last_seen_at >= $1
       ORDER BY last_seen_at DESC
       LIMIT 50`,
      [onlineMin]
    );

    const lastSeenR = await pool.query(
      `SELECT nick, xp, is_guest, last_seen_at
       FROM site_visitors
       WHERE last_seen_at < $1
       ORDER BY last_seen_at DESC
       LIMIT 10`,
      [onlineMin]
    );

    res.json({
      ok: true,
      onlineCount: onlineR.rowCount,
      online: onlineR.rows.map(r => {
        const xp = Number(r.xp || 0);
        const level = xpToLevel(xp);
        return {
          nick: r.nick,
          xp,
          level,
          avatar: levelToAvatar(level),
          is_guest: !!r.is_guest,
          last_seen_at: Number(r.last_seen_at || 0),
        };
      }),
      lastSeen: lastSeenR.rows.map(r => {
        const xp = Number(r.xp || 0);
        const level = xpToLevel(xp);
        return {
          nick: r.nick,
          xp,
          level,
          avatar: levelToAvatar(level),
          is_guest: !!r.is_guest,
          last_seen_at: Number(r.last_seen_at || 0),
        };
      }),
    });
  } catch (e) {
    console.error("VISITORS_GET_FAIL:", e);
    res.status(500).json({ ok: false, error: "VISITORS_GET_FAIL" });
  }
});


/* =========================
   GLOBAL CHAT
========================= */

app.get('/api/global-chat/messages', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT nick, xp, level, is_guest, message, created_at
      FROM global_chat
      ORDER BY created_at ASC
      LIMIT 100
    `);

    res.json({
      ok: true,
      messages: r.rows.map(m => {
        const level = Number(m.level || 1);
        return {
          nick: m.nick,
          xp: Number(m.xp || 0),
          level,
          avatar: levelToAvatar(level),
          is_guest: !!m.is_guest,
          message: m.message,
          created_at: Number(m.created_at || 0)
        };
      })
    });
  } catch (e) {
    console.error('GLOBAL_CHAT_MESSAGES_FAIL:', e);
    res.status(500).json({ ok: false, error: 'GLOBAL_CHAT_MESSAGES_FAIL' });
  }
});

app.post('/api/global-chat/send', authOptional, async (req, res) => {
  try {
    const text = (req.body?.message || '').toString().trim();
    if (!text) return res.status(400).json({ ok: false, error: 'MESSAGE_REQUIRED' });
    if (text.length > GLOBAL_CHAT_MAX_LEN) {
      return res.status(400).json({ ok: false, error: 'MESSAGE_TOO_LONG', max: GLOBAL_CHAT_MAX_LEN });
    }

    const now = Date.now();
    const senderKey = getVisitorKey(req);

    const last = await pool.query(
      `SELECT created_at FROM global_chat WHERE sender_key=$1 ORDER BY created_at DESC LIMIT 1`,
      [senderKey]
    );
    if (last.rowCount > 0) {
      const lastAt = Number(last.rows[0].created_at || 0);
      if (now - lastAt < GLOBAL_CHAT_SPAM_MS) {
        return res.status(429).json({ ok: false, error: 'SPAM', waitMs: GLOBAL_CHAT_SPAM_MS - (now - lastAt) });
      }
    }

    let nick = req.user?.nick || '';
    let userId = req.user?.id || null;
    let xp = 0;
    let level = 1;
    let isGuest = !userId;

    if (userId) {
      const ur = await pool.query(`SELECT nick, xp FROM users WHERE id=$1 LIMIT 1`, [userId]);
      nick = ur.rows[0]?.nick || nick || 'Usuário';
      xp = Number(ur.rows[0]?.xp || 0);
      level = xpToLevel(xp);
    } else {
      const raw = senderKey.replace(/^guest:/, '');
      const suffix = raw.slice(-2).padStart(2, '0').replace(/\s/g, '');
      nick = `Usuário ${suffix}`;
      xp = 0;
      level = 1;
      isGuest = true;
    }

    const msgId = 'gc_' + Math.random().toString(36).slice(2, 10);
    await pool.query(
      `INSERT INTO global_chat(id,sender_key,user_id,nick,xp,level,is_guest,message,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [msgId, senderKey, userId, nick, xp, level, isGuest, text, now]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('GLOBAL_CHAT_SEND_FAIL:', e);
    res.status(500).json({ ok: false, error: 'GLOBAL_CHAT_SEND_FAIL' });
  }
});


/* =========================
   CHAT SYSTEM
========================= */

const CHAT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_SPAM_MS = 30 * 1000;
const GLOBAL_CHAT_SPAM_MS = 3 * 1000;
const GLOBAL_CHAT_MAX_LEN = 200;

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

app.post(
  "/api/global-chat/delete",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      const messageId = (req.body?.messageId || req.body?.id || "").toString().trim();
      if (!messageId) {
        return res.status(400).json({ ok: false, error: "MESSAGE_ID_REQUIRED" });
      }
      if (req.user?.nick !== MASTER_NICK) {
        return res.status(403).json({ ok: false, error: "MASTER_ONLY" });
      }

      const now = Date.now();
      const upd = await pool.query(
        `UPDATE global_chat
         SET message = 'Mensagem apagada pelo administrador'
         WHERE id=$1
         RETURNING id`,
        [messageId]
      );

      if (!upd.rowCount) {
        return res.status(404).json({ ok: false, error: "MESSAGE_NOT_FOUND" });
      }

      res.json({ ok: true, deleted: true, messageId, deletedAt: now });
    } catch (e) {
      console.error("GLOBAL_CHAT_DELETE_FAIL:", e);
      res.status(500).json({ ok: false, error: "GLOBAL_CHAT_DELETE_FAIL" });
    }
  }
);


app.post(
  "/api/admin/chats/open-by-nick",
  authOptional,
  requireAdminOrMaster,
  async (req, res) => {
    try {
      if (req.user?.nick !== MASTER_NICK) {
        return res.status(403).json({ ok: false, error: "MASTER_ONLY" });
      }

      const nick = (req.body?.nick || "").toString().trim();
      if (!nick) return res.status(400).json({ ok: false, error: "NICK_REQUIRED" });

      const userResult = await pool.query(
        `SELECT id, nick FROM users WHERE LOWER(nick)=LOWER($1) LIMIT 1`,
        [nick]
      );

      if (userResult.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
      }

      const user = userResult.rows[0];
      if (user.nick === MASTER_NICK) {
        return res.status(400).json({ ok: false, error: "CANNOT_CHAT_SELF" });
      }

      const chat = await getOrCreateActiveChat(user.id);

      await pool.query(
        `UPDATE chats SET last_activity_at=$1 WHERE id=$2`,
        [Date.now(), chat.id]
      );

      return res.json({
        ok: true,
        chat: {
          id: chat.id,
          user_id: user.id,
          nick: user.nick,
          expires_at: chat.expires_at
        }
      });
    } catch (e) {
      console.error("OPEN_CHAT_BY_NICK_FAIL:", e);
      return res.status(500).json({ ok: false, error: "OPEN_CHAT_BY_NICK_FAIL" });
    }
  }
);


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



app.get("/api/ps3-debug", async (req, res) => {
  try {
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ps3_games`);
    return res.json({ ok: true, route: true, total: Number(count.rows[0]?.total || 0), cwd: process.cwd(), dir: __dirname, hasTsv: fs.existsSync(path.join(__dirname, "PS3_GAMES.tsv")) || fs.existsSync(path.join(process.cwd(), "PS3_GAMES.tsv")) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "PS3_DEBUG_FAIL", detail: String(e && e.message || e) });
  }
});
