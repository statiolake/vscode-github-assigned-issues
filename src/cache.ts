import * as vscode from "vscode";
import { LoadedProject } from "./github/projects";
import { ProjectConfig } from "./model/types";

const cacheKey = "githubAssignedIssues.projectSnapshot.v2";

interface StoredProject extends Omit<LoadedProject, "statusOptions"> {
  readonly statusOptions: readonly (readonly [string, string])[];
}

interface StoredSnapshot {
  readonly configKey: string;
  readonly viewerLogin: string;
  readonly savedAt: number;
  readonly projects: readonly StoredProject[];
}

export interface ProjectSnapshot {
  readonly viewerLogin: string;
  readonly savedAt: number;
  readonly projects: readonly LoadedProject[];
}

export class ProjectCache {
  constructor(private readonly state: vscode.Memento) {}

  load(configs: readonly ProjectConfig[]): ProjectSnapshot | undefined {
    const stored = this.state.get<StoredSnapshot>(cacheKey);
    if (!stored || stored.configKey !== projectConfigKey(configs)) return undefined;
    return {
      viewerLogin: stored.viewerLogin,
      savedAt: stored.savedAt,
      projects: stored.projects.map(project => ({
        ...project,
        statusOptions: new Map(project.statusOptions)
      }))
    };
  }

  async save(configs: readonly ProjectConfig[], viewerLogin: string, projects: readonly LoadedProject[]): Promise<void> {
    await this.state.update(cacheKey, {
      configKey: projectConfigKey(configs),
      viewerLogin,
      savedAt: Date.now(),
      projects: projects.map(project => ({
        ...project,
        statusOptions: [...project.statusOptions.entries()]
      }))
    } satisfies StoredSnapshot);
  }

  async clear(): Promise<void> {
    await this.state.update(cacheKey, undefined);
  }
}

export function projectConfigKey(configs: readonly ProjectConfig[]): string {
  return JSON.stringify(configs.map(config => ({
    owner: config.owner.toLocaleLowerCase(),
    ownerType: config.ownerType,
    number: config.number,
    statuses: config.statuses
  })));
}
