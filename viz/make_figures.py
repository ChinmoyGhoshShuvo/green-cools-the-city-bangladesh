"""Analysis figures for Green Cools the City.

Reads data/city_year_summary.csv, data/pixel_samples.csv and one example raster
(data/rasters/Dhaka_2025_NDVI_LST.tif) and writes PNG figures to images/.
Run from the repository folder:  python viz/make_figures.py
"""
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio

ROOT = Path(__file__).resolve().parent.parent
DATA, OUT = ROOT / "data", ROOT / "images"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.titlesize": 10, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False, "savefig.dpi": 200, "savefig.bbox": "tight",
    "figure.facecolor": "white",
})
# Okabe-Ito colour-blind-safe palette (8 colours, one per city)
OI = ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"]
SRC = "Data: USGS Landsat 8/9 Collection 2 Level-2 via Microsoft Planetary Computer; ~12 × 13 km window per city core."

sm = pd.read_csv(DATA / "city_year_summary.csv")
px = pd.read_csv(DATA / "pixel_samples.csv")
sm["per01"] = sm["slope"] / 10  # °C change per +0.1 NDVI

# ---------------------------------------------------------------- Figure 1
order = sm.groupby("city")["per01"].median().sort_values().index.tolist()  # strongest cooling first
fig, ax = plt.subplots(figsize=(6.6, 3.6))
for i, c in enumerate(order):
    g = sm[sm.city == c]
    jitter = np.linspace(-0.18, 0.18, len(g))
    sc = ax.scatter(g["per01"], i + jitter, c=g["r"], cmap="viridis_r", vmin=-0.8, vmax=-0.1,
                    s=22, edgecolor="white", linewidth=0.4, zorder=3)
    med = g["per01"].median()
    ax.plot([med, med], [i - 0.32, i + 0.32], color="#D55E00", lw=2.4, zorder=4)
    ax.text(0.08, i, f"{med:+.2f}", va="center", ha="left", fontsize=8, color="#D55E00", fontweight="bold")
ax.axvline(0, color="#999999", lw=0.8)
ax.set_yticks(range(len(order)), order)
ax.invert_yaxis()
ax.set_xlim(-2.3, 0.35)
ax.set_xlabel("Change in land surface temperature for +0.1 NDVI (°C)")
ax.set_title("Cooling effect of vegetation, 8 Bangladeshi cities, 2014–2025")
cb = fig.colorbar(sc, ax=ax, pad=0.02, shrink=0.85)
cb.set_label("Pearson r of the yearly fit")
fig.text(0.01, -0.03, "Dots: one pre-monsoon scene per city-year (95 fits). Orange bar and label: median over the years. "
         "Every fit is negative.\n" + SRC, fontsize=7, color="#555555", va="top")
fig.savefig(OUT / "cooling-per-ndvi-by-city.png")
plt.close(fig)

# ---------------------------------------------------------------- Figure 2
# LST anomaly (pixel LST minus its city-year sample mean) against NDVI, pooled over all years.
px["anom"] = px["lst_c"] - px.groupby(["city", "year"])["lst_c"].transform("mean")
bins = np.arange(0.0, 0.90001, 0.05)
mid = (bins[:-1] + bins[1:]) / 2
fig, ax = plt.subplots(figsize=(6.6, 3.8))
for k, c in enumerate(sm.groupby("city")["per01"].median().sort_values().index):
    g = px[px.city == c]
    cut = pd.cut(g["ndvi"], bins)
    agg = g.groupby(cut, observed=False)["anom"].agg(["median", "size"])
    ok = agg["size"].to_numpy() >= 50  # skip sparsely populated NDVI bins
    ax.plot(mid[ok], agg["median"].to_numpy()[ok], marker="o", ms=3, lw=1.5, color=OI[k], label=c)
ax.axhline(0, color="#999999", lw=0.8)
ax.set_xlabel("NDVI (greenness)")
ax.set_ylabel("LST relative to city-year mean (°C)")
ax.set_title("Greener ground is cooler in every city")
ax.legend(frameon=False, ncol=2, fontsize=8, loc="upper right")
fig.text(0.01, -0.03, "Median anomaly per 0.05 NDVI bin, pooling 600 sampled land pixels × 95 city-years; bins with <50 pixels omitted.\n"
         "Subtracting each scene's mean removes differences in weather and scene date between years. The cool, sparse pixels below\n"
         "NDVI ≈ 0.15 in Khulna and Chattogram are likely wet ground or water edges that the QA water flag missed.\n" + SRC,
         fontsize=7, color="#555555", va="top")
fig.savefig(OUT / "lst-anomaly-vs-ndvi-all-cities.png")
plt.close(fig)

# ---------------------------------------------------------------- Figure 3
with rasterio.open(DATA / "rasters" / "Dhaka_2025_NDVI_LST.tif") as r:
    ndvi, lst = r.read(1), r.read(2)
    b = r.bounds
ext = [(b.left - b.left) / 1000, (b.right - b.left) / 1000, 0, (b.top - b.bottom) / 1000]
fig, axs = plt.subplots(1, 2, figsize=(6.4, 4.0))
im0 = axs[0].imshow(ndvi, cmap="YlGn", vmin=0, vmax=0.7, extent=ext)
im1 = axs[1].imshow(lst, cmap="inferno", vmin=np.nanpercentile(lst, 1), vmax=np.nanpercentile(lst, 99), extent=ext)
for ax, im, t, lab in [(axs[0], im0, "NDVI (greenness)", "NDVI"), (axs[1], im1, "Land surface temperature", "°C")]:
    ax.set_title(t)
    ax.set_xlabel("km")
    for s in ("top", "right"):
        ax.spines[s].set_visible(True)
    cb = fig.colorbar(im, ax=ax, orientation="horizontal", pad=0.14, shrink=0.85)
    cb.set_label(lab)
axs[0].set_ylabel("km")
fig.suptitle("Dhaka city core, 28 March 2025: greener ground is cooler", fontweight="bold", y=1.0)
m = sm[(sm.city == "Dhaka") & (sm.year == 2025)].iloc[0]
fig.text(0.01, -0.02, f"Landsat scene {m.scene}; 30 m pixels, UTM 46N. For this scene: {m.per01:+.2f} °C per +0.1 NDVI, r = {m.r:.2f}.\n"
         "Water is shown on the maps (cool dark lines) but left out of the fits.\n" + SRC, fontsize=7, color="#555555", va="top")
fig.savefig(OUT / "dhaka-2025-ndvi-lst-map.png")
plt.close(fig)
print("Figures written to", OUT)
