#!/usr/bin/env python3
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Write docs/HISTORY.md: one entry per tagged build (version, date, size of change, top files).

Keeps entries already in the file, so builds trimmed from git history stay on record.
Usage: python3 tools/history_log.py
"""
import os
import re
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "docs", "HISTORY.md")


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def main():
    old = {}
    if os.path.isfile(OUT):
        for block in re.split(r"(?m)^## ", open(OUT).read())[1:]:
            old[block.split()[0]] = "## " + block.rstrip() + "\n"
    tags = [t for t in git("tag", "--sort=creatordate").splitlines() if t.startswith("v")]
    prev = None
    for t in tags:
        rng = f"{prev}..{t}" if prev else t
        date = git("log", "-1", "--format=%ad", "--date=format:%Y-%m-%d %H:%M", t)
        stat = git("diff", "--shortstat", prev, t) if prev else git("show", "--shortstat", "--format=", t + "^{commit}")
        files = git("diff", "--numstat", prev, t) if prev else git("show", "--numstat", "--format=", t + "^{commit}")
        rows = []
        for line in files.splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and parts[0] != "-" and parts[2].endswith((".py", ".js", ".css", ".html", ".sh", ".bat", ".command")):
                rows.append((int(parts[0]) + int(parts[1]), parts[2], parts[0], parts[1]))
        rows.sort(reverse=True)
        body = f"## {t}\n\n- Built: {date}\n- Change: {stat or 'n/a'}\n- Range: `{rng}`\n"
        if rows:
            body += "\n| Code file | + | − |\n|---|---|---|\n" + "".join(f"| `{r[1]}` | {r[2]} | {r[3]} |\n" for r in rows[:10])
        old[t] = body
        prev = t
    order = sorted(old, key=lambda v: [int(x) if x.isdigit() else x for x in re.findall(r"\d+|[a-z]+", v)], reverse=True)
    with open(OUT, "w") as f:
        f.write("# Build history\n\nOne entry per build, newest first. Written by `tools/history_log.py`.\n\n")
        f.write("\n".join(old[k] for k in order))
    print("wrote", OUT, f"({len(order)} builds)")


if __name__ == "__main__":
    main()
