# OpenClaw Lessons For Monster Agent

Source review date: 2026-04-17.

This file captures ideas to copy or adapt from OpenClaw without blindly cloning its full scope.
The goal is a small, cheap Telegram-first agent that can grow toward a local-first gateway.

## What To Steal First

### 1. Gateway As The Long-Lived Control Plane

OpenClaw treats the gateway as the daemon that owns channels, sessions, tools, health, events,
and clients. We should copy the pattern, not the full protocol yet.

For us:

- keep one long-running `monster-agent` process;
- put Telegram, queue, task state, tools, model router, memory, and heartbeat behind one runtime;
- later expose the same runtime through Web UI or CLI instead of duplicating logic per interface;
- keep Telegram as a client/channel, not the whole product.

Near-term implementation:

- rename internal concepts toward `GatewayRuntime` or `AgentGateway` later;
- add a `/health`-style internal status object;
- add explicit lifecycle events: task accepted, started, tool started, tool ended, completed, failed.

### 2. Workspace Bootstrap Files

OpenClaw uses concise workspace files such as `AGENTS.md`, `SOUL.md`, `USER.md`,
`TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md`. This is better than one growing mega-prompt.

For us:

- keep `.env` and secrets out of workspace memory;
- use Markdown files as stable Obsidian-readable context;
- inject only concise bootstrap files every task;
- read larger memory files on demand.

Recommended local layout:

```text
data/workspace/
  AGENTS.md
  SOUL.md
  USER.md
  TOOLS.md
  HEARTBEAT.md
  MEMORY.md
  memory/YYYY-MM-DD.md
  skills/<skill>/SKILL.md
```

MVP adaptation:

- keep current `data/memory/AGENT_MEMORY.md`;
- add bootstrap files next;
- cap injected memory aggressively to reduce tokens.

### 3. Tools, Skills, Plugins Are Separate Layers

OpenClaw separates:

- tools: typed functions the model can call;
- skills: Markdown instructions teaching when/how to use tools;
- plugins: packaged integrations that register tools, skills, channels, providers, or hooks.

For us:

- tools already exist as `ToolRegistry`;
- next add `skills/` with `SKILL.md` files;
- postpone full plugin packaging until we have stable tools and two or three real skills.

Immediate skills to add:

- `coding-task`: inspect repo, plan, edit, test, report;
- `self-improvement`: change this agent safely;
- `telegram-ops`: keep replies short, handle stop/status, avoid spam;
- `model-routing`: choose cheap fallback first and summarize provider failures.

### 4. Queue Modes And Session Lanes

OpenClaw serializes runs per session and caps global concurrency. It also distinguishes queue
modes such as collect, followup, steer, and interrupt.

For us:

- keep one active task for MVP;
- add debounce/collect for rapid Telegram messages;
- add `/queue` later only if needed;
- add “steer current task” later for instructions like “stop doing that, do X”.

Important fix we already learned:

- never let multiple Telegram updates write task state concurrently.

### 5. Model Failover With Cooldowns

OpenClaw does not blindly retry every model. It tracks rate limits, billing failures,
overloaded models, cooldowns, and model-scoped failures.

For us:

- keep current model fallback chain;
- add provider/model cooldown state to avoid hammering overloaded/quota-limited models;
- classify failures into `rate_limit`, `overloaded`, `billing`, `auth`, `model_not_found`,
  `context_overflow`, and `unknown`;
- do not retry billing/quota failures aggressively;
- report compact user-facing fallback summaries.

Near-term config shape:

```json
{
  "models": {
    "primary": "gemini/gemini-2.5-flash",
    "fallbacks": ["gemini/gemini-2.5-flash-lite"],
    "cooldowns": {
      "rateLimitMs": 60000,
      "overloadedMs": 15000,
      "billingMs": 86400000
    }
  }
}
```

### 6. Exec Approvals, Not Just Regex Blocking

OpenClaw has layered exec policy: tool policy, approval policy, allowlist, safe bins,
and strict inline eval handling.

For us:

- current regex blocking is only a temporary guard;
- add explicit command policy:
  - `deny`: never run;
  - `ask`: require Telegram approval;
  - `allow`: run;
- store pending approvals with exact command, cwd, createdAt, and taskId;
- bind approval to the exact command so the agent cannot change it after approval;
- keep `sudo`, package installs, firewall, nginx, systemd, cron in `ask`;
- keep destructive commands in `deny`.

### 7. Loop Detection

OpenClaw can detect repeated tool calls that do not make progress.

For us:

- track last N tool calls per task;
- stop if the same tool+args fails repeatedly;
- stop if output is unchanged for repeated calls;
- return a short failure instead of burning tokens.

Default MVP thresholds:

- warn after 3 repeated identical tool calls;
- stop after 5;
- global hard cap already exists via `MAX_AGENT_STEPS`.

### 8. Subagents Should Be Push-Based

OpenClaw subagents finish asynchronously and announce back. The main agent should not poll.

For us:

- do not implement parallel subagents first;
- implement role-specific one-shot child runs later;
- child run returns one compact result to parent;
- max two child runs at once;
- cheap model for subagents, stronger model only for main or hard tasks.

### 9. Reply Shaping And Chunking

OpenClaw separates final payload shaping, chunking, preview streaming, and duplicate suppression.

For us:

- current short replies are good;
- add channel-safe chunking helper as a shared module;
- send progress only when useful, not every internal step;
- do not send raw model/tool errors to Telegram.

### 10. Doctor Command

OpenClaw repeatedly points operators to `openclaw doctor`. We need our own equivalent.

For us:

- add `/doctor`;
- check `.env` completeness;
- check model smoke status;
- check workspace writability;
- check git repo status;
- check task file JSON validity;
- check memory file exists;
- check production dependencies audit;
- report concise pass/warn/fail.

## Adoption Order

1. Add Telegram approval flow for blocked commands.
2. Add loop detection.
3. Add git workflow tools: init/status/branch/diff/commit/push.
4. Add web search and browser tools.
5. Add real subagent runs.
6. Add daemon/systemd setup after owner approval.

## Non-Goals For Now

- multi-channel inbox;
- WebSocket gateway protocol;
- mobile nodes;
- canvas UI;
- full plugin marketplace;
- nested subagents;
- Docker sandboxing unless we explicitly decide to install Docker.
