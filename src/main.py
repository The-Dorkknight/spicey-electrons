#!/usr/bin/env python3
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Spicey Electrons launcher: starts the local server and opens the editor in your browser.

    python3 src/main.py              # normal start
    python3 src/main.py --version
    python3 src/main.py --no-browser --port 8765
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from spiceyelectrons import __version__, __build_date__, __app_name__  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__app_name__)
    ap.add_argument("--version", action="store_true")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--port", type=int, default=None)
    a = ap.parse_args()
    if a.version:
        print(f"{__app_name__} {__version__} (Built {__build_date__})")
        return
    from spiceyelectrons.server import serve
    serve(open_browser=not a.no_browser, port=a.port)


if __name__ == "__main__":
    main()
