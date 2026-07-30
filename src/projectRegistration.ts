import * as vscode from "vscode";
import { GitHubClient } from "./github/client";
import {
  emptyStatusMapping,
  listProjectOwners,
  listProjects,
  suggestedStatuses
} from "./github/discovery";
import type { ProjectOwner, ProjectSummary } from "./github/discovery";
import type { ProjectConfig } from "./model/types";

export async function registerProject(client: GitHubClient): Promise<void> {
  const owners = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Loading GitHub project owners…" },
    () => listProjectOwners(client)
  );
  const owner = await pickOwner(owners, client.viewerLogin);
  if (!owner) {
    return;
  }

  const projects = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Loading ${owner.login} projects…` },
    () => listProjects(client, owner)
  );
  const project = await pickProject(projects, owner);
  if (!project) {
    return;
  }
  if (!project.statusOptions.length) {
    throw new Error(`Project "${project.title}" has no single-select Status field`);
  }

  const statuses = emptyStatusMapping();
  const used = new Set<string>();
  for (const lane of ["todo", "inProgress", "inReview"] as const) {
    const selected = await pickStatuses(lane, project.statusOptions, used);
    if (!selected) {
      return;
    }
    statuses[lane].push(...selected);
    selected.forEach(status => used.add(status));
  }

  const target = await pickConfigurationTarget();
  if (!target) {
    return;
  }
  const projectsConfiguration = vscode.workspace.getConfiguration("githubAssignedIssues");
  const current = [...projectsConfiguration.get<readonly ProjectConfig[]>("projects", [])];
  const registered: ProjectConfig = {
    owner: owner.login,
    ownerType: owner.type,
    number: project.number,
    statuses
  };
  const existingIndex = current.findIndex(candidate =>
    candidate.owner.toLocaleLowerCase() === owner.login.toLocaleLowerCase() &&
    candidate.ownerType === owner.type &&
    candidate.number === project.number
  );
  if (existingIndex >= 0) {
    current[existingIndex] = registered;
  } else {
    current.push(registered);
  }
  await projectsConfiguration.update("projects", current, target);
  void vscode.window.showInformationMessage(
    `${existingIndex >= 0 ? "Updated" : "Registered"} project "${project.title}".`
  );
}

async function pickOwner(
  owners: readonly ProjectOwner[],
  viewerLogin: string
): Promise<ProjectOwner | undefined> {
  const selected = await vscode.window.showQuickPick(
    owners.map(owner => ({
      label: owner.login,
      description: owner.type === "user"
        ? owner.login === viewerLogin ? "Your personal projects" : "User"
        : "Organization",
      iconPath: new vscode.ThemeIcon(owner.type === "user" ? "account" : "organization"),
      owner
    })),
    {
      title: "Register GitHub Project · 1/6",
      placeHolder: "Select the project owner"
    }
  );
  return selected?.owner;
}

async function pickProject(
  projects: readonly ProjectSummary[],
  owner: ProjectOwner
): Promise<ProjectSummary | undefined> {
  if (!projects.length) {
    void vscode.window.showInformationMessage(`No accessible Projects were found for ${owner.login}.`);
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(
    projects.map(project => ({
      label: project.title,
      description: `#${project.number}`,
      detail: project.shortDescription || undefined,
      project
    })),
    {
      title: "Register GitHub Project · 2/6",
      placeHolder: `Select a project owned by ${owner.login}`,
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  return selected?.project;
}

async function pickStatuses(
  lane: "todo" | "inProgress" | "inReview",
  options: readonly string[],
  used: ReadonlySet<string>
): Promise<readonly string[] | undefined> {
  const labels = {
    todo: "To Do",
    inProgress: "In Progress",
    inReview: "In Review"
  } as const;
  const steps = { todo: 3, inProgress: 4, inReview: 5 } as const;
  const suggested = new Set(suggestedStatuses(lane, options));
  const available = options.filter(option => !used.has(option));
  const selected = await vscode.window.showQuickPick(
    available.map(status => ({
      label: status,
      picked: suggested.has(status)
    })),
    {
      title: `Register GitHub Project · ${steps[lane]}/6 · Map ${labels[lane]}`,
      placeHolder: `Select one or more statuses for ${labels[lane]}`,
      canPickMany: true
    }
  );
  if (!selected) {
    return undefined;
  }
  if (!selected.length) {
    void vscode.window.showErrorMessage(`Select at least one status for ${labels[lane]}.`);
    return await pickStatuses(lane, options, used);
  }
  return selected.map(item => item.label);
}

async function pickConfigurationTarget(): Promise<vscode.ConfigurationTarget | undefined> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return vscode.ConfigurationTarget.Global;
  }
  const selected = await vscode.window.showQuickPick([
    {
      label: "Workspace Settings",
      description: "Recommended",
      detail: "Register the project only for this workspace",
      target: vscode.ConfigurationTarget.Workspace
    },
    {
      label: "User Settings",
      detail: "Register the project in every VS Code window",
      target: vscode.ConfigurationTarget.Global
    }
  ], {
    title: "Register GitHub Project · 6/6",
    placeHolder: "Choose where to save this project"
  });
  return selected?.target;
}
