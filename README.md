# Monster Agent

Personal autonomous AI agent controlled from Telegram.

## MVP Scope

- Telegram as the main interface.
- One owner account.
- Task queue.
- Main planning agent plus role-based subagents.
- Multi-provider LLM routing with fallback.
- Markdown long-term memory compatible with Obsidian.
- Budget tracking.
- Heartbeat messages.
- Iterative agent loop with workspace tools:
  - list files;
  - read files;
  - write files inside the workspace;
  - run non-system shell commands;
  - inspect git status;
  - create task branches;
  - commit safe changes;
  - push the current branch to GitHub through `GITHUB_TOKEN`;
  - open GitHub pull requests from task branches.
- OpenClaw-inspired bootstrap workspace:
  - `data/workspace/AGENTS.md`
  - `data/workspace/SOUL.md`
  - `data/workspace/USER.md`
  - `data/workspace/TOOLS.md`
  - `data/workspace/HEARTBEAT.md`
  - `data/workspace/MEMORY.md`
  - `data/workspace/skills/*/SKILL.md`
- Git-oriented workflow: create a task branch, run checks, secret-scan changed files, commit, push, open PR.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a config file:

```bash
cp .env.example .env
```

3. Fill at least:

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_ID=
GEMINI_API_KEY=
GITHUB_TOKEN=
```

4. Start in development mode:

```bash
npm run dev
```

## Telegram Commands

- `/start` - check access and basic status.
- `/status` - current queue and budget status.
- `/memory` - short memory file summary.
- `/stop` - request emergency stop for the active task.
- `/pause` - keep accepting tasks but stop running the queue.
- `/resume` - resume queue processing.
- `/runtime` - show runtime pause state.
- `/report` - send a plain-language activity report now.
- `/chat <message>` or `/ask <message>` - talk to the LLM directly without queueing an agent task.
- `/doctor` - self-diagnostics for config, workspace, memory, and git.
- `/autopilot_status` - self-improvement scheduler status.
- `/autopilot_on` - enable periodic self-improvement tasks.
- `/autopilot_off` - disable periodic self-improvement tasks.
- `/autopilot_run` - enqueue one self-improvement task now if queue is idle.
- Any other text message becomes a task.

The agent sends an activity report every `REPORT_INTERVAL_MINUTES` minutes. Direct chat replies do not
pause the queue or autopilot.
Direct chat uses `DIRECT_CHAT_PROVIDER` so `/chat` can prefer Gemini while autonomous coding tasks
use `DEFAULT_PROVIDER`.

## Dashboard

The daemon also serves a local operator dashboard when `DASHBOARD_ENABLED=true`.

Default URL:

```bash
http://127.0.0.1:8787
```

Dashboard settings:

```bash
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
DASHBOARD_TOKEN=
DASHBOARD_PUBLIC_URL=
```

Keep `DASHBOARD_HOST=127.0.0.1` for server use unless a reverse proxy or firewall is configured.
Set `DASHBOARD_TOKEN` when exposing the dashboard beyond a local SSH tunnel.
Use `/dashboard` in Telegram to get a one-command access hint or an open button when
`DASHBOARD_PUBLIC_URL` is configured.

## Safety Rules

The agent must ask for confirmation before:

- spending money;
- sending messages to other people;
- changing system-level server config;
- installing system packages;
- adding new tooling to an existing project.

Secrets belong in `.env`, never in git. `GITHUB_TOKEN` is used only for push and must not be stored in git remotes.
