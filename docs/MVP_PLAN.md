# Agent MVP Plan v0.1

## Goal

Build a personal autonomous agent that is controlled from Telegram, uses external LLM APIs,
keeps long-term Markdown memory, works cheaply by default, and can improve itself over time.

## First Version

Included:

- Telegram as primary UI.
- One owner account.
- Queue with one active task.
- Main agent planner.
- Role selection for subagents.
- Gemini/OpenAI provider routing with fallback.
- Budget tracking file.
- Markdown memory file for Obsidian.
- Heartbeat.
- Workspace tool loop: list/read/write files, run non-system commands, git status.
- Basic tests and lint/format commands.

OpenClaw-inspired additions accepted for MVP direction:

- Gateway-like single runtime: Telegram is a channel, not the whole product.
- Bootstrap workspace files instead of one giant memory prompt.
- Separate layers: tools now, skills next, plugins later.
- Model fallback with cooldowns and compact failure summaries.
- Telegram approval flow for blocked/risky commands.
- `/doctor` command for self-diagnostics.
- Loop detection for repeated tool calls.
- OpenClaw-style bootstrap workspace now lives under `data/workspace`.
- Self-improvement autopilot can periodically enqueue a small safe task.

Deferred:

- Web UI.
- Top-down virtual office.
- Full plugin marketplace.
- Deep repository index.
- PR automation.
- Automatic CVE/security update workflow.

## Confirmation Rules

Ask owner before:

- spending money;
- sending messages to other people;
- installing system packages;
- changing firewall, nginx, systemd, cron, or other server-level settings;
- adding new lint/test/dev tooling to an existing project.

## Onboarding Inputs

The owner needs to provide:

- Telegram bot token.
- Telegram owner user ID.
- Gemini API key.
- Optional OpenAI API key.
- GitHub access later.
- Budget limits.
- Preferred default/fallback models.

## Runtime Files

- `.env` - local secrets and settings, never committed.
- `data/memory/AGENT_MEMORY.md` - long-term memory.
- `data/tasks/tasks.json` - task queue state.
- `data/budget/usage.json` - budget usage events.
- `data/models/cooldowns.json` - model cooldown/failure state.
- `data/runtime/state.json` - runtime pause/resume state.
- `WORKSPACE_ROOT` - directory the agent is allowed to operate in.
- `docs/OPENCLAW_LESSONS.md` - local review notes from OpenClaw docs.

## Operating Mode

- Plain Telegram text is queued as agent work.
- `/chat <message>` and `/ask <message>` are direct LLM replies that do not create tasks.
- The runtime sends a plain-language activity report every `REPORT_INTERVAL_MINUTES` minutes.
- Self-improvement can run continuously when enabled, but it skips work while runtime is paused.

## Next Engineering Steps

1. Add Telegram approval flow for blocked commands.
2. Add loop detection for repeated no-progress tool calls.
3. Add GitHub workflow: branch, changes, tests, secret scan, commit, push.
4. Add real media ingestion: voice transcription, image/document extraction.
5. Add backup job for agent config/memory/state.
6. Install as a systemd user service after owner approval.
