export type SubagentRole =
  | "researcher"
  | "coder"
  | "reviewer"
  | "tester"
  | "devops"
  | "marketer"
  | "security"
  | "product";

export const roleDescriptions: Record<SubagentRole, string> = {
  researcher: "Find facts, compare options, and summarize tradeoffs.",
  coder: "Implement focused code changes.",
  reviewer: "Find bugs, regressions, missing tests, and unclear assumptions.",
  tester: "Run checks, interpret failures, and propose fixes.",
  devops: "Handle deployment, monitoring, server operations, and reliability.",
  marketer: "Prepare positioning, distribution ideas, and marketing assets.",
  security: "Check secrets, dangerous actions, and budget/risk boundaries.",
  product: "Clarify requirements, scope MVPs, and keep work aligned with goals.",
};

export function selectRoles(taskText: string): SubagentRole[] {
  const text = taskText.toLowerCase();
  const roles = new Set<SubagentRole>(["product"]);

  if (/(код|code|bug|repo|github|test|typescript|python)/i.test(text)) {
    roles.add("coder");
    roles.add("tester");
    roles.add("reviewer");
  }
  if (/(server|deploy|docker|ubuntu|nginx|systemd|monitor|деплой|сервер)/i.test(text)) {
    roles.add("devops");
  }
  if (/(research|найди|исслед|рынок|конкурент|web|internet)/i.test(text)) {
    roles.add("researcher");
  }
  if (/(marketing|маркет|лендинг|продвиж|distribution)/i.test(text)) {
    roles.add("marketer");
  }
  if (/(token|secret|key|безопас|security|деньг|budget)/i.test(text)) {
    roles.add("security");
  }

  return [...roles].slice(0, 2);
}
