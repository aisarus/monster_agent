const systemCommandPatterns = [
  /\bsudo\b/,
  /\bapt(-get)?\b/,
  /\bsystemctl\b/,
  /\bservice\b/,
  /\bnginx\b/,
  /\bufw\b/,
  /\biptables\b/,
  /\bcrontab\b/,
  /\bdocker\b/,
];

const destructivePatterns = [
  /\brm\s+-[^&|;]*r[^&|;]*/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bmkfs\b/,
  /\bdd\s+/,
  />\s*\/dev\/sd[a-z]/,
];

export type CommandSafety = {
  allowed: boolean;
  reason?: string;
};

export function checkCommandSafety(command: string): CommandSafety {
  if (systemCommandPatterns.some((pattern) => pattern.test(command))) {
    return {
      allowed: false,
      reason: "System-level command requires explicit owner confirmation.",
    };
  }

  if (destructivePatterns.some((pattern) => pattern.test(command))) {
    return {
      allowed: false,
      reason: "Potentially destructive command is blocked.",
    };
  }

  return { allowed: true };
}

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /\d{8,12}:[A-Za-z0-9_-]{30,}/,
  /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
];

export function findPotentialSecrets(text: string): string[] {
  return secretPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}
