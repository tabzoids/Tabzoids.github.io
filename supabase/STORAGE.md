# Zoid-Vault image storage (Cloudflare R2)

Tab images live on **Cloudflare R2** (zero egress, 10 GB free). The Postgres
`zoid_vault` table stores only public URLs, so the storage backend is swappable.

## Bucket

- Bucket name: `tabzoid-vault` (region ENAM, Standard class)
- Public base URL: `https://pub-46ac9b2e70d746d4a3386591c5210da8.r2.dev`
  (r2.dev dev subdomain — rate-limited, dev-only; move to a custom domain
  e.g. `img.tabzoid.com` before launch for CDN caching + stable URLs).
- Full image URL = `<public base>/{id}/front.webp`, etc.

## Key naming convention

Keyed by `{brand_id}/{slug}` — readable, SEO-friendly, collision-safe across
brands, and lets Postgres own the row `id` independently:

```
{brand_id}/{slug}/front.webp
{brand_id}/{slug}/front_thumb.webp
{brand_id}/{slug}/back.webp
{brand_id}/{slug}/back_thumb.webp
{brand_id}/{slug}/can_top.webp        (optional, later)
{brand_id}/{slug}/can_top_thumb.webp  (optional, later)
```

Example: `BSW/hi-u-purple/front.webp`. Stored in the DB as full public URLs,
e.g. `https://<public-base>/BSW/hi-u-purple/front.webp` → `image_front`.

## Image specs

| Variant | Format | Long edge | Quality | Use |
|---------|--------|-----------|---------|-----|
| Full    | WebP   | ~1200 px  | ~80     | detail page |
| Thumb   | WebP   | ~300 px   | ~75     | gallery grid |

Generate both at import time (sharp / Pillow), upload both. Gallery loads
thumbs only; full image loads on the detail view.

## DB columns (zoid_vault)

`image_front`, `image_front_thumb`, `image_back`, `image_back_thumb`,
`image_can_top`, `image_can_top_thumb` — all nullable `text` URLs.

## Setup checklist

1. Cloudflare account (free). **Note:** enabling R2 requires a card on file
   even on the free tier — it won't charge within free limits.
2. Create bucket `tabzoid-vault`.
3. Enable the `r2.dev` public dev URL (or attach a custom domain).
4. Create an R2 API token (read/write) for the bulk-upload script → keep the
   access key id + secret secret; never commit them.
