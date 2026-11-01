#!/usr/bin/env python3
"""Plot recorded production-renderer results; never runs a benchmark."""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent
report = json.loads((ROOT / "results/software.json").read_text())
if report["status"] != "PASSED":
    raise SystemExit("Refusing to chart a failed comparison as qualified evidence")
rows = [t for t in report["timings"] if t["variant"] == "candidate-default"]
labels = {
    "all-visible-opaque": "All visible · 512 instances",
    "mostly-offscreen": "Mostly offscreen · 4,096",
    "mixed-materials": "Mixed materials · 640",
    "paused-orbit": "Camera orbit · 384",
    "moving-rigids": "Moving objects · 384",
    "quality-4x-nine-taps": "4× MSAA / 9 shadow taps · 192",
}
if len(rows) != 6 or {r["id"] for r in rows} != set(labels):
    raise SystemExit("Expected all six default-configuration cases")

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11})
fig, (ax, ratio_ax) = plt.subplots(
    1, 2, figsize=(13.5, 6.8), gridspec_kw={"width_ratios": [2.2, 1]}, sharey=True
)
fig.patch.set_facecolor("#fafbfc")
y = np.arange(len(rows))
base = [r["baseline"]["wallCompletion"]["p50"] for r in rows]
candidate = [r["candidate"]["wallCompletion"]["p50"] for r in rows]
ax.barh(y - 0.18, base, height=0.31, color="#727e8b", label="Published baseline")
ax.barh(y + 0.18, candidate, height=0.31, color="#167ca8", label="New defaults")
for i, (a, b) in enumerate(zip(base, candidate)):
    ax.text(a + 1.1, i - 0.18, f"{a:.2f}", va="center", fontsize=10, color="#384452")
    ax.text(b + 1.1, i + 0.18, f"{b:.2f}", va="center", fontsize=10, color="#126789")
ax.set_yticks(y, [labels[r["id"]] for r in rows])
ax.invert_yaxis()
ax.set_xlim(0, max(base + candidate) * 1.16)
ax.set_xlabel("Queue-completed render time (median milliseconds; lower is better)", labelpad=12)
ax.legend(loc="lower right", frameon=False, fontsize=10)

for i, row in enumerate(rows):
    uncertainty = row["uncertainty"]
    median = uncertainty["pairedRatioMedian"]
    low, high = uncertainty["bootstrap95PercentInterval"]
    color = "#167ca8" if low > 1 else "#7a7d83"
    ratio_ax.errorbar(
        median, i, xerr=[[median - low], [high - median]],
        fmt="o", color=color, capsize=4, markersize=6, linewidth=2,
    )
    ratio_ax.text(high + 0.025, i, f"{median:.2f}×", va="center", fontsize=10, color=color)
ratio_ax.axvline(1, color="#a2a9b1", linestyle="--", linewidth=1)
ratio_ax.set_xlim(0.85, 2.08)
ratio_ax.set_xticks([1, 1.25, 1.5, 1.75, 2])
ratio_ax.set_xlabel("Paired speed ratio\n(median and 95% bootstrap interval)", labelpad=12)
ratio_ax.tick_params(axis="y", left=False, labelleft=False)

for item in (ax, ratio_ax):
    item.set_facecolor("#fafbfc")
    item.set_axisbelow(True)
    item.grid(axis="x", color="#dce1e5", linewidth=0.7)
    item.tick_params(length=0)
    for spine in item.spines.values():
        spine.set_visible(False)

fig.suptitle("Box3D · production renderer comparison", x=0.045, y=0.985, ha="left", fontsize=20, fontweight="bold", color="#263746")
fig.text(0.045, 0.925, "SwiftShader software adapter  ·  320 × 240  ·  20 A/B pairs per case  ·  equal rendering quality", fontsize=11, color="#576573")
fig.text(0.045, 0.055, "Intervals describe this run only. Moving objects have no resolved gain. Optional GPU visibility is excluded from this chart.", fontsize=10, color="#576573")
fig.text(0.045, 0.022, "Rendering only: simulation and presentation excluded. These are not physical-GPU results or application FPS.", fontsize=10, color="#576573")
fig.subplots_adjust(left=0.235, right=0.985, bottom=0.20, top=0.86, wspace=0.20)
for suffix in ("png", "svg"):
    fig.savefig(ROOT / f"results/default-latency.{suffix}", dpi=180, facecolor=fig.get_facecolor())
print("Wrote results/default-latency.png and .svg from the recorded default-configuration cases")
