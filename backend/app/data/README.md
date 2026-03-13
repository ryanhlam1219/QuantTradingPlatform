# app/data/ — External Data Feeds
**Roadmap Phase: p1 (Data Infrastructure)**

Planned files:
- `earnings.py`  — earnings calendar fetcher/cache (OpenBB or EDGAR) — **p1t4**
- `macro.py`     — macro data feeds: yield curve (10Y-2Y), DXY, VIX proxy via FRED API — **p1t5**
- `trends.py`    — Google Trends signal via pytrends (consumer-facing symbols) — **p4t2**
- `insider.py`   — SEC EDGAR Form 4 insider transaction signal — **p4t3**
- `options.py`   — CBOE put/call ratio + IV skew sentiment — **p4t4**

All data fetchers cache results in the database (p8) and refresh on a schedule.
Refresh intervals: earnings weekly, macro daily, trends weekly, insider weekly.
