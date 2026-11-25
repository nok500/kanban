"""Agent sessions kept on disk, so a processed card's conversation can be
continued from the card chat.

Layout under SESSIONS_ROOT (a host folder mounted at /kanban/sessions):

    cards/<cardId>.json        {"agent", "sessionId"}: the card's latest session
    <agent>/<sessionId>.json   the session record: CLI handle + turns
    pi/cli/                    pi's own session files (--session-dir)
    claude/work/<sessionId>/   claude's working dir (claude keys sessions on it)
    claude/<sessionId>.jsonl   copy of claude's transcript
    agy/<sessionId>.db         copy of agy's conversation
    llama/<cardId>.json        card chats with llama.cpp (written by the server)

The record's `turns` are what the chat shows: the prompt each run got and the
answer it printed. The CLI's own files are what a resume actually reads.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

SESSIONS_ROOT = Path(os.environ.get("AGENT_SESSIONS_DIR", "/kanban/sessions"))
CARD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

_enabled: bool | None = None
_busy: set[str] = set()
_busy_lock = threading.Lock()


def enabled() -> bool:
    """True when SESSIONS_ROOT is usable. Without it jobs run as before
    (no saved sessions) instead of failing."""
    global _enabled
    if _enabled is None:
        try:
            for sub in ("cards", "pi/cli", "claude/work", "agy"):
                (SESSIONS_ROOT / sub).mkdir(parents=True, exist_ok=True)
            probe = SESSIONS_ROOT / "cards" / ".write-test"
            probe.write_text("", encoding="utf-8")
            probe.unlink()
            _enabled = True
        except OSError:
            _enabled = False
    return _enabled


def now_ms() -> int:
    return int(time.time() * 1000)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def new_session(agent: str, card_id: str | None, board_id: str | None, title: str, job_id: str) -> dict:
    sid = str(uuid.uuid4())
    record = {
        "id": sid,
        "agent": agent,
        "cardId": card_id,
        "boardId": board_id,
        "title": title,
        "jobId": job_id,
        "createdAt": now_ms(),
        "updatedAt": now_ms(),
        "cli": {},
        "turns": [],
    }
    if agent == "claude":
        record["cli"] = {"sessionId": sid, "cwd": str(SESSIONS_ROOT / "claude" / "work" / sid)}
    return record


def save(record: dict) -> None:
    record["updatedAt"] = now_ms()
    _write_json(SESSIONS_ROOT / record["agent"] / f"{record['id']}.json", record)
    card_id = record.get("cardId")
    if card_id and CARD_ID_RE.match(card_id):
        _write_json(
            SESSIONS_ROOT / "cards" / f"{card_id}.json",
            {"agent": record["agent"], "sessionId": record["id"]},
        )


def for_card(card_id: str) -> dict | None:
    if not CARD_ID_RE.match(card_id):
        return None
    pointer = _read_json(SESSIONS_ROOT / "cards" / f"{card_id}.json")
    if not pointer:
        return None
    agent, sid = pointer.get("agent"), pointer.get("sessionId")
    if not isinstance(agent, str) or not isinstance(sid, str) or "/" in agent + sid:
        return None
    return _read_json(SESSIONS_ROOT / agent / f"{sid}.json")


def add_turn(record: dict, role: str, content: str, **extra: object) -> None:
    record["turns"].append({"role": role, "content": content, "at": now_ms(), **extra})


def claim(sid: str) -> bool:
    """One run at a time per session: a resume while one is going would fork
    the CLI's history."""
    with _busy_lock:
        if sid in _busy:
            return False
        _busy.add(sid)
        return True


def release(sid: str) -> None:
    with _busy_lock:
        _busy.discard(sid)


def is_busy(sid: str) -> bool:
    with _busy_lock:
        return sid in _busy


# ---- per-agent CLI handles -------------------------------------------------

def pi_cli_dir() -> Path:
    return SESSIONS_ROOT / "pi" / "cli"


def find_pi_file(sid: str) -> str | None:
    """pi names its file `<timestamp>_<id>.jsonl`; the newest one for the id."""
    matches = sorted(pi_cli_dir().glob(f"*_{sid}.jsonl"))
    return str(matches[-1]) if matches else None


def _thinking_of(content: object) -> str:
    """The reasoning blocks of one assistant message (pi and claude both use
    `{"type": "thinking", "thinking": "..."}`)."""
    if not isinstance(content, list):
        return ""
    parts = [
        str(block.get("thinking") or "").strip()
        for block in content
        if isinstance(block, dict) and block.get("type") == "thinking"
    ]
    return "\n\n".join(p for p in parts if p)


def _jsonl(path: Path):
    try:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue
    except OSError:
        return


def pi_reasoning(path: str) -> list[str]:
    """Reasoning per assistant message in a pi session file, in order: one
    per print run, since the runner turns tools off."""
    out = []
    for entry in _jsonl(Path(path)):
        message = entry.get("message") if entry.get("type") == "message" else None
        if isinstance(message, dict) and message.get("role") == "assistant":
            out.append(_thinking_of(message.get("content")))
    return out


def claude_reasoning_since(record: dict, since_ms: int) -> str:
    """Claude's reasoning in the transcript from `since_ms` on: one run can
    hold several assistant messages (tool calls in between)."""
    cli = record.get("cli") or {}
    path = _claude_project_dir(cli.get("cwd", "")) / f"{cli.get('sessionId')}.jsonl"
    parts = []
    for entry in _jsonl(path):
        if entry.get("type") != "assistant":
            continue
        stamp = str(entry.get("timestamp") or "")
        try:
            at = int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            at = since_ms
        if at + 1000 < since_ms:
            continue
        thinking = _thinking_of((entry.get("message") or {}).get("content"))
        if thinking:
            parts.append(thinking)
    return "\n\n".join(parts)


def with_reasoning(record: dict) -> dict:
    """Fills in pi reasoning the record doesn't carry yet, from pi's own file
    (whose name has the same id), matching assistant messages in order."""
    if record.get("agent") != "pi":
        return record
    path = (record.get("cli") or {}).get("file")
    if not path:
        return record
    thoughts = pi_reasoning(path)
    replies = [t for t in record.get("turns", []) if t.get("role") == "assistant"]
    for turn, thinking in zip(replies, thoughts):
        if thinking and not turn.get("reasoning"):
            turn["reasoning"] = thinking
    return record


def _claude_project_dir(cwd: str) -> Path:
    # Claude keeps a working dir's sessions under ~/.claude/projects/<cwd with
    # every non-alphanumeric character turned into "-">.
    home = Path(os.environ.get("HOME", "/root"))
    return home / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", cwd)


def copy_claude_transcript(record: dict) -> None:
    cli = record.get("cli") or {}
    src = _claude_project_dir(cli.get("cwd", "")) / f"{cli.get('sessionId')}.jsonl"
    if src.exists():
        shutil.copyfile(src, SESSIONS_ROOT / "claude" / f"{record['id']}.jsonl")


def agy_conversations_dir() -> Path:
    home = Path(os.environ.get("HOME", "/root"))
    return home / ".gemini" / "antigravity-cli" / "conversations"


def agy_snapshot() -> set[str]:
    try:
        return {p.stem for p in agy_conversations_dir().glob("*.db")}
    except OSError:
        return set()


def agy_new_conversation(before: set[str], started_at: float) -> str | None:
    """The conversation a run created: a .db that wasn't there before it,
    newest first in case two runs overlapped."""
    fresh = [
        p for p in agy_conversations_dir().glob("*.db")
        if p.stem not in before and p.stat().st_mtime >= started_at - 1
    ]
    fresh.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return fresh[0].stem if fresh else None


def copy_agy_conversation(record: dict) -> None:
    cid = (record.get("cli") or {}).get("conversationId")
    src = agy_conversations_dir() / f"{cid}.db"
    if cid and src.exists():
        shutil.copyfile(src, SESSIONS_ROOT / "agy" / f"{record['id']}.db")


def snapshot_cli_files(record: dict) -> None:
    """Best-effort copies of the CLI's own state next to the record."""
    try:
        if record["agent"] == "claude":
            copy_claude_transcript(record)
        elif record["agent"] == "agy":
            copy_agy_conversation(record)
    except OSError:
        pass
