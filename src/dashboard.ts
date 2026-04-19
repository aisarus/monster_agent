import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppConfig } from "./config.js";
import type { AgentRuntime } from "./agent.js";
import type { SelfImprovementScheduler } from "./scheduler.js";
import { readJsonFile, readTextFile } from "./storage/fs.js";
import type { AgentTask, TaskStatus } from "./tasks.js";
import { SkillEvaluator } from "./skills/SkillEvaluator.js";
import { SkillLoader } from "./skills/SkillLoader.js";

type RuntimeFile = {
  paused: boolean;
  reason?: string;
  updatedAt?: string;
};

type TaskFile = {
  activeTaskId?: string;
  tasks: AgentTask[];
};

type BudgetUsage = {
  totalUsd: number;
  byDay: Record<string, number>;
  events: Array<{ at: string; provider: string; model: string; estimatedUsd: number }>;
};

type DashboardDeps = {
  config: AppConfig;
  agent: AgentRuntime;
  scheduler: SelfImprovementScheduler;
  skillLoader: SkillLoader;
  skillEvaluator: SkillEvaluator;
};

const emptyTasks: TaskFile = { tasks: [] };
const emptyRuntime: RuntimeFile = { paused: false };
const emptyBudget: BudgetUsage = { totalUsd: 0, byDay: {}, events: [] };

export function startDashboardServer(deps: DashboardDeps): { close: () => Promise<void>; url: string } {
  const server = createServer((req, res) => {
    void handleRequest(req, res, deps);
  });

  server.listen(deps.config.DASHBOARD_PORT, deps.config.DASHBOARD_HOST);
  const address = server.address() as AddressInfo | null;
  const url = `http://${deps.config.DASHBOARD_HOST}:${address?.port ?? deps.config.DASHBOARD_PORT}`;
  console.log(`Dashboard listening on ${url}`);

  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DashboardDeps,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://dashboard.local");

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      sendHtml(res, dashboardHtml());
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (!isAuthorized(req, deps.config.DASHBOARD_TOKEN)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      sendJson(res, 200, await buildSnapshot(deps.config, deps.scheduler));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      sendJson(res, 200, await readTasks(deps.config.TASKS_FILE));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/skills") {
      sendJson(res, 200, await buildSkills(deps));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readBody<{ text?: string }>(req);
      const text = body.text?.trim();
      if (!text) {
        sendJson(res, 400, { error: "Task text is required." });
        return;
      }
      const task = await deps.agent.enqueue(text.slice(0, 4000));
      deps.agent.kick();
      sendJson(res, 200, { task });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/runtime") {
      const body = await readBody<{ action?: string }>(req);
      const message = await runRuntimeAction(body.action, deps);
      sendJson(res, 200, { message });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message.slice(0, 500) });
  }
}

async function buildSnapshot(config: AppConfig, scheduler: SelfImprovementScheduler) {
  const [runtime, taskFile, budget] = await Promise.all([
    readJsonFile(config.RUNTIME_STATE_FILE, emptyRuntime),
    readJsonFile(config.TASKS_FILE, emptyTasks),
    readJsonFile(config.BUDGET_FILE, emptyBudget),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const tasks = taskFile.tasks;
  const counts = countTasks(tasks);
  const current = tasks.find((task) => task.id === taskFile.activeTaskId);

  return {
    runtime: {
      paused: runtime.paused,
      reason: runtime.reason ?? "none",
      updatedAt: runtime.updatedAt ?? null,
      currentTaskId: current?.id ?? null,
      queueSize: counts.queued,
      autopilot: scheduler.status(),
      defaultProvider: config.DEFAULT_PROVIDER,
    },
    tasks: counts,
    budget: {
      totalUsd: budget.totalUsd,
      todayUsd: budget.byDay[today] ?? 0,
      dailyLimitUsd: config.DAILY_BUDGET_USD,
      monthlyLimitUsd: config.MONTHLY_BUDGET_USD,
      events: budget.events.slice(-10).reverse(),
    },
  };
}

async function buildSkills(deps: DashboardDeps) {
  const [skills, metrics, learnings, errors, featureRequests] = await Promise.all([
    deps.skillLoader.loadAll(),
    deps.skillEvaluator.readMetrics(),
    readTextFile(`${deps.config.LEARNINGS_DIR}/LEARNINGS.md`, ""),
    readTextFile(`${deps.config.LEARNINGS_DIR}/ERRORS.md`, ""),
    readTextFile(`${deps.config.LEARNINGS_DIR}/FEATURE_REQUESTS.md`, ""),
  ]);

  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      version: skill.version,
      description: skill.description,
      eligible: skill.eligible,
      missingRequirements: skill.missingRequirements,
      metrics: metrics.skills[skill.name] ?? null,
    })),
    learnings: {
      learnings: tailMarkdown(learnings),
      errors: tailMarkdown(errors),
      featureRequests: tailMarkdown(featureRequests),
    },
  };
}

async function readTasks(filePath: string): Promise<{ tasks: Array<AgentTask & { dashboardStatus: string }> }> {
  const file = await readJsonFile(filePath, emptyTasks);
  return {
    tasks: file.tasks
      .slice()
      .reverse()
      .map((task) => ({ ...task, dashboardStatus: dashboardStatus(task.status) })),
  };
}

async function runRuntimeAction(action: string | undefined, deps: DashboardDeps): Promise<string> {
  switch (action) {
    case "pause":
      return deps.agent.pause("Paused from dashboard.");
    case "resume":
      return deps.agent.resume();
    case "autopilot_on":
      return deps.scheduler.enable();
    case "autopilot_off":
      return deps.scheduler.disable();
    case "autopilot_run":
      return deps.scheduler.runNow();
    default:
      throw new Error("Unknown runtime action.");
  }
}

function countTasks(tasks: AgentTask[]): Record<TaskStatus, number> {
  return {
    queued: tasks.filter((task) => task.status === "queued").length,
    running: tasks.filter((task) => task.status === "running").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    stopped: tasks.filter((task) => task.status === "stopped").length,
  };
}

function dashboardStatus(status: TaskStatus): string {
  if (status === "completed") return "done";
  return status;
}

function tailMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .slice(-40)
    .join("\n")
    .trim();
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) {
    return true;
  }
  return req.headers.authorization === `Bearer ${token}` || req.headers["x-dashboard-token"] === token;
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Monster Agent Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --ink: #16181d;
      --muted: #667085;
      --line: #d8dde7;
      --primary: #167c80;
      --accent: #7a4f9a;
      --warn: #b35b1e;
      --bad: #b42318;
      --good: #087443;
      --info: #175cd3;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, textarea, input { font: inherit; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 236px 1fr; }
    aside { border-right: 1px solid var(--line); background: #eef3f2; padding: 20px 14px; }
    .brand { display: flex; gap: 10px; align-items: center; margin-bottom: 24px; }
    .mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: var(--primary); color: white; font-weight: 800; }
    nav { display: grid; gap: 6px; }
    nav button { border: 0; border-radius: 8px; background: transparent; color: var(--muted); padding: 10px 12px; text-align: left; cursor: pointer; }
    nav button.active { background: #dce9e7; color: var(--ink); }
    main { min-width: 0; padding: 26px; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 26px; line-height: 1.15; }
    p { line-height: 1.5; }
    .muted { color: var(--muted); }
    .grid { display: grid; gap: 14px; }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .cols { grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); margin-top: 18px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .card h2 { margin: 0 0 12px; font-size: 16px; }
    .stat-label { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .stat-value { margin-top: 8px; font-size: 28px; font-weight: 750; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); }
    .row:first-child { border-top: 0; }
    .task { display: grid; gap: 8px; padding: 12px 0; border-top: 1px solid var(--line); }
    .task:first-child { border-top: 0; }
    .task-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .badge { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; font-size: 12px; text-transform: capitalize; }
    .running { color: var(--info); border-color: #b2ccff; background: #eff4ff; }
    .done, .completed { color: var(--good); border-color: #abefc6; background: #ecfdf3; }
    .failed { color: var(--bad); border-color: #fecdca; background: #fef3f2; }
    .queued { color: var(--warn); border-color: #fedf89; background: #fffaeb; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button.primary { border: 0; border-radius: 8px; padding: 9px 12px; background: var(--primary); color: white; cursor: pointer; }
    button.secondary { border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; background: white; color: var(--ink); cursor: pointer; }
    textarea, input { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: white; color: var(--ink); }
    textarea { min-height: 110px; resize: vertical; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.45; }
    .section { display: none; }
    .section.active { display: block; }
    .error { color: var(--bad); }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      aside { position: sticky; top: 0; z-index: 3; padding: 10px; }
      .brand { margin-bottom: 10px; }
      nav { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      nav button { text-align: center; padding: 8px 6px; }
      main { padding: 16px; }
      .stats, .cols { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand"><div class="mark">M</div><div><strong>Monster Agent</strong><br><span class="muted">Operator console</span></div></div>
      <nav>
        <button data-tab="overview" class="active">Overview</button>
        <button data-tab="tasks">Tasks</button>
        <button data-tab="runtime">Runtime</button>
        <button data-tab="skills">Skills</button>
      </nav>
    </aside>
    <main>
      <div class="topbar">
        <div><h1 id="title">Overview</h1><p class="muted" id="subtitle">Live queue, budget and runtime state.</p></div>
        <div class="actions"><button class="secondary" id="refresh">Refresh</button><input id="token" type="password" placeholder="Dashboard token" /></div>
      </div>
      <p class="error" id="error"></p>
      <section id="overview" class="section active"></section>
      <section id="tasks" class="section"></section>
      <section id="runtime" class="section"></section>
      <section id="skills" class="section"></section>
    </main>
  </div>
  <script>
    const state = { tab: "overview", snapshot: null, tasks: [], skills: null };
    const title = document.querySelector("#title");
    const subtitle = document.querySelector("#subtitle");
    const error = document.querySelector("#error");
    const token = document.querySelector("#token");
    token.value = localStorage.getItem("monsterDashboardToken") || "";
    token.addEventListener("change", () => localStorage.setItem("monsterDashboardToken", token.value));
    document.querySelector("#refresh").addEventListener("click", () => loadAll());
    document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

    async function api(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (token.value) headers.Authorization = "Bearer " + token.value;
      if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const response = await fetch(path, { ...options, headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      return data;
    }

    async function loadAll() {
      error.textContent = "";
      try {
        const [snapshot, tasks, skills] = await Promise.all([api("/api/snapshot"), api("/api/tasks"), api("/api/skills")]);
        state.snapshot = snapshot;
        state.tasks = tasks.tasks;
        state.skills = skills;
        render();
      } catch (err) {
        error.textContent = err.message;
      }
    }

    function switchTab(tab) {
      state.tab = tab;
      document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      document.querySelectorAll(".section").forEach((s) => s.classList.toggle("active", s.id === tab));
      render();
    }

    function render() {
      if (!state.snapshot) return;
      title.textContent = state.tab[0].toUpperCase() + state.tab.slice(1);
      subtitle.textContent = {
        overview: "Live queue, budget and runtime state.",
        tasks: "Queue new work and inspect recent results.",
        runtime: "Pause, resume and control autopilot.",
        skills: "Reusable workflows, metrics and learning notes."
      }[state.tab];
      renderOverview();
      renderTasks();
      renderRuntime();
      renderSkills();
    }

    function renderOverview() {
      const s = state.snapshot;
      const recent = state.tasks.slice(0, 5);
      document.querySelector("#overview").innerHTML = \`
        <div class="grid stats">
          \${stat("Status", s.runtime.paused ? "Paused" : "Running", s.runtime.reason)}
          \${stat("Queue", String(s.runtime.queueSize), s.tasks.running + " running")}
          \${stat("Today", money(s.budget.todayUsd), "of " + money(s.budget.dailyLimitUsd))}
          \${stat("Total", money(s.budget.totalUsd), "month limit " + money(s.budget.monthlyLimitUsd))}
        </div>
        <div class="grid cols">
          <div class="card"><h2>Recent tasks</h2>\${recent.map(taskHtml).join("") || "<p class='muted'>No tasks yet.</p>"}</div>
          <div class="card"><h2>Heartbeat</h2>
            \${row("Current task", s.runtime.currentTaskId || "idle")}
            \${row("Runtime updated", s.runtime.updatedAt || "never")}
            \${row("Provider", s.runtime.defaultProvider)}
            \${row("Autopilot", escapeHtml(s.runtime.autopilot).replaceAll("\\n", "<br>"))}
          </div>
        </div>\`;
    }

    function renderTasks() {
      document.querySelector("#tasks").innerHTML = \`
        <div class="card"><h2>New task</h2>
          <form id="task-form"><textarea id="task-text" maxlength="4000" placeholder="Describe what the agent should do"></textarea><br><br><button class="primary" type="submit">Queue task</button></form>
        </div>
        <div class="card" style="margin-top:14px"><h2>Tasks</h2>\${state.tasks.map(taskHtml).join("") || "<p class='muted'>No tasks yet.</p>"}</div>\`;
      document.querySelector("#task-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = document.querySelector("#task-text").value.trim();
        if (!text) return;
        await api("/api/tasks", { method: "POST", body: JSON.stringify({ text }) });
        await loadAll();
      });
    }

    function renderRuntime() {
      const s = state.snapshot;
      document.querySelector("#runtime").innerHTML = \`
        <div class="grid cols">
          <div class="card"><h2>Controls</h2><div class="actions">
            <button class="primary" data-action="resume">Resume</button>
            <button class="secondary" data-action="pause">Pause</button>
            <button class="primary" data-action="autopilot_run">Run autopilot</button>
            <button class="secondary" data-action="autopilot_on">Autopilot on</button>
            <button class="secondary" data-action="autopilot_off">Autopilot off</button>
          </div></div>
          <div class="card"><h2>Budget</h2>
            \${row("Today", money(s.budget.todayUsd) + " / " + money(s.budget.dailyLimitUsd))}
            \${row("Total", money(s.budget.totalUsd))}
            \${row("Month limit", money(s.budget.monthlyLimitUsd))}
          </div>
        </div>
        <div class="card" style="margin-top:14px"><h2>Recent spend events</h2>\${s.budget.events.map((e) => row(e.provider + " / " + e.model, money(e.estimatedUsd) + " · " + e.at)).join("") || "<p class='muted'>No spend events.</p>"}</div>\`;
      document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
        await api("/api/runtime", { method: "POST", body: JSON.stringify({ action: button.dataset.action }) });
        await loadAll();
      }));
    }

    function renderSkills() {
      const data = state.skills;
      document.querySelector("#skills").innerHTML = \`
        <div class="grid cols">
          <div class="card"><h2>Skills</h2>\${data.skills.map((skill) => \`
            <div class="task"><div class="task-head"><strong>\${escapeHtml(skill.name)} v\${escapeHtml(skill.version)}</strong><span class="badge \${skill.eligible ? "done" : "failed"}">\${skill.eligible ? "eligible" : "blocked"}</span></div>
            <p class="muted">\${escapeHtml(skill.description)}</p>
            <pre>\${escapeHtml(JSON.stringify(skill.metrics || {}, null, 2))}</pre></div>\`).join("")}</div>
          <div class="card"><h2>Learnings</h2>
            <h3>Errors</h3><pre>\${escapeHtml(data.learnings.errors || "No errors.")}</pre>
            <h3>Feature requests</h3><pre>\${escapeHtml(data.learnings.featureRequests || "No feature requests.")}</pre>
            <h3>Learnings</h3><pre>\${escapeHtml(data.learnings.learnings || "No learnings.")}</pre>
          </div>
        </div>\`;
    }

    function stat(label, value, hint) { return \`<div class="card"><div class="stat-label">\${escapeHtml(label)}</div><div class="stat-value">\${escapeHtml(value)}</div><div class="muted">\${escapeHtml(hint || "")}</div></div>\`; }
    function row(k, v) { return \`<div class="row"><span class="muted">\${escapeHtml(k)}</span><span>\${v}</span></div>\`; }
    function taskHtml(task) { return \`<div class="task"><div class="task-head"><code>\${task.id.slice(0, 8)}</code><span class="badge \${task.dashboardStatus || task.status}">\${task.dashboardStatus || task.status}</span></div><div>\${escapeHtml(task.text)}</div><small class="muted">Updated \${escapeHtml(task.updatedAt)}</small>\${task.result ? "<pre>" + escapeHtml(task.result) + "</pre>" : ""}\${task.error ? "<pre class='error'>" + escapeHtml(task.error) + "</pre>" : ""}</div>\`; }
    function money(value) { return "$" + Number(value || 0).toFixed(4); }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }

    loadAll();
    setInterval(loadAll, 15000);
  </script>
</body>
</html>`;
}
