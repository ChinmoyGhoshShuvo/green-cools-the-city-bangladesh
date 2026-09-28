"""Green Cools the City - animated NDVI vs LST small multiples (MP4 + GIF)."""
import sys, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import imageio.v2 as imageio

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
px = pd.read_csv(f"{SRC}/pixel_samples.csv")
sm = pd.read_csv(f"{SRC}/city_year_summary.csv")

CITIES = ["Dhaka", "Chattogram", "Khulna", "Rajshahi", "Sylhet", "Barishal", "Rangpur", "Mymensingh"]
CITIES = [c for c in CITIES if c in set(sm.city)]
YEARS = sorted(sm.year.unique())

# ---- palette (reference instance, light surface) ----
SURF, PAGE = "#fcfcfb", "#f9f9f7"
INK, INK2, MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, AXIS = "#e1e0d9", "#c3c2b7"
PT = "#008300"      # series: pixels (green)
FIT = "#eb6834"     # series: fitted line (orange)

XLIM, YLIM = (0, 0.9), (22, 56)
FPS, TWEEN, HOLD = 12, 8, 16

plt.rcParams.update({"font.family": "DejaVu Sans", "axes.edgecolor": AXIS, "axes.labelcolor": INK2,
                     "xtick.color": MUTED, "ytick.color": MUTED, "font.size": 11})

pts = {(c, y): g[["ndvi", "lst_c"]].to_numpy() for (c, y), g in px.groupby(["city", "year"])}
meta = {(r.city, r.year): r for r in sm.itertuples()}


def build_fig():
    fig = plt.figure(figsize=(10.8, 13.5), dpi=100, facecolor=PAGE)
    axes = []
    left, right, top, bottom = 0.085, 0.975, 0.815, 0.1
    ncol, nrow, hg, vg = 2, 4, 0.07, 0.045
    w = (right - left - hg) / ncol
    h = (top - bottom - vg * (nrow - 1)) / nrow
    for i, c in enumerate(CITIES):
        r, k = divmod(i, ncol)
        ax = fig.add_axes([left + k * (w + hg), top - (r + 1) * h - r * vg, w, h], facecolor=SURF)
        ax.set_xlim(*XLIM); ax.set_ylim(*YLIM)
        ax.grid(True, color=GRID, lw=0.8); ax.set_axisbelow(True)
        for s in ("top", "right"): ax.spines[s].set_visible(False)
        ax.tick_params(length=0, labelsize=10)
        ax.set_yticks([25, 35, 45, 55]); ax.set_xticks([0, 0.2, 0.4, 0.6, 0.8])
        if k == 0: ax.set_ylabel("LST (°C)", fontsize=10.5)
        if r == nrow - 1: ax.set_xlabel("NDVI (greenness)", fontsize=10.5)
        ax.text(0.015, 1.03, c, transform=ax.transAxes, fontsize=14, fontweight="bold", color=INK, va="bottom")
        axes.append(ax)
    fig.text(0.085, 0.965, "Green cools the city", fontsize=30, fontweight="bold", color=INK, va="top")
    fig.text(0.085, 0.918, "Land surface temperature vs vegetation (NDVI) in 8 Bangladeshi cities, "
             "pre-monsoon Landsat scenes", fontsize=12.5, color=INK2, va="top")
    fig.text(0.085, 0.893, "●", color=PT, fontsize=12, va="top")
    fig.text(0.103, 0.893, "one 30 m pixel", color=INK2, fontsize=11.5, va="top")
    fig.text(0.245, 0.893, "━", color=FIT, fontsize=13, va="top", fontweight="bold")
    fig.text(0.268, 0.893, "linear fit", color=INK2, fontsize=11.5, va="top")
    fig.text(0.085, 0.022, "Data: USGS Landsat 8/9 Collection 2 Level-2 (surface reflectance + surface temperature) via Microsoft "
             "Planetary Computer.\n~13 × 12 km window around each city core; clouds, shadows and water masked; "
             "600 random pixels shown per city-year.", fontsize=8.8, color=MUTED, va="bottom", linespacing=1.5)
    fig.text(0.975, 0.022, "Chinmoy Ghosh Shuvo", fontsize=10, color=INK2, ha="right", va="bottom", fontweight="bold")
    return fig, axes


def render(fig, axes, state, year_label, sub_label=None):
    """state[c] = list of (points, alpha) and fit=(slope, intercept, r, date)"""
    for a in fig._dyn: a.remove()
    fig._dyn = []
    for ax, c in zip(axes, CITIES):
        s = state[c]
        for P, al in s["pts"]:
            if P is None or al <= 0: continue
            fig._dyn.append(ax.scatter(P[:, 0], P[:, 1], s=7, c=PT, alpha=0.32 * al, lw=0, rasterized=True))
        for (a1, b1, l1, h1) in s.get("lines", []):
            fig._dyn += ax.plot([l1, h1], [a1 * l1 + b1, a1 * h1 + b1], color=FIT, lw=1.2, alpha=0.35)
        if s["fit"] is None:
            fig._dyn.append(ax.text(0.5, 0.5, "no cloud-free scene", transform=ax.transAxes, ha="center",
                                    va="center", fontsize=12, color=MUTED, style="italic"))
            continue
        sl, ic, r, date, lo, hi = s["fit"]
        xs = np.array([lo, hi])
        fig._dyn += ax.plot(xs, sl * xs + ic, color=FIT, lw=2.4, solid_capstyle="round")
        per01 = sl / 10
        fig._dyn.append(ax.text(0.98, 0.95, f"{per01:+.2f} °C per +0.1 NDVI", transform=ax.transAxes,
                                ha="right", va="top", fontsize=11, color=INK, fontweight="bold"))
        fig._dyn.append(ax.text(0.98, 0.84, (f"r = {r:.2f}" + (f"  ·  {date}" if date else "")) if not s.get("lines") else f"median of {len(s['lines'])} yearly fits · r = {r:.2f}", transform=ax.transAxes,
                                ha="right", va="top", fontsize=9.5, color=INK2))
    for i, yy in enumerate(YEARS if not sub_label else []):
        on = ("–" in year_label) or (year_label.isdigit() and yy <= int(year_label))
        fig._dyn.append(fig.text(0.085 + i * (0.89 / (len(YEARS) - 1)), 0.862, str(yy), ha="center" if 0 < i < len(YEARS) - 1 else ("left" if i == 0 else "right"),
                                 va="top", fontsize=10.5 if str(yy) == year_label else 9.5,
                                 color=(INK if str(yy) == year_label else MUTED) if on else AXIS, fontweight="bold" if str(yy) == year_label else "normal"))
    fig._dyn.append(fig.text(0.975, 0.965, year_label, fontsize=38, fontweight="bold", color=INK, ha="right", va="top"))
    if sub_label:
        fig._dyn.append(fig.text(0.085, 0.866, sub_label, fontsize=12.5, color=INK, ha="left", va="top", fontweight="bold"))
    fig.canvas.draw()
    return np.asarray(fig.canvas.buffer_rgba())[..., :3].copy()


def fit_of(c, y):
    m = meta.get((c, y))
    if m is None or (c, y) not in pts: return None
    lo, hi = np.percentile(pts[(c, y)][:, 0], [2, 98])
    return (m.slope, m.intercept, m.r, pd.to_datetime(m.date).strftime("%d %b"), lo, hi)


def ease(t): return t * t * (3 - 2 * t)


fig, axes = build_fig(); fig._dyn = []
frames = []
prev = {c: None for c in CITIES}
for yi, y in enumerate(YEARS):
    for f in range(TWEEN if yi else 1):
        t = ease((f + 1) / TWEEN) if yi else 1.0
        st = {}
        for c in CITIES:
            cur = fit_of(c, y)
            p = prev[c]
            if cur is None or p is None or t >= 1:
                fit = cur
            else:
                fit = tuple(p[i] + (cur[i] - p[i]) * t for i in range(3)) + (cur[3],) + tuple(p[i] + (cur[i] - p[i]) * t for i in (4, 5))
            P_old = pts.get((c, YEARS[yi - 1])) if yi else None
            st[c] = {"pts": [(P_old, 1 - t), (pts.get((c, y)), t)], "fit": fit}
        frames.append(render(fig, axes, st, str(y)))
    for _ in range(HOLD):
        frames.append(frames[-1])
    for c in CITIES:
        prev[c] = fit_of(c, y)

# ---- closing frame: every yearly fit line + median ----
st = {}
for c in CITIES:
    g = sm[sm.city == c]
    lines = []
    for r_ in g.itertuples():
        f_ = fit_of(c, r_.year)
        if f_: lines.append((f_[0], f_[1], f_[4], f_[5]))
    msl = g.slope.median()
    mx, my = g.ndvi_mean.mean(), g.lst_mean.mean()
    lo, hi = np.median([l[2] for l in lines]), np.median([l[3] for l in lines])
    st[c] = {"pts": [], "lines": lines, "fit": (msl, my - msl * mx, g.r.median(), "", lo, hi)}
allmed = sm.slope.median() / 10
end = render(fig, axes, st, f"{YEARS[0]}–{YEARS[-1]}",
             f"Every city, every year: greener pixels are cooler.  Median: {allmed:+.2f} °C for each +0.1 NDVI.")
frames += [end] * (FPS * 5)

imageio.mimwrite(f"{OUT}/green_cools_the_city.mp4", frames, fps=FPS, codec="libx264", quality=9,
                 macro_block_size=1, ffmpeg_params=["-pix_fmt", "yuv420p"])
# GIF (smaller)
from PIL import Image
small = [Image.fromarray(fr).resize((720, 900), Image.LANCZOS) for fr in frames[::2]]
small[0].save(f"{OUT}/green_cools_the_city.gif", save_all=True, append_images=small[1:],
              duration=int(2000 / FPS), loop=0, optimize=True)
Image.fromarray(end).save(f"{OUT}/green_cools_the_city_final_frame.png")
Image.fromarray(frames[len(frames) // 2]).save(f"{OUT}/_mid_frame.png")
Image.fromarray(frames[1 + (TWEEN + HOLD) * 2 + 2]).save(f"{OUT}/_tween_frame.png")
Image.fromarray(frames[(TWEEN + HOLD) * 3]).save(f"{OUT}/_2017_frame.png")
print(len(frames), "frames")
