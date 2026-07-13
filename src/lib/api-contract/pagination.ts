import { z } from "zod";

/**
 * v1 pagination standard for list endpoints (docs/API-CONTRACT.md):
 * opaque forward cursors, bounded page sizes, `nextCursor: null` as the
 * ONLY end-of-list signal. Offsets are not part of the contract - they
 * break under concurrent writes and can't be indexed cheaply.
 */

export const PAGINATION_MAX_LIMIT = 100;
export const PAGINATION_DEFAULT_LIMIT = 20;

/** Query params accepted by every paginated list endpoint. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  /**
   * Opaque server-issued cursor from a previous page's `nextCursor`.
   * Clients never construct or parse cursors; the encoding may change
   * without notice.
   */
  cursor: z.string().min(1).max(400).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** The `data` payload shape of every paginated response. */
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    /** null = no further pages. Anything else feeds the next request's `cursor`. */
    nextCursor: z.string().nullable(),
  });

/** Server helper: encode/decode opaque cursors (base64url JSON). */
export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
export function decodeCursor<T = Record<string, unknown>>(cursor: string): T | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
