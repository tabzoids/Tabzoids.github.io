#!/usr/bin/env python3
"""
Import a Bubly tab image set into the Zoid-Vault.

Pipeline per front tab (from generated/_manifest.tsv):
  front image  -> full WebP + 300px thumbnail
  back image   -> full WebP + 300px thumbnail   (shared per color)
  upload the 4 variants to Cloudflare R2 under {uuid}/...
  emit a row record (with public URLs) to rows.json

By default this runs a DRY RUN: it processes images locally into --out and
writes rows.json, but does NOT upload or touch the database. Add --live (with
R2_* env vars set) to actually upload to R2. Row inserts are done separately
from rows.json so no Supabase key is needed here.

Env vars for --live:
  R2_ENDPOINT           https://<accountid>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID      R2 API token access key id
  R2_SECRET_ACCESS_KEY  R2 API token secret
  R2_BUCKET             bucket name (default: tabzoid-vault)

Usage:
  python3 import_tabs.py --src data/bubly --out .work/bubly \
      --base-url https://pub-XXXX.r2.dev            # dry run
  python3 import_tabs.py --src data/bubly --out .work/bubly \
      --base-url https://pub-XXXX.r2.dev --live     # real upload
"""
import argparse, csv, io, json, os, uuid
from pathlib import Path
from PIL import Image

BRAND = {
    "brand": "Bubly Sparkling Water",
    "brand_id": "BSW",
    "manufacturer": "PepsiCo Inc.",
    "series": "Original Bubly",
}
FULL_LONG_EDGE = 1200   # cap (source is already ~720, so effectively pass-through)
THUMB_LONG_EDGE = 300
FULL_Q = 82
THUMB_Q = 75
VARIANTS = ("front.webp", "front_thumb.webp", "back.webp", "back_thumb.webp")


def parse_color(color: str):
    """'purple-extra-dark' -> ('purple', 'extra-dark'); 'red' -> ('red', None)"""
    parts = color.split("-")
    return parts[0], ("-".join(parts[1:]) or None)


def to_webp(im: Image.Image, long_edge: int, quality: int) -> bytes:
    im = im.convert("RGBA")
    w, h = im.size
    scale = long_edge / max(w, h)
    if scale < 1:
        im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="bubly dir (has generated/ and backs/)")
    ap.add_argument("--out", required=True, help="work dir for processed files + rows.json")
    ap.add_argument("--base-url", required=True, help="R2 public base URL")
    ap.add_argument("--live", action="store_true", help="upload to R2 (needs R2_* env)")
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    (out / "upload").mkdir(parents=True, exist_ok=True)
    base = args.base_url.rstrip("/")

    s3 = bucket = None
    if args.live:
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        bucket = os.environ.get("R2_BUCKET", "tabzoid-vault")

    manifest = list(csv.DictReader(open(src / "generated" / "_manifest.tsv"), delimiter="\t"))
    rows, skipped, jobs = [], [], []  # jobs: (key, bytes) for parallel upload

    for m in manifest:
        color, word = m["color"].strip(), m["word"].strip()
        stem = Path(m["file"]).stem
        front_path = src / "generated" / f"{stem}.webp"
        back_path = src / "backs" / f"back-{color}.webp"
        if not front_path.exists() or not back_path.exists():
            skipped.append({"stem": stem, "color": color,
                            "front": front_path.exists(), "back": back_path.exists()})
            continue

        base_color, shade = parse_color(color)
        # R2 key scheme: {brand_id}/{slug}/...  -> readable, collision-safe URLs.
        prefix = f"{BRAND['brand_id']}/{stem}"
        # Source is already web-sized WebP -> pass full images through untouched;
        # only generate the 300px thumbnails.
        data = {
            "front.webp": front_path.read_bytes(),
            "front_thumb.webp": to_webp(Image.open(front_path), THUMB_LONG_EDGE, THUMB_Q),
            "back.webp": back_path.read_bytes(),
            "back_thumb.webp": to_webp(Image.open(back_path), THUMB_LONG_EDGE, THUMB_Q),
        }

        local_dir = out / "upload" / stem
        local_dir.mkdir(parents=True, exist_ok=True)
        for name in VARIANTS:
            (local_dir / name).write_bytes(data[name])
            if args.live:
                jobs.append((f"{prefix}/{name}", data[name]))

        rows.append({
            "title": f"{word} ({color})",
            "slug": stem,
            **BRAND,
            "color_type": base_color,
            "color_variant": shade,
            "mark_media": word,
            "tab_type": "ST",
            "image_front": f"{base}/{prefix}/front.webp",
            "image_front_thumb": f"{base}/{prefix}/front_thumb.webp",
            "image_back": f"{base}/{prefix}/back.webp",
            "image_back_thumb": f"{base}/{prefix}/back_thumb.webp",
            "publishing_status": "Published",
        })

    if args.live and jobs:
        from concurrent.futures import ThreadPoolExecutor

        def put(job):
            key, body = job
            s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="image/webp",
                          CacheControl="public, max-age=31536000, immutable")
            return key

        done = 0
        with ThreadPoolExecutor(max_workers=24) as ex:
            for _ in ex.map(put, jobs):
                done += 1
        print(f"uploaded {done}/{len(jobs)} objects to R2 bucket '{bucket}'")

    json.dump(rows, open(out / "rows.json", "w"), indent=2)
    print(f"{'LIVE upload' if args.live else 'DRY RUN'}: processed {len(rows)} rows")
    if skipped:
        print(f"skipped {len(skipped)}: {skipped}")
    print(f"wrote {out/'rows.json'} and local variants under {out/'upload'}")


if __name__ == "__main__":
    main()
