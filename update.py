#!/usr/bin/env python3
"""Refresh public TSLA and SPCX daily closes from Yahoo Finance.

Writes data/series.json and data/series.csv beside this file.
A failed download, a shorter series, or an older last day leaves the
saved files untouched. No key, no account, no personal data.
"""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
JSON_PATH = DATA / "series.json"
CSV_PATH = DATA / "series.csv"
NY = ZoneInfo("America/New_York")
START = datetime(2026, 6, 11, tzinfo=timezone.utc)
UA = "Mozilla/5.0 (compatible; public-price-chart/1.0)"
FIELDS = [
    "date",
    "tsla_close",
    "spcx_close",
    "tsla_pct",
    "spcx_pct",
    "daily_strength",
    "cumulative",
    "ma5",
    "ma20",
]


def fetch_chart(symbol: str) -> dict:
    period2 = int((datetime.now(timezone.utc) + timedelta(days=2)).timestamp())
    period1 = int(START.timestamp())
    query = (
        f"/v8/finance/chart/{symbol}?period1={period1}&period2={period2}"
        "&interval=1d&includeAdjustedClose=true"
    )
    hosts = (
        "https://query1.finance.yahoo.com",
        "https://query2.finance.yahoo.com",
    )
    last_err: Exception | None = None
    for attempt in range(3):
        for host in hosts:
            try:
                req = urllib.request.Request(
                    host + query,
                    headers={"User-Agent": UA, "Accept": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode())
                result = payload["chart"]["result"][0]
                if not result.get("timestamp"):
                    raise RuntimeError("empty series")
                return result
            except Exception as exc:  # keep the previous file on any fetch error
                last_err = exc
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{symbol} unavailable: {last_err}")


def completed_bars(result: dict) -> dict[str, float]:
    now_ny = datetime.now(NY)
    after_close = (now_ny.hour, now_ny.minute) >= (16, 15)
    quote = result["indicators"]["quote"][0]
    adjusted = result["indicators"].get("adjclose", [{}])[0].get("adjclose")
    if not adjusted:
        adjusted = quote["close"]
    out: dict[str, float] = {}
    for i, stamp in enumerate(result["timestamp"]):
        close = quote["close"][i]
        adj = adjusted[i]
        if close is None or adj is None:
            continue
        day = datetime.fromtimestamp(stamp, NY).date()
        if day > now_ny.date():
            continue
        if day == now_ny.date() and not after_close:
            continue
        out[day.isoformat()] = float(adj)
    return out


def build(tsla: dict[str, float], spcx: dict[str, float]) -> dict:
    days = sorted(set(tsla) & set(spcx))
    if len(days) < 2:
        raise RuntimeError("not enough common sessions")
    base = tsla[days[0]] / spcx[days[0]]
    rows = []
    dailies: list[float] = []
    for i, day in enumerate(days):
        ratio = tsla[day] / spcx[day]
        row = {
            "date": day,
            "tsla": round(tsla[day], 4),
            "spcx": round(spcx[day], 4),
            "tsla_pct": None,
            "spcx_pct": None,
            "daily": None,
            "cumulative": None,
            "ma5": None,
            "ma20": None,
            "ratio": round(ratio, 6),
            "ratio_index": round(ratio / base * 100, 6),
        }
        if i:
            prev = days[i - 1]
            tsla_pct = (tsla[day] / tsla[prev] - 1) * 100
            spcx_pct = (spcx[day] / spcx[prev] - 1) * 100
            daily = tsla_pct - spcx_pct
            dailies.append(daily)
            row["tsla_pct"] = round(tsla_pct, 6)
            row["spcx_pct"] = round(spcx_pct, 6)
            row["daily"] = round(daily, 6)
            row["cumulative"] = round(sum(dailies), 6)
            if len(dailies) >= 5:
                row["ma5"] = round(sum(dailies[-5:]) / 5, 6)
            if len(dailies) >= 20:
                row["ma20"] = round(sum(dailies[-20:]) / 20, 6)
        rows.append(row)
    return {
        "source": "Yahoo Finance",
        "price": "daily adjusted close",
        "listing": "2026-06-12",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "rows": rows,
    }


def load_existing() -> dict | None:
    if not JSON_PATH.exists():
        return None
    try:
        return json.loads(JSON_PATH.read_text())
    except json.JSONDecodeError:
        return None


def reject_reason(new: dict, old: dict | None) -> str | None:
    if not old or not old.get("rows"):
        return None
    if len(new["rows"]) < len(old["rows"]):
        return "shorter than the saved series"
    if new["rows"][-1]["date"] < old["rows"][-1]["date"]:
        return "older than the saved series"
    return None


def same_prices(new: dict, old: dict | None) -> bool:
    if not old:
        return False

    def key(payload: dict) -> list:
        return [
            (r["date"], r["tsla"], r["spcx"], r["daily"], r["cumulative"])
            for r in payload.get("rows", [])
        ]

    return key(new) == key(old)


def write_csv(payload: dict) -> None:
    with CSV_PATH.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for row in payload["rows"]:
            writer.writerow(
                {
                    "date": row["date"],
                    "tsla_close": row["tsla"],
                    "spcx_close": row["spcx"],
                    "tsla_pct": "" if row["tsla_pct"] is None else row["tsla_pct"],
                    "spcx_pct": "" if row["spcx_pct"] is None else row["spcx_pct"],
                    "daily_strength": "" if row["daily"] is None else row["daily"],
                    "cumulative": "" if row["cumulative"] is None else row["cumulative"],
                    "ma5": "" if row["ma5"] is None else row["ma5"],
                    "ma20": "" if row["ma20"] is None else row["ma20"],
                }
            )


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def push_changes() -> int:
    added = git("add", "data/series.json", "data/series.csv")
    if added.returncode != 0:
        print("push skipped: could not stage files")
        return 1
    quiet = git("diff", "--cached", "--quiet")
    if quiet.returncode == 0:
        print("nothing to push")
        return 0
    committed = git("commit", "-m", "Update daily closes")
    if committed.returncode != 0:
        print("push skipped: commit failed")
        return 1
    pushed = git("push")
    if pushed.returncode != 0:
        print("push failed")
        return 1
    print("pushed")
    return 0


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    old = load_existing()
    try:
        payload = build(completed_bars(fetch_chart("TSLA")), completed_bars(fetch_chart("SPCX")))
    except Exception as exc:
        print(f"kept previous: {exc}")
        return 0 if old else 1
    reason = reject_reason(payload, old)
    if reason:
        print(f"kept previous: {reason}")
        return 0
    if same_prices(payload, old):
        print(f"unchanged through {payload['rows'][-1]['date']}")
        return 0
    JSON_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    write_csv(payload)
    last = payload["rows"][-1]
    print(
        f"wrote {len(payload['rows'])} rows through {last['date']} "
        f"daily={last['daily']} cumulative={last['cumulative']}"
    )
    if "--push" in sys.argv:
        return push_changes()
    return 0


if __name__ == "__main__":
    sys.exit(main())
