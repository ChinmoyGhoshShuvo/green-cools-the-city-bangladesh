"""Interactive animated NDVI vs LST scatter (Plotly, year slider + play button)."""
import sys, numpy as np, pandas as pd, plotly.graph_objects as go
from plotly.subplots import make_subplots

SRC, OUT = sys.argv[1], sys.argv[2]
px = pd.read_csv(f"{SRC}/pixel_samples.csv")
sm = pd.read_csv(f"{SRC}/city_year_summary.csv")
CITIES = [c for c in ["Dhaka", "Chattogram", "Khulna", "Rajshahi", "Sylhet", "Barishal", "Rangpur", "Mymensingh"] if c in set(sm.city)]
YEARS = sorted(sm.year.unique())
PT, FIT, INK, INK2, MUTED, GRID, SURF = "#008300", "#eb6834", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#fcfcfb"

fig = make_subplots(rows=2, cols=4, subplot_titles=CITIES, shared_xaxes=True, shared_yaxes=True,
                    horizontal_spacing=0.03, vertical_spacing=0.12)


def traces(y):
    out = []
    for i, c in enumerate(CITIES):
        g = px[(px.city == c) & (px.year == y)]
        m = sm[(sm.city == c) & (sm.year == y)]
        out.append(go.Scatter(x=g.ndvi, y=g.lst_c, mode="markers", marker=dict(color=PT, size=5, opacity=0.4),
                              name="30 m pixel", showlegend=(i == 0), legendgroup="p",
                              hovertemplate=f"<b>{c}</b><br>NDVI %{{x:.2f}}<br>LST %{{y:.1f}} °C<extra></extra>"))
        if len(m) and len(g):
            m = m.iloc[0]; lo, hi = np.percentile(g.ndvi, [2, 98]); xs = np.array([lo, hi])
            out.append(go.Scatter(x=xs, y=m.slope * xs + m.intercept, mode="lines", line=dict(color=FIT, width=3),
                                  name="linear fit", showlegend=(i == 0), legendgroup="f",
                                  hovertemplate=(f"<b>{c} {y}</b><br>{m.slope/10:+.2f} °C per +0.1 NDVI<br>r = {m.r:.2f}"
                                                 f"<br>scene {m.date}<extra></extra>")))
        else:
            out.append(go.Scatter(x=[None], y=[None], mode="lines", showlegend=False))
    return out


for i, t in enumerate(traces(YEARS[0])):
    fig.add_trace(t, row=i // 2 // 4 + 1, col=(i // 2) % 4 + 1)
fig.frames = [go.Frame(data=traces(y), name=str(y)) for y in YEARS]

fig.update_xaxes(range=[0, 0.9], gridcolor=GRID, zeroline=False, tickfont=dict(color=MUTED))
fig.update_yaxes(range=[22, 56], gridcolor=GRID, zeroline=False, tickfont=dict(color=MUTED))
for c in range(1, 5): fig.update_xaxes(title_text="NDVI", row=2, col=c)
for r in (1, 2): fig.update_yaxes(title_text="LST (°C)", row=r, col=1)
fig.update_layout(
    title=dict(text="<b>Green cools the city</b><br><span style='font-size:13px;color:#52514e'>Land surface temperature vs NDVI, "
               "8 Bangladeshi cities, pre-monsoon Landsat 8/9 scenes 2014–2025 · press ▶ or drag the slider</span>",
               x=0.02, y=0.97, font=dict(size=24, color=INK)),
    plot_bgcolor=SURF, paper_bgcolor="#f9f9f7", font=dict(family="system-ui, Segoe UI, sans-serif", color=INK2),
    height=780, margin=dict(t=140, l=60, r=20, b=170),
    legend=dict(orientation="h", x=1, xanchor="right", y=1.13),
    updatemenus=[dict(type="buttons", direction="left", x=0.0, y=-0.13, xanchor="left", yanchor="top", showactive=False, pad=dict(t=0, r=10),
                      buttons=[dict(label="▶ Play", method="animate",
                                    args=[None, dict(frame=dict(duration=900, redraw=True), transition=dict(duration=300), fromcurrent=True)]),
                               dict(label="❚❚ Pause", method="animate",
                                    args=[[None], dict(frame=dict(duration=0, redraw=False), mode="immediate")])])],
    sliders=[dict(active=0, x=0.2, len=0.8, y=-0.1, pad=dict(t=0), currentvalue=dict(prefix="Year: ", font=dict(size=16, color=INK)),
                  steps=[dict(label=str(y), method="animate",
                              args=[[str(y)], dict(frame=dict(duration=0, redraw=True), mode="immediate")]) for y in YEARS])],
    annotations=list(fig.layout.annotations) + [dict(
        text="Data: USGS Landsat Collection 2 Level-2 via Microsoft Planetary Computer · ~13×12 km window per city core · "
             "clouds, shadows, water masked · 600 random pixels per city-year · Chinmoy Ghosh Shuvo",
        x=0, y=-0.33, xref="paper", yref="paper", showarrow=False, xanchor="left", font=dict(size=10, color=MUTED))])
fig.write_html(f"{OUT}/green_cools_the_city_interactive.html", include_plotlyjs="cdn", auto_play=False)
print("ok")
