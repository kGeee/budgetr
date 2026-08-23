import { describe, it, expect, vi, afterEach } from "vitest";
import { clampRange, getBars, getBarsFor } from "./yahoo";

/**
 * Parsing tests for the charting bar feed. Yahoo's chart payload has two shapes
 * that reliably break naive parsers — holiday/halt rows padded with nulls in the
 * parallel quote arrays, and second-resolution timestamps — and the intraday
 * range caps are silently fatal (Yahoo errors rather than clamping). All three
 * are pinned here; the network is mocked so this stays deterministic.
 */

type QuoteArrays = {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
};

function payload(timestamp: number[], quote: QuoteArrays, meta: Record<string, unknown> = {}) {
  return {
    chart: { result: [{ meta, timestamp, indicators: { quote: [quote] } }] },
  };
}

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampRange", () => {
  it("caps sub-hourly intervals at a month", () => {
    expect(clampRange("5y", "5m")).toBe("1mo");
    expect(clampRange("5d", "15m")).toBe("5d"); // already inside the cap
  });

  it("caps hourly at two years", () => {
    expect(clampRange("max", "1h")).toBe("2y");
    expect(clampRange("6mo", "1h")).toBe("6mo");
  });

  it("leaves daily-and-slower intervals alone", () => {
    expect(clampRange("max", "1d")).toBe("max");
    expect(clampRange("10y", "1wk")).toBe("10y");
  });
});

describe("getBars", () => {
  it("converts second timestamps to milliseconds and keeps OHLCV", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse(
          payload([1_700_000_000, 1_700_086_400], {
            open: [10, 11],
            high: [12, 13],
            low: [9, 10],
            close: [11, 12],
            volume: [500, null],
          }),
        ),
      ),
    );

    const { bars } = await getBars("AAPL", "1mo", "1d");
    expect(bars).toEqual([
      { t: 1_700_000_000_000, open: 10, high: 12, low: 9, close: 11, volume: 500 },
      { t: 1_700_086_400_000, open: 11, high: 13, low: 10, close: 12, volume: null },
    ]);
  });

  it("drops bars Yahoo padded with nulls rather than interpolating them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse(
          payload([1, 2, 3], {
            open: [10, null, 12],
            high: [12, null, 14],
            low: [9, null, 11],
            close: [11, null, 13],
            volume: [1, 2, 3],
          }),
        ),
      ),
    );

    const { bars } = await getBars("AAPL");
    expect(bars.map((b) => b.t)).toEqual([1000, 3000]);
  });

  it("maps 1h to Yahoo's 60m and clamps the range in the URL", async () => {
    const spy = vi.fn<(url: string) => Promise<Response>>(async () => okResponse(payload([], {})));
    vi.stubGlobal("fetch", spy);

    await getBars("MSFT", "max", "1h");
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("interval=60m");
    expect(url).toContain("range=2y"); // 'max' is not available hourly
  });

  it("reads the meta block, preferring previousClose over chartPreviousClose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse(
          payload([1], { open: [1], high: [1], low: [1], close: [1] }, {
            symbol: "NVDA",
            currency: "USD",
            fullExchangeName: "NasdaqGS",
            instrumentType: "EQUITY",
            regularMarketPrice: 123.45,
            previousClose: 120,
            chartPreviousClose: 999,
          }),
        ),
      ),
    );

    const { meta } = await getBars("nvda");
    expect(meta).toEqual({
      symbol: "NVDA",
      currency: "USD",
      exchangeName: "NasdaqGS",
      instrumentType: "EQUITY",
      regularMarketPrice: 123.45,
      previousClose: 120,
    });
  });

  it("falls back to chartPreviousClose when previousClose is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse(payload([1], { open: [1], high: [1], low: [1], close: [1] }, { chartPreviousClose: 88 })),
      ),
    );
    expect((await getBars("X")).meta?.previousClose).toBe(88);
  });

  it("returns empty on a non-ok response, a thrown fetch, or an empty symbol", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await getBars("BAD")).toEqual({ bars: [], meta: null });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(await getBars("AAPL")).toEqual({ bars: [], meta: null });

    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await getBars("   ")).toEqual({ bars: [], meta: null });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("getBarsFor", () => {
  it("uppercases, dedupes, and keys the result by symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(payload([1], { open: [1], high: [1], low: [1], close: [1] }))),
    );

    const out = await getBarsFor(["aapl", "AAPL", " msft ", ""], "1y", "1d");
    expect(Object.keys(out).sort()).toEqual(["AAPL", "MSFT"]);
    expect(out.AAPL.bars).toHaveLength(1);
  });

  it("keeps the good symbols when one of them fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("BAD")
          ? ({ ok: false } as unknown as Response)
          : okResponse(payload([1], { open: [1], high: [1], low: [1], close: [1] })),
      ),
    );

    const out = await getBarsFor(["GOOD", "BAD"]);
    expect(out.GOOD.bars).toHaveLength(1);
    expect(out.BAD).toEqual({ bars: [], meta: null });
  });

  it("is a no-op for an empty list", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await getBarsFor([])).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});
