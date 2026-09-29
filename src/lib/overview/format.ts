/** "$0.42"; tiny amounts keep enough digits to be meaningful ("$0.0031"). */
export function formatUsd(value: number, { precise = false }: { precise?: boolean } = {}): string {
  const digits = precise && value > 0 && value < 0.1 ? 4 : 2;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString("en-US");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  return `${Math.floor(seconds / 60)} m ${Math.round(seconds % 60)} s`;
}

/** "Sep 29, 14:05" in UTC. */
export function formatDateTime(value: Date): string {
  return value.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
}
