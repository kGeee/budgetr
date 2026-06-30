"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LiveQuote = {
  /** Current / last trade price. */
  price: number;
  /** Previous close, for day-change math (may be null). */
  prevClose: number | null;
  /** True once we've received a real-time trade tick (vs. the REST snapshot). */
  live: boolean;
  /** Epoch ms of the last update. */
  ts: number;
};

export type LiveStatus =
  | "idle" // no symbols to track
  | "connecting" // fetching snapshot / opening socket
  | "live" // WebSocket open, streaming trades
  | "disabled" // no FINNHUB_API_KEY configured
  | "error"; // gave up after repeated failures

type Ctx = { quotes: Record<string, LiveQuote>; status: LiveStatus };

const LivePricesContext = createContext<Ctx>({ quotes: {}, status: "idle" });

/** Read the live quote map + connection status from context. */
export function useLivePrices(): Ctx {
  return useContext(LivePricesContext);
}

const FINNHUB_WS = "wss://ws.finnhub.io";
const MAX_RECONNECT_DELAY = 30_000;

export function LivePricesProvider({
  symbols,
  children,
}: {
  symbols: string[];
  children: ReactNode;
}) {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connStatus, setConnStatus] = useState<LiveStatus>("connecting");

  // Stable, order-independent key so the effect only re-runs when the actual
  // set of symbols changes.
  const symbolsKey = useMemo(
    () => [...new Set(symbols.map((s) => s.toUpperCase()))].sort().join(","),
    [symbols],
  );

  // With no symbols there's nothing to track — derive "idle" rather than
  // writing state synchronously inside the effect.
  const status: LiveStatus = symbolsKey ? connStatus : "idle";

  useEffect(() => {
    const syms = symbolsKey ? symbolsKey.split(",") : [];
    if (syms.length === 0) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let token: string | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 2_000;

    /** Seed prices from the REST snapshot; also grabs the WS token. */
    async function loadSnapshot(): Promise<boolean> {
      try {
        const res = await fetch(
          `/api/prices?symbols=${encodeURIComponent(syms.join(","))}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          enabled: boolean;
          wsToken: string | null;
          quotes: Record<string, { price: number | null; prevClose: number | null }>;
        };
        if (cancelled) return false;

        if (!data.enabled) {
          setConnStatus("disabled");
          return false;
        }

        token = data.wsToken;
        const seed: Record<string, LiveQuote> = {};
        for (const [sym, q] of Object.entries(data.quotes ?? {})) {
          if (q?.price != null) {
            seed[sym] = {
              price: q.price,
              prevClose: q.prevClose ?? null,
              live: false,
              ts: Date.now(),
            };
          }
        }
        if (Object.keys(seed).length > 0) {
          setQuotes((prev) => ({ ...prev, ...seed }));
        }
        return true;
      } catch {
        return false;
      }
    }

    function connect() {
      if (cancelled || !token) return;

      ws = new WebSocket(`${FINNHUB_WS}?token=${token}`);

      ws.onopen = () => {
        if (cancelled) return;
        setConnStatus("live");
        reconnectDelay = 2_000;
        for (const s of syms) {
          ws?.send(JSON.stringify({ type: "subscribe", symbol: s }));
        }
      };

      ws.onmessage = (ev) => {
        let msg: { type?: string; data?: Array<{ s: string; p: number; t: number }> };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type !== "trade" || !Array.isArray(msg.data)) return;

        setQuotes((prev) => {
          const next = { ...prev };
          for (const t of msg.data!) {
            if (typeof t.p !== "number") continue;
            const existing = next[t.s];
            next[t.s] = {
              price: t.p,
              prevClose: existing?.prevClose ?? null,
              live: true,
              ts: t.t ?? Date.now(),
            };
          }
          return next;
        });
      };

      ws.onerror = () => ws?.close();

      ws.onclose = () => {
        if (cancelled) return;
        setConnStatus("connecting");
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      };
    }

    (async () => {
      // Reset to "connecting" on (re)subscribe — inside this async callback so
      // it isn't a synchronous setState in the effect body.
      setConnStatus("connecting");
      const ok = await loadSnapshot();
      if (cancelled) return;
      if (ok && token) connect();
      else if (ok && !token) setConnStatus("error");
    })();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            for (const s of syms) {
              ws.send(JSON.stringify({ type: "unsubscribe", symbol: s }));
            }
          }
        } catch {
          // ignore — we're tearing down anyway
        }
        ws.close();
      }
    };
  }, [symbolsKey]);

  return (
    <LivePricesContext.Provider value={{ quotes, status }}>
      {children}
    </LivePricesContext.Provider>
  );
}
