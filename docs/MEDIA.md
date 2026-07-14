# Tirvea media architecture

One canonical photo system. This document is the map; the source of
truth is the code paths listed below.

## Who renders photos (audited)

Through **PhotoFrame** (`src/components/shared/photo-frame.tsx` - the
only profile-photo renderer):

| Surface                | File                                        | Mode | Variant        | Lazy                   |
| ---------------------- | ------------------------------------------- | ---- | -------------- | ---------------------- |
| Swipe top card + peek  | `src/components/app/swipe-deck.tsx`         | fill | card           | eager                  |
| Fullscreen viewer      | `src/components/explore/profile-viewer.tsx` | fill | full           | eager                  |
| Explore person card    | `src/components/explore/person-card.tsx`    | 4:5  | gallery        | lazy                   |
| Profile hero + gallery | `src/components/profile/photo-manager.tsx`  | 4:5  | card / gallery | hero eager, tiles lazy |
| Matches grid           | `src/app/(app)/matches/page.tsx`            | 4:5  | gallery        | lazy                   |

Deliberate non-PhotoFrame renders: circular `Avatar` primitives (chat
lists, profile peek - not photo frames), admin moderation thumbs
(`src/app/admin/photos`, `admin/verification` - authenticated staff
surfaces), marketing pages (stock imagery), the explore category
illustration (object-contain artwork), and the swipe AmbientBackdrop
(a lighting effect fed by the same card URL).

## Pipeline

Upload -> in-memory Buffer only -> sharp `.rotate()` (bakes EXIF
orientation, strips metadata) -> four WebP derivatives (quality 84,
effort 5; WebP has no progressive mode):

| Variant | Size      | Used by                |
| ------- | --------- | ---------------------- |
| thumb   | 320x400   | lists, admin queue     |
| gallery | 720x900   | grids/tiles            |
| card    | 1080x1350 | swipe, profile hero    |
| full    | 1800x2700 | fullscreen viewer only |

The original is never persisted - not to disk, not to storage.
Pipeline also computes `blurhash`, `dominantColor`, and records
`mimeType`/`sizeBytes` of the original upload.

## Storage

Bucket `listing-images` (private) at
`users/{userId}/photos/{photoId}/{variant}.webp`. Both buckets are
`public=false`; anonymous object fetches are blocked (verified live).
RLS: owner-folder insert/update/delete for authenticated users;
minimum authenticated SELECT so the delivery proxy can stream. The
app never lists or scans storage - the database is the only index
(`Photo.storagePath` holds the folder).

## Delivery

`GET /api/media/{photoId}/{thumb|gallery|card|full}` is the ONLY URL
surface the app stores or renders. Session required; visible to the
owner, staff, or anyone when `status=ACTIVE` and moderation is not
REJECTED. Headers: `image/webp`, `Cache-Control: private,
max-age=31536000, immutable`, `ETag {photoId}-{variant}` with 304
support. Supabase URLs are never exposed to clients.

## Moderation

`src/lib/services/moderation.ts` - `ModerationProvider` interface
(category surface: nudity/sexual, violence/weapons/blood, drugs, hate
symbols, minors, text/logos/QR, screenshots/memes, AI faces,
multiple/no face, animal-instead-of-person).

Verdict mapping (transactional, with a `PhotoModerationEvent` always
written): safe -> APPROVED/ACTIVE - review -> PENDING/ACTIVE (human
queue) - rejected -> REJECTED/REJECTED (proxy 403s non-owners).
Cover with `faceDetected === false` logs a non-blocking warning
event. Admin queue at `/admin/photos`: pending/rejected/auto-approved
tabs, reason history, approve / reject-with-reason / delete
permanently, AdminLog audit. Detection fields render "-" when absent;
scores are never invented.

## Graceful fallbacks (missing env/service)

| Missing                                     | Behaviour                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`     | Upload route returns 503 "Photo storage not configured"; nothing crashes.                                                                                                                              |
| `MODERATION_API_URL` / `MODERATION_API_KEY` | `nullProvider` auto-approves with labels `["unmoderated"]`, a warn log and an honest moderation event - no fake AI scores. A misbehaving external provider degrades to "review", never auto-publishes. |
| HEIC upload (sharp build without HEVC)      | Clean 422 `invalid_image`, no crash.                                                                                                                                                                   |
| Legacy rows without variant URLs            | PhotoFrame falls back `galleryUrl -> url`; demo profiles keep absolute stock URLs.                                                                                                                     |

## Deletion

Photo delete: DB row + all four storage objects + cover promotion.
Account teardown: rows cascade and the whole `users/{uid}/` storage
folder is purged best-effort (can never break teardown). Moderation
events cascade with the photo; the durable audit record for permanent
deletes is AdminLog.

## Download protection (UX, not DRM)

PhotoFrame blocks context menu, drag, selection and iOS long-press
callout on every photo surface. Screenshots and devtools cannot be
prevented - the goal is casual-download friction, same as the major
dating apps.
