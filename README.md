# 🍋 Lemon Lift — lemonade shop

Order lemonade (sweet, sour or mixed), enter your lobby, floor and unit, and Magnus Yao gets the order instantly and delivers it.

## Run it

You need Node.js 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000

## How it works

- **Customers** pick a flavour and number of cups, type lobby / floor / unit, and click **Place order**. Signing in is optional (it just puts your name on the order). Their "Your orders" list updates live: *sent to Magnus → on the way → delivered*.
- **Magnus**: click **Sign in** and enter `Magnus Yao` (any capitalisation). You get the delivery board instead of the shop. Every new order pops in with a sound, a flashing card and (if enabled) a browser notification. Click **Start delivery**, then **Delivered ✓** — the customer sees each change.
- Orders are saved in `orders.json`, so they survive a restart.

## Optional extras

| Setting | What it does |
| --- | --- |
| `ADMIN_PASSWORD=secret npm start` | Anyone can type "Magnus Yao", so set this to require a password for the admin login. |
| `TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm start` | Also sends each order as a Telegram message to Magnus's phone. Make a bot with @BotFather and get your chat ID from @userinfobot. |
| `PORT=8080 npm start` | Use a different port. |

On Windows PowerShell, set variables like `$env:ADMIN_PASSWORD="secret"; npm start`.

## Files

```
lemonade-shop/
├── package.json
├── server.js         # Express server + API + live updates
├── public/index.html # Shop, sign-in and Magnus's dashboard
└── README.md
```
