import { USDC_DECIMALS } from "@/config";

/** "1234.5" -> "1234500000" (6 decimals). Returns null on invalid input. */
export function parseUsdc(input: string): string | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const units = BigInt(whole) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt((frac + "000000").slice(0, USDC_DECIMALS));
  return units.toString();
}

export function formatUsdc(units: string | bigint, opts: { symbol?: boolean } = {}): string {
  const v = BigInt(units);
  const base = BigInt(10) ** BigInt(USDC_DECIMALS);
  const whole = v / base;
  const frac = (v % base).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  const wholeStr = whole.toLocaleString("en-US");
  const shown = frac ? `${wholeStr}.${frac.slice(0, 2).padEnd(2, "0")}${frac.length > 2 ? frac.slice(2) : ""}` : `${wholeStr}.00`;
  return opts.symbol === false ? shown : `${shown} USDC`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function relative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size);
      const label = `${n} ${name}${n === 1 ? "" : "s"}`;
      return diff >= 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return diff >= 0 ? "in under a minute" : "just now";
}

export function shortAccount(a: string): string {
  return a.length > 24 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a;
}
