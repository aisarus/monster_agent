---
name: self-improvement
description: Safely improve Monster Agent itself.
---

Use this when changing the agent runtime.

Rules:

- Do not edit `.env` unless explicitly asked.
- Do not print secrets.
- Keep changes small and reversible.
- Run `npm run typecheck`, `npm test`, and `npm run lint` after changes.
- If a command is blocked by policy, explain the needed approval.
