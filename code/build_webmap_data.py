"""Build the compact data files used by the web map in docs/.

For each city-year GeoTIFF (band 1 NDVI, band 2 LST in deg C, written by gcc_lib.py)
this script:
  1. reprojects it onto one fixed Web Mercator (EPSG:3857) grid per city, ~30 m on
     the ground, so every year of a city lines up pixel for pixel and matches the
     web basemap exactly;
  2. stores NDVI and LST as one byte each (0 = no data) and gzips the result;
  3. writes docs/data/meta.json with the grid geometry, the encoding and the
     per-city-year statistics from city_year_summary.csv.

Usage (from the repository folder):
    python code/build_webmap_data.py <folder with the 95 GeoTIFFs> data/city_year_summary.csv docs/data
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform as warp_transform

# Same city centres and window half-width as gcc_lib.py
CITIES = {"Dhaka": (90.4125, 23.7800), "Chattogram": (91.8200, 22.3450), "Khulna": (89.5500, 22.8300),
          "Rajshahi": (88.6000, 24.3700), "Sylhet": (91.8700, 24.8950), "Barishal": (90.3550, 22.7050),
          "Rangpur": (89.2500, 25.7450), "Mymensingh": (90.4050, 24.7500)}
H = 0.06
GROUND_RES = 30.0

# One-byte encoding (0 means no data)
NDVI_MIN, NDVI_MAX = -0.2, 1.0
LST_MIN, LST_MAX = 15.0, 65.0


def encode(a, lo, hi):
    q = np.round((a - lo) / (hi - lo) * 254) + 1
    q = np.clip(q, 1, 255)
    q[~np.isfinite(a)] = 0
    return q.astype(np.uint8)


def city_grid(lon, lat):
    xs, ys = warp_transform("EPSG:4326", "EPSG:3857", [lon - H, lon + H], [lat - H, lat + H])
    res = GROUND_RES / math.cos(math.radians(lat))          # Mercator metres per ~30 m on the ground
    w = int(math.ceil((xs[1] - xs[0]) / res)); h = int(math.ceil((ys[1] - ys[0]) / res))
    x0, y1 = xs[0], ys[0] + h * res
    tr = from_origin(x0, y1, res, res)
    lons, lats = warp_transform("EPSG:3857", "EPSG:4326", [x0, x0 + w * res], [y1 - h * res, y1])
    return tr, w, h, res, [[lats[0], lons[0]], [lats[1], lons[1]]], [x0, y1 - h * res, x0 + w * res, y1]


def main(raster_dir, summary_csv, out_dir):
    raster_dir, out_dir = Path(raster_dir), Path(out_dir)
    (out_dir / "grid").mkdir(parents=True, exist_ok=True)
    sm = pd.read_csv(summary_csv)
    meta = {"encoding": {"ndvi": [NDVI_MIN, NDVI_MAX], "lst": [LST_MIN, LST_MAX], "levels": 254,
                         "note": "value = lo + (byte - 1) / 254 * (hi - lo); byte 0 = no data. "
                                 "File = NDVI bytes then LST bytes, row-major, north-up."},
            "years": sorted(int(y) for y in sm.year.unique()), "cities": {}}
    for c, (lon, lat) in CITIES.items():
        tr, w, h, res, bounds, merc = city_grid(lon, lat)
        g = sm[sm.city == c]
        entry = {"lon": lon, "lat": lat, "width": w, "height": h, "bounds": bounds, "merc": merc,
                 "median_slope": round(float(g.slope.median()), 3), "median_r": round(float(g.r.median()), 3),
                 "years": {}}
        for row in g.itertuples():
            src = raster_dir / f"{c}_{row.year}_NDVI_LST.tif"
            if not src.exists():
                print("missing", src); continue
            out = np.full((2, h, w), np.nan, dtype="float32")
            with rasterio.open(src) as ds:
                for b in (1, 2):
                    reproject(rasterio.band(ds, b), out[b - 1], src_nodata=np.nan, dst_transform=tr,
                              dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.nearest)
            blob = encode(out[0], NDVI_MIN, NDVI_MAX).tobytes() + encode(out[1], LST_MIN, LST_MAX).tobytes()
            fn = f"{c}_{row.year}.bin.gz"
            (out_dir / "grid" / fn).write_bytes(gzip.compress(blob, 9, mtime=0))
            entry["years"][str(row.year)] = {
                "file": f"grid/{fn}", "date": row.date, "scene": row.scene, "clear": row.clear_frac,
                "n": int(row.n_pixels), "ndvi_mean": row.ndvi_mean, "lst_mean": row.lst_mean,
                "slope": row.slope, "intercept": row.intercept, "r": row.r}
        meta["cities"][c] = entry
        print(c, w, "x", h, len(entry["years"]), "years")
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:4])
