# Zoid-Vault image storage (Cloudflare R2)

Tab images live on **Cloudflare R2** (zero egress, 10 GB free). The Postgres
`zoid_vault` table stores only public URLs, so the storage backend is swappable.

## Bucket

- Bucket name: `tabzoid-vault`
- Public access: R2 `r2.dev` dev subdomain for now; move to a custom domain
  (e.g. `img.tabzoid.com`) before launch for CDN caching + stable URLs.

## Key naming convention

Keyed by the `zoid_vault.id` (UUID — stable, unlike the slug):

```
{id}/front.webp
{id}/front_thumb.webp
{id}/back.webp
{id}/back_thumb.webp
{id}/can_top.webp        (optional, later)
{id}/can_top_thumb.webp  (optional, later)
```

Stored in the DB as full public URLs, e.g.
`https://<public-domain>/{id}/front.webp` → `image_front`,
`https://<public-domain>/{id}/front_thumb.webp` → `image_front_thumb`.

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
