# Developer Experience (DX) Report: Jupiter Oracle Dashboard

**Bounty:** Jupiter Developer Platform (Superteam)
**Version:** 6.0.0
**Author:** 0xVibes (via AI Pair Programming)

## Overview
This report details the integration experience of building the **Jupiter Oracle Dashboard** — an automated, on-chain execution engine that bridges real-world prediction data from Jupiter Prediction Markets API with programmatic Jupiter Swap V2 execution.

The dashboard implements **6 distinct API integrations**:
1. **Prediction Market Discovery** (`/prediction/v1/events`)
2. **Prediction Orderbook** (`/prediction/v1/orderbook/{marketId}`)
3. **Prediction Search** (`/prediction/v1/events/search`)
4. **Price Oracle** (`/price/v3`)
5. **Swap Quote** (`/swap/v2/order`)
6. **Swap Execution** (via `@solana/wallet-adapter-react` and `@solana/web3.js`)

## Friction Points & API Feedback

### 1. Documentation 404 Errors
*   **Issue:** The initial LLM instructions directed us to `developers.jup.ag/docs/llms.txt`, which returned a 404 error.
*   **Resolution:** We discovered the actual documentation lives at `dev.jup.ag/docs/llms.txt`.
*   **Recommendation:** Set up a permanent 301 redirect from `developers.jup.ag/*` to `dev.jup.ag/*` to ensure LLM agent workflows do not break.

### 2. Price API Version Deprecation (`/price/v2` → `/price/v3`)
*   **Issue:** Some outdated documentation points to `/price/v2`, which returns a 404. 
*   **Resolution:** Migrated to `/price/v3`.
*   **Recommendation:** Provide clear deprecation warnings in the API response or documentation for `v2` endpoints.

### 3. Price API v3 Response Structure
*   **Issue:** The v3 response structure drops the `{ data: {} }` wrapper and returns a direct object mapping of `{ [mint]: { usdPrice, priceChange24h, ... } }`.
*   **Resolution:** We mapped the frontend explicitly to expect `usdPrice` rather than `price`.
*   **Recommendation:** Document the exact JSON schema changes between v2 and v3 in the migration guide.

### 4. Cross-Origin Resource Sharing (CORS) on Localhost
*   **Issue:** When fetching from the browser `localhost:5173`, requests to `api.jup.ag` are often blocked by CORS policy despite using the correct `x-api-key` header.
*   **Resolution:** We implemented a Vite development proxy (`/jup/* -> https://api.jup.ag`) to completely bypass browser CORS restrictions during development.
*   **Recommendation:** Ensure the API gateway permits `localhost` origins during development, or explicitly mention the Vite proxy pattern in the setup guide.

### 5. Prediction API Event Wrapper
*   **Issue:** The `prediction/v1/events` endpoint wraps its array of events inside a `{ data: [...] }` object, unlike the Price API v3. This inconsistency can lead to LLM misinterpretations.
*   **Recommendation:** Standardize the JSON response wrapper across all V2 and V3 APIs.

## Architecture Decisions

### Sentinel Engine: The Bridge
The core innovation in this build is the **Sentinel Engine**. Instead of treating the APIs as isolated read-only data feeds, we combined them.
1. The engine polls the **Prediction API** for the YES probability of a selected market.
2. If the probability crosses the user-defined threshold (e.g., 65%), the Sentinel **fires**.
3. Upon firing, it instantly pings the **Swap V2 API** (`/swap/v2/order`) to construct a real `USDC -> SOL` transaction.
4. The Base64 transaction is deserialized using `@solana/web3.js` and prompted to the user's wallet via `@solana/wallet-adapter-react`.

### Frontend Aesthetic
We implemented a strict "Vibecoded" aesthetic (Cyber-Terminal, dark mode, glassmorphism, mono fonts, CSS grid overlay, and pulse animations) utilizing **Tailwind v4** and a custom CSS architecture.

## Conclusion
The Jupiter API is blazingly fast. The ability to pull down fully assembled, optimally routed transactions from `/swap/v2/order` without running an RPC node is an absolute game-changer for automated agents. By wrapping this in a reactive dashboard, we've demonstrated how prediction markets can act as real-time triggers for on-chain DeFi operations.
