/**
 * Tirvea API v1 contract - framework-free Zod schemas shared by the
 * server, the typed client (lib/api-client), future native clients and
 * test tooling. Request-body schemas remain in lib/validators/* (the
 * single validation source the routes already use); this module owns
 * the TRANSPORT contract: envelopes, error codes, pagination and
 * idempotency.
 */
export * from "./envelope";
export * from "./pagination";
export * from "./idempotency";
