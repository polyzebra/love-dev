# Media Access (Phase 0I)

## Decision: controlled hybrid

- **Authenticated proxy (canonical)** - `GET /api/media/[photoId]/[variant]`.
  Authorization runs on EVERY request against the canonical principal
  (cookie or Bearer, Phase 0C `requireSession`). A leaked proxy URL grants
  nothing without a session, so proxy URLs are safe to store and share
  inside the app (`Photo.url` etc.).
- **Short-lived signed URLs (optional lane)** -
  `GET /api/media/[photoId]/[variant]/url`. Same authorization, then a
  60-second storage signature (`SIGNED_MEDIA_TTL_SECONDS`). For image
  pipelines that want direct-to-storage fetches (native shells,
  prefetchers). The endpoint response is `no-store` - the URL is a
  credential - and a leaked signed URL dies in about a minute. **No
  long-lived or public URLs exist anywhere.**

## Why the proxy needed fixing for Bearer

The proxy authorized both transports (requireSession), but fetched bytes
with the cookie-bound Supabase client - Bearer callers passed
authorization and then failed the storage download. Byte fetches now use
the **service role** (`services/media.ts`): the route's own authorization
IS the access boundary; tying the storage read to the caller's cookie JWT
added nothing except a Bearer failure mode. Keyless dev environments fall
back to the cookie client.

## Authorization (one rule, `authorizeMediaAccess`)

- 401 anonymous; 403 suspended/banned (requireSession choke point)
- owner: always, any status (their own under-review photos)
- staff: always (the moderation queue renders REJECTED photos)
- everyone else: `ACTIVE` and not moderation-`REJECTED`, and **no block
  in either direction** between viewer and owner (Phase 0I hardening -
  previously a blocked pair could still fetch bytes by direct URL)
- the private-bucket guarantee is unchanged: bytes are reachable only
  through these two authorized surfaces

## Caching

Proxy responses: `private, max-age=31536000, immutable` +
`"{photoId}-{variant}-v{mediaVersion}"` ETag. `private` keeps shared
caches from serving bytes across users; immutability holds because a
reprocess bumps `mediaVersion`. The 304 revalidation path runs full
authorization first - a cached validator never bypasses auth. The
signed-URL endpoint is `no-store`.

## Tests (`tests/api-0i.test.ts`, live - real private-bucket objects)

Owner via Bearer AND cookies · permitted viewer · anonymous 401 ·
under-review owner-only · blocked pair 403 · suspended 403 · staff on
REJECTED · authorized 304 + validator-never-bypasses-auth · signed URL
mint/fetch/no-store · signed-URL endpoint authorization parity ·
expired signature refused.
