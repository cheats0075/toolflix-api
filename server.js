const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ✅ CORS: permite seu site do GitHub chamar a API
app.use(
  cors({
    origin: "*", // depois a gente restringe pro seu domínio do GitHub Pages
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const DATA_DIR = path.join(__dirname, "data");
const GAMES_FILE = path.join(DATA_DIR, "games.json");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const PREMIUM_FILE = path.join(DATA_DIR, "premium_users.json");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

  if (!fs.existsSync(GAMES_FILE)) fs.writeFileSync(GAMES_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(PREMIUM_FILE)) fs.writeFileSync(PREMIUM_FILE, JSON.stringify([], null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

ensureDataFiles();

// ✅ Health check
app.get("/", (req, res) => {
  res.json({ ok: true, name: "ToolFlix API", time: new Date().toISOString() });
});

/* =========================
   GAMES (Catálogo)
========================= */

// Listar jogos
app.get("/api/games", (req, res) => {
  const games = readJson(GAMES_FILE);
  res.json({ ok: true, games });
});

// Adicionar jogo (modo teste: sem senha)
app.post("/api/admin/games", (req, res) => {
  const { title, link, image } = req.body || {};
  if (!title || !link) return res.status(400).json({ ok: false, error: "title e link são obrigatórios" });

  const games = readJson(GAMES_FILE);
  const newGame = {
    id: "g_" + Math.random().toString(36).slice(2, 10),
    title,
    link,
    image: image || "",
    createdAt: Date.now(),
  };
  games.unshift(newGame);
  writeJson(GAMES_FILE, games);

  res.json({ ok: true, game: newGame });
});

/* =========================
   TOKENS + PREMIUM
========================= */

// Gerar token (modo teste: sem senha)
app.post("/api/admin/tokens", (req, res) => {
  const { days = 30 } = req.body || {};
  const tokens = readJson(TOKENS_FILE);

  const token = "TFX-" + Math.random().toString(36).toUpperCase().slice(2, 8) + "-" + Math.random().toString(36).toUpperCase().slice(2, 8);
  const now = Date.now();
  const expiresAt = now + Number(days) * 24 * 60 * 60 * 1000;

  const newToken = {
    token,
    createdAt: now,
    expiresAt,
    usedBy: null,
    usedAt: null,
  };

  tokens.unshift(newToken);
  writeJson(TOKENS_FILE, tokens);

  res.json({ ok: true, token: newToken });
});

// Validar token e ativar premium para um userId
app.post("/api/validar-token", (req, res) => {
  const { token, userId } = req.body || {};
  if (!token || !userId) return res.status(400).json({ ok: false, error: "token e userId são obrigatórios" });

  const tokens = readJson(TOKENS_FILE);
  const t = tokens.find((x) => x.token === token);

  if (!t) return res.json({ ok: false, valid: false, reason: "TOKEN_INEXISTENTE" });
  if (Date.now() > t.expiresAt) return res.json({ ok: false, valid: false, reason: "TOKEN_EXPIRADO" });
  if (t.usedBy && t.usedBy !== userId) return res.json({ ok: false, valid: false, reason: "TOKEN_JA_USADO" });

  // marca como usado
  t.usedBy = userId;
  t.usedAt = Date.now();
  writeJson(TOKENS_FILE, tokens);

  // registra premium
  const premium = readJson(PREMIUM_FILE);
  const already = premium.find((p) => p.userId === userId);
  if (!already) {
    premium.unshift({ userId, since: Date.now() });
    writeJson(PREMIUM_FILE, premium);
  }

  res.json({ ok: true, valid: true, userId });
});

// Ver status premium
app.get("/api/premium-status", (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ ok: false, error: "userId é obrigatório" });

  const premium = readJson(PREMIUM_FILE);
  const isPremium = premium.some((p) => p.userId === userId);

  res.json({ ok: true, userId, isPremium });
});

// Total de usuários premium
app.get("/api/total-premium", (req, res) => {
  const premium = readJson(PREMIUM_FILE);
  res.json({ ok: true, totalPremium: premium.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("ToolFlix API rodando na porta", PORT));