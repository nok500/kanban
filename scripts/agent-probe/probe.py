#!/usr/bin/env python3
"""Lightweight host probe that reports running `claude` and `agy` CLI processes."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socket
import time

PORT = int(os.environ.get("AGENT_PROBE_PORT", "4747"))
HOST = os.environ.get("AGENT_PROBE_HOST", "0.0.0.0")
SELF_PID = os.getpid()

CLAUDE_ARG_RE = re.compile(r"(?:^|/)claude$")
AGY_ARG_RE = re.compile(r"(?:^|/)agy$")
LLAMA_NAME_RE = re.compile(r"^llama(?:-(?:server|cli|cpp|bench))?$")
OLLAMA_NAME_RE = re.compile(r"^ollama$")

STATE_LABELS = {
    "R": "running",
    "S": "sleeping",
    "I": "idle",
    "D": "disk-sleep",
    "T": "stopped",
    "t": "tracing",
    "Z": "zombie",
    "X": "dead",
}


def read_proc_state(entry: Path) -> str:
    try:
        stat = (entry / "stat").read_text(errors="ignore")
    except OSError:
        return "?"
    rparen = stat.rfind(")")
    if rparen == -1:
        return "?"
    rest = stat[rparen + 2 :].split()
    return rest[0] if rest else "?"


def read_proc_cwd(entry: Path) -> str | None:
    try:
        return os.readlink(entry / "cwd")
    except OSError:
        return None


def summarize_cli(procs: list[dict]) -> dict:
    active = sum(1 for p in procs if p["state"] not in ("T", "t", "Z", "X"))
    return {
        "running": active > 0,
        "count": len(procs),
        "activeCount": active,
        "processes": procs,
    }


def count_processes() -> dict:
    claude_procs: list[dict] = []
    agy_procs: list[dict] = []
    llama_procs: list[dict] = []
    ollama_procs: list[dict] = []

    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == SELF_PID:
            continue

        try:
            comm = (entry / "comm").read_text(errors="ignore").strip()
            raw_cmd = (entry / "cmdline").read_bytes()
        except OSError:
            continue

        if not raw_cmd:
            continue

        args = [part.decode("utf-8", errors="ignore") for part in raw_cmd.split(b"\x00") if part]
        if not args or any("probe.py" in a for a in args):
            continue

        exe_name = os.path.basename(args[0])
        is_claude = comm == "claude" or exe_name == "claude" or any(CLAUDE_ARG_RE.search(a) for a in args[:2])
        is_agy = comm == "agy" or exe_name == "agy" or any(AGY_ARG_RE.search(a) for a in args[:2])
        is_llama = bool(LLAMA_NAME_RE.match(comm) or LLAMA_NAME_RE.match(exe_name))
        is_ollama = bool(OLLAMA_NAME_RE.match(comm) or OLLAMA_NAME_RE.match(exe_name))
        if not (is_claude or is_agy or is_llama or is_ollama):
            continue

        state = read_proc_state(entry)
        proc_info = {
            "pid": pid,
            "state": state,
            "status": STATE_LABELS.get(state, "unknown"),
            "cwd": read_proc_cwd(entry),
        }
        if is_claude:
            claude_procs.append(proc_info)
        if is_agy:
            agy_procs.append(proc_info)
        if is_llama:
            llama_procs.append(proc_info)
        if is_ollama:
            ollama_procs.append(proc_info)

    return {
        "host": socket.gethostname(),
        "claude": summarize_cli(claude_procs),
        "agy": summarize_cli(agy_procs),
        "llama": summarize_cli(llama_procs),
        "ollama": summarize_cli(ollama_procs),
        "updatedAt": int(time.time() * 1000),
    }


class ProbeHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path not in ("/status", "/"):
            self._send_json(404, {"error": "Not found"})
            return

        try:
            self._send_json(200, count_processes())
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": str(exc)})

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), ProbeHandler)
    print(f"agent-probe listening on http://{HOST}:{PORT}/status", flush=True)
    server.serve_forever()
