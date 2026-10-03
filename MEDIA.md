# Media: box3d-WEBGPU

Nothing for this project is on the Railway drive yet (`apex-media ls box3d-WEBGPU` and `box3d` were
empty on 2026-10-03). Large local-only sets on the owner's Mac (2026-10-03), not in git, queued for
the owner's decision (not uploaded):

| local path | size | what |
|---|---|---|
| `benchmarks/experiments/` | ~2.0 GB | benchmark experiment runs (regenerable) |
| `benchmarks/results/` | ~680 MB | benchmark result captures |
| `benchmarks/baselines/` (binaries) | ~255 MB | baseline captures/binaries (text parts are in git) |
| `public/studio/` (untracked images/models) | ~121 MB | studio assets not yet committed |
| `docs/design/` (images) | ~85 MB | design evidence images (reports/JSON are in git) |

When media is published it goes to `media/box3d-WEBGPU/<YYYYMMDD-task>/` and is listed here with
size and sha256. Fetch recipe:

```
# needs cloud env secrets: RAILWAY_MEDIA_S3_ENDPOINT, RAILWAY_MEDIA_S3_ACCESS_KEY_ID, RAILWAY_MEDIA_S3_SECRET_ACCESS_KEY (set by the owner in the Claude Code / Codex cloud environment settings; never commit them)
export RCLONE_CONFIG_R_TYPE=s3 RCLONE_CONFIG_R_PROVIDER=Other RCLONE_CONFIG_R_REGION=auto RCLONE_CONFIG_R_FORCE_PATH_STYLE=true \
       RCLONE_CONFIG_R_ENDPOINT="$RAILWAY_MEDIA_S3_ENDPOINT" RCLONE_CONFIG_R_ACCESS_KEY_ID="$RAILWAY_MEDIA_S3_ACCESS_KEY_ID" \
       RCLONE_CONFIG_R_SECRET_ACCESS_KEY="$RAILWAY_MEDIA_S3_SECRET_ACCESS_KEY"
rclone copy "R:home-inactive-offload-20260915-vpgsxt/media/box3d-WEBGPU/<YYYYMMDD-task>/" ./media/ && sha256sum -c media.sha256
```
