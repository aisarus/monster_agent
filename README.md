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
  - inspect git status.
- OpenClaw-inspired bootstrap workspace:
  - `data/workspace/AGENTS.md`
  - `data/workspace/SOUL.md`
  - `data/workspace/USER.md`
  - `data/workspace/TOOLS.md`
  - `data/workspace/HEARTBEAT.md`
  - `data/workspace/MEMORY.md`
  - `data/workspace/skills/*/SKILL.md`
- Git-oriented workflow planned for future tasks: branch, secret scan, commit, push.

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
- `/doctor` - self-diagnostics for config, workspace, memory, and git.
- `/autopilot_status` - self-improvement scheduler status.
- `/autopilot_on` - enable periodic self-improvement tasks.
- `/autopilot_off` - disable periodic self-improvement tasks.
- `/autopilot_run` - enqueue one self-improvement task now if queue is idle.
- Any other text message becomes a task.

## Safety Rules

The agent must ask for confirmation before:

- spending money;
- sending messages to other people;
- changing system-level server config;
- installing system packages;
- adding new tooling to an existing project.

Secrets belong in `.env`, never in git.
