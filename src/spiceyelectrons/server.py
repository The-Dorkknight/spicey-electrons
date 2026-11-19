# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Tiny local web server (Python standard library only) that serves the editor and runs simulations.

Only listens on 127.0.0.1, so nothing outside this computer can reach it.
"""
import json
import os
import socket
import threading
import webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

from . import __version__, __build_date__, __app_name__
from .runner import start_job, JOBS, find_ngspice, simulate
from .parts import CATALOGUE

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
         ".json": "application/json", ".ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    server_version = "SpiceyElectrons/" + __version__

    def log_message(self, fmt, *args):     # keep the terminal quiet
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/info":
            return self._send(200, {"app": __app_name__, "version": __version__, "build": __build_date__,
                                    "ngspice": find_ngspice(),
                                    "parts": {k: {"pins": v[0], "props": v[1]} for k, v in CATALOGUE.items()}})
        if path.startswith("/api/job/"):
            job = JOBS.get(path.rsplit("/", 1)[1])
            if not job:
                return self._send(404, {"error": "no such job"})
            if job["state"] == "done":
                return self._send(200, {"state": "done", "result": job["result"]})
            return self._send(200, {"state": "running", "heartbeat": job.get("heartbeat")})
        if path == "/":
            path = "/index.html"
        full = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
        if not full.startswith(WEB) or not os.path.isfile(full):
            return self._send(404, "not found", "text/plain")
        with open(full, "rb") as f:
            self._send(200, f.read(), TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._send(400, {"error": "bad json"})
        if self.path == "/api/simulate":
            return self._send(200, {"job": start_job(data)})
        if self.path.startswith("/api/cancel/"):
            job = JOBS.get(self.path.rsplit("/", 1)[1])
            if job:
                job["cancel"] = True
            return self._send(200, {"ok": True})
        self._send(404, {"error": "unknown"})


def free_port(preferred=8765):
    for port in [preferred] + list(range(preferred + 1, preferred + 40)):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(open_browser=True, port=None):
    port = port or free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"{__app_name__} {__version__} (Built {__build_date__})")
    print(f"Open {url} in your browser. Close this window to quit.")
    eng = find_ngspice()
    print("ngspice:", eng or "NOT FOUND - see README 'Installing ngspice'")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
