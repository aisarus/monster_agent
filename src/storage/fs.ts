import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function readTextFile(filePath: string, fallback = ""): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  const raw = await readTextFile(filePath);
  if (!raw.trim()) {
    return fallback;
  }
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
