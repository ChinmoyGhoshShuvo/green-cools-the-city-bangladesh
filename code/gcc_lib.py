
"""Green Cools the City - NDVI vs LST extraction from Landsat 8/9 C2 L2 (Microsoft Planetary Computer)."""
import urllib.request, json, os, datetime, numpy as np
from osgeo import gdal
gdal.SetConfigOption("GDAL_DISABLE_READDIR_ON_OPEN","EMPTY_DIR")
gdal.SetConfigOption("GDAL_HTTP_MULTIRANGE","YES")
gdal.SetConfigOption("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES","YES")
OUT = r"E:\Everything\Projects Portfolio\01_Green_Cools_the_City"
CITIES = {"Dhaka":(90.4125,23.7800),"Chattogram":(91.8200,22.3450),"Khulna":(89.5500,22.8300),
 "Rajshahi":(88.6000,24.3700),"Sylhet":(91.8700,24.8950),"Barishal":(90.3550,22.7050),
 "Rangpur":(89.2500,25.7450),"Mymensingh":(90.4050,24.7500)}
H = 0.06   # half-width of city window in degrees (~13 x 12 km)
TARGET_DOY = 95  # ~5 April, pre-monsoon hot season
_TOK = None
def token():
    global _TOK
    if _TOK is None:
        _TOK = json.loads(urllib.request.urlopen("https://planetarycomputer.microsoft.com/api/sas/v1/token/landsateuwest/landsat-c2",timeout=20).read())["token"]
    return _TOK
def search(bbox, year):
    body={"collections":["landsat-c2-l2"],"bbox":bbox,"datetime":f"{year}-02-20/{year}-05-10",
      "query":{"eo:cloud_cover":{"lt":40},"platform":{"in":["landsat-8","landsat-9"]}},
      "sortby":[{"field":"eo:cloud_cover","direction":"asc"}],"limit":12}
    req=urllib.request.Request("https://planetarycomputer.microsoft.com/api/stac/v1/search",data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req,timeout=40).read())["features"]
def rd(href, win):
    ds=gdal.Translate("/vsimem/t.tif", "/vsicurl/"+href+"?"+token(), projWin=win, projWinSRS="EPSG:4326", format="GTiff")
    a=ds.GetRasterBand(1).ReadAsArray(); gt=ds.GetGeoTransform(); pr=ds.GetProjection(); ds=None
    gdal.Unlink("/vsimem/t.tif")
    return a, gt, pr
def clearmask(qa):
    bad=(1<<0)|(1<<1)|(1<<2)|(1<<3)|(1<<4)   # fill, dilated cloud, cirrus, cloud, shadow
    return (qa & bad)==0
def process(c, year, max_try=5):
    lon,lat=CITIES[c]; bbox=[lon-H,lat-H,lon+H,lat+H]; win=[lon-H,lat+H,lon+H,lat-H]
    fs=search(bbox,year)[:max_try]
    best=None
    for f in fs:
        qa,gt,pr=rd(f["assets"]["qa_pixel"]["href"],win)
        frac=float(clearmask(qa).mean())
        d=datetime.date.fromisoformat(f["properties"]["datetime"][:10]); dd=abs(d.timetuple().tm_yday-TARGET_DOY)
        score=(1, -dd) if frac>=0.85 else (0, frac)
        if best is None or score>best[0]: best=(score,f,qa,gt,pr,frac)
        if frac>=0.97 and dd<25: break
    if best is None or best[5] < 0.5: return None
    _,f,qa,gt,pr,frac=best
    red,_,_=rd(f["assets"]["red"]["href"],win); nir,_,_=rd(f["assets"]["nir08"]["href"],win); st,_,_=rd(f["assets"]["lwir11"]["href"],win)
    redr=red*2.75e-5-0.2; nirr=nir*2.75e-5-0.2
    ndvi=(nirr-redr)/(nirr+redr+1e-9); lst=st*0.00341802+149.0-273.15
    clr=clearmask(qa)&(st>0)&(red>0)
    water=(qa & (1<<7))>0
    ok=clr&(~water)&(ndvi>0)&(ndvi<1)&(lst>5)&(lst<70)
    ndvi_o=np.where(clr,ndvi,np.nan).astype("float32"); lst_o=np.where(clr,lst,np.nan).astype("float32")
    fn=os.path.join(OUT,"rasters",f"{c}_{year}_NDVI_LST.tif")
    ds=gdal.GetDriverByName("GTiff").Create(fn,ndvi.shape[1],ndvi.shape[0],2,gdal.GDT_Float32,["COMPRESS=DEFLATE","PREDICTOR=3"])
    ds.SetGeoTransform(gt); ds.SetProjection(pr)
    for i,(a,n) in enumerate([(ndvi_o,"NDVI"),(lst_o,"LST_C")],1):
        b=ds.GetRasterBand(i); b.WriteArray(a); b.SetNoDataValue(float("nan")); b.SetDescription(n)
    ds=None
    x=ndvi[ok].astype("float64"); y=lst[ok].astype("float64")
    slope,icpt=np.polyfit(x,y,1); r=np.corrcoef(x,y)[0,1]
    rng=np.random.default_rng(year*100+len(c)); idx=rng.choice(len(x),min(600,len(x)),replace=False)
    meta=dict(city=c,year=year,scene=f["id"],date=f["properties"]["datetime"][:10],clear_frac=round(frac,3),n_pixels=int(len(x)),
              ndvi_mean=round(float(x.mean()),4),lst_mean=round(float(y.mean()),3),slope=round(float(slope),3),intercept=round(float(icpt),3),r=round(float(r),4))
    return meta, x[idx], y[idx]
def run(cities, years):
    import csv, time
    mp=os.path.join(OUT,"city_year_summary.csv"); sp=os.path.join(OUT,"pixel_samples.csv")
    newm=not os.path.exists(mp); news=not os.path.exists(sp)
    with open(mp,"a",newline="") as fm, open(sp,"a",newline="") as fsm:
        wm=csv.writer(fm); ws=csv.writer(fsm)
        if newm: wm.writerow(["city","year","scene","date","clear_frac","n_pixels","ndvi_mean","lst_mean","slope","intercept","r"])
        if news: ws.writerow(["city","year","ndvi","lst_c"])
        for c in cities:
            for y in years:
                t=time.time()
                try:
                    res=process(c,y)
                except Exception as e:
                    print("ERR",c,y,e); continue
                if res is None: print("NONE",c,y); continue
                m,xs,ys=res
                wm.writerow(list(m.values()))
                for a,b in zip(xs,ys): ws.writerow([c,y,round(float(a),4),round(float(b),2)])
                fm.flush(); fsm.flush()
                print(c,y,m["date"],m["clear_frac"],m["r"],m["lst_mean"],round(time.time()-t,1),"s")
