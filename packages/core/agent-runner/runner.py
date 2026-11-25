#!/usr/bin/env python3
"""Separate container runner that executes the `agy`, `claude` or `pi` CLI on JD
cards against CV attachments from the board's `Docs` column.

`agy`, `claude` and `pi` get a prompt built here and update the card over Kanban
MCP. pi gets the CVs' text in its prompt (the server extracts it), since it runs
with only web search and the Kanban MCP tools.

`pi` talks to an OpenAI-compatible server (llama.cpp and the like) from
LOCAL_PROVIDERS: the first one that answers wins, and the runner writes the pi
provider config for it into the job's own directory. Without LOCAL_PROVIDERS,
pi runs on its own config (PI_PROVIDER / PI_MODEL, or pi's defaults).
"""

import base64
import re
import shutil
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

import sessions

PORT = int(os.environ.get("AGENT_RUNNER_PORT", "4850"))
AGENTS = ("agy", "claude", "pi")
# Provider/model for `pi`. Unset: pi's defaults. Provider without model: the
# provider's first model.
PI_PROVIDER = os.environ.get("PI_PROVIDER", "").strip()
PI_MODEL = os.environ.get("PI_MODEL", "").strip()
PROBE_TIMEOUT_S = float(os.environ.get("LOCAL_PROVIDERS_TIMEOUT", "3"))
# Tools pi may call: web search (and fetch, if a plugin provides it). Names no
# loaded extension registers are ignored. Empty: no tools at all.
PI_TOOLS = os.environ.get("PI_TOOLS", "web_search,web_fetch,batch_web_fetch").strip()
# The host pi's Kanban MCP server (in ~/.pi/agent/mcp.json): pi updates and
# moves the card through it, like agy and claude. Empty: no MCP for pi.
PI_KANBAN_MCP = os.environ.get("PI_KANBAN_MCP", "kanban").strip()
# Only what a JD job needs: no create/delete of boards, columns or cards.
KANBAN_MCP_TOOLS = ("list_boards", "get_board", "get_card", "search_cards", "update_card", "move_card")
JOBS_ROOT = Path(os.environ.get("AGENT_JOBS_DIR", "/tmp/agent-jobs"))
# A resumed message runs to completion inside the HTTP request.
RESUME_TIMEOUT_S = int(os.environ.get("AGENT_RESUME_TIMEOUT", "1200"))

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
    cv_texts: list[dict] | None = None,
) -> str:
    if cv_texts is not None:
        # pi can't open the files: the server sends their text.
        readable = [c for c in cv_texts if c.get("text")]
        unreadable = [c for c in cv_texts if not c.get("text")]
        cv_section = (
            "\n\n".join(f"## Candidate CV: {c.get('name')}\n\n{c['text']}" for c in readable)
            if readable
            else "No readable CV text was found in the Docs column; analyse the JD on its own and say the fit couldn't be checked against a CV."
        )
        if unreadable:
            cv_section += "\n\n(Could not read: " + "; ".join(
                f"{c.get('name')}: {c.get('note') or 'no text'}" for c in unreadable
            ) + ")"
    elif cv_paths:
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


def _provider(name: str, value: object) -> dict | None:
    """One LOCAL_PROVIDERS entry: "host:port/v1", "host:port/v1|api-key", or
    {"url": ..., "apiKey": ...}. Scheme defaults to http://; `/v1` is added
    when the path is empty."""
    if isinstance(value, dict):
        url, key = str(value.get("url") or ""), str(value.get("apiKey") or "")
    else:
        url, _, key = str(value).strip().strip("'\"").partition("|")
    url = url.strip().rstrip("/")
    if not url:
        return None
    if "://" not in url:
        url = f"http://{url}"
    if url.count("/") == 2:
        url += "/v1"
    name = name.strip() or url.split("://", 1)[1].split("/", 1)[0]
    # The name is also pi's provider id, which takes letters, digits, - and _.
    pid = re.sub(r"[^A-Za-z0-9_-]", "-", name).strip("-") or "local"
    return {"name": name, "id": pid, "baseUrl": url, "apiKey": key.strip()}


def parse_local_providers(raw: str) -> list[dict]:
    """LOCAL_PROVIDERS, tried in order:

    - a JSON object of name -> URL: `{"pc1": "192.168.8.229:8080/v1", ...}`
    - a JSON list of URLs: `["192.168.8.229:8080/v1", ...]`
    - comma-separated URLs, optionally `name=URL`

    A URL may carry an API key after `|`. Unnamed entries are named by host."""
    raw = raw.strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = [e for e in raw.strip("[]").split(",") if e.strip()]
    if isinstance(parsed, str):
        parsed = [parsed]
    if isinstance(parsed, dict):
        pairs = list(parsed.items())
    else:
        pairs = []
        for entry in parsed:
            text = entry if isinstance(entry, (str, dict)) else str(entry)
            if isinstance(text, str) and "=" in text.split("|", 1)[0]:
                name, _, text = text.partition("=")
                pairs.append((name.strip().strip("'\""), text))
            else:
                pairs.append(("", text))
    providers, seen = [], set()
    for name, value in pairs:
        provider = _provider(str(name), value)
        if not provider:
            continue
        while provider["id"] in seen:
            provider["id"] += "-2"
        seen.add(provider["id"])
        providers.append(provider)
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


def resolve_local_provider(providers: list[dict] | None = None) -> tuple[dict, str] | None:
    """The first provider (default: LOCAL_PROVIDERS) that answers and has a
    usable model."""
    for provider in LOCAL_PROVIDERS if providers is None else providers:
        try:
            model = pick_model(list_models(provider))
        except (URLError, OSError, ValueError) as exc:
            log(f"local provider {provider['name']} ({provider['baseUrl']}) unreachable: {exc}")
            continue
        if model:
            return provider, model
        log(f"local provider {provider['name']} ({provider['baseUrl']}) has no usable model"
            + (f" (PI_MODEL={PI_MODEL})" if PI_MODEL else ""))
    return None


def write_pi_config(agent_dir: Path, provider: dict, model: str) -> None:
    """A pi config dir holding just this provider (PI_CODING_AGENT_DIR), so the
    host's mounted ~/.pi is read by nothing and written by nothing."""
    agent_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "providers": {
            provider["id"]: {
                "name": provider["name"],
                "baseUrl": provider["baseUrl"],
                "api": "openai-completions",
                "apiKey": provider["apiKey"] or "none",
                "models": [{"id": model, "name": model, "contextWindow": 128000}],
            }
        }
    }
    (agent_dir / "models.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    write_pi_mcp(agent_dir)


def host_kanban_mcp() -> dict | None:
    """The host pi's Kanban MCP server entry, if it has one."""
    if not PI_KANBAN_MCP:
        return None
    path = Path(os.environ.get("HOME", "/root")) / ".pi" / "agent" / "mcp.json"
    try:
        servers = json.loads(path.read_text(encoding="utf-8")).get("mcpServers") or {}
    except (OSError, ValueError):
        return None
    entry = servers.get(PI_KANBAN_MCP)
    if not isinstance(entry, dict) or entry.get("enabled") is False:
        return None
    return entry


def write_pi_mcp(agent_dir: Path) -> None:
    """Just the Kanban server, its tools declared directly (not behind
    codemode), signed in with the host pi's saved login: mcp-auth.json is
    linked, so a refreshed token lands back on the host."""
    entry = host_kanban_mcp()
    if not entry:
        return
    config = {"mcpServers": {PI_KANBAN_MCP: {**entry, "exposure": "direct"}}}
    (agent_dir / "mcp.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    auth = Path(os.environ.get("HOME", "/root")) / ".pi" / "agent" / "mcp-auth.json"
    link = agent_dir / "mcp-auth.json"
    if auth.exists() and not link.exists():
        link.symlink_to(auth)


def pi_tool_allowlist() -> str:
    """PI_TOOLS plus the Kanban MCP tools a job may call."""
    tools = [t for t in PI_TOOLS.split(",") if t.strip()]
    server = re.sub(r"[^A-Za-z0-9_]", "_", PI_KANBAN_MCP)
    if host_kanban_mcp():
        tools += [f"mcp__{server}__{t}" for t in KANBAN_MCP_TOOLS]
    return ",".join(tools)


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


def pi_extensions() -> list[str]:
    """The extension packages the host's pi has installed (`packages` in
    ~/.pi/agent/settings.json, e.g. pi-searxng-search for web_search), so jobs
    get the same tools as the host's pi though they run on a generated config
    dir. Plus any paths in PI_EXTENSIONS (comma-separated)."""
    agent_dir = Path(os.environ.get("HOME", "/root")) / ".pi" / "agent"
    found: list[str] = []
    try:
        settings = json.loads((agent_dir / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        settings = {}
    for spec in settings.get("packages") or []:
        spec = str(spec)
        if spec.startswith("npm:"):
            # "npm:name", "npm:name@1.2", "npm:@scope/name@1.2": drop the version.
            name = spec[4:]
            head, at, _version = name[1:].rpartition("@")
            if at:
                name = name[0] + head
            path = agent_dir / "npm" / "node_modules" / name
        else:
            path = Path(spec).expanduser()
        if path.exists():
            found.append(str(path))
    for extra in os.environ.get("PI_EXTENSIONS", "").split(","):
        if extra.strip() and Path(extra.strip()).exists():
            found.append(extra.strip())
    return found


def pi_command(
    prompt: str,
    system: str | None,
    local: tuple[dict, str] | None,
    session: list[str] | None = None,
) -> list[str]:
    """`pi` in print mode with skills, templates and context files off: the
    prompt carries the JD and the CVs' text. Its only tools are PI_TOOLS (web
    search for the company's careers page, from the host's installed
    extensions) and the Kanban MCP tools it updates the card with. `session` names the
    session to create or resume (`--session-dir ... --session-id/--session ...`);
    without it, none is kept."""
    allowed = pi_tool_allowlist()
    tools = ["--tools", allowed] if allowed else ["--no-tools"]
    extensions = [arg for path in pi_extensions() for arg in ("-e", path)]
    cmd = [
        "pi",
        "--print",
        *(session or ["--no-session"]),
        *tools,
        *extensions,
        "--no-context-files",
        # Not --no-extensions: pi (>= 1.6) provides llama.cpp and other
        # providers through extensions, so turning them off loses the model.
        "--no-skills",
        "--no-prompt-templates",
        "--offline",
    ]
    if local:
        cmd += ["--provider", local[0]["id"], "--model", local[1]]
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


def job_providers(config: dict) -> list[dict] | str:
    """pi's servers for one job, from LOCAL_PROVIDERS: just the one an admin
    picked in Settings → LLM (by name), or all of them to try in order."""
    chosen = str(config.get("provider") or "").strip()
    if not chosen:
        return LOCAL_PROVIDERS
    for provider in LOCAL_PROVIDERS:
        if provider["name"] == chosen:
            return [provider]
    names = ", ".join(p["name"] for p in LOCAL_PROVIDERS) or "none"
    return f"pi is set to {chosen!r}, which isn't in LOCAL_PROVIDERS (have: {names})"


def auth_setup(agent: str, config: dict) -> tuple[dict, list[str], str]:
    """Env and extra CLI args for the agent's auth mode, and the mode.

    `installed`: the CLI's own login from its mounted config dir.
    `apiKey`: claude gets ANTHROPIC_API_KEY; agy gets GEMINI_API_KEY with the
    Gemini model provider (agy's only API-key route)."""
    auth = config.get("auth") or {}
    key = str(auth.get("apiKey") or "").strip()
    if auth.get("mode") != "apiKey" or not key:
        return {}, [], "installed"
    if agent == "claude":
        return {"ANTHROPIC_API_KEY": key}, [], "apiKey"
    if agent == "agy":
        return (
            {"GEMINI_API_KEY": key},
            ["--settings", json.dumps({"modelProvider": "gemini"})],
            "apiKey",
        )
    return {}, [], "installed"


def run_job(
    job_id: str,
    agent: str,
    job_dir: Path,
    prompt: str,
    log_path: Path,
    system: str | None = None,
    config: dict | None = None,
) -> None:
    config = config or {}
    env = {**os.environ, "HOME": os.environ.get("HOME", "/root")}
    auth_env, auth_args, auth_mode = auth_setup(agent, config)
    env.update(auth_env)
    with jobs_lock:
        card_id = jobs[job_id].get("cardId")
        board_id = jobs[job_id].get("boardId")
        title = jobs[job_id].get("title") or ""
    record = (
        sessions.new_session(agent, card_id, board_id, title, job_id)
        if sessions.enabled()
        else None
    )
    if record:
        record["auth"] = auth_mode
    cwd = job_dir
    agy_before: set[str] = set()
    if agent == "pi":
        local = None
        providers = job_providers(config)
        if isinstance(providers, str):
            fail_job(job_id, stderr_path(log_path), providers)
            return
        if providers:
            local = resolve_local_provider(providers)
            if not local:
                tried = ", ".join(f"{p['name']} ({p['baseUrl']})" for p in providers)
                fail_job(job_id, stderr_path(log_path),
                         f"no LOCAL_PROVIDERS endpoint answered with a usable model (tried {tried})")
                return
            agent_dir = job_dir / "pi-agent"
            write_pi_config(agent_dir, *local)
            env["PI_CODING_AGENT_DIR"] = str(agent_dir)
            log(f"job={job_id} pi on {local[0]['name']} ({local[0]['baseUrl']}) model={local[1]}")
            if record:
                record["provider"] = {"name": local[0]["name"], "model": local[1]}
        session_args = (
            ["--session-dir", str(sessions.pi_cli_dir()), "--session-id", record["id"]]
            if record
            else None
        )
        cmd = pi_command(prompt, system, local, session_args)
    elif agent == "agy":
        agy_before = sessions.agy_snapshot()
        cmd = [
            "agy",
            "--dangerously-skip-permissions",
            *auth_args,
            "--add-dir",
            str(job_dir),
            f"--print={prompt}",
        ]
    else:
        cmd = [
            "claude",
            "--print",
            "--dangerously-skip-permissions",
            *auth_args,
            *(["--session-id", record["id"]] if record else []),
            prompt,
            "--add-dir",
            str(job_dir),
        ]
        if record:
            # Claude keys its sessions on the working dir; a fixed one per
            # session lets a resume find it after the job dir is gone.
            cwd = Path(record["cli"]["cwd"])
            cwd.mkdir(parents=True, exist_ok=True)
    if record:
        with jobs_lock:
            jobs[job_id]["sessionId"] = record["id"]
    shown = [a if len(a) < 80 else f"<{len(a)} chars>" for a in cmd]
    log(f"job={job_id} spawning: {' '.join(shown)} cwd={cwd}")
    started = time.monotonic()
    started_wall = time.time()

    # pi's stdout is the answer the server puts on the card, so its stderr
    # (warnings, errors) goes to its own file instead of into the answer.
    err_path = stderr_path(log_path) if agent == "pi" else None

    try:
        with log_path.open("a", encoding="utf-8") as log_file, (
            err_path.open("a", encoding="utf-8") if err_path else open(os.devnull, "w")
        ) as err_file:
            proc = subprocess.Popen(
                cmd,
                cwd=str(cwd),
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
        if record:
            save_job_session(record, agent, prompt, read_text(log_path), exit_code, agy_before, started_wall)
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = int((time.monotonic() - started) * 1000)
        with (err_path or log_path).open("a", encoding="utf-8") as log_file:
            log_file.write(f"\n[runner error] {exc}\n")
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["finishedAt"] = int(time.time() * 1000)
        log(f"job={job_id} error after {elapsed_ms}ms: {exc}")


def save_job_session(
    record: dict,
    agent: str,
    prompt: str,
    output: str,
    exit_code: int,
    agy_before: set[str],
    started_wall: float,
) -> None:
    """Records a finished job's run as the card's session."""
    try:
        if agent == "pi":
            record["cli"] = {"file": sessions.find_pi_file(record["id"])}
        elif agent == "agy":
            record["cli"] = {"conversationId": sessions.agy_new_conversation(agy_before, started_wall)}
        resumable = all(record["cli"].values()) and bool(record["cli"])
        sessions.add_turn(record, "user", prompt, kind="job", jobId=record["jobId"])
        extra: dict = {} if exit_code == 0 else {"error": f"exit code {exit_code}"}
        if agent == "claude":
            thinking = sessions.claude_reasoning_since(record, int(started_wall * 1000))
            if thinking:
                extra["reasoning"] = thinking
        sessions.add_turn(record, "assistant", output.strip(), jobId=record["jobId"], **extra)
        record["resumable"] = resumable
        sessions.save(sessions.with_reasoning(record))
        sessions.snapshot_cli_files(record)
        log(f"session {record['id']} saved agent={agent} card={record.get('cardId')} resumable={resumable}")
    except Exception as exc:  # noqa: BLE001
        log(f"session {record.get('id')} not saved: {exc}")


def resume_command(
    record: dict, message: str, config: dict | None = None
) -> tuple[list[str], Path, dict] | str:
    """The CLI call that continues `record` with `message`, its working dir
    and env; or why it can't."""
    config = config or {}
    agent, cli = record["agent"], record.get("cli") or {}
    env = {**os.environ, "HOME": os.environ.get("HOME", "/root")}
    auth_env, auth_args, auth_mode = auth_setup(agent, config)
    env.update(auth_env)
    record["auth"] = auth_mode
    work = JOBS_ROOT / f"resume-{record['id']}"
    work.mkdir(parents=True, exist_ok=True)
    if agent == "pi":
        if not cli.get("file"):
            return "this pi session has no saved session file"
        local = None
        providers = job_providers(config)
        if isinstance(providers, str):
            return providers
        if providers:
            local = resolve_local_provider(providers)
            if not local:
                names = ", ".join(p["name"] for p in providers)
                return f"no LOCAL_PROVIDERS endpoint answered with a usable model (tried {names})"
            write_pi_config(work / "pi-agent", *local)
            env["PI_CODING_AGENT_DIR"] = str(work / "pi-agent")
            record["provider"] = {"name": local[0]["name"], "model": local[1]}
        session = ["--session-dir", str(sessions.pi_cli_dir()), "--session", cli["file"]]
        return pi_command(message, None, local, session), work, env
    if agent == "claude":
        if not cli.get("sessionId") or not cli.get("cwd"):
            return "this claude session has no session id"
        cwd = Path(cli["cwd"])
        cwd.mkdir(parents=True, exist_ok=True)
        return (
            ["claude", "--print", "--dangerously-skip-permissions", *auth_args, "--resume", cli["sessionId"], message],
            cwd,
            env,
        )
    if not cli.get("conversationId"):
        return "this agy run's conversation could not be found"
    return (
        ["agy", "--dangerously-skip-permissions", *auth_args, "--conversation", cli["conversationId"], f"--print={message}"],
        work,
        env,
    )


def resume_session(record: dict, message: str, config: dict | None = None) -> tuple[int, dict]:
    """Runs one follow-up message through the session's CLI, to completion."""
    built = resume_command(record, message, config)
    if isinstance(built, str):
        return 409, {"error": built}
    cmd, cwd, env = built
    shown = [a if len(a) < 80 else f"<{len(a)} chars>" for a in cmd]
    log(f"session {record['id']} resume: {' '.join(shown)} cwd={cwd}")
    started = time.monotonic()
    started_wall = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=RESUME_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return 504, {"error": f"{record['agent']} did not answer within {RESUME_TIMEOUT_S}s"}
    except OSError as exc:
        return 500, {"error": f"could not start {record['agent']}: {exc}"}
    elapsed_ms = int((time.monotonic() - started) * 1000)
    reply = proc.stdout.strip()
    if record["agent"] != "pi" and proc.stderr.strip():
        # claude/agy print diagnostics to stderr; the reply is stdout.
        log(f"session {record['id']} stderr: {proc.stderr.strip()[-300:]}")
    log(f"session {record['id']} resume exitCode={proc.returncode} durationMs={elapsed_ms}")
    sessions.add_turn(record, "user", message)
    extra: dict = {}
    if record["agent"] == "claude":
        thinking = sessions.claude_reasoning_since(record, int(started_wall * 1000))
        if thinking:
            extra["reasoning"] = thinking
    if proc.returncode != 0:
        detail = (proc.stderr.strip() or reply)[-600:]
        sessions.add_turn(record, "assistant", reply, error=detail or f"exit code {proc.returncode}", **extra)
    else:
        sessions.add_turn(record, "assistant", reply, **extra)
    sessions.save(sessions.with_reasoning(record))
    sessions.snapshot_cli_files(record)
    status = 200 if proc.returncode == 0 else 502
    return status, {"session": session_view(record)}


def session_view(record: dict) -> dict:
    record = sessions.with_reasoning(record)
    view = {k: v for k, v in record.items() if k != "cli"}
    view["busy"] = sessions.is_busy(record["id"])
    return view


def probe_providers() -> list[dict]:
    """Each LOCAL_PROVIDERS entry: does it answer, and which model pi would
    ask it for. Probed in parallel so one slow host doesn't hold up the rest."""
    results: list[dict] = [{} for _ in LOCAL_PROVIDERS]

    def probe(i: int, provider: dict) -> None:
        entry = {"name": provider["name"], "baseUrl": provider["baseUrl"], "online": False, "model": None}
        try:
            entry["model"] = pick_model(list_models(provider))
            entry["online"] = True
            if not entry["model"]:
                entry["error"] = "no usable model" + (f" (PI_MODEL={PI_MODEL})" if PI_MODEL else "")
        except (URLError, OSError, ValueError) as exc:
            entry["error"] = str(getattr(exc, "reason", exc))[:200]
        results[i] = entry

    threads = [threading.Thread(target=probe, args=(i, p)) for i, p in enumerate(LOCAL_PROVIDERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(PROBE_TIMEOUT_S + 2)
    return [r for r in results if r]


AGENT_CHECKS = {
    # agent: (binary, files its installed login needs)
    "claude": ("claude", [".claude", ".claude.json"]),
    "agy": ("agy", [".gemini/antigravity-cli"]),
    "pi": ("pi", []),
    # Listed for the sidebar; offline until compose mounts its binary.
    "opencode": ("opencode", []),
}
_status_cache: dict = {"at": 0.0, "value": None}


def agent_status() -> dict:
    """Whether each CLI can run here: its binary (mounted by compose), its
    version, the config its installed login needs, and API keys from env."""
    # The CLI checks start each binary, so they're cached; providers are
    # probed every time (whether a host is up changes by the minute).
    if _status_cache["value"] and time.time() - _status_cache["at"] < 30:
        return {**_status_cache["value"], "providers": probe_providers()}
    home = Path(os.environ.get("HOME", "/root"))
    agents = {}
    for agent, (binary, files) in AGENT_CHECKS.items():
        found = shutil.which(binary)
        version, error = None, None
        if found:
            try:
                out = subprocess.run(
                    [binary, "--version"], capture_output=True, text=True,
                    timeout=20, stdin=subprocess.DEVNULL,
                )
                text = (out.stdout or out.stderr).strip().splitlines()
                if out.returncode == 0 and text:
                    version = text[0][:80]
                else:
                    error = (text[-1] if text else f"exit code {out.returncode}")[:200]
            except (OSError, subprocess.TimeoutExpired) as exc:
                error = str(exc)[:200]
        else:
            error = f"`{binary}` not found: check its volume in the compose file"
        missing = [f"~/{f}" for f in files if not (home / f).exists()]
        if agent == "pi" and not Path("/opt/pi/dist/bundle/cli.js").exists():
            missing.append("/opt/pi (PI_PACKAGE mount)")
        agents[agent] = {
            "binary": found,
            "version": version,
            "error": error,
            "missing": missing,
            "ok": bool(found and version and not missing),
        }
    agents["claude"]["envApiKey"] = bool(os.environ.get("ANTHROPIC_API_KEY"))
    agents["agy"]["envApiKey"] = bool(os.environ.get("GEMINI_API_KEY"))
    value = {
        "agents": agents,
        "providers": probe_providers(),
        "sessions": sessions.enabled(),
    }
    _status_cache.update(at=time.time(), value=value)
    return value


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
        if self.path.startswith("/sessions/card/"):
            card_id = self.path.removeprefix("/sessions/card/").strip("/")
            record = sessions.for_card(card_id) if sessions.enabled() else None
            if not record:
                self._send_json(404, {"error": "No session for this card"})
                return
            self._send_json(200, {"session": session_view(record)})
            return
        if self.path == "/status":
            self._send_json(200, agent_status())
            return
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        log(f"incoming POST {self.path} from {self.client_address[0]}")
        if self.path.startswith("/sessions/card/") and self.path.endswith("/messages"):
            self._post_session_message(
                self.path.removeprefix("/sessions/card/").removesuffix("/messages").strip("/")
            )
            return
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

        # A server-built prompt (an agent the server applies the answer for);
        # otherwise the Kanban MCP prompt, with the CVs' text for pi.
        system = payload.get("system") if payload.get("prompt") else None
        cv_texts = payload.get("cvTexts") if agent == "pi" else None
        prompt = (
            str(payload["prompt"])
            if payload.get("prompt")
            else build_prompt(
                title,
                body,
                cv_paths,
                board_id=board_id,
                card_id=card_id,
                job_id=job_id,
                cv_texts=cv_texts if isinstance(cv_texts, list) else None,
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
            args=(job_id, agent, job_dir, prompt, log_path, system, payload.get("agentConfig") or {}),
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

    def _post_session_message(self, card_id: str) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") if length else "{}")
        except Exception as exc:  # noqa: BLE001
            self._send_json(400, {"error": f"Invalid JSON: {exc}"})
            return
        message = str(payload.get("message") or "").strip()
        if not message:
            self._send_json(400, {"error": "message is required"})
            return
        record = sessions.for_card(card_id) if sessions.enabled() else None
        if not record:
            self._send_json(404, {"error": "No session for this card"})
            return
        if not sessions.claim(record["id"]):
            self._send_json(409, {"error": f"{record['agent']} is still answering"})
            return
        try:
            configs = payload.get("agentConfigs") or {}
            config = configs.get(record["agent"]) if isinstance(configs, dict) else None
            code, body = resume_session(record, message, config or payload.get("agentConfig") or {})
        finally:
            sessions.release(record["id"])
        self._send_json(code, body)

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
        log("pi local providers: " + ", ".join(f"{p['name']}={p['baseUrl']}" for p in LOCAL_PROVIDERS))
    if sessions.enabled():
        log(f"sessions in {sessions.SESSIONS_ROOT}")
    else:
        log(f"sessions off: {sessions.SESSIONS_ROOT} is not writable")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RunnerHandler)
    log(f"listening on http://0.0.0.0:{PORT} (jobsDir={JOBS_ROOT})")
    server.serve_forever()
