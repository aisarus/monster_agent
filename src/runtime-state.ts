import { readJsonFile, writeJsonFile } from "./storage/fs.js";

type RuntimeStateFile = {
  paused: boolean;
  reason?: string;
  updatedAt?: string;
};

const defaultState: RuntimeStateFile = {
  paused: false,
};

export class RuntimeState {
  constructor(private readonly filePath: string) {}

  async isPaused(): Promise<boolean> {
    return (await this.read()).paused;
  }

  async pause(reason = "Paused by owner."): Promise<string> {
    await this.write({
      paused: true,
      reason,
      updatedAt: new Date().toISOString(),
    });
    return "Runtime paused. New tasks will queue but not run.";
  }

  async resume(): Promise<string> {
    await this.write({
      paused: false,
      reason: "Resumed by owner.",
      updatedAt: new Date().toISOString(),
    });
    return "Runtime resumed.";
  }

  async status(): Promise<string> {
    const state = await this.read();
    return [
      `Runtime: ${state.paused ? "paused" : "running"}`,
      `Reason: ${state.reason ?? "none"}`,
      `Updated: ${state.updatedAt ?? "never"}`,
    ].join("\n");
  }

  private read(): Promise<RuntimeStateFile> {
    return readJsonFile(this.filePath, defaultState);
  }

  private write(state: RuntimeStateFile): Promise<void> {
    return writeJsonFile(this.filePath, state);
  }
}
