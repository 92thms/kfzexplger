import os
import re
from pathlib import Path
from functools import lru_cache
from typing import Optional

import pandas as pd
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
STATIC_DIR = Path(__file__).parent / "static"

YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

MOTO_KW = [
    "MOTORRAD", "MOPED", "KAWASAKI", "YAMAHA", "KTM", "DUCATI", "TRIUMPH",
    "HARLEY", "APRILIA", "PIAGGIO", "VESPA", "HUSQVARNA", "MV AGUSTA", "NORTON",
    "ROYAL ENFIELD", "BENELLI", "MOTO GUZZI", "BMW MOTORRAD", "ZERO MOTORC",
    "ENERGICA", "KYMCO", "SYM ", "RIEJU", "SHERCO", "BETA MOTOR", "GAS GAS",
    "ORCAL", "SILENCE MOTOR", "ELECTRIC MOTOR", "VMOTO", "LIFAN", "LONGJIA",
    "XINGYUE", "BAOTIAN", "QINGQI", "ZNEN", "JONWAY", "KEEWAY", "MALAGUTI",
    "DERBI", "ROGHI", "BRIXTON", "MOTORHISPANIA", "BULLIT", "REWACO",
    "BOOM TRIKE", "MOTOR TRIKE",
]
TRAILER_KW = [
    "ANHÄNG", "TRAILER", "AUFLIEGER", "SATTELAUFLIEG", "WOHNWAGEN", "CARAVAN",
    "HUMBAUR", "BÖCKMANN", "HAPERT", "KNOTT", "AL-KO", "ALKO", "DETHLEFFS",
    "ERIBA", "HYMER", "WEINSBERG", "ADRIA", "BÜRSTNER", "CARADO", "CONCORDE",
    "EURA MOBIL", "CARTHAGO", "NIESMANN", "LAIKA", "RAPIDO", "FENDT CARAVAN",
    "HOBBY ", "POLAR CARAVAN", "STERCKEMAN", "TRIGANO", "WILK WOHNWAGEN",
    "LMC CARAVAN", "TABBERT", "FRANKIA", "T.E.C CARAVAN", "KNAUS", "SUNLIGHT",
    "FORSTER", "PILOTE", "BAVARIA CAMP", "CAPRON", "ESTEREL CAMP", "NOTIN",
    "CHAUSSON", "CHALLENGER", "MOBILVETTA", "AUTOSTAR", "POSSL", "ELNAGH",
    "ETRUSCO", "FLEURETTE", "GITANE", "GLOBECAR", "GLOBESCOUT", "ITINEO",
    "KARMANN", "KABE", "LOISIRS", "NADOR", "NIESMANN+BISCHOFF", "PILOTE",
    "RIMOR", "ROLLER TEAM", "SUNLIGHT", "TISCHER", "WINGAMM",
]
AGRI_KW = [
    "TRAKTOR", "LANDMASCHINE", "AGRAR", "SCHLEPPER", "MÄHDR", "FENDT",
    "CLAAS", "DEUTZ-FAHR", "JOHN DEERE", "NEW HOLLAND", "MASSEY FERGUSON",
    "KUBOTA", "ISEKI", "YANMAR", "STEYR TRAK", "VALTRA", "CASE IH",
    "CASE AGRI", "AMAZONE", "HORSCH", "LEMKEN", "KRONE AGRAR", "JOSKIN",
    "SAME TRAK", "ZETOR", "URSUS", "CHALLENGER AGRI", "AGCO",
    "GRIMME LANDMASCHIN", "ROPA FAHRZEUG", "HOLMER MASCHIN",
]
NFZ_KW = [
    "LKW", "NUTZFAHRZEUG", "SATTELZUG", "SCANIA", "DAF ", "IVECO", "MAN ",
    "RENAULT TRUCKS", "VOLVO TRUCK", "NEOPLAN", "SETRA", "VDL BUS",
    "SOLARIS BUS", "VAN HOOL", "IRIZAR", "TEMSA", "HEULIEZ BUS",
    "DAIMLER TRUCK", "MERCEDES-BENZ TRUCK", "MAN TRUCK", "FORD TRUCK",
    "EVOBUS", "DAIMLER BUS", "OMNIBUS", "REISEBUS", "LINIENBUS",
]
BAU_KW = [
    "BAUMASCHINE", "STAPLER", "KRAN", "CATERPILLAR", "LIEBHERR", "MANITOU",
    "TEREX", "JCB ", "KOMATSU", "VOLVO CONSTRUCT", "LINDE GABEL",
    "JUNGHEINRICH", "STILL GABEL", "TOYOTA GABEL", "CROWN GABEL",
    "CLARK GABEL", "HYSTER", "YALE ", "DOOSAN", "HELI GABEL", "COMBILIFT",
    "AUSA", "MERLO", "FARESIN", "DIECI", "MAGNI", "MANITOWOC",
]


def _category(hersteller: str) -> str:
    h = str(hersteller).upper()
    for kw in MOTO_KW:
        if kw in h:
            return "KRAD"
    for kw in TRAILER_KW:
        if kw in h:
            return "Anhänger"
    for kw in AGRI_KW:
        if kw in h:
            return "Landwirtschaft"
    for kw in NFZ_KW:
        if kw in h:
            return "NFZ"
    for kw in BAU_KW:
        if kw in h:
            return "Sonderkraftfahrzeug"
    return "KFZ"


def _load_year(path: Path, year: int) -> pd.DataFrame:
    xf = pd.ExcelFile(path)
    sheet = "FZ 6.1" if "FZ 6.1" in xf.sheet_names else xf.sheet_names[-1]
    # Read raw without header to find where data starts
    raw = pd.read_excel(path, sheet_name=sheet, header=None)
    # Find first row whose second non-null value looks like a 4-digit HSN (numeric string)
    data_start = None
    for i, row in raw.iterrows():
        vals = [v for v in row if pd.notna(v)]
        if len(vals) >= 5:
            # Check if first real value is numeric-string (HSN like "0001")
            candidate = str(vals[0]).strip()
            if candidate.isdigit() and len(candidate) <= 4:
                data_start = i
                break
    if data_start is None:
        return pd.DataFrame(columns=["hsn","hersteller","tsn","handelsname","anzahl","year"])
    # Slice from data_start, drop all-NaN rows, take first 5 real columns
    df = raw.iloc[data_start:].copy()
    # Drop columns that are entirely NaN
    df = df.dropna(axis=1, how="all")
    # Drop footer rows (last 2)
    df = df.iloc[:-2]
    # Take the first 5 columns
    df = df.iloc[:, :5]
    df.columns = ["hsn", "hersteller", "tsn", "handelsname", "anzahl"]
    return df


def load_all() -> pd.DataFrame:
    frames = []
    for year in YEARS:
        path = DATA_DIR / f"fz6_{year}.xlsx"
        if not path.exists():
            continue
        df = _load_year(path, year)
        df = df.dropna(subset=["hsn"])
        df["anzahl"] = pd.to_numeric(df["anzahl"], errors="coerce").fillna(0).astype(int)
        df["hsn"] = df["hsn"].astype(str).str.strip().str.zfill(4)
        df["tsn"] = df["tsn"].astype(str).str.strip()
        df["hersteller"] = df["hersteller"].astype(str).str.strip()
        df["handelsname"] = df["handelsname"].fillna("").astype(str).str.strip()
        df["year"] = year
        frames.append(df)
    full = pd.concat(frames, ignore_index=True)
    full["kategorie"] = full["hersteller"].map(_category)
    return full


@lru_cache(maxsize=1)
def get_df() -> pd.DataFrame:
    return load_all()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="KFZ Explorer")


@app.on_event("startup")
def startup():
    get_df()  # warm cache


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

CATEGORY_ORDER = ["KFZ", "NFZ", "KRAD", "Anhänger", "Landwirtschaft", "Sonderkraftfahrzeug"]
CATEGORY_LABELS = {
    "KFZ": "Kraftfahrzeuge (PKW)",
    "NFZ": "Nutzfahrzeuge",
    "KRAD": "Krafträder / Moped",
    "Anhänger": "Anhänger / Wohnmobile",
    "Landwirtschaft": "Landwirtschaft",
    "Sonderkraftfahrzeug": "Sonderkraftfahrzeug",
}


def _filter(df: pd.DataFrame, *, year=None, hsn=None, tsn=None,
            manufacturer=None, model=None, category=None, q=None) -> pd.DataFrame:
    if year:
        df = df[df["year"] == int(year)]
    if hsn:
        df = df[df["hsn"] == str(hsn).zfill(4)]
    if tsn:
        df = df[df["tsn"].str.upper() == str(tsn).upper()]
    if manufacturer:
        df = df[df["hersteller"].str.upper() == str(manufacturer).upper()]
    if model:
        df = df[df["handelsname"].str.upper() == str(model).upper()]
    if category:
        df = df[df["kategorie"] == category]
    if q:
        pat = re.escape(q)
        mask = (
            df["hersteller"].str.contains(pat, case=False, na=False)
            | df["handelsname"].str.contains(pat, case=False, na=False)
            | df["hsn"].str.contains(pat, na=False)
            | df["tsn"].str.contains(pat, case=False, na=False)
        )
        df = df[mask]
    return df


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/stats")
def stats():
    df = get_df()
    by_year = (
        df.groupby("year")["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
    )
    cat_year = (
        df.groupby(["year", "kategorie"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
    )
    return {
        "by_year": by_year.to_dict(orient="records"),
        "categories": cat_year.to_dict(orient="records"),
        "total_manufacturers": int(df["hersteller"].nunique()),
        "total_models": int(df["handelsname"].replace("", pd.NA).dropna().nunique()),
        "years": sorted(df["year"].unique().tolist()),
    }


@app.get("/api/manufacturers")
def manufacturers(
    q: Optional[str] = None,
    category: Optional[str] = None,
    year: Optional[int] = None,
    limit: int = Query(100, le=500),
):
    df = _filter(get_df(), year=year, category=category, q=q)
    result = (
        df.groupby(["hsn", "hersteller"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("total", ascending=False)
        .head(limit)
    )
    return result.to_dict(orient="records")


@app.get("/api/models")
def models(
    hsn: Optional[str] = None,
    manufacturer: Optional[str] = None,
    category: Optional[str] = None,
    year: Optional[int] = None,
    q: Optional[str] = None,
    limit: int = Query(100, le=500),
):
    df = _filter(get_df(), hsn=hsn, manufacturer=manufacturer, category=category, year=year, q=q)
    df = df[df["handelsname"] != ""]
    result = (
        df.groupby(["hsn", "tsn", "hersteller", "handelsname"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("total", ascending=False)
        .head(limit)
    )
    return result.to_dict(orient="records")


@app.get("/api/chart/yearly-trend")
def yearly_trend(
    hsn: Optional[str] = None,
    tsn: Optional[str] = None,
    manufacturer: Optional[str] = None,
    model: Optional[str] = None,
    category: Optional[str] = None,
):
    df = _filter(get_df(), hsn=hsn, tsn=tsn, manufacturer=manufacturer, model=model, category=category)
    result = (
        df.groupby("year")["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("year")
    )
    return result.to_dict(orient="records")


@app.get("/api/chart/top-manufacturers")
def top_manufacturers(
    year: Optional[int] = None,
    category: Optional[str] = None,
    limit: int = Query(15, le=50),
):
    df = _filter(get_df(), year=year, category=category)
    result = (
        df.groupby("hersteller")["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("total", ascending=False)
        .head(limit)
    )
    return result.to_dict(orient="records")


@app.get("/api/chart/top-models")
def top_models(
    year: Optional[int] = None,
    manufacturer: Optional[str] = None,
    hsn: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(15, le=50),
):
    df = _filter(get_df(), year=year, manufacturer=manufacturer, hsn=hsn, category=category)
    df = df[df["handelsname"] != ""]
    result = (
        df.groupby(["hersteller", "handelsname"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("total", ascending=False)
        .head(limit)
    )
    return result.to_dict(orient="records")


@app.get("/api/chart/category-distribution")
def category_distribution(year: Optional[int] = None):
    df = _filter(get_df(), year=year)
    result = (
        df.groupby("kategorie")["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
    )
    result["label"] = result["kategorie"].map(CATEGORY_LABELS).fillna(result["kategorie"])
    return result.to_dict(orient="records")


@app.get("/api/chart/category-trends")
def category_trends():
    df = get_df()
    result = (
        df.groupby(["year", "kategorie"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values(["kategorie", "year"])
    )
    return result.to_dict(orient="records")


@app.get("/api/chart/manufacturer-trend")
def manufacturer_trend(manufacturer: str, category: Optional[str] = None):
    df = _filter(get_df(), manufacturer=manufacturer, category=category)
    result = (
        df.groupby("year")["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("year")
    )
    return result.to_dict(orient="records")


@app.get("/api/search")
def search(
    q: str,
    category: Optional[str] = None,
    year: Optional[int] = None,
    limit: int = Query(50, le=200),
):
    df = _filter(get_df(), q=q, category=category, year=year)
    result = (
        df.groupby(["hsn", "tsn", "hersteller", "handelsname", "kategorie"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("total", ascending=False)
        .head(limit)
    )
    return result.to_dict(orient="records")


@app.get("/api/hsn-detail")
def hsn_detail(hsn: str):
    df = get_df()
    df = df[df["hsn"] == str(hsn).zfill(4)]
    if df.empty:
        return {"error": "not found"}
    hersteller = df["hersteller"].iloc[0]
    kategorie = df["kategorie"].iloc[0]
    by_year = (
        df.groupby("year")["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("year")
    )
    top_models_df = (
        df[df["handelsname"] != ""]
        .groupby(["tsn", "handelsname"])["anzahl"]
        .sum()
        .reset_index()
        .rename(columns={"anzahl": "total"})
        .sort_values("total", ascending=False)
        .head(10)
    )
    return {
        "hsn": hsn,
        "hersteller": hersteller,
        "kategorie": kategorie,
        "by_year": by_year.to_dict(orient="records"),
        "top_models": top_models_df.to_dict(orient="records"),
    }


# Static files (SPA)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
