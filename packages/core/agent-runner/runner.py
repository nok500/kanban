#!/usr/bin/env python3
"""Separate container runner that executes `agy` or `claude` CLI on JD cards
against CV attachments from the board's `Docs` column.
"""

import base64
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import time

PORT = int(os.environ.get("AGENT_RUNNER_PORT", "4850"))
JOBS_ROOT = Path(os.environ.get("AGENT_JOBS_DIR", "/tmp/agent-jobs"))

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
job_counter = 0


def next_job_id() -> str:
    global job_counter
    with jobs_lock:
        if job_counter == 0 and JOBS_ROOT.exists():
            existing = [int(p.name) for p in JOBS_ROOT.iterdir() if p.is_dir() and p.name.isdigit()]
            if existing:
                job_counter = max(existing)
        job_counter += 1
        return str(job_counter)


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] [agent-runner] {msg}", flush=True)


def build_prompt(
    title: str,
    body: str,
    cv_paths: list[Path],
    board_id: str | None = None,
    card_id: str | None = None,
    job_id: str | None = None,
) -> str:
    if cv_paths:
        cv_lines = "\n".join(f"- {p}" for p in cv_paths)
        cv_section = f"Candidate CV file(s) from the Docs column:\n{cv_lines}"
    else:
        cv_section = (
            "No CV file was attached to any card in the Docs column yet; "
            "you can also check the Docs column via Kanban MCP."
        )

    if ":" in title:
        company, position = (part.strip() for part in title.split(":", 1))
    else:
        company, position = "", title.strip()

    company_line = (
        f"Also search {company!r} online for the {position!r} role and check for their official careers page or direct application link, and include any URL(s) found."
        if company
        else f"If a company name is mentioned in the title or JD, search it online for the {position or title!r} role and check for their official careers page or direct application link, and include any URL(s) found."
    )

    return "\n".join(
        [
            f"Analyze the JD ({position or title} at {company}) against CV."
            if company
            else f"Analyze the JD ({title}) against CV.",
            "Provide a clear, structured fit analysis covering: matching skills/experience, gaps or missing requirements, and brief reasoning.",
            company_line,
            "",
            "Use your Kanban MCP tools to update this card directly:",
            f"- Board ID: {board_id or '(unknown)'}, Card ID: {card_id or '(unknown)'}, Job ID: {job_id or '(unknown)'}",
            "- Append a `---` divider followed by your analysis (and `process as job-id: <job_id>` at the end) to the card using `update_card`.",
            "- If the JD is worth following up, set `priority` (`high`, `medium`, or `low` based on match strength) and move the card to `Follow-up` using `move_card`.",
            "- Otherwise, move the card to `Nay` using `move_card`.",
            "",
            cv_section,
            "",
            f"# JD Title: {title or '(untitled)'}",
            "",
            body or "(empty JD body)",
        ]
    )


def run_job(job_id: str, agent: str, job_dir: Path, prompt: str, log_path: Path) -> None:
    if agent == "agy":
        cmd = [
            "agy",
            "--dangerously-skip-permissions",
            "--add-dir",
            str(job_dir),
            f"--print={prompt}",
        ]
    else:
        cmd = [
            "claude",
            "--print",
            "--dangerously-skip-permissions",
            prompt,
            "--add-dir",
            str(job_dir),
        ]
    log(
        f"job={job_id} spawning: {agent} --print --dangerously-skip-permissions "
        f"<prompt:{len(prompt)} chars> --add-dir {job_dir} cwd={job_dir}"
    )
    started = time.monotonic()

    try:
        with log_path.open("a", encoding="utf-8") as log_file:
            proc = subprocess.Popen(
                cmd,
                cwd=str(job_dir),
                env={**os.environ, "HOME": os.environ.get("HOME", "/root")},
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
            )
            with jobs_lock:
                jobs[job_id]["pid"] = proc.pid
            log(f"job={job_id} started pid={proc.pid} log={log_path}")

            exit_code = proc.wait()
            elapsed_ms = int((time.monotonic() - started) * 1000)
            with jobs_lock:
                jobs[job_id]["status"] = "completed" if exit_code == 0 else "failed"
                jobs[job_id]["exitCode"] = exit_code
                jobs[job_id]["durationMs"] = elapsed_ms
                jobs[job_id]["finishedAt"] = int(time.time() * 1000)
            log(
                f"job={job_id} finished agent={agent} pid={proc.pid} "
                f"exitCode={exit_code} durationMs={elapsed_ms} log={log_path}"
            )
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = int((time.monotonic() - started) * 1000)
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"\n[runner error] {exc}\n")
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["finishedAt"] = int(time.time() * 1000)
        log(f"job={job_id} error after {elapsed_ms}ms: {exc}")


class RunnerHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        log(f"incoming GET {self.path} from {self.client_address[0]}")
        if self.path == "/jobs":
            with jobs_lock:
                payload = {"jobs": list(jobs.values())}
            self._send_json(200, payload)
            return
        if self.path.startswith("/jobs/"):
            job_id = self.path.removeprefix("/jobs/").strip("/")
            with jobs_lock:
                job = jobs.get(job_id)
                snapshot = dict(job) if job else None
            if not snapshot:
                self._send_json(404, {"error": "Job not found"})
                return
            log_file = Path(snapshot["logPath"])
            output = log_file.read_text(encoding="utf-8", errors="replace") if log_file.exists() else ""
            snapshot["output"] = output
            self._send_json(200, snapshot)
            return
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        log(f"incoming POST {self.path} from {self.client_address[0]}")
        if self.path != "/run":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            log(f"invalid JSON payload: {exc}")
            self._send_json(400, {"error": f"Invalid JSON: {exc}"})
            return

        agent = payload.get("agent")
        if agent not in ("agy", "claude"):
            log(f"rejected request: invalid agent={agent!r}")
            self._send_json(400, {"error": "agent must be 'agy' or 'claude'"})
            return

        board_id = payload.get("boardId")
        card_id = payload.get("cardId")
        title = payload.get("title") or ""
        body = payload.get("body") or ""
        cvs = payload.get("cvs") or []

        job_id = next_job_id()
        job_dir = JOBS_ROOT / job_id
        cv_dir = job_dir / "cv"
        cv_dir.mkdir(parents=True, exist_ok=True)

        log(
            f"job={job_id} accepted agent={agent} boardId={board_id} cardId={card_id} "
            f"title={title!r} bodyChars={len(body)} cvs={len(cvs)}"
        )

        cv_paths: list[Path] = []
        for cv in cvs:
            name = cv.get("name")
            b64 = cv.get("contentBase64")
            if not name or not b64:
                continue
            safe_name = os.path.basename(str(name))
            dest = cv_dir / safe_name
            raw_bytes = base64.b64decode(b64)
            dest.write_bytes(raw_bytes)
            cv_paths.append(dest)
            log(f"job={job_id} wrote CV {dest} ({len(raw_bytes)} bytes)")

        prompt = build_prompt(
            title,
            body,
            cv_paths,
            board_id=board_id,
            card_id=card_id,
            job_id=job_id,
        )
        (job_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
        log_path = job_dir / "output.log"

        with jobs_lock:
            jobs[job_id] = {
                "jobId": job_id,
                "agent": agent,
                "boardId": board_id,
                "cardId": card_id,
                "title": title,
                "cvCount": len(cv_paths),
                "pid": None,
                "status": "running",
                "startedAt": int(time.time() * 1000),
                "finishedAt": None,
                "exitCode": None,
                "logPath": str(log_path),
            }

        thread = threading.Thread(
            target=run_job,
            args=(job_id, agent, job_dir, prompt, log_path),
            daemon=True,
        )
        thread.start()

        self._send_json(
            202,
            {
                "ok": True,
                "jobId": job_id,
                "agent": agent,
                "cvCount": len(cv_paths),
            },
        )

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
    JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RunnerHandler)
    log(f"listening on http://0.0.0.0:{PORT} (jobsDir={JOBS_ROOT})")
    server.serve_forever()
