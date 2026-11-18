export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const MAX_MCP_BODY_BYTES = 64 * 1024;
export const MAX_BEACON_BODY_BYTES = 512;
export const MAX_BATCH_REQUESTS = 20;
export const RETRY_AFTER_SECONDS = 60;

export const declaredBodyExceeds = (request: Request, maxBytes: number): boolean =>
  Number(request.headers.get("content-length") ?? 0) > maxBytes;

export const exceedsBatchLimit = (payload: unknown): boolean =>
  Array.isArray(payload) && payload.length > MAX_BATCH_REQUESTS;

export const clientKey = (request: Request): string =>
  request.headers.get("cf-connecting-ip") ?? "sin-ip";

export async function withinRateLimit(
  limiter: RateLimiter | undefined,
  request: Request,
): Promise<boolean> {
  if (limiter === undefined) return true;
  const { success } = await limiter.limit({ key: clientKey(request) });
  return success;
}
