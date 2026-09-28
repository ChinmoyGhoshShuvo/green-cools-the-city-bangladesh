/* Green Cools the City: interactive map
 * Overview of 8 cities -> per-city swipe map (NDVI | heat) linked to a pixel scatter.
 * Plain JavaScript + Leaflet, no build step. Data: data/meta.json + data/grid/*.bin.gz
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- constants
  const BD_BOUNDS = [[20.55, 87.9], [26.75, 92.75]];
  const TILE = {
    streets: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }),
    satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    }),
  };
  const REL_RANGE = 8;          // relative heat colour range, +/- deg C
  const ABS_RANGE = [25, 50];   // actual LST colour range, deg C
  const SC_X = [0, 0.9];        // scatter NDVI axis
  const SC_Y_REL = [-12, 12];
  const SC_Y_ABS = [20, 56];
  const PIXEL_KM2 = 0.0009;     // one 30 m pixel

  // colour stops
  const NDVI_STOPS = [[0, "#f3efe2"], [0.15, "#d9e3b0"], [0.3, "#a8cf86"], [0.45, "#6db36a"], [0.62, "#2e8b4a"], [0.8, "#0b5d2e"]];
  const WATER = [201, 214, 223];
  const REL_STOPS = [[-1, "#104281"], [-0.6, "#2a78d6"], [-0.25, "#86b6ef"], [0, "#f0efec"], [0.25, "#f2a7a1"], [0.6, "#e34948"], [1, "#8e1b1b"]];
  const ABS_STOPS = [[0, "#fff1e0"], [0.2, "#fdd0a2"], [0.4, "#fdae6b"], [0.6, "#f16913"], [0.8, "#c2410c"], [1, "#6b1a07"]];
  const COOL_STOPS = [[0, "#cde2fb"], [0.25, "#86b6ef"], [0.5, "#3987e5"], [0.75, "#1c5cab"], [1, "#0d366b"]];

  // ---------------------------------------------------------------- helpers
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function ramp(stops, t) {
    t = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], t));
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
        const f = (t - t0) / (t1 - t0 || 1), a = hex(c0), b = hex(c1);
        return a.map((v, k) => Math.round(v + (b[k] - v) * f));
      }
    }
    return hex(stops[stops.length - 1][1]);
  }
  const rgb = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
  const cssGradient = (stops, lo, hi) =>
    `linear-gradient(90deg, ${stops.map(([t, c]) => `${c} ${((t - lo) / (hi - lo)) * 100}%`).join(", ")})`;
  const fmt = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const fmtDate = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const coolColor = (per01) => rgb(ramp(COOL_STOPS, (Math.abs(per01) - 0.4) / 1.4)); // 0.4..1.8 deg C

  async function fetchGrid(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    let buf = await res.arrayBuffer();
    const b = new Uint8Array(buf, 0, 2);
    if (b[0] === 0x1f && b[1] === 0x8b) {           // still gzipped (the usual case on GitHub Pages)
      const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      buf = await new Response(ds).arrayBuffer();
    }
    return new Uint8Array(buf);
  }

  // ---------------------------------------------------------------- state
  const S = {
    meta: null, years: [], yearIdx: 0, city: null, mode: "rel", base: "streets",
    grids: new Map(), cur: null, sel: null, swipe: 0.5, opacity: 0.85, playing: null,
  };

  // ---------------------------------------------------------------- map
  const map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 18, zoomSnap: 0.25 });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  TILE.streets.addTo(map);
  map.fitBounds(BD_BOUNDS);
  map.createPane("ndviPane"); map.getPane("ndviPane").style.zIndex = 410;
  map.createPane("heatPane"); map.getPane("heatPane").style.zIndex = 411;

  const overviewLayer = L.layerGroup().addTo(map);
  const cityMarkers = {};
  let ndviOverlay = null, heatOverlay = null;
  const ndviCanvas = document.createElement("canvas");
  const heatCanvas = document.createElement("canvas");

  // ---------------------------------------------------------------- init
  fetch("data/meta.json").then((r) => r.json()).then((meta) => {
    S.meta = meta;
    S.years = meta.years;
    S.yearIdx = S.years.length - 1;
    const sl = $("#yearSlider");
    sl.max = S.years.length - 1; sl.value = S.yearIdx;
    $("#yearTicks").innerHTML = S.years.map((y) => `<span>’${String(y).slice(2)}</span>`).join("");
    buildOverview();
    wireUI();
    applyHash();
    updateYearUI();
  }).catch((e) => {
    $("#overviewPanel").innerHTML = `<p>Could not load the map data (${e.message}). If you opened this file directly from your computer, run a small local web server instead (see the README).</p>`;
  });

  // ---------------------------------------------------------------- overview
  function buildOverview() {
    for (const [name, c] of Object.entries(S.meta.cities)) {
      const rect = L.rectangle(c.bounds, { color: "#0b0b0b", weight: 1, opacity: 0.35, fill: false, interactive: false });
      const m = L.circleMarker([c.lat, c.lon], { radius: 13, weight: 2, color: "#fff", fillOpacity: 1 })
        .bindTooltip(name, { permanent: true, direction: "right", offset: [12, 0], className: "city-label" })
        .on("click", () => openCity(name));
      m.on("mouseover", () => m.setStyle({ weight: 3, color: "#0b0b0b" }));
      m.on("mouseout", () => m.setStyle({ weight: 2, color: "#fff" }));
      cityMarkers[name] = m;
      overviewLayer.addLayer(rect).addLayer(m);
    }
  }

  function updateOverview() {
    const y = String(S.years[S.yearIdx]);
    const rows = Object.entries(S.meta.cities).map(([name, c]) => {
      const e = c.years[y];
      return { name, per01: e ? e.slope / 10 : null, r: e ? e.r : null };
    });
    for (const r of rows) {
      const m = cityMarkers[r.name];
      if (r.per01 === null) m.setStyle({ fillColor: "#c3c2b7" });
      else m.setStyle({ fillColor: coolColor(r.per01) });
    }
    rows.sort((a, b) => (a.per01 ?? 0) - (b.per01 ?? 0));
    const maxAbs = 2.2;
    $("#listYear").textContent = y;
    $("#cityList").innerHTML = rows.map((r) => r.per01 === null
      ? `<li class="na" data-city="${r.name}"><span>${r.name}</span><span class="muted">no cloud-free scene</span><span class="val">–</span></li>`
      : `<li tabindex="0" data-city="${r.name}"><span>${r.name}</span><span><span class="bar" style="display:block;width:${(Math.abs(r.per01) / maxAbs) * 100}%;background:${coolColor(r.per01)}"></span></span><span class="val">${fmt(r.per01)}</span></li>`
    ).join("");
    $$("#cityList li:not(.na)").forEach((li) => {
      li.addEventListener("click", () => openCity(li.dataset.city));
      li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") openCity(li.dataset.city); });
    });
  }

  // ---------------------------------------------------------------- city view
  function openCity(name) {
    S.city = name; S.sel = null;
    const c = S.meta.cities[name];
    map.flyToBounds(c.bounds, { duration: 0.9, padding: [20, 20] });
    overviewLayer.remove();
    $("#overviewPanel").hidden = true; $("#cityPanel").hidden = false;
    $("#backBtn").hidden = false; $("#divider").hidden = false;
    $("#crumbTitle").textContent = name;
    $("#cityName").textContent = name;
    ndviCanvas.width = heatCanvas.width = c.width;
    ndviCanvas.height = heatCanvas.height = c.height;
    if (ndviOverlay) { ndviOverlay.remove(); heatOverlay.remove(); }
    ndviOverlay = L.imageOverlay("", c.bounds, { pane: "ndviPane", className: "pixelated", opacity: S.opacity, interactive: false }).addTo(map);
    heatOverlay = L.imageOverlay("", c.bounds, { pane: "heatPane", className: "pixelated", opacity: S.opacity, interactive: false }).addTo(map);
    loadCityYear();
    updateHash();
  }

  function closeCity() {
    stopPlay();
    S.city = null; S.cur = null; S.sel = null;
    if (ndviOverlay) { ndviOverlay.remove(); heatOverlay.remove(); ndviOverlay = heatOverlay = null; }
    overviewLayer.addTo(map);
    map.flyToBounds(BD_BOUNDS, { duration: 0.9 });
    $("#overviewPanel").hidden = false; $("#cityPanel").hidden = true;
    $("#backBtn").hidden = true; $("#divider").hidden = true; $("#hoverTip").hidden = true; $("#mapNote").hidden = true;
    $("#crumbTitle").textContent = "Bangladesh · choose a city";
    ["ndviPane", "heatPane"].forEach((p) => (map.getPane(p).style.clip = ""));
    updateOverview(); updateHash();
  }

  async function getGrid(city, year) {
    const key = `${city}_${year}`;
    if (S.grids.has(key)) return S.grids.get(key);
    const c = S.meta.cities[city], e = c.years[String(year)];
    if (!e) return null;
    const p = fetchGrid(`data/${e.file}`).then((bytes) => decode(bytes, c, e));
    S.grids.set(key, p);
    return p;
  }

  function decode(bytes, c, e) {
    const n = c.width * c.height, enc = S.meta.encoding;
    const ndvi = new Float32Array(n), lst = new Float32Array(n), land = new Uint8Array(n);
    const [n0, n1] = enc.ndvi, [l0, l1] = enc.lst;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const a = bytes[i], b = bytes[n + i];
      ndvi[i] = a ? n0 + ((a - 1) / 254) * (n1 - n0) : NaN;
      lst[i] = b ? l0 + ((b - 1) / 254) * (l1 - l0) : NaN;
      if (a && b && ndvi[i] > 0) { land[i] = 1; cnt++; }
    }
    return { ndvi, lst, land, nLand: cnt, entry: e };
  }

  async function loadCityYear() {
    const city = S.city, year = S.years[S.yearIdx];
    const g = await getGrid(city, year);
    if (city !== S.city || year !== S.years[S.yearIdx]) return; // user moved on
    S.cur = g;
    // prefetch next year for smooth playback
    if (S.yearIdx < S.years.length - 1) getGrid(city, S.years[S.yearIdx + 1]);
    updateCityPanel();
    renderLayers();
    computeDensity();
    drawScatter();
    updateSelectionInfo();
  }

  function updateCityPanel() {
    const g = S.cur;
    $("#mapNote").hidden = !!g;
    if (!g) $("#mapNote").textContent = `No cloud-free Landsat scene for ${S.city} in ${S.years[S.yearIdx]}`;
    if (!g) {
      $("#sceneLine").textContent = `${S.years[S.yearIdx]}: no cloud-free scene for this city`;
      ["#tSlope", "#tR", "#tMean"].forEach((s) => ($(s).textContent = "–"));
      return;
    }
    const e = g.entry;
    $("#sceneLine").textContent = `Landsat scene ${fmtDate(e.date)} · ${Math.round(e.clear * 100)}% cloud-free`;
    $("#tSlope").textContent = fmt(e.slope / 10);
    $("#tR").textContent = fmt(e.r);
    $("#tMean").textContent = `${e.lst_mean.toFixed(1)} °C`;
  }

  // colour lookup tables
  const NDVI_LUT = (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) { const c = ramp(NDVI_STOPS, i / 255); lut.set(c, i * 3); }
    return lut;
  })();
  const heatLUT = { rel: new Uint8ClampedArray(512 * 3), abs: new Uint8ClampedArray(512 * 3) };
  for (let i = 0; i < 512; i++) {
    heatLUT.rel.set(ramp(REL_STOPS, (i / 511) * 2 - 1), i * 3);
    heatLUT.abs.set(ramp(ABS_STOPS, i / 511), i * 3);
  }
  const heatVal = (lst, mean) => (S.mode === "rel" ? lst - mean : lst);
  function heatIndex(v) {
    const t = S.mode === "rel" ? (v + REL_RANGE) / (2 * REL_RANGE) : (v - ABS_RANGE[0]) / (ABS_RANGE[1] - ABS_RANGE[0]);
    return Math.max(0, Math.min(511, Math.round(t * 511)));
  }

  function inSel(nd, rel) {
    const s = S.sel;
    return nd >= s.x0 && nd <= s.x1 && rel >= s.y0 && rel <= s.y1;
  }

  function renderLayers() {
    const c = S.meta.cities[S.city];
    const n = c.width * c.height;
    const nctx = ndviCanvas.getContext("2d"), hctx = heatCanvas.getContext("2d");
    const nImg = nctx.createImageData(c.width, c.height), hImg = hctx.createImageData(c.width, c.height);
    const g = S.cur;
    if (g) {
      const mean = g.entry.lst_mean, lut = heatLUT[S.mode], sel = S.sel;
      for (let i = 0; i < n; i++) {
        const nd = g.ndvi[i], ls = g.lst[i], o = i * 4;
        if (Number.isNaN(nd) || Number.isNaN(ls)) continue;         // cloud / no data: transparent
        let alpha = 255;
        if (sel) alpha = g.land[i] && inSel(nd, ls - mean) ? 255 : 38;
        if (nd <= 0) { nImg.data[o] = WATER[0]; nImg.data[o + 1] = WATER[1]; nImg.data[o + 2] = WATER[2]; }
        else { const k = Math.max(0, Math.min(255, Math.round((nd / 0.85) * 255))) * 3; nImg.data[o] = NDVI_LUT[k]; nImg.data[o + 1] = NDVI_LUT[k + 1]; nImg.data[o + 2] = NDVI_LUT[k + 2]; }
        nImg.data[o + 3] = alpha;
        const k2 = heatIndex(heatVal(ls, mean)) * 3;
        hImg.data[o] = lut[k2]; hImg.data[o + 1] = lut[k2 + 1]; hImg.data[o + 2] = lut[k2 + 2]; hImg.data[o + 3] = alpha;
      }
    }
    nctx.putImageData(nImg, 0, 0); hctx.putImageData(hImg, 0, 0);
    ndviOverlay.setUrl(ndviCanvas.toDataURL());
    heatOverlay.setUrl(heatCanvas.toDataURL());
    updateClip();
    updateHeatLegend();
  }

  function updateHeatLegend() {
    if (S.mode === "rel") {
      $("#heatRamp").style.background = cssGradient(REL_STOPS, -1, 1);
      $("#heatTicks").innerHTML = [-8, -4, 0, 4, 8].map((v) => `<span>${v > 0 ? "+" + v : v === 0 ? "0" : "−" + Math.abs(v)}</span>`).join("");
      $("#heatLegendK").textContent = "Relative heat (°C vs city average that day)";
      $("#heatTag").textContent = "Relative heat";
    } else {
      $("#heatRamp").style.background = cssGradient(ABS_STOPS, 0, 1);
      $("#heatTicks").innerHTML = [25, 30, 35, 40, 45, 50].map((v) => `<span>${v}</span>`).join("");
      $("#heatLegendK").textContent = "Land surface temperature (°C)";
      $("#heatTag").textContent = "Surface temperature";
    }
  }

  // ---------------------------------------------------------------- swipe
  function updateClip() {
    if (!S.city) return;
    const size = map.getSize();
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint(size);
    const x = nw.x + size.x * S.swipe;
    map.getPane("ndviPane").style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
    map.getPane("heatPane").style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
    $("#divider").style.left = `${S.swipe * 100}%`;
    $(".divider-handle").setAttribute("aria-valuenow", Math.round(S.swipe * 100));
  }
  map.on("move zoom resize", updateClip);

  function wireSwipe() {
    const h = $(".divider-handle");
    let drag = false;
    const setFromX = (clientX) => {
      const r = $("#map").getBoundingClientRect();
      S.swipe = Math.max(0.02, Math.min(0.98, (clientX - r.left) / r.width));
      updateClip();
    };
    h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); });
    h.addEventListener("pointermove", (e) => { if (drag) setFromX(e.clientX); });
    h.addEventListener("pointerup", () => (drag = false));
    h.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { S.swipe = Math.max(0.02, S.swipe - 0.05); updateClip(); }
      if (e.key === "ArrowRight") { S.swipe = Math.min(0.98, S.swipe + 0.05); updateClip(); }
    });
  }

  // ---------------------------------------------------------------- hover
  function pixelAt(latlng) {
    const c = S.meta.cities[S.city];
    const p = L.CRS.EPSG3857.project(latlng);
    const res = (c.merc[2] - c.merc[0]) / c.width;
    const col = Math.floor((p.x - c.merc[0]) / res), row = Math.floor((c.merc[3] - p.y) / res);
    if (col < 0 || row < 0 || col >= c.width || row >= c.height) return -1;
    return row * c.width + col;
  }
  let hoverPt = null;
  map.on("mousemove click", (ev) => {
    if (!S.city || !S.cur) return;
    const i = pixelAt(ev.latlng), tip = $("#hoverTip");
    if (i < 0 || Number.isNaN(S.cur.lst[i])) { tip.hidden = true; hoverPt = null; drawScatter(); $("#hoverInfo").textContent = "Point at the map to read a pixel."; return; }
    const nd = S.cur.ndvi[i], ls = S.cur.lst[i], rel = ls - S.cur.entry.lst_mean;
    const water = nd <= 0;
    const html = `<b>NDVI ${nd.toFixed(2)}</b>${water ? " (water)" : ""}<br>${ls.toFixed(1)} °C · <b>${fmt(rel, 1)} °C</b> vs city average`;
    tip.innerHTML = html; tip.hidden = false;
    const pt = ev.containerPoint, W = map.getSize().x;
    tip.style.left = `${pt.x + (pt.x > W - 220 ? -210 : 14)}px`; tip.style.top = `${pt.y + 14}px`;
    $("#hoverInfo").innerHTML = `Pixel: NDVI <b>${nd.toFixed(2)}</b> · ${ls.toFixed(1)} °C · ${fmt(rel, 1)} °C vs city average`;
    hoverPt = water ? null : { x: nd, y: S.mode === "rel" ? rel : ls };
    drawScatter();
  });
  map.on("mouseout", () => { $("#hoverTip").hidden = true; hoverPt = null; if (S.city) drawScatter(); });

  // ---------------------------------------------------------------- scatter
  const sc = $("#scatter");
  const M = { l: 38, r: 10, t: 8, b: 30 };
  const NBX = 110, NBY = 90;
  let density = null;
  const yRange = () => (S.mode === "rel" ? SC_Y_REL : SC_Y_ABS);

  function computeDensity() {
    density = new Float32Array(NBX * NBY);
    const g = S.cur; if (!g) return;
    const [y0, y1] = yRange(), mean = g.entry.lst_mean;
    for (let i = 0; i < g.land.length; i++) {
      if (!g.land[i]) continue;
      const x = g.ndvi[i], y = heatVal(g.lst[i], mean);
      const bx = Math.floor(((x - SC_X[0]) / (SC_X[1] - SC_X[0])) * NBX), by = Math.floor(((y - y0) / (y1 - y0)) * NBY);
      if (bx >= 0 && bx < NBX && by >= 0 && by < NBY) density[by * NBX + bx]++;
    }
  }

  function scatterGeom() {
    const dpr = window.devicePixelRatio || 1, w = sc.clientWidth, h = sc.clientHeight;
    if (sc.width !== Math.round(w * dpr)) { sc.width = Math.round(w * dpr); sc.height = Math.round(h * dpr); }
    const [y0, y1] = yRange();
    const X = (v) => M.l + ((v - SC_X[0]) / (SC_X[1] - SC_X[0])) * (w - M.l - M.r);
    const Y = (v) => h - M.b - ((v - y0) / (y1 - y0)) * (h - M.t - M.b);
    const Xi = (px) => SC_X[0] + ((px - M.l) / (w - M.l - M.r)) * (SC_X[1] - SC_X[0]);
    const Yi = (py) => y0 + ((h - M.b - py) / (h - M.t - M.b)) * (y1 - y0);
    return { dpr, w, h, X, Y, Xi, Yi, y0, y1 };
  }

  function drawScatter(drag) {
    if (!S.city) return;
    const G = scatterGeom(), ctx = sc.getContext("2d");
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.clearRect(0, 0, G.w, G.h);
    ctx.fillStyle = "#fcfcfb"; ctx.fillRect(M.l, M.t, G.w - M.l - M.r, G.h - M.t - M.b);
    // grid + axes
    ctx.strokeStyle = "#e1e0d9"; ctx.lineWidth = 1; ctx.fillStyle = "#898781"; ctx.font = "10.5px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let v = 0; v <= 0.81; v += 0.2) { const x = Math.round(G.X(v)) + 0.5; ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, G.h - M.b); ctx.stroke(); ctx.fillText(v.toFixed(1), x, G.h - M.b + 4); }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const step = S.mode === "rel" ? 4 : 5;
    for (let v = Math.ceil(G.y0 / step) * step; v <= G.y1; v += step) { const y = Math.round(G.Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(G.w - M.r, y); ctx.stroke(); if (v === G.y0) continue; ctx.fillText(S.mode === "rel" ? (v > 0 ? "+" + v : v === 0 ? "0" : "−" + Math.abs(v)) : String(v), M.l - 5, y); }
    ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = "#52514e";
    ctx.fillText("NDVI (greenness)", M.l + (G.w - M.l - M.r) / 2, G.h);
    ctx.save(); ctx.translate(10, M.t + (G.h - M.t - M.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle";
    ctx.fillText(S.mode === "rel" ? "°C vs city average" : "Surface temp. (°C)", 0, 0); ctx.restore();

    const g = S.cur;
    if (!g) { ctx.fillStyle = "#898781"; ctx.textAlign = "center"; ctx.fillText("No cloud-free scene this year", G.w / 2, G.h / 2); return; }
    // density cells
    let mx = 0; for (const v of density) if (v > mx) mx = v;
    const cw = (G.w - M.l - M.r) / NBX, ch = (G.h - M.t - M.b) / NBY, lmx = Math.log1p(mx);
    const s = S.sel, mean = g.entry.lst_mean;
    for (let by = 0; by < NBY; by++) for (let bx = 0; bx < NBX; bx++) {
      const v = density[by * NBX + bx]; if (!v) continue;
      const t = Math.log1p(v) / lmx;
      const xv = SC_X[0] + ((bx + 0.5) / NBX) * (SC_X[1] - SC_X[0]);
      const yv = G.y0 + ((by + 0.5) / NBY) * (G.y1 - G.y0);
      const rel = S.mode === "rel" ? yv : yv - mean;
      const on = !s || (xv >= s.x0 && xv <= s.x1 && rel >= s.y0 && rel <= s.y1);
      const shade = Math.round(215 - t * 190);
      ctx.fillStyle = on ? `rgb(${shade},${shade},${Math.min(255, shade + 4)})` : `rgba(${shade},${shade},${shade},0.25)`;
      ctx.fillRect(M.l + bx * cw, G.h - M.b - (by + 1) * ch, Math.ceil(cw), Math.ceil(ch));
    }
    // fitted line (from the full analysis)
    const e = g.entry, xa = 0.03, xb = 0.85;
    const fy = (x) => e.slope * x + e.intercept - (S.mode === "rel" ? mean : 0);
    ctx.strokeStyle = "#eb6834"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(G.X(xa), G.Y(fy(xa))); ctx.lineTo(G.X(xb), G.Y(fy(xb))); ctx.stroke();
    // selection box
    const box = drag || (s && { x0: s.x0, x1: s.x1, y0: s.y0 + (S.mode === "rel" ? 0 : mean), y1: s.y1 + (S.mode === "rel" ? 0 : mean) });
    if (box) {
      const x0 = G.X(Math.max(SC_X[0], box.x0)), x1 = G.X(Math.min(SC_X[1], box.x1));
      const y0 = G.Y(Math.min(G.y1, box.y1)), y1 = G.Y(Math.max(G.y0, box.y0));
      ctx.fillStyle = "rgba(42,120,214,0.08)"; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = "#2a78d6"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
    }
    // hovered pixel
    if (hoverPt) {
      ctx.beginPath(); ctx.arc(G.X(hoverPt.x), G.Y(hoverPt.y), 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#eb6834"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    }
  }

  function wireScatter() {
    let start = null;
    const pos = (e) => { const r = sc.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    sc.addEventListener("pointerdown", (e) => { if (!S.cur) return; start = pos(e); sc.setPointerCapture(e.pointerId); });
    sc.addEventListener("pointermove", (e) => {
      if (!start) return;
      const G = scatterGeom(), p = pos(e);
      drawScatter({ x0: G.Xi(Math.min(start[0], p[0])), x1: G.Xi(Math.max(start[0], p[0])), y0: G.Yi(Math.max(start[1], p[1])), y1: G.Yi(Math.min(start[1], p[1])) });
    });
    sc.addEventListener("pointerup", (e) => {
      if (!start) return;
      const G = scatterGeom(), p = pos(e);
      if (Math.abs(p[0] - start[0]) < 4 && Math.abs(p[1] - start[1]) < 4) { start = null; setSel(null); return; }
      const off = S.mode === "rel" ? 0 : S.cur.entry.lst_mean;   // store selections as relative heat
      setSel({ x0: G.Xi(Math.min(start[0], p[0])), x1: G.Xi(Math.max(start[0], p[0])), y0: G.Yi(Math.max(start[1], p[1])) - off, y1: G.Yi(Math.min(start[1], p[1])) - off });
      start = null;
    });
    $$(".presets .chip").forEach((b) => b.addEventListener("click", () => {
      const p = b.dataset.preset;
      if (p === "hot") setSel({ x0: 0, x1: 0.2, y0: 3, y1: 99 });
      else if (p === "cool") setSel({ x0: 0.5, x1: 1, y0: -99, y1: -2 });
      else setSel(null);
    }));
  }

  function setSel(sel) { S.sel = sel; if (S.cur) { renderLayers(); drawScatter(); } updateSelectionInfo(); }

  function updateSelectionInfo() {
    const el = $("#selInfo"), g = S.cur;
    if (!S.sel) { el.innerHTML = "No selection. The orange line is the fitted trend from the full analysis."; return; }
    if (!g) { el.textContent = "No data this year."; return; }
    let n = 0, sn = 0, sr = 0; const mean = g.entry.lst_mean;
    for (let i = 0; i < g.land.length; i++) {
      if (!g.land[i]) continue;
      const rel = g.lst[i] - mean;
      if (inSel(g.ndvi[i], rel)) { n++; sn += g.ndvi[i]; sr += rel; }
    }
    const s = S.sel;
    const desc = `NDVI ${s.x0.toFixed(2)}–${Math.min(1, s.x1).toFixed(2)}, ` +
      (s.y1 >= 50 ? `≥ ${fmt(s.y0, 1)} °C` : s.y0 <= -50 ? `≤ ${fmt(s.y1, 1)} °C` : `${fmt(s.y0, 1)} to ${fmt(s.y1, 1)} °C`) + " vs average";
    el.innerHTML = n
      ? `<b>${(n * PIXEL_KM2).toFixed(1)} km²</b> of land (${((n / g.nLand) * 100).toFixed(1)}%) in the box · mean NDVI ${(sn / n).toFixed(2)}, ${fmt(sr / n, 1)} °C vs average.<br><span>${desc}. Other pixels are faded on the map.</span>`
      : `No land pixels in the box this year (${desc}).`;
  }

  // ---------------------------------------------------------------- year + playback
  function setYear(idx) {
    S.yearIdx = idx;
    updateYearUI();
    if (S.city) loadCityYear(); else updateOverview();
    updateHash();
  }
  function updateYearUI() {
    const y = S.years[S.yearIdx];
    $("#yearSlider").value = S.yearIdx;
    $("#yearLabel").textContent = y;
    $$("#yearTicks span").forEach((s, i) => s.classList.toggle("on", i === S.yearIdx));
    if (!S.city) updateOverview();
  }
  function stopPlay() {
    if (S.playing) { clearInterval(S.playing); S.playing = null; }
    $("#playBtn").classList.remove("playing"); $("#playBtn").innerHTML = "&#9654;"; $("#playBtn").setAttribute("aria-label", "Play through the years");
  }
  function togglePlay() {
    if (S.playing) return stopPlay();
    if (S.yearIdx === S.years.length - 1) setYear(0);
    $("#playBtn").classList.add("playing"); $("#playBtn").innerHTML = "&#10074;&#10074;"; $("#playBtn").setAttribute("aria-label", "Pause");
    S.playing = setInterval(() => {
      if (S.yearIdx >= S.years.length - 1) return stopPlay();
      setYear(S.yearIdx + 1);
    }, 1300);
  }

  // ---------------------------------------------------------------- UI wiring
  function wireUI() {
    $("#yearSlider").addEventListener("input", (e) => { stopPlay(); setYear(+e.target.value); });
    $("#playBtn").addEventListener("click", togglePlay);
    $("#backBtn").addEventListener("click", closeCity);
    $$(".basemap-switch .chip").forEach((b) => b.addEventListener("click", () => {
      if (S.base === b.dataset.base) return;
      TILE[S.base].remove(); S.base = b.dataset.base; TILE[S.base].addTo(map);
      $$(".basemap-switch .chip").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    }));
    $$(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      S.mode = b.dataset.mode;
      $$(".seg-btn").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      if (S.cur) { renderLayers(); computeDensity(); drawScatter(); }
      updateHash();
    }));
    $("#opacity").addEventListener("input", (e) => {
      S.opacity = +e.target.value;
      if (ndviOverlay) { ndviOverlay.setOpacity(S.opacity); heatOverlay.setOpacity(S.opacity); }
    });
    wireSwipe();
    wireScatter();
    window.addEventListener("resize", () => drawScatter());
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.getAttribute("role") === "slider") return;
      if (e.key === "Escape" && S.city) closeCity();
      if (e.key === " " && e.target === document.body) { e.preventDefault(); togglePlay(); }
    });
  }

  // ---------------------------------------------------------------- shareable links: #Dhaka/2024/abs
  function updateHash() {
    const h = S.city ? `#${S.city}/${S.years[S.yearIdx]}/${S.mode}` : `#${S.years[S.yearIdx]}`;
    history.replaceState(null, "", h);
  }
  function applyHash() {
    const parts = decodeURIComponent(location.hash.slice(1)).split("/").filter(Boolean);
    let city = null;
    for (const p of parts) {
      if (S.meta.cities[p]) city = p;
      else if (/^\d{4}$/.test(p) && S.years.includes(+p)) S.yearIdx = S.years.indexOf(+p);
      else if (p === "abs" || p === "rel") {
        S.mode = p; $$(".seg-btn").forEach((x) => { x.classList.toggle("on", x.dataset.mode === p); x.setAttribute("aria-pressed", x.dataset.mode === p); });
      }
    }
    if (city) openCity(city); else updateOverview();
  }
})();
