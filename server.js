const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");

const config = require("./config.json");
const SCRIPTS_DIR = path.join(__dirname, "scripts");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// ============================================================
// Simple protection
// ============================================================
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
}));

["/admin.php", "/.env", "/wp-login.php", "/.git", "/config.json", "/.aws"].forEach((p) => {
  app.all(p, (req, res) => res.status(404).end());
});

// ============================================================
// Static website
// ============================================================
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// List scripts (public)
// ============================================================
app.get("/api/scripts", (req, res) => {
  if (!fs.existsSync(SCRIPTS_DIR)) return res.json([]);

  const list = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".lua"))
    .map((f) => {
      const full = path.join(SCRIPTS_DIR, f);
      const stat = fs.statSync(full);
      const content = fs.readFileSync(full, "utf8");
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
// Raw script access (public, no browser preview)
// ============================================================
app.get("/script/:name", (req, res) => {
  const { name } = req.params;
  const safeName = path.basename(name);
  const filePath = path.join(SCRIPTS_DIR, safeName);

  if (!filePath.startsWith(SCRIPTS_DIR)) return res.status(400).end();
  if (!fs.existsSync(filePath)) return res.status(404).end();

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(fs.readFileSync(filePath, "utf8"));
});

// ============================================================
// Admin upload/delete (protected by adminKey)
// ============================================================
app.post("/api/scripts/upload", (req, res) => {
  const adminKey = req.get("x-admin-key");
  if (adminKey !== config.adminKey) return res.status(403).json({ error: "Forbidden" });

  const { name, content } = req.body || {};
  if (!name || !content) return res.status(400).json({ error: "Missing name or content" });
  if (!name.endsWith(".lua")) return res.status(400).json({ error: "Only .lua files allowed" });

  const safeName = path.basename(name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!filePath.startsWith(SCRIPTS_DIR)) return res.status(400).json({ error: "Invalid filename" });

  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

  fs.writeFileSync(filePath, content, "utf8");
  res.json({ ok: true, name: safeName });
});

app.post("/api/scripts/delete", (req, res) => {
  const adminKey = req.get("x-admin-key");
  if (adminKey !== config.adminKey) return res.status(403).json({ error: "Forbidden" });

  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing name" });

  const safeName = path.basename(name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!filePath.startsWith(SCRIPTS_DIR)) return res.status(400).json({ error: "Invalid filename" });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });

  fs.unlinkSync(filePath);
  res.json({ ok: true, name: safeName });
});

app.get("/api/scripts/:name/preview", (req, res) => {
  const adminKey = req.get("x-admin-key");
  if (adminKey !== config.adminKey) return res.status(403).json({ error: "Forbidden" });

  const safeName = path.basename(req.params.name);
  const filePath = path.join(SCRIPTS_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const content = fs.readFileSync(filePath, "utf8");
  res.json({
    name: safeName,
    code: content.split("\n").slice(0, 50).join("\n"),
    total: content.split("\n").length,
  });
});

// ============================================================
// Start server
// ============================================================
const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`Script host running on http://localhost:${PORT}`);
});
