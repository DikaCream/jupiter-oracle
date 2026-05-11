import { useState, useEffect, useCallback } from 'react'

// Use Phantom's injected window.solana directly — no wallet adapter needed
declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean
      connect: () => Promise<{ publicKey: { toBase58: () => string } }>
      disconnect: () => Promise<void>
      signAndSendTransaction: (tx: any) => Promise<{ signature: string }>
      publicKey: { toBase58: () => string } | null
      isConnected: boolean
    }
  }
}

// ─── Token Mints ───────────────────────────────────────────────────────────────
const SOL_MINT  = 'So11111111111111111111111111111111111111112'
const JUP_MINT  = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const WIF_MINT  = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
const API_KEY   = import.meta.env.VITE_JUPITER_API_KEY

const TOKENS = [
  { symbol: 'SOL',  mint: SOL_MINT,  color: '#38bdf8' },
  { symbol: 'JUP',  mint: JUP_MINT,  color: '#a3e635' },
  { symbol: 'WIF',  mint: WIF_MINT,  color: '#f97316' },
  { symbol: 'BONK', mint: BONK_MINT, color: '#facc15' },
  { symbol: 'USDC', mint: USDC_MINT, color: '#ffffff' },
]

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TokenData { usdPrice: number; priceChange24h: number; liquidity: number }
interface PriceMap  { [mint: string]: TokenData }

// ─── Utilities ─────────────────────────────────────────────────────────────────
const jupFetch = (url: string, opts?: RequestInit) =>
  fetch(url, {
    ...opts,
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })

const fmtUsd = (n: number) =>
  n < 0.0001 ? `$${n.toFixed(8)}` :
  n < 0.01   ? `$${n.toFixed(6)}` :
  n < 1      ? `$${n.toFixed(4)}` :
               `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtVol = (raw: string | number) => {
  const n = Number(raw) / 1e6
  return n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B`
       : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M`
       : n >= 1e3 ? `$${(n / 1e3).toFixed(2)}K`
       :            `$${n.toFixed(0)}`
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [online, setOnline] = useState(false)

  // Module A — Top Markets & Search
  const [searchQuery, setSearchQuery] = useState('')
  const [allEvents,   setAllEvents]   = useState<any[]>([])
  const [topEvents,   setTopEvents]   = useState<any[]>([])
  const [evtLoading,  setEvtLoading]  = useState(false)
  const [evtTs,       setEvtTs]       = useState('')

  // Module B — Price Oracle
  const [prices,    setPrices]    = useState<PriceMap>({})
  const [priceTs,   setPriceTs]   = useState('')
  const [priceErr,  setPriceErr]  = useState('')

  // Module C — Orderbook
  const [orderbook, setOrderbook] = useState<any>(null)

  // Module D — Sentinel
  const [focusIdx,    setFocusIdx]    = useState(0)
  const [threshold,   setThreshold]   = useState(65)
  const [sentinel,    setSentinel]    = useState<'idle' | 'armed' | 'triggered'>('idle')
  const [sentinelLog, setSentinelLog] = useState<{ ts: string; msg: string; alert: boolean }[]>([])

  // ── Fetch events (and search) ─────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    if (!online) return
    setEvtLoading(true)
    try {
      let url = '/jup/prediction/v1/events'
      if (searchQuery.trim().length > 0) {
        url = `/jup/prediction/v1/events/search?query=${encodeURIComponent(searchQuery)}`
      }
      
      const res  = await jupFetch(url)
      const json = await res.json()
      const active: any[] = (json?.data ?? []).filter((e: any) => e.isActive)
      
      // Sort by 24h volume descending
      const sorted = [...active].sort((a, b) => Number(b.volume24hr) - Number(a.volume24hr))
      setAllEvents(sorted)
      setTopEvents(sorted.slice(0, 10))
      setEvtTs(new Date().toLocaleTimeString('en-US', { hour12: false }))
    } catch (err) {
      console.error('Events fetch failed', err)
    } finally {
      setEvtLoading(false)
    }
  }, [online, searchQuery])

  // ── Fetch Orderbook ───────────────────────────────────────────────────────
  const fetchOrderbook = useCallback(async (marketId: string) => {
    if (!online) return
    try {
      const res = await jupFetch(`/jup/prediction/v1/orderbook/${marketId}`)
      const data = await res.json()
      setOrderbook(data)
    } catch (e) {
      console.error('Orderbook fetch failed', e)
    }
  }, [online])

  // ── Fetch prices ──────────────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    if (!online) return
    setPriceErr('')
    try {
      const ids = TOKENS.map(t => t.mint).join(',')
      const res = await jupFetch(`/jup/price/v3?ids=${ids}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PriceMap = await res.json()
      setPrices(json)
      setPriceTs(new Date().toLocaleTimeString('en-US', { hour12: false }))
    } catch (e: any) {
      setPriceErr(e.message ?? 'fetch failed')
    }
  }, [online])

  // ── Wallet connect via window.solana (Phantom) ──────────────────────────
  const connectWallet = async () => {
    try {
      if (!window.solana) throw new Error('Phantom wallet not found. Install it at phantom.app')
      const resp = await window.solana.connect()
      setWalletAddress(resp.publicKey.toBase58())
    } catch (e: any) {
      setSentinelLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: `Wallet error: ${e.message}`, alert: true }, ...prev])
    }
  }

  const disconnectWallet = async () => {
    await window.solana?.disconnect()
    setWalletAddress(null)
  }

  // ── Sentinel execution: fetch TX from Swap V2, sign via Phantom ──────────
  const executeSwap = async () => {
    if (!walletAddress) {
      setSentinelLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: 'ERROR: Wallet not connected', alert: true }, ...prev])
      return
    }
    setSentinelLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: 'Requesting Swap V2 order...', alert: false }, ...prev])
    try {
      const res = await fetch(
        `/jup/swap/v2/order?inputMint=${USDC_MINT}&outputMint=${SOL_MINT}&amount=1000000&taker=${walletAddress}`,
        { headers: { 'x-api-key': API_KEY } }
      )
      const data = await res.json()
      if (!data.transaction) throw new Error(data.message ?? 'No TX from /order')
      setSentinelLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: 'TX built. Awaiting signature...', alert: false }, ...prev])
      const result = await window.solana!.signAndSendTransaction({ message: data.transaction })
      setSentinelLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: `✓ SENT: ${result.signature.slice(0,20)}...`, alert: true }, ...prev])
    } catch (e: any) {
      setSentinelLog(prev => [{ ts: new Date().toLocaleTimeString(), msg: `TX ERROR: ${e.message}`, alert: true }, ...prev])
    }
  }

  // ── Sentinel logic ────────────────────────────────────────────────────────
  const runSentinel = useCallback(() => {
    if (sentinel !== 'armed') return
    const evt    = topEvents[focusIdx]
    const market = evt?.markets?.[0]
    if (!market) return
    const yesProb = Number(market.outcomePrices?.[0]) * 100
    const ts      = new Date().toLocaleTimeString('en-US', { hour12: false })
    const fired   = yesProb >= threshold
    
    setSentinelLog(prev => [
      {
        ts,
        msg: fired
          ? `⚡ TRIGGER FIRED — YES=${yesProb.toFixed(1)}% ≥ threshold ${threshold}%`
          : `Monitoring... YES=${yesProb.toFixed(1)}% | threshold=${threshold}%`,
        alert: fired,
      },
      ...prev,
    ].slice(0, 10))
    
    if (fired) {
      setSentinel('triggered')
      executeSwap()
    }
  }, [sentinel, topEvents, focusIdx, threshold, walletAddress])

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!online) {
      setAllEvents([]); setTopEvents([]); setPrices({})
      setSentinel('idle'); setSentinelLog([])
      setPriceErr(''); setEvtTs(''); setPriceTs(''); setOrderbook(null)
      return
    }
    fetchEvents(); fetchPrices()
    const t1 = setInterval(fetchEvents, 10_000)
    const t2 = setInterval(fetchPrices, 15_000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [online, fetchEvents])

  useEffect(() => {
    if (sentinel !== 'armed') return
    runSentinel()
    const t = setInterval(runSentinel, 10_000)
    return () => clearInterval(t)
  }, [sentinel, runSentinel])

  // Watch for focused market change to fetch orderbook
  useEffect(() => {
    const evt = topEvents[focusIdx]
    const mkt = evt?.markets?.[0]
    if (mkt && online) {
      fetchOrderbook(mkt.marketId)
    }
  }, [focusIdx, topEvents, online])

  // ── Derived ───────────────────────────────────────────────────────────────
  const focusEvent  = topEvents[focusIdx] ?? null
  const focusMarket = focusEvent?.markets?.[0] ?? null
  const yesProb     = focusMarket ? Number(focusMarket.outcomePrices?.[0]) * 100 : 0
  const noProb      = focusMarket ? Number(focusMarket.outcomePrices?.[1]) * 100 : 0

  const CATEGORY_COLOR: Record<string, string> = {
    politics: '#f97316', crypto: '#38bdf8', sports: '#a3e635',
    culture: '#c084fc', finance: '#facc15',
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col p-5 gap-5">

      {/* ── HEADER ── */}
      <header className="flex justify-between items-center border-b border-white/10 pb-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-vibes-gray uppercase mb-1">
            Jupiter Developer Platform · Superteam Bounty 2026
          </p>
          <h1 className="font-mono text-xl tracking-widest text-vibes-green uppercase flex items-center gap-4">
            Oracle_Dashboard //
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {walletAddress ? (
            <button onClick={disconnectWallet}
              className="font-mono text-xs tracking-widest px-3 py-2 border border-vibes-green text-vibes-green hover:border-red-500 hover:text-red-400 transition-all">
              {walletAddress.slice(0,4)}...{walletAddress.slice(-4)} ✓
            </button>
          ) : (
            <button onClick={connectWallet}
              className="font-mono text-xs tracking-widest px-3 py-2 border border-white/20 text-white hover:border-vibes-green hover:text-vibes-green transition-all">
              CONNECT WALLET
            </button>
          )}
          <div className="hidden sm:flex flex-col items-end">
            <span className="vibes-label">Solana Mainnet</span>
            <span className={`font-mono text-xs ${online ? 'text-vibes-cyan' : 'text-vibes-orange'}`}>
              {online ? `● LIVE · ${allEvents.length} active markets` : '● OFFLINE'}
            </span>
          </div>
          <button
            onClick={() => setOnline(v => !v)}
            className={`font-mono text-xs tracking-widest px-5 py-2 border transition-all ${
              online
                ? 'bg-white text-black border-white hover:bg-vibes-green'
                : 'border-white/30 text-white hover:border-vibes-cyan hover:text-vibes-cyan'
            }`}
          >
            {online ? 'TERMINATE' : 'INITIATE'}
          </button>
        </div>
      </header>

      {/* ── TOP ROW: Top Markets + Price Oracle ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* ════════════════════════════
            PANEL A: TOP PREDICTION MARKETS + SEARCH
        ════════════════════════════ */}
        <div className="vibes-card xl:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-3">
            <div>
              <span className="vibes-label">api.jup.ag/prediction/v1/events</span>
              <div className="flex items-center gap-4 mt-1">
                <h2 className="font-mono text-base text-white">Prediction Markets</h2>
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search events..." 
                  className="vibes-input w-48"
                  disabled={!online}
                />
              </div>
            </div>
            <div className="text-right">
              <span className="vibes-label block">Sorted by 24h Volume · 10s poll</span>
              {evtTs && <span className="font-mono text-[10px] text-vibes-cyan">{evtTs}</span>}
            </div>
          </div>

          {!online ? (
            <div className="text-center py-12 font-mono text-white/10 text-3xl">OFFLINE</div>
          ) : evtLoading && topEvents.length === 0 ? (
            <div className="text-center py-12 font-mono text-vibes-cyan animate-pulse">
              FETCHING LIVE DATA...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="vibes-label pb-2 pr-2 w-6">#</th>
                    <th className="vibes-label pb-2 pr-4">Event</th>
                    <th className="vibes-label pb-2 pr-3 text-right">24h Vol</th>
                    <th className="vibes-label pb-2 pr-3 text-center">YES</th>
                    <th className="vibes-label pb-2 text-center">NO</th>
                  </tr>
                </thead>
                <tbody>
                  {topEvents.map((evt, i) => {
                    const mkt      = evt.markets?.[0]
                    const yes      = mkt ? (Number(mkt.outcomePrices?.[0]) * 100).toFixed(1) : '--'
                    const no       = mkt ? (Number(mkt.outcomePrices?.[1]) * 100).toFixed(1) : '--'
                    const catColor = CATEGORY_COLOR[evt.category] ?? '#94a3b8'
                    const isFocus  = i === focusIdx
                    return (
                      <tr
                        key={evt.eventId}
                        onClick={() => { setFocusIdx(i); setSentinel('idle'); setSentinelLog([]) }}
                        className={`border-b border-white/5 cursor-pointer transition-colors ${
                          isFocus ? 'bg-vibes-green/5 border-vibes-green/20' : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="py-2.5 pr-2 text-white/30">{i + 1}</td>
                        <td className="py-2.5 pr-4 max-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[9px] px-1 py-0.5 shrink-0"
                              style={{ color: catColor, border: `1px solid ${catColor}44` }}
                            >
                              {evt.category?.toUpperCase()}
                            </span>
                            <span className={`truncate ${isFocus ? 'text-vibes-green' : 'text-white/80'}`}
                              title={evt.metadata?.title}>
                              {evt.metadata?.title}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-vibes-cyan whitespace-nowrap">
                          {fmtVol(evt.volume24hr)}
                        </td>
                        <td className="py-2.5 pr-3 text-center text-vibes-green font-bold">{yes}%</td>
                        <td className="py-2.5 text-center text-red-400 font-bold">{no}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {topEvents.length === 0 && online && !evtLoading && (
                <p className="text-center py-8 text-vibes-gray font-mono text-sm">No active markets found.</p>
              )}
            </div>
          )}
        </div>

        {/* ════════════════════════════
            PANEL B: PRICE ORACLE
        ════════════════════════════ */}
        <div className="vibes-card flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="vibes-label">api.jup.ag/price/v3 · 15s poll</span>
              <h2 className="font-mono text-base text-white">Live Prices</h2>
            </div>
            {priceTs && <span className="font-mono text-[10px] text-vibes-cyan">{priceTs}</span>}
          </div>

          {!online ? (
            <div className="flex-1 flex items-center justify-center font-mono text-white/10 text-3xl">OFFLINE</div>
          ) : priceErr ? (
            <p className="font-mono text-vibes-orange text-xs">{priceErr}</p>
          ) : (
            <div className="flex-1 flex flex-col gap-1">
              {TOKENS.map(({ symbol, mint, color }) => {
                const d   = prices[mint]
                const chg = d?.priceChange24h ?? 0
                const up  = chg >= 0
                return (
                  <div key={mint}
                    className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ background: d ? color : '#ffffff22' }} />
                      <span className="font-mono text-sm font-bold" style={{ color }}>
                        {symbol}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-white">
                        {d ? fmtUsd(d.usdPrice) : <span className="text-white/30 text-xs animate-pulse">syncing…</span>}
                      </p>
                      {d && (
                        <p className={`font-mono text-[10px] ${up ? 'text-vibes-green' : 'text-red-400'}`}>
                          {up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM ROW: Market Detail + Sentinel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ════════════════════════════
            PANEL C: SELECTED MARKET DETAIL + ORDERBOOK
        ════════════════════════════ */}
        <div className="vibes-card">
          <div className="flex justify-between items-start mb-2">
            <span className="vibes-label">Selected Market Detail</span>
            <span className="vibes-label text-vibes-cyan">ORDERBOOK_ACTIVE</span>
          </div>
          <h2 className="font-mono text-base text-white mb-3">
            {focusEvent?.metadata?.title ?? 'Click a market above'}
          </h2>

          {focusEvent && focusMarket ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="flex-1 bg-vibes-green/10 border border-vibes-green/30 p-3 text-center">
                  <p className="vibes-label">YES Probability</p>
                  <p className="font-mono text-vibes-green text-3xl font-bold mt-1">{yesProb.toFixed(1)}%</p>
                </div>
                <div className="flex-1 bg-red-900/20 border border-red-500/30 p-3 text-center">
                  <p className="vibes-label">NO Probability</p>
                  <p className="font-mono text-red-400 text-3xl font-bold mt-1">{noProb.toFixed(1)}%</p>
                </div>
              </div>

              {/* Orderbook rendering */}
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="vibes-label mb-2">Live Orderbook Depth (Bid/Ask)</p>
                {orderbook?.bids?.length > 0 ? (
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <p className="vibes-label mb-1 text-vibes-green text-center">BIDS (YES)</p>
                      {orderbook.bids.slice(0, 5).map((b: any, i: number) => (
                        <div key={i} className="flex justify-between font-mono text-[10px] mb-1">
                          <span className="text-white">{Number(b.price).toFixed(2)}</span>
                          <span className="text-vibes-green">{Number(b.size).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="w-px bg-white/10"></div>
                    <div className="flex-1">
                      <p className="vibes-label mb-1 text-red-400 text-center">ASKS (NO)</p>
                      {orderbook.asks.slice(0, 5).map((a: any, i: number) => (
                        <div key={i} className="flex justify-between font-mono text-[10px] mb-1">
                          <span className="text-white">{Number(a.price).toFixed(2)}</span>
                          <span className="text-red-400">{Number(a.size).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="font-mono text-xs text-white/30 text-center">Fetching orderbook...</p>
                )}
              </div>
            </>
          ) : (
            <p className="font-mono text-white/20 text-sm">
              {online ? 'Click any row in the Top Markets table.' : 'System offline.'}
            </p>
          )}
        </div>

        {/* ════════════════════════════
            PANEL D: SENTINEL STRATEGY ENGINE (REAL EXECUTION)
        ════════════════════════════ */}
        <div className="vibes-card flex flex-col">
          <div className="flex justify-between items-center mb-1">
            <div>
              <span className="vibes-label">Real On-Chain Execution</span>
              <h2 className="font-mono text-base text-white">Sentinel Engine</h2>
            </div>
            <span className={`font-mono text-xs px-2 py-0.5 border ${
              sentinel === 'triggered' ? 'border-vibes-green text-vibes-green animate-pulse' :
              sentinel === 'armed'     ? 'border-vibes-cyan text-vibes-cyan' :
              'border-white/20 text-white/30'
            }`}>
              {sentinel.toUpperCase()}
            </span>
          </div>

          <p className="text-xs text-vibes-gray leading-relaxed mb-4">
            Sentinel watches YES probability. When crossed, it triggers a <strong>REAL transaction</strong> using Jupiter Swap API V2 to buy 1 USDC worth of SOL.
          </p>

          <div className="mb-4">
            <div className="flex justify-between mb-1">
              <span className="vibes-label">YES Trigger Threshold</span>
              <span className="font-mono text-vibes-cyan text-sm">{threshold}%</span>
            </div>
            <input type="range" min={1} max={99} step={1}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full accent-vibes-green cursor-pointer mb-1"
            />
            <div className="flex justify-between vibes-label">
              <span>1%</span><span>99%</span>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-3 mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
            <span className="text-vibes-gray">Current YES</span>
            <span className={yesProb >= threshold ? 'text-vibes-green font-bold' : 'text-white'}>
              {online && focusMarket ? `${yesProb.toFixed(1)}%` : '—'}
            </span>
            <span className="text-vibes-gray">Wallet Status</span>
            <span className={walletAddress ? 'text-vibes-green' : 'text-red-400'}>
              {walletAddress ? `${walletAddress.slice(0,4)}...${walletAddress.slice(-4)}` : 'NOT CONNECTED'}
            </span>
            <span className="text-vibes-gray">Action on fire</span>
            <span className="text-vibes-green">SWAP USDC → SOL</span>
          </div>

          {/* Log */}
          <div className="flex-1 bg-black/60 border border-white/10 p-2 mb-3 overflow-y-auto min-h-[80px]">
            <p className="vibes-label mb-1">Execution Log</p>
            {sentinelLog.length === 0 ? (
              <p className="font-mono text-[10px] text-white/20">// arm the sentinel to start monitoring</p>
            ) : sentinelLog.map((l, i) => (
              <p key={i} className={`font-mono text-[10px] mb-0.5 ${
                l.alert ? 'text-vibes-green font-bold' : 'text-white/40'
              }`}>
                <span className="text-white/20 mr-1">[{l.ts}]</span>{l.msg}
              </p>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setSentinel('armed'); setSentinelLog([]) }}
              disabled={!online || !focusMarket || sentinel === 'armed' || !walletAddress}
              className="flex-1 font-mono text-xs tracking-widest py-2 border transition-all
                bg-white text-black border-white hover:bg-vibes-green
                disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-white disabled:border-white/20"
            >
              {!walletAddress ? 'CONNECT WALLET FIRST' : sentinel === 'armed' ? '● SENTINEL ARMED' : 'ARM SENTINEL'}
            </button>
            <button
              onClick={() => { setSentinel('idle'); setSentinelLog([]) }}
              disabled={sentinel === 'idle'}
              className="font-mono text-xs tracking-widest px-4 py-2 border border-white/20 text-white
                hover:border-red-500 hover:text-red-400 transition-all
                disabled:opacity-30 disabled:cursor-not-allowed"
            >
              DISARM
            </button>
          </div>
        </div>

      </div>

      {/* Footer */}
      <footer className="flex justify-between items-center pt-3 border-t border-white/10 mt-1">
        <span className="vibes-label">Jupiter Oracle Dashboard v6.0.0</span>
        <span className="vibes-label">
          Price v3 · Prediction v1 · Swap v2 · Superteam Bounty
        </span>
      </footer>
    </div>
  )
}
