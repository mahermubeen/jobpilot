"""
Runs JobSpy (https://github.com/speedyapply/JobSpy, MIT) for JobPilot.

Reads one JSON object on stdin:
  {"queries": [{"id": "0", "site": "linkedin", "search_term": "...", "location": "...",
                "is_remote": false, "results_wanted": 50, "hours_old": 24,
                "country": "pakistan", "google_search_term": "..."}],
   "budget_s": 900}
and prints one JSON line per query as it finishes:
  {"query": "0", "jobs": [{...JobSpy columns...}], "error": null}

Each query scrapes one site, so a site that blocks us only loses its own results.
Searches still waiting when the time budget runs out are skipped, not lost midway.
Started by lib/sources/jobspy.ts through `uvx --from python-jobspy`.
"""

import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from jobspy import scrape_jobs
from jobspy.model import Country

COUNTRIES = {c.value.split(",")[0].strip(): c.value for c in Country}
ALIASES = {alias.strip(): first for first, value in COUNTRIES.items() for alias in value.split(",")}
# Sites that need a country JobSpy knows.
NEEDS_COUNTRY = {"indeed", "glassdoor"}


def run(q):
    site = q["site"]
    country = ALIASES.get((q.get("country") or "").lower())
    if site in NEEDS_COUNTRY and not country:
        raise ValueError(f"{site} does not cover {q.get('country') or 'this location'}")
    kwargs = dict(
        site_name=[site],
        search_term=q["search_term"],
        location=q.get("location") or None,
        is_remote=bool(q.get("is_remote")),
        results_wanted=int(q.get("results_wanted") or 30),
        hours_old=int(q.get("hours_old") or 72),
        country_indeed=country or "usa",
        description_format="markdown",
        fetch_description=True,
        verbose=0,
    )
    if site == "google":
        kwargs["google_search_term"] = q.get("google_search_term") or q["search_term"]
    df = scrape_jobs(**kwargs)
    rows = json.loads(df.to_json(orient="records", date_format="iso")) if len(df) else []
    return rows


def main():
    data = json.load(sys.stdin)
    queries = data.get("queries", [])
    deadline = time.monotonic() + float(data.get("budget_s") or 900)
    lock = threading.Lock()

    def emit(qid, rows, err):
        # One line per search as soon as it finishes, so a run stopped early keeps what it found.
        line = json.dumps({"query": qid, "jobs": rows, "error": err})
        with lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def site_queue(qs):
        for q in qs:
            if time.monotonic() > deadline:
                emit(q["id"], [], "skipped: out of time for this run")
                continue
            try:
                emit(q["id"], run(q), None)
            except Exception as e:  # one blocked site must not stop the others
                emit(q["id"], [], f"{type(e).__name__}: {e}"[:300])

    # Sites run side by side, but each site's searches run one after another
    # so no board sees a burst of requests from us.
    by_site = {}
    for q in queries:
        by_site.setdefault(q["site"], []).append(q)
    if by_site:
        with ThreadPoolExecutor(max_workers=len(by_site)) as ex:
            list(ex.map(site_queue, by_site.values()))


if __name__ == "__main__":
    main()
