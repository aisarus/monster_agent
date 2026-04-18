# MEMORY.md

Long-term facts:

- The agent runs on an Ubuntu cloud VM.
- Current resources: 2 vCPU, 4 GB RAM, 80 GB disk.
- Telegram is the primary UI.
- Default useful Gemini models on current key: `gemini-2.5-flash`, `gemini-2.5-flash-lite`.
- OpenAI key currently returns quota errors.
- Build toward an OpenClaw-inspired gateway, but keep MVP small.

Lessons:

- Telegram message length must be capped.
- Queue writes must be serialized and atomic.
- Model errors must be compacted before sending to Telegram.
- Prioritize Gemini models due to persistent OpenAI quota errors.
