#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POLIIGON_LIBRARY="${POLIIGON_LIBRARY:-/Users/commander/Documents/HouseBuilder/poliigon}"
OUT="$ROOT/public/textures"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/box3d-poliigon.XXXXXX")"
TILE_SIZE=504
ATLAS_SIZE=1008
trap 'rm -rf "$TMP"' EXIT

for tool in ffmpeg toktx; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done

CONCRETE="$POLIIGON_LIBRARY/weathered-concrete-wall-texture-10729"
METAL="$POLIIGON_LIBRARY/clean-galvanized-zinc-metal-texture-7184"
FABRIC="$POLIIGON_LIBRARY/woven-upholstery-fabric-slate-blue-8447"
STONE="$POLIIGON_LIBRARY/large-format-honed-stone-sidewalk-texture-grey-11223"

for file in \
  "$CONCRETE/basecolor.jpg" "$CONCRETE/normal.png" "$CONCRETE/roughness.jpg" \
  "$METAL/basecolor.jpg" "$METAL/normal.png" "$METAL/roughness.jpg" \
  "$FABRIC/basecolor.jpg" "$FABRIC/normal.png" "$FABRIC/roughness.jpg" \
  "$STONE/basecolor.jpg" "$STONE/normal.png" "$STONE/roughness.jpg"; do
  [[ -f "$file" ]] || { echo "Missing Poliigon source map: $file" >&2; exit 1; }
done

mkdir -p "$OUT"

ffmpeg -y -loglevel error \
  -i "$CONCRETE/basecolor.jpg" -i "$METAL/basecolor.jpg" \
  -i "$FABRIC/basecolor.jpg" -i "$STONE/basecolor.jpg" \
  -filter_complex \
  "[0:v]scale=${TILE_SIZE}:${TILE_SIZE}[c];[1:v]scale=${TILE_SIZE}:${TILE_SIZE}[m];[2:v]scale=${TILE_SIZE}:${TILE_SIZE}[f];[3:v]scale=${TILE_SIZE}:${TILE_SIZE}[s];[c][m][f][s]xstack=inputs=4:layout=0_0|${TILE_SIZE}_0|0_${TILE_SIZE}|${TILE_SIZE}_${TILE_SIZE}[out]" \
  -map '[out]' -frames:v 1 "$TMP/albedo.png"

ffmpeg -y -loglevel error \
  -i "$CONCRETE/normal.png" -i "$CONCRETE/roughness.jpg" \
  -i "$METAL/normal.png" -i "$METAL/roughness.jpg" \
  -i "$FABRIC/normal.png" -i "$FABRIC/roughness.jpg" \
  -i "$STONE/normal.png" -i "$STONE/roughness.jpg" \
  -filter_complex \
  "[0:v]scale=${TILE_SIZE}:${TILE_SIZE}[n0];[1:v]scale=${TILE_SIZE}:${TILE_SIZE},format=gray[r0];[n0][r0]alphamerge[a0];[2:v]scale=${TILE_SIZE}:${TILE_SIZE}[n1];[3:v]scale=${TILE_SIZE}:${TILE_SIZE},format=gray[r1];[n1][r1]alphamerge[a1];[4:v]scale=${TILE_SIZE}:${TILE_SIZE}[n2];[5:v]scale=${TILE_SIZE}:${TILE_SIZE},format=gray[r2];[n2][r2]alphamerge[a2];[6:v]scale=${TILE_SIZE}:${TILE_SIZE}[n3];[7:v]scale=${TILE_SIZE}:${TILE_SIZE},format=gray[r3];[n3][r3]alphamerge[a3];[a0][a1][a2][a3]xstack=inputs=4:layout=0_0|${TILE_SIZE}_0|0_${TILE_SIZE}|${TILE_SIZE}_${TILE_SIZE}[out]" \
  -map '[out]' -frames:v 1 "$TMP/surface.png"

toktx --t2 --genmipmap --target_type RGBA --assign_oetf srgb \
  "$OUT/poliigon-materials-albedo-rgba8.ktx2" "$TMP/albedo.png"
toktx --t2 --genmipmap --target_type RGBA --assign_oetf linear \
  "$OUT/poliigon-materials-surface-rgba8.ktx2" "$TMP/surface.png"
toktx --t2 --encode astc --astc_blk_d 6x6 --astc_quality thorough --genmipmap --target_type RGBA --assign_oetf srgb \
  "$OUT/poliigon-materials-albedo-astc.ktx2" "$TMP/albedo.png"
toktx --t2 --encode astc --astc_blk_d 6x6 --astc_quality thorough --genmipmap --target_type RGBA --assign_oetf linear \
  "$OUT/poliigon-materials-surface-astc.ktx2" "$TMP/surface.png"

echo "Built ${ATLAS_SIZE}x${ATLAS_SIZE} browser-ready Poliigon atlases in $OUT"
ls -lh "$OUT"/poliigon-materials-*.ktx2
