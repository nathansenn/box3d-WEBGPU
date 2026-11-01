# Liquid Lab V3 — 2026-09-12

Build on V2 with shared hydraulic/rendered terrain, floodable riverbanks, shaped runoff surfaces, additional pipe programs, and depth/speed inspection. Retain existing study routes and saved runs.

Verification: conserved volume, stationary water over uneven beds, wet/dry propagation, full preset runs, supply and drainage controls, typecheck, production build, native desktop/mobile UI and replay checks.

Browser exception: task 01a07e7b-23c9-72e1-a62e-b780ac76623f uses a private localhost app and native WebGPU/WebGL. Use disposable in-app tabs for this bounded QA; preserve user tabs and prior remote-transfer/retention rejections. No private build or credentials transferred. Close owned tabs after QA.

Storage admission: 60 GiB available at start; shared 50 GiB reserve. Recheck before build. Preserve existing dirty main and other tasks' artifacts. All servers bind 127.0.0.1.
