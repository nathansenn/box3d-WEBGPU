# Post-campaign Metal validation

These files were generated after the v1.13 1,000-case campaign had already been
sealed. They validate the same renderer source (`7c655396…`) on Apple Metal, but
they are **not** substituted into the frozen benchmark evidence.

The byte-exact snapshots tied to `v113-production-1000.json` remain at:

- `../native-rigid-upload-metal.json`
- `../upload-cache-metal.json`
- `../renderer-startup-metal.json`

Keeping the two sets separate preserves reproducibility: `npm run
bench:v1.13:gate` verifies the frozen inputs, while this directory records the
later independent rerun.

Post-campaign results:

- 4,096-body native rigid stream: 327,680 initial bytes, 262,144 transform-only
  bytes, 65,536 color-only bytes, and zero bytes for a settled unchanged frame.
- Upload-cache call path: 23.833 ns cached versus 987.000 ns changed, or 41.41×
  for this isolated cache check; cached uploads remained zero bytes.
- Renderer creation: 25.242 ms optimized versus 25.861 ms v1.9 baseline median,
  a 0.976 optimized/baseline time ratio. This small result is not treated as a
  strong startup-speed claim.
- Timestamp-query quality sweep: all supported 1× and 4× MSAA/shadow cases
  completed with zero uncaptured WebGPU errors. Dawn Metal reported 2× MSAA as
  unsupported.

These are subsystem and hardware-validation measurements, not universal FPS
claims.
