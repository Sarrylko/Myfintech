const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const qrcode = require("qrcode-terminal");

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "/app/.wwebjs_auth" }),
  puppeteer: {
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
    ],
  },
});

let isReady = false;

client.on("qr", (qr) => {
  console.log("\n📱 WhatsApp not connected — scan this QR with your SPARE PHONE:\n");
  qrcode.generate(qr, { small: true });
  console.log("\nTip: run  docker compose logs -f whatsapp-bot  to see this QR\n");
});

client.on("ready", () => {
  isReady = true;
  console.log("✅ WhatsApp client ready — notifications enabled");
});

client.on("authenticated", () => {
  console.log("🔐 WhatsApp authenticated — session saved");
});

client.on("auth_failure", (msg) => {
  console.error("❌ WhatsApp auth failed:", msg);
  isReady = false;
});

client.on("disconnected", (reason) => {
  console.warn("⚠️  WhatsApp disconnected:", reason);
  isReady = false;
});

client.initialize();

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ready: isReady, status: isReady ? "connected" : "connecting" });
});

// ── Connected phone info ───────────────────────────────────────────────────────

app.get("/me", (_req, res) => {
  if (!isReady || !client.info) return res.status(503).json({ error: "not connected" });
  const num = client.info.wid.user;
  res.json({ phone: "+" + num, chatId: num + "@c.us" });
});

// ── Send message ──────────────────────────────────────────────────────────────

app.post("/send", async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: "Both 'to' and 'message' are required" });
  }
  if (!isReady) {
    return res.status(503).json({ error: "WhatsApp not connected — scan QR first" });
  }

  try {
    // Strip non-digits and append WhatsApp chat ID suffix
    const chatId = to.replace(/\D/g, "") + "@c.us";
    await client.sendMessage(chatId, message);
    res.json({ ok: true });
  } catch (err) {
    console.error("Send error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("WhatsApp bot HTTP server listening on :3000");
});
