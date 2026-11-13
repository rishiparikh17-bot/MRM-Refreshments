// MRM Refreshments server
// Run: npm install && npm start  ->  http://localhost:3000
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
// Anyone who signs in with one of these names (any capitalisation) is an admin.
const ADMIN_NAMES = ["magnus yao", "rishi parikh", "max ranchod"];
// Optional: set ADMIN_PASSWORD so nobody else can just type an admin's name.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
// Optional: Telegram so the admins get a phone message for every order (TELEGRAM_CHAT_ID can be a group chat).
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";

// Optional: a Postgres connection string (e.g. from Neon). When set, orders are
// stored in the database so they — and the "cups sold worldwide" count — survive restarts.
const DATABASE_URL = process.env.DATABASE_URL || "";

const DATA_FILE = path.join(__dirname, "orders.json");
const FLAVORS = { sweet: "Sweet 🍯", sour: "Sour 🍋", mixed: "Mixed 🍹" };
const STATUSES = ["new", "on the way", "delivered"];

// ---------- storage ----------
// `orders` is always kept in memory for speed; the database (or orders.json) is the
// permanent copy. With a database, ids come from Postgres.
let orders = [];
let db = null;
const fromRow = (r) => ({
  id: r.id, flavor: r.flavor, qty: r.qty, lobby: r.lobby, floor: r.floor, unit: r.unit,
  note: r.note, name: r.name, status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
  ...(r.delivered_at ? { deliveredAt: new Date(r.delivered_at).toISOString() } : {}),
});

const store = {
  async init() {
    if (!DATABASE_URL) {
      try { orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { orders = []; }
      return "file (orders.json)";
    }
    const { Pool } = require("pg");
    db = new Pool({ connectionString: DATABASE_URL, max: 5 });
    db.on("error", (e) => console.error("Database error:", e.message));
    await db.query(`CREATE TABLE IF NOT EXISTS orders (
      id           SERIAL PRIMARY KEY,
      flavor       TEXT NOT NULL,
      qty          INTEGER NOT NULL,
      lobby        TEXT NOT NULL,
      floor        TEXT NOT NULL,
      unit         TEXT NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      name         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'new',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivered_at TIMESTAMPTZ
    )`);
    const { rows } = await db.query("SELECT * FROM orders ORDER BY id");
    orders = rows.map(fromRow);
    return "Postgres database";
  },
  async add(o) {
    if (!db) {
      o.id = orders.length ? orders[orders.length - 1].id + 1 : 1;
      o.createdAt = new Date().toISOString();
      orders.push(o);
      fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
      return o;
    }
    const { rows } = await db.query(
      `INSERT INTO orders (flavor, qty, lobby, floor, unit, note, name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [o.flavor, o.qty, o.lobby, o.floor, o.unit, o.note, o.name, o.status]);
    const saved = fromRow(rows[0]);
    orders.push(saved);
    return saved;
  },
  async setStatus(o, status) {
    const deliveredAt = status === "delivered" ? new Date().toISOString() : o.deliveredAt;
    if (db) await db.query("UPDATE orders SET status = $1, delivered_at = $2 WHERE id = $3", [status, deliveredAt || null, o.id]);
    o.status = status;
    if (deliveredAt) o.deliveredAt = deliveredAt;
    if (!db) fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
    return o;
  },
};

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
  const text = `🍋 MRM Refreshments — new order #${o.id}\n${o.qty} × ${FLAVORS[o.flavor]} lemonade\nFor: ${o.name}\nLobby ${o.lobby}, Floor ${o.floor}, Unit ${o.unit}` +
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
  const isAdmin = ADMIN_NAMES.includes(name.toLowerCase());
  if (isAdmin && ADMIN_PASSWORD && req.body.password !== ADMIN_PASSWORD) {
    const error = req.body.password ? "Wrong admin password" : "Admins need the admin password";
    return res.status(401).json({ error, needPassword: true });
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

// Public sales counter: total cups and orders ever placed.
const stats = () => ({ cups: orders.reduce((n, o) => n + o.qty, 0), orders: orders.length });
app.get("/api/stats", (req, res) => res.json(stats()));

app.post("/api/orders", async (req, res) => {
  const s = getSession(req);
  const { flavor, lobby, floor, unit, note } = req.body;
  const qty = Math.max(1, Math.min(20, parseInt(req.body.qty, 10) || 1));
  const clean = (v, n = 20) => String(v ?? "").trim().slice(0, n);
  if (!FLAVORS[flavor]) return res.status(400).json({ error: "Choose sweet, sour or mixed" });
  if (!clean(lobby) || !clean(floor) || !clean(unit))
    return res.status(400).json({ error: "Lobby, floor and unit are all required" });

  let order;
  try {
    order = await store.add({
      flavor, qty,
      lobby: clean(lobby), floor: clean(floor), unit: clean(unit),
      note: clean(note, 200),
      name: s ? s.name : clean(req.body.name, 60) || "Guest",
      status: "new",
    });
  } catch (e) {
    console.error("Could not save order:", e.message);
    return res.status(503).json({ error: "Sorry, we couldn't save your order. Please try again in a moment." });
  }
  broadcast(adminClients, "new-order", order); // message to the admins
  broadcast(customerClients, "stats", stats()); // live "sold worldwide" counter
  notifyTelegram(order);
  console.log(`📨 Order #${order.id}: ${qty} × ${flavor} → Lobby ${order.lobby}, #${order.floor}-${order.unit}`);
  res.json(order);
});

// Customers track their own orders by id (ids are kept in their browser).
app.get("/api/orders/track", (req, res) => {
  const ids = String(req.query.ids || "").split(",").map(Number).filter(Boolean);
  res.json(orders.filter((o) => ids.includes(o.id)));
});
app.get("/api/events/customer", (req, res) => sseOpen(req, res, customerClients));

// Admins (Magnus Yao, Rishi Parikh, Max Ranchod)
app.get("/api/orders", requireAdmin, (req, res) => res.json([...orders].reverse()));
app.get("/api/events/admin", requireAdmin, (req, res) => sseOpen(req, res, adminClients));
app.post("/api/orders/:id/status", requireAdmin, async (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Bad status" });
  try { await store.setStatus(o, req.body.status); }
  catch (e) {
    console.error("Could not update order:", e.message);
    return res.status(503).json({ error: "Couldn't save that change. Please try again." });
  }
  broadcast(adminClients, "update", o);
  broadcast(customerClients, "update", { id: o.id, status: o.status });
  res.json(o);
});

store.init().then((where) => {
  app.listen(PORT, () => {
    console.log(`🥤 MRM Refreshments running at http://localhost:${PORT}`);
    console.log(`   Orders stored in: ${where} (${orders.length} orders, ${stats().cups} cups so far)`);
    if (!DATABASE_URL) console.log("   Tip: set DATABASE_URL (e.g. a Neon connection string) so orders survive restarts.");
    if (!ADMIN_PASSWORD) console.log("   Tip: set ADMIN_PASSWORD to protect the admin logins.");
    if (TG_TOKEN && TG_CHAT) console.log("   Telegram notifications: ON");
  });
}).catch((e) => {
  console.error("❌ Could not connect to the database:", e.message);
  console.error("   Check DATABASE_URL — it should be the Neon connection string starting with postgresql://");
  process.exit(1);
});
