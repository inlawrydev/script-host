const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("./config.json");

const BINDINGS_PATH = path.join(__dirname, "hwid_bindings.json");
const SCRIPTS_DIR = path.join(__dirname, "scripts");

// ============================================================
// Работа с привязками HWID
// ============================================================
function loadBindings() {
  if (!fs.existsSync(BINDINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(BINDINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveBindings(data) {
  fs.writeFileSync(BINDINGS_PATH, JSON.stringify(data, null, 2));
}

// ============================================================
// Инициализация
// ============================================================
const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// Хранилища
const bannedIPs = new Set(config.blockedIPs || []);
const suspicious = new Map();
const sessions = new Map();

// Очистка истёкших сессий
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expires < now) sessions.delete(id);
  }
}, 10_000).unref?.();

// ============================================================
// Suspicion / бан IP
// ============================================================
function addSuspicion(ip, weight = 1, reason = "") {
  const cur = (suspicious.get(ip) || 0) + weight;
  suspicious.set(ip, cur);
  if (cur >= 5) {
    bannedIPs.add(ip);
    console.warn(`[BAN] ${ip} (score=${cur}) ${reason}`);
  }
}

// ============================================================
// Rate limiting
// ============================================================
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    addSuspicion(req.ip, 2, "rate-limit");
    res.status(429).json({ error: "Too many requests" });
  },
}));

// ============================================================
// Хонейпоты
// ============================================================
["/admin.php", "/.env", "/wp-login.php", "/.git", "/config.json", "/.aws"].forEach((p) => {
  app.all(p, (req, res) => {
    addSuspicion(req.ip, 5, "honeypot");
    console.warn(`[HONEYPOT] ${req.ip} -> ${p}`);
    res.status(404).end();
  });
});

// ============================================================
// Блокировка забаненных IP
// ============================================================
app.use((req, res, next) => {
  if (bannedIPs.has(req.ip)) return res.status(403).end();
  next();
});

// ============================================================
// User-Agent whitelist
// ============================================================
function isAllowedUA(ua = "") {
  return config.allowedUserAgents.some((t) =>
    ua.toLowerCase().includes(t.toLowerCase())
  );
}

// ============================================================
// HMAC-подпись
// ============================================================
function verifySignature({ token, timestamp, signature, extra }) {
  if (!config.authTokens.includes(token)) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > config.maxTimestampSkewMs) return false;

  const payload = `${token}:${timestamp}:${extra}`;
  const expected = crypto
    .createHmac("sha256", config.hmacSecret)
    .update(payload)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature || "", "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============================================================
// POST /auth — авторизация по HWID
// ============================================================
app.post("/auth", (req, res) => {
  const {
    token,
    hwid,
    executor,
    userId,
    username,
    timestamp,
    signature,
    scriptName,
  } = req.body || {};

  // 1. User-Agent
  if (!isAllowedUA(req.get("user-agent") || "")) {
    addSuspicion(req.ip, 3, "bad-ua");
    return res.status(403).json({ error: "Forbidden" });
  }

  // 2. Обязательные поля
  if (!token || !hwid || !executor || !timestamp || !signature) {
    addSuspicion(req.ip, 2, "missing-fields");
    return res.status(400).json({ error: "Missing fields" });
  }

  // 3. Подпись
  const extra = `${hwid}:${executor}:${scriptName || ""}`;
  if (!verifySignature({ token, timestamp, signature, extra })) {
    addSuspicion(req.ip, 2, "bad-signature");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 4. Проверка привязок
  const bindings = loadBindings();
  const record = bindings[token];

  if (!record) {
    bindings[token] = {
      hwid,
      executor,
      userId: userId || null,
      username: username || null,
      banned: false,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      maxExecutors: config.defaultAllowedExecutors,
    };
    saveBindings(bindings);
    console.log(`[BIND] new ${hwid} → ${executor} (${username || userId})`);
  } else {
    if (record.banned) {
      return res.status(403).json({ error: "Banned" });
    }

    if (record.hwid !== hwid) {
      addSuspicion(req.ip, 5, "hwid-mismatch");
      console.warn(`[ALERT] HWID mismatch for token ${token.slice(0, 8)}…`);
      return res.status(403).json({ error: "HWID mismatch" });
    }

    if (
      Array.isArray(record.maxExecutors) &&
      record.maxExecutors.length > 0 &&
      !record.maxExecutors.includes(executor)
    ) {
      console.warn(`[ALERT] forbidden executor ${executor}`);
      return res.status(403).json({ error: "Executor not allowed" });
    }

    if (record.userId && userId && record.userId !== userId) {
      addSuspicion(req.ip, 4, "userid-mismatch");
      return res.status(403).json({ error: "UserId mismatch" });
    }

    record.lastSeen = Date.now();
    record.executor = executor;
    saveBindings(bindings);
  }

  // 5. Сессия на 60 сек
  const sessionId = crypto.randomBytes(24).toString("hex");
  sessions.set(sessionId, {
    token,
    hwid,
    executor,
    expires: Date.now() + 60_000,
  });

  res.json({ session: sessionId, expiresIn: 60 });
});

// ============================================================
// GET /script/:name — отдача скрипта
// ============================================================
app.get("/script/:name", (req, res) => {
  const { name } = req.params;
  const sessionId = req.get("x-session");

  if (!sessionId) return res.status(401).json({ error: "No session" });
  const s = sessions.get(sessionId);
  if (!s || s.expires < Date.now()) {
    return res.status(401).json({ error: "Session expired" });
  }

  // Одноразовость
  sessions.delete(sessionId);

  const safeName = path.basename(name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!filePath.startsWith(SCRIPTS_DIR)) return res.status(400).end();
  if (!fs.existsSync(filePath)) return res.status(404).end();

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(fs.readFileSync(filePath, "utf8"));
});

// ============================================================
// POST /admin/ban — бан/разбан
// ============================================================
app.post("/admin/ban", (req, res) => {
  const { adminKey, token, ban } = req.body || {};
  if (adminKey !== config.adminKey) return res.status(403).end();

  const bindings = loadBindings();
  if (!bindings[token]) return res.status(404).json({ error: "not found" });

  bindings[token].banned = !!ban;
  saveBindings(bindings);
  res.json({ ok: true, token, banned: bindings[token].banned });
});

// ============================================================
// Статика (сайт)
// ============================================================
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// API: список скриптов
// ============================================================
app.get("/api/scripts", (req, res) => {
  if (!fs.existsSync(SCRIPTS_DIR)) return res.json([]);

  const list = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".lua"))
    .map((f) => {
      const stat = fs.statSync(path.join(SCRIPTS_DIR, f));
      const content = fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8");
      return {
        name: f,
        size: stat.size,
        updated: stat.mtimeMs,
        lines: content.split("\n").length,
      };
    });

  res.json(list);
});

// ============================================================
// POST /api/scripts/upload — загрузить скрипт (админ)
// ============================================================
app.post("/api/scripts/upload", (req, res) => {
  if (req.get("x-admin-key") !== config.adminKey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { name, content } = req.body || {};
  if (!name || !content) {
    return res.status(400).json({ error: "Missing name or content" });
  }

  if (!name.endsWith(".lua")) {
    return res.status(400).json({ error: "Only .lua files allowed" });
  }

  if (content.length > 1024 * 1024) {
    return res.status(400).json({ error: "File too large (max 1MB)" });
  }

  // Безопасность: проверка имени файла
  const safeName = path.basename(name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!filePath.startsWith(SCRIPTS_DIR)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  // Создание папки если её нет
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  try {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`[UPLOAD] ${safeName} by admin`);
    res.json({ ok: true, name: safeName });
  } catch (e) {
    console.error(`[UPLOAD ERROR] ${e.message}`);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ============================================================
// POST /api/scripts/delete — удалить скрипт (админ)
// ============================================================
app.post("/api/scripts/delete", (req, res) => {
  if (req.get("x-admin-key") !== config.adminKey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "Missing name" });
  }

  const safeName = path.basename(name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!filePath.startsWith(SCRIPTS_DIR)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "not found" });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`[DELETE] ${safeName} by admin`);
    res.json({ ok: true, name: safeName });
  } catch (e) {
    console.error(`[DELETE ERROR] ${e.message}`);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ============================================================
// API: предпросмотр скрипта (только админ)
// ============================================================
app.get("/api/scripts/:name/preview", (req, res) => {
  if (req.get("x-admin-key") !== config.adminKey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const safeName = path.basename(req.params.name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const code = fs.readFileSync(filePath, "utf8");
  res.json({
    name: safeName,
    code: code.split("\n").slice(0, 50).join("\n"),
    total: code.split("\n").length,
  });
});

// ============================================================
// API: список привязок (только админ)
// ============================================================
app.get("/api/bindings", (req, res) => {
  if (req.get("x-admin-key") !== config.adminKey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const bindings = loadBindings();
  const list = Object.entries(bindings).map(([token, data]) => ({
    token: token.slice(0, 12) + "…" + token.slice(-4),
    fullToken: token,
    hwid: data.hwid ? data.hwid.slice(0, 16) + "…" : "—",
    executor: data.executor,
    username: data.username,
    userId: data.userId,
    banned: data.banned,
    createdAt: data.createdAt,
    lastSeen: data.lastSeen,
  }));

  res.json(list);
});

// ============================================================
// Запуск
// ============================================================
const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`Script host on http://localhost:${PORT}`);
});
