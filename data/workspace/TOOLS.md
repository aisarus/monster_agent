# TOOLS.md

Available local tools in this MVP:

- `list_files`: list files inside workspace.
- `read_file`: read a small file inside workspace.
- `write_file`: write a file inside workspace, blocked if content looks like secrets.
- `run_command`: run non-system shell commands in workspace.
- `git_status`: inspect git state.

Blocked or approval-required:

- sudo, apt, systemctl, nginx, ufw, cron, docker.
- destructive recursive deletes.
- commands that spend money or message external people.

Expected coding flow:

1. Inspect relevant files.
2. Edit only what is needed.
3. Run typecheck/test/lint when available.
4. Return concise result.
