import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "./storage/fs.js";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type AgentTask = {
  id: string;
  text: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
};

type TaskFile = {
  activeTaskId?: string;
  tasks: AgentTask[];
};

const emptyTaskFile: TaskFile = {
  tasks: [],
};

export class TaskQueue {
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async enqueue(text: string): Promise<AgentTask> {
    return this.withLock(async () => {
      const file = await this.read();
      const now = new Date().toISOString();
      const task: AgentTask = {
        id: randomUUID(),
        text,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      file.tasks.push(task);
      await this.write(file);
      return task;
    });
  }

  async next(): Promise<AgentTask | undefined> {
    const file = await this.read();
    return file.tasks.find((task) => task.status === "queued");
  }

  async get(id: string): Promise<AgentTask | undefined> {
    const file = await this.read();
    return file.tasks.find((task) => task.id === id);
  }

  async mark(id: string, status: TaskStatus, patch: Partial<AgentTask> = {}): Promise<AgentTask> {
    return this.withLock(async () => {
      const file = await this.read();
      const task = file.tasks.find((item) => item.id === id);
      if (!task) {
        throw new Error(`Task not found: ${id}`);
      }
      Object.assign(task, patch, { status, updatedAt: new Date().toISOString() });
      file.activeTaskId = status === "running" ? id : undefined;
      await this.write(file);
      return task;
    });
  }

  async stopActive(): Promise<AgentTask | undefined> {
    return this.withLock(async () => {
      const file = await this.read();
      const active = file.tasks.find((task) => task.id === file.activeTaskId);
      if (!active) {
        return undefined;
      }
      active.status = "stopped";
      active.updatedAt = new Date().toISOString();
      file.activeTaskId = undefined;
      await this.write(file);
      return active;
    });
  }

  async status(): Promise<string> {
    const file = await this.read();
    const running = file.tasks.filter((task) => task.status === "running").length;
    const queued = file.tasks.filter((task) => task.status === "queued").length;
    const completed = file.tasks.filter((task) => task.status === "completed").length;
    const failed = file.tasks.filter((task) => task.status === "failed").length;
    return `Tasks: ${running} running, ${queued} queued, ${completed} done, ${failed} failed`;
  }

  async hasPendingWork(): Promise<boolean> {
    const file = await this.read();
    return file.tasks.some((task) => task.status === "running" || task.status === "queued");
  }

  async recoverRunning(reason = "Recovered after process restart."): Promise<number> {
    return this.withLock(async () => {
      const file = await this.read();
      let count = 0;
      for (const task of file.tasks) {
        if (task.status === "running") {
          task.status = "queued";
          task.updatedAt = new Date().toISOString();
          task.error = reason;
          count += 1;
        }
      }
      file.activeTaskId = undefined;
      if (count > 0) {
        await this.write(file);
      }
      return count;
    });
  }

  private read(): Promise<TaskFile> {
    return readJsonFile(this.filePath, emptyTaskFile);
  }

  private write(file: TaskFile): Promise<void> {
    return writeJsonFile(this.filePath, file);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
