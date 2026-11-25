#!/usr/bin/env python3
"""Separate container runner that executes the `agy`, `claude` or `pi` CLI on JD
cards against CV attachments from the board's `Docs` column.

`agy` and `claude` get a prompt built here and update the card over Kanban MCP.
`pi` has no MCP: the server sends its prompt (with the CVs' text) and applies
its answer to the card when the job finishes.

`pi` talks to an OpenAI-compatible server (llama.cpp and the like) from
LOCAL_PROVIDERS: the first one that answers wins, and the runner writes the pi
provider config for it into the job's own directory. Without LOCAL_PROVIDERS,
pi runs on its own config (PI_PROVIDER / PI_MODEL, or pi's defaults).
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
from urllib import request as urlrequest
from urllib.error import URLError

PORT = int(os.environ.get("AGENT_RUNNER_PORT", "4850"))
AGENTS = ("agy", "claude", "pi")
# Provider/model for `pi`. Unset: pi's defaults. Provider without model: the
# provider's first model.
PI_PROVIDER = os.environ.get("PI_PROVIDER", "").strip()
PI_MODEL = os.environ.get("PI_MODEL", "").strip()
# Name of the provider written into the generated pi config.
LOCAL_PROVIDER_ID = "local"
PROBE_TIMEOUT_S = float(os.environ.get("LOCAL_PROVIDERS_TIMEOUT", "3"))
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
            "Provide a clear, structured fit analysis covering: Matching Skills & Experience, Gaps & Missing Requirements (include actionable recommendations on how to tailor/reframe the CV or address those gaps for this JD), and brief reasoning.",
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


def stderr_path(log_path: Path) -> Path:
    return log_path.with_name("stderr.log")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""


def parse_local_providers(raw: str) -> list[dict]:
    """LOCAL_PROVIDERS as a JSON list (`["192.168.8.229:8080/v1", ...]`) or a
    comma-separated string. An entry may carry an API key after `|`
    (`host:8080/v1|secret`). Scheme defaults to http://; `/v1` is added when
    the path is empty."""
    raw = raw.strip()
    if not raw:
        return []
    try:
        entries = json.loads(raw)
        if isinstance(entries, str):
            entries = [entries]
    except json.JSONDecodeError:
        entries = raw.strip("[]").split(",")
    providers = []
    for entry in entries:
        entry = str(entry).strip().strip("'\"")
        if not entry:
            continue
        url, _, key = entry.partition("|")
        url = url.strip().rstrip("/")
        if "://" not in url:
            url = f"http://{url}"
        if url.count("/") == 2:
            url += "/v1"
        providers.append({"baseUrl": url, "apiKey": key.strip()})
    return providers


LOCAL_PROVIDERS = parse_local_providers(os.environ.get("LOCAL_PROVIDERS", ""))

# Not chat models: never picked unless PI_MODEL names one.
NON_CHAT = ("embed", "rerank", "whisper", "tts")


def list_models(provider: dict) -> list[dict]:
    req = urlrequest.Request(f"{provider['baseUrl']}/models")
    if provider["apiKey"]:
        req.add_header("Authorization", f"Bearer {provider['apiKey']}")
    with urlrequest.urlopen(req, timeout=PROBE_TIMEOUT_S) as res:
        return json.load(res).get("data") or []


def pick_model(models: list[dict]) -> str | None:
    """PI_MODEL when the server has it; else a model already loaded (a llama.cpp
    router reports `status.value`), so a job never swaps the model out from
    under a chat; else the first chat model."""
    ids = [m.get("id") for m in models if m.get("id")]
    if PI_MODEL:
        return PI_MODEL if PI_MODEL in ids else None
    chat = [m for m in models if m.get("id") and not any(n in m["id"].lower() for n in NON_CHAT)]
    for m in chat:
        status = m.get("status")
        if isinstance(status, dict) and status.get("value") == "loaded":
            return m["id"]
    return chat[0]["id"] if chat else None


def resolve_local_provider() -> tuple[dict, str] | None:
    """The first LOCAL_PROVIDERS entry that answers and has a usable model."""
    for provider in LOCAL_PROVIDERS:
        try:
            model = pick_model(list_models(provider))
        except (URLError, OSError, ValueError) as exc:
            log(f"local provider {provider['baseUrl']} unreachable: {exc}")
            continue
        if model:
            return provider, model
        log(f"local provider {provider['baseUrl']} has no usable model"
            + (f" (PI_MODEL={PI_MODEL})" if PI_MODEL else ""))
    return None


def write_pi_config(agent_dir: Path, provider: dict, model: str) -> None:
    """A pi config dir holding just this provider (PI_CODING_AGENT_DIR), so the
    host's mounted ~/.pi is read by nothing and written by nothing."""
    agent_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "providers": {
            LOCAL_PROVIDER_ID: {
                "baseUrl": provider["baseUrl"],
                "api": "openai-completions",
                "apiKey": provider["apiKey"] or "none",
                "models": [{"id": model, "name": model, "contextWindow": 128000}],
            }
        }
    }
    (agent_dir / "models.json").write_text(json.dumps(config, indent=2), encoding="utf-8")


def resolve_pi_model(provider: str) -> str | None:
    """pi (>= 1.6) wants `--model` with `--provider`. Without PI_MODEL, take the
    provider's first model as pi lists it, so a model swap in pi's own config
    needs no change here."""
    try:
        listed = subprocess.run(
            ["pi", "--offline", "--list-models"],
            capture_output=True,
            text=True,
            timeout=60,
            stdin=subprocess.DEVNULL,
        ).stdout
    except (OSError, subprocess.TimeoutExpired) as exc:
        log(f"pi --list-models failed: {exc}")
        return None
    # Rows: `provider  model  context ...` under a header line.
    for line in listed.splitlines()[1:]:
        cols = line.split()
        if len(cols) >= 2 and cols[0] == provider:
            return cols[1]
    return None


def pi_command(prompt: str, system: str | None, local: tuple[dict, str] | None) -> list[str]:
    """`pi` in print mode with tools, sessions, skills, templates and context
    files off: the prompt already carries the JD and the CVs' text, and the
    answer is all the server reads."""
    cmd = [
        "pi",
        "--print",
        "--no-session",
        "--no-tools",
        "--no-context-files",
        # Not --no-extensions: pi (>= 1.6) provides llama.cpp and other
        # providers through extensions, so turning them off loses the model.
        "--no-skills",
        "--no-prompt-templates",
        "--offline",
    ]
    if local:
        cmd += ["--provider", LOCAL_PROVIDER_ID, "--model", local[1]]
    elif PI_PROVIDER:
        model = PI_MODEL or resolve_pi_model(PI_PROVIDER)
        cmd += ["--provider", PI_PROVIDER]
        if model:
            cmd += ["--model", model]
    elif PI_MODEL:
        cmd += ["--model", PI_MODEL]
    if system:
        cmd += ["--system-prompt", system]
    # `--` so a prompt starting with "-" or "@" is never read as an option/file.
    return [*cmd, "--", prompt]


def run_job(
    job_id: str,
    agent: str,
    job_dir: Path,
    prompt: str,
    log_path: Path,
    system: str | None = None,
) -> None:
    env = {**os.environ, "HOME": os.environ.get("HOME", "/root")}
    if agent == "pi":
        local = None
        if LOCAL_PROVIDERS:
            local = resolve_local_provider()
            if not local:
                tried = ", ".join(p["baseUrl"] for p in LOCAL_PROVIDERS)
                fail_job(job_id, stderr_path(log_path),
                         f"no LOCAL_PROVIDERS endpoint answered with a usable model (tried {tried})")
                return
            agent_dir = job_dir / "pi-agent"
            write_pi_config(agent_dir, *local)
            env["PI_CODING_AGENT_DIR"] = str(agent_dir)
            log(f"job={job_id} pi on {local[0]['baseUrl']} model={local[1]}")
        cmd = pi_command(prompt, system, local)
    elif agent == "agy":
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
    shown = [a if len(a) < 80 else f"<{len(a)} chars>" for a in cmd]
    log(f"job={job_id} spawning: {' '.join(shown)} cwd={job_dir}")
    started = time.monotonic()

    # pi's stdout is the answer the server puts on the card, so its stderr
    # (warnings, errors) goes to its own file instead of into the answer.
    err_path = stderr_path(log_path) if agent == "pi" else None

    try:
        with log_path.open("a", encoding="utf-8") as log_file, (
            err_path.open("a", encoding="utf-8") if err_path else open(os.devnull, "w")
        ) as err_file:
            proc = subprocess.Popen(
                cmd,
                cwd=str(job_dir),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=err_file if err_path else subprocess.STDOUT,
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
        with (err_path or log_path).open("a", encoding="utf-8") as log_file:
            log_file.write(f"\n[runner error] {exc}\n")
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["finishedAt"] = int(time.time() * 1000)
        log(f"job={job_id} error after {elapsed_ms}ms: {exc}")


def fail_job(job_id: str, err_path: Path, message: str) -> None:
    with err_path.open("a", encoding="utf-8") as err_file:
        err_file.write(f"[runner error] {message}\n")
    with jobs_lock:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["exitCode"] = 1
        jobs[job_id]["finishedAt"] = int(time.time() * 1000)
    log(f"job={job_id} failed: {message}")


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
            snapshot["output"] = read_text(log_file)
            snapshot["stderr"] = read_text(stderr_path(log_file))
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
        if agent not in AGENTS:
            log(f"rejected request: invalid agent={agent!r}")
            self._send_json(400, {"error": f"agent must be one of {', '.join(AGENTS)}"})
            return
        if agent == "pi" and not payload.get("prompt"):
            self._send_json(400, {"error": "pi jobs need the server-built prompt"})
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

        system = payload.get("system") if agent == "pi" else None
        prompt = (
            str(payload["prompt"])
            if agent == "pi"
            else build_prompt(
                title,
                body,
                cv_paths,
                board_id=board_id,
                card_id=card_id,
                job_id=job_id,
            )
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
            args=(job_id, agent, job_dir, prompt, log_path, system),
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
    if LOCAL_PROVIDERS:
        log("pi local providers: " + ", ".join(p["baseUrl"] for p in LOCAL_PROVIDERS))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RunnerHandler)
    log(f"listening on http://0.0.0.0:{PORT} (jobsDir={JOBS_ROOT})")
    server.serve_forever()
