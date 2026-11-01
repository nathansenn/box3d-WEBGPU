# Media: box3d-WEBGPU

Large local-only sets on the owner's Mac (inventoried 2026-10-03) and where they are now. The
2026-10-04 backup commit (`backup/offload-20261004`, b824c71) placed the benchmark sets in the
Railway drive tar and committed the studio and design media to that branch; the 2026-11-01
integration merged that media into the main line.

| local path | size | what | status (2026-11-01) |
|---|---|---|---|
| `benchmarks/experiments/` | ~2.0 GB | benchmark experiment runs (regenerable) | not in git; Railway drive tar |
| `benchmarks/results/` | ~680 MB | benchmark result captures | captures not in git; tracked JSON evidence stays in git |
| `benchmarks/baselines/` (binaries) | ~255 MB | baseline captures/binaries | not in git; text parts are in git |
| `public/studio/` | ~121 MB | studio textures, models, reference images | in git |
| `docs/design/` (images, logs) | ~85 MB | design and QA evidence | in git |

When media is published it goes to `media/box3d-WEBGPU/<YYYYMMDD-task>/` and is listed here with
size and sha256. Fetch recipe:

```
# needs cloud env secrets: RAILWAY_MEDIA_S3_ENDPOINT, RAILWAY_MEDIA_S3_ACCESS_KEY_ID, RAILWAY_MEDIA_S3_SECRET_ACCESS_KEY (set by the owner in the Claude Code / Codex cloud environment settings; never commit them)
export RCLONE_CONFIG_R_TYPE=s3 RCLONE_CONFIG_R_PROVIDER=Other RCLONE_CONFIG_R_REGION=auto RCLONE_CONFIG_R_FORCE_PATH_STYLE=true \
       RCLONE_CONFIG_R_ENDPOINT="$RAILWAY_MEDIA_S3_ENDPOINT" RCLONE_CONFIG_R_ACCESS_KEY_ID="$RAILWAY_MEDIA_S3_ACCESS_KEY_ID" \
       RCLONE_CONFIG_R_SECRET_ACCESS_KEY="$RAILWAY_MEDIA_S3_SECRET_ACCESS_KEY"
rclone copy "R:home-inactive-offload-20260915-vpgsxt/media/box3d-WEBGPU/<YYYYMMDD-task>/" ./media/ && sha256sum -c media.sha256
```
