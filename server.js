// Lemonade Shop server
// Run: npm install && npm start  ->  http://localhost:3000
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_NAME = "magnus yao";
// Optional: set ADMIN_PASSWORD so nobody else can just type "Magnus Yao".
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
// Optional: Telegram so Magnus gets a phone message for every order.
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";

const DATA_FILE = path.join(__dirname, "orders.json");
const FLAVORS = { sweet: "Sweet 🍯", sour: "Sour 🍋", mixed: "Mixed 🍹" };
const STATUSES = ["new", "on the way", "delivered"];

// ---------- storage ----------
let orders = [];
try { orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { orders = []; }
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));

// ---------- sessions (in memory) ----------
const sessions = new Map(); // token -> { name, isAdmin }
function getSession(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  return m ? sessions.get(m[1]) : null;
}
function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (!s || !s.isAdmin) return res.status(403).json({ error: "Admins only" });
  next();
}

// ---------- live updates (Server-Sent Events) ----------
const adminClients = new Set();
const customerClients = new Set();
function broadcast(set, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(msg);
}
function sseOpen(req, res, set) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  set.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); set.delete(res); });
}

async function notifyTelegram(o) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const text = `🍋 New order #${o.id}\n${o.qty} × ${FLAVORS[o.flavor]}\nFor: ${o.name}\nLobby ${o.lobby}, Floor ${o.floor}, Unit ${o.unit}` +
    (o.note ? `\nNote: ${o.note}` : "");
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text }),
    });
  } catch (e) { console.error("Telegram failed:", e.message); }
}

// ---------- app ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/me", (req, res) => res.json(getSession(req) || null));

app.post("/api/signin", (req, res) => {
  const name = String(req.body.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) return res.status(400).json({ error: "Please enter your name" });
  let isAdmin = name.toLowerCase() === ADMIN_NAME;
  if (isAdmin && ADMIN_PASSWORD && req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong admin password", needPassword: true });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { name, isAdmin });
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
  res.json({ name, isAdmin, needPassword: !!ADMIN_PASSWORD });
});

app.post("/api/signout", (req, res) => {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (m) sessions.delete(m[1]);
  res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => res.json({ adminPassword: !!ADMIN_PASSWORD }));

app.post("/api/orders", (req, res) => {
  const s = getSession(req);
  const { flavor, lobby, floor, unit, note } = req.body;
  const qty = Math.max(1, Math.min(20, parseInt(req.body.qty, 10) || 1));
  const clean = (v, n = 20) => String(v ?? "").trim().slice(0, n);
  if (!FLAVORS[flavor]) return res.status(400).json({ error: "Choose sweet, sour or mixed" });
  if (!clean(lobby) || !clean(floor) || !clean(unit))
    return res.status(400).json({ error: "Lobby, floor and unit are all required" });

  const order = {
    id: orders.length ? orders[orders.length - 1].id + 1 : 1,
    flavor, qty,
    lobby: clean(lobby), floor: clean(floor), unit: clean(unit),
    note: clean(note, 200),
    name: s ? s.name : clean(req.body.name, 60) || "Guest",
    status: "new",
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  save();
  broadcast(adminClients, "new-order", order); // message to Magnus
  notifyTelegram(order);
  console.log(`📨 Order #${order.id} for Magnus: ${qty} × ${flavor} → Lobby ${order.lobby}, #${order.floor}-${order.unit}`);
  res.json(order);
});

// Customers track their own orders by id (ids are kept in their browser).
app.get("/api/orders/track", (req, res) => {
  const ids = String(req.query.ids || "").split(",").map(Number).filter(Boolean);
  res.json(orders.filter((o) => ids.includes(o.id)));
});
app.get("/api/events/customer", (req, res) => sseOpen(req, res, customerClients));

// Admin (Magnus)
app.get("/api/orders", requireAdmin, (req, res) => res.json([...orders].reverse()));
app.get("/api/events/admin", requireAdmin, (req, res) => sseOpen(req, res, adminClients));
app.post("/api/orders/:id/status", requireAdmin, (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Bad status" });
  o.status = req.body.status;
  if (o.status === "delivered") o.deliveredAt = new Date().toISOString();
  save();
  broadcast(adminClients, "update", o);
  broadcast(customerClients, "update", { id: o.id, status: o.status });
  res.json(o);
});

app.listen(PORT, () => {
  console.log(`🍋 Lemonade shop running at http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.log("   Tip: set ADMIN_PASSWORD to protect the Magnus Yao admin login.");
  if (TG_TOKEN && TG_CHAT) console.log("   Telegram notifications: ON");
});
