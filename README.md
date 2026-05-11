# Jupiter Oracle Dashboard

Real-time trading intelligence dashboard built on Jupiter's developer APIs. Tracks live prediction market odds, monitors token prices, and arms a strategy engine that fires an actual on-chain swap when market conditions match your parameters.

Built as part of the **Superteam Jupiter Developer Platform Bounty 2026**.

**Live:** https://jupiter-oracle.vercel.app/

**Repo:** https://github.com/DikaCream/jupiter-oracle

---

## Background

Jupiter's developer platform gives you REST APIs that return clean JSON with no RPC node required. This project was built to explore how far you can push those APIs in a single-page app: combining prediction market signals, price data, orderbook depth, and swap execution into one reactive interface.

The guiding question: can a prediction market act as a trading oracle? If the market says there's a 75% chance BTC hits $150k, should a bot buy BTC? That's what the Sentinel Engine tests.

---

## Features

### Prediction Markets Feed

Pulls all active prediction events from `api.jup.ag/prediction/v1/events` and sorts them by 24-hour volume. This matches the ordering on `jup.ag/prediction`. The table shows event title, category, 24h volume, and the current YES/NO probability split for each market.

Data refreshes every 10 seconds automatically. There is also a search input that calls `prediction/v1/events/search` to filter markets by keyword in real time.

Worth knowing: Jupiter's prediction markets source their events from Polymarket (you can see `"series": "polymarket"` and `eventId: "POLY-xxxxx"` in the API response). Jupiter acts as a Solana-native bridge to Polymarket liquidity, so you get on-chain trading on Solana for events that originally exist on Polymarket.

### Market Detail and Orderbook

Clicking any row in the table loads a detail view for that market. It shows the YES and NO probabilities as large numbers with a live probability bar that animates as the odds shift. Below that is a live orderbook pulled from `prediction/v1/orderbook/{marketId}`, showing the top 5 bid and ask levels with price and size.

### Live Price Feed

Fetches current USD prices for SOL, JUP, WIF, BONK, and USDC from `api.jup.ag/price/v3`. Each token shows its current price and 24-hour percentage change with a green or red indicator. Refreshes every 15 seconds.

One thing to note: the Price API v3 changed its response format from v2. In v3 the response is a flat object keyed by mint address like `{ [mint]: { usdPrice, priceChange24h, liquidity } }` with no outer wrapper. The v2 format was different and some older docs still reference it.

### Sentinel Strategy Engine

The Sentinel is where everything connects. You pick a market from the table, set a YES probability threshold using the slider (anything from 1% to 99%), and click ARM.

Once armed, the Sentinel checks the market's current YES probability on every poll cycle (every 10 seconds, in sync with the prediction feed). The moment `yesProb >= threshold`, it triggers automatically:

1. Calls `GET /swap/v2/order` with your connected wallet address as the `taker` parameter, USDC as input and SOL as output, for 1 USDC
2. Jupiter returns a fully assembled, unsigned Base64-encoded transaction
3. The transaction goes to `window.solana.signAndSendTransaction()` in Phantom
4. Phantom shows you the transaction to approve
5. If you approve, it hits the chain

This is not a simulation. The transaction comes from Jupiter's routing engine and goes on-chain if you sign it.

---

## Jupiter APIs Used

`GET /prediction/v1/events`
Fetches all active prediction markets. Each event has a `markets` array where the first market's `outcomePrices` array gives you YES and NO probabilities as decimals (multiply by 100 for percentage).

`GET /prediction/v1/events/search?query={keyword}`
Searches events by title or keyword. Powers the search bar in the dashboard.

`GET /prediction/v1/orderbook/{marketId}`
Returns current bid and ask depth for a specific market. Used in the market detail panel.

`GET /price/v3?ids={comma-separated mints}`
Returns live USD prices for up to 50 tokens per request. Response format is `{ [mint]: { usdPrice, priceChange24h, liquidity, decimals } }`.

`GET /swap/v2/order?inputMint={}&outputMint={}&amount={}&taker={}`
Builds and returns an unsigned swap transaction. The `taker` parameter is the wallet that will sign. Returns `{ transaction, requestId }` where `transaction` is Base64.

All requests use the `x-api-key` header with a key from https://developers.jup.ag/portal.

---

## CORS and the Proxy Setup

Calling `api.jup.ag` directly from a browser can hit CORS issues depending on the environment. This project solves it with a proxy at two levels.

During development, `vite.config.ts` sets up a dev server proxy:

```ts
server: {
  proxy: {
    '/jup': {
      target: 'https://api.jup.ag',
      changeOrigin: true,
      rewrite: path => path.replace(/^\/jup/, ''),
    },
  },
}
```

In production on Vercel, `vercel.json` handles the same routing:

```json
{
  "rewrites": [
    { "source": "/jup/:path*", "destination": "https://api.jup.ag/:path*" }
  ]
}
```

So the app always calls `/jup/prediction/v1/events` and the proxy forwards it to `api.jup.ag/prediction/v1/events`. The API key is injected via the request header from the client, not baked into the URL.

---

## Wallet Integration

The dashboard connects to Phantom using the `window.solana` injected provider directly, without the `@solana/wallet-adapter` library. The adapter library had Windows-specific install failures (npm scripts calling Unix `true` command), so the native approach was cleaner.

Connect flow:

```ts
const resp = await window.solana.connect()
setWalletAddress(resp.publicKey.toBase58())
```

Signing flow for the Sentinel:

```ts
const result = await window.solana.signAndSendTransaction({ message: data.transaction })
```

Any wallet that exposes a `window.solana`-compatible API should work. Backpack does. Solflare does.

---

## Running Locally

```bash
git clone https://github.com/DikaCream/jupiter-oracle.git
cd jupiter-oracle

npm install --legacy-peer-deps
```

Create a `.env` file in the project root:

```
VITE_JUPITER_API_KEY=your_key_here
```

Get a key at https://developers.jup.ag/portal. The free tier (1 RPS) is enough for local development.

```bash
npm run dev
```

The app runs at `http://localhost:5173`. The Vite proxy handles all API routing from there.

---

## Deploying to Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click "Add New Project" and import this repo
3. Under "Environment Variables", add:

```
VITE_JUPITER_API_KEY = your_key_here
```

4. Click Deploy

The `vercel.json` file in the repo already configures the API proxy. No other settings need to change. Vercel detects Vite automatically and sets the build command and output directory correctly.

---

## Project Structure

```
src/
  App.tsx       main component, all four modules live here
  main.tsx      React entry, plain StrictMode wrapper
  index.css     design system, Tailwind v4 with custom cyber-terminal styles

vercel.json     production API proxy
vite.config.ts  dev proxy + Vite config
DX-REPORT.md    full developer experience report
.env            local API key, gitignored
```

---

## Developer Experience Report

The full DX report covering API friction points, endpoint discoveries, CORS findings, response format differences between API versions, and architectural decisions is in `DX-REPORT.md`.

Read it at: https://github.com/DikaCream/jupiter-oracle/blob/main/DX-REPORT.md

---

## Tech Stack

React 19, TypeScript, Vite 8, Tailwind CSS v4, Solana Mainnet, Vercel
