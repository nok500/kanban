# TODO

Agent pipeline issues found during project familiarization (2026-11-25).

- [ ] **Unbounded retries** — if the agent never makes its MCP calls, the card stays in `Analise` without the `process as job-id:` marker and is re-dispatched every 10s once the 5-minute watch ends. Add a retry limit / failure marker.
- [ ] **Watch timeout doesn't kill the agent** — `waitForJobFinish` gives up after 5 min but the runner process keeps going, so a slow job can run twice at once.
- [ ] **Job state is in memory only** — `activeCardJobs` (server) and `jobs` (runner) are lost on restart, which can cause duplicate dispatches.
- [ ] **No auth between server and runner** — `agent-runner:4850/run` accepts any POST and runs an agent with permissions bypassed. Add a shared secret.
- [ ] **Runner paths tied to this machine** — mounts into `/home/jvnl`; `AGY_BIN`, `CLAUDE_BIN` etc. are missing from `.env.selfhost.example`.
- [ ] **Dead client code** — client still listens for `kanban:agent-job-started`, which nothing dispatches.

## Agent settings in the UI

- [ ] **pi reasoning / speed** — a pi JD job on the 27B Qwen (192.168.8.229) took ~110s, mostly reasoning at pi's built-in default thinking level (the job's generated pi config doesn't read `~/.pi/settings.json`). Quick fix meanwhile: pass `--thinking <level>` from a `PI_THINKING` env var. Expose per-agent settings in the UI: thinking level (`pi --thinking off|low|…`), model choice, and which LLM endpoint pi jobs use (today: `LOCAL_PROVIDERS` / `PI_MODEL` env on agent-runner). The server would send them with each job.
