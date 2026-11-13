# 🥤 MRM Refreshments

Open the site, pick from the menu (right now: Lemonade), choose sweet, sour or mixed, enter your lobby, floor and unit, and Magnus Yao gets the order instantly and delivers it.

## Run it

You need Node.js 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000

## How it works

- **Menu:** the site opens on a menu (right now just Lemonade) with a live **cups sold worldwide** counter that goes up as soon as anyone orders.
- **Customers** click Lemonade, pick sweet, sour or mixed and how many cups, type lobby / floor / unit, and click **Place order**. Signing in is optional. They get a pop-up when their order is on the way and when it's delivered.
- **Admins:** Magnus Yao, Rishi Parikh and Max Ranchod. Sign in with one of those names (any capitalisation) and you get the delivery board instead of the shop. Every new order pops in with a sound, a flashing card and (if enabled) a browser notification. Click **Start delivery**, then **Delivered ✓**. All admins see the same board live. To change the admin list, edit `ADMIN_NAMES` near the top of `server.js`.
- Orders are saved in a **Neon (Postgres) database** when `DATABASE_URL` is set, so the cups-sold count and order history survive restarts. Without it, they're saved in `orders.json`.

## Optional extras

| Setting | What it does |
| --- | --- |
| `ADMIN_PASSWORD=secret npm start` | Anyone can type an admin's name, so set this to require a password for all three admin logins (they share one password). |
| `TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm start` | Also sends each order as a Telegram message. Use a Telegram group chat ID to reach all three admins. Make a bot with @BotFather and get your chat ID from @userinfobot. |
| `DATABASE_URL=postgresql://...` | Store orders in a Neon database (see below). |
| `PORT=8080 npm start` | Use a different port. |

On Windows PowerShell, set variables like `$env:ADMIN_PASSWORD="secret"; npm start`.

## Files

```
mrm-refreshments/
├── package.json
├── server.js         # Express server + API + live updates
├── public/index.html # Shop, sign-in and Magnus's dashboard
└── README.md
```

## Neon database (keeps the cups-sold count forever)

1. Sign up at neon.tech (free) and create a project.
2. On the project dashboard click **Connect** and copy the connection string. It looks like
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
3. In Render, open your service, go to **Environment**, and add `DATABASE_URL` with that string as the value. Save; Render redeploys.
4. Check Render's **Logs**: you should see `Orders stored in: Postgres database`.

The app creates its `orders` table on first start, so you don't need to set anything up inside Neon. Keep the connection string secret: it contains the database password.

Without `DATABASE_URL`, orders go in `orders.json`, which Render's free plan wipes when the app redeploys or sleeps.
