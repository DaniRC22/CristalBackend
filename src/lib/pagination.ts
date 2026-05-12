const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;

export function parsePage(raw: string | undefined): number {
  const n = parseInt(raw ?? '1');
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

export function parseLimit(raw: string | undefined, defaultLimit = 20): number {
  const n = parseInt(raw ?? String(defaultLimit));
  if (!Number.isFinite(n) || n < 1) return defaultLimit;
  return Math.min(n, MAX_LIMIT);
}
