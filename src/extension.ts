import * as vscode from "vscode";
import { ProjectCache } from "./cache";
import { LocalRepository } from "./git/repository";
import { GitHubClient } from "./github/client";
import { assignViewer, loadProject, LoadedProject, updateIssueStatus } from "./github/projects";
import { ProjectConfig, ProjectIssue, PullRequest } from "./model/types";
import { validateProjectConfigs } from "./model/workflow";
import { isFresh } from "./model/cachePolicy";
import { registerProject } from "./projectRegistration";
import { BoardProvider, IssueNode } from "./view/board";

class ExtensionController implements vscode.Disposable {
  private readonly board = new BoardProvider();
  private readonly disposables: vscode.Disposable[] = [];
  private client: GitHubClient | undefined;
  private projects = new Map<string, LoadedProject>();
  private readonly cache: ProjectCache;
  private refreshPromise: Promise<void> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.cache = new ProjectCache(context.globalState);
    this.disposables.push(
      vscode.window.registerTreeDataProvider("githubAssignedIssues.board", this.board),
      vscode.commands.registerCommand("githubAssignedIssues.refresh", () => this.refresh(true)),
      vscode.commands.registerCommand(
        "githubAssignedIssues.registerProject",
        () => this.runCommand(async () => registerProject(await this.getClient()))
      ),
      vscode.commands.registerCommand("githubAssignedIssues.openInWeb", (node: IssueNode) => this.openInWeb(node)),
      vscode.commands.registerCommand("githubAssignedIssues.checkout", (node: IssueNode) => this.checkout(node)),
      vscode.commands.registerCommand("githubAssignedIssues.addressIssue", (node: IssueNode) => this.addressIssue(node)),
      vscode.commands.registerCommand("githubAssignedIssues.passToReview", (node: IssueNode) => this.passToReview(node)),
      vscode.commands.registerCommand("githubAssignedIssues.openPullRequest", (node: IssueNode) => this.openPullRequest(node)),
      vscode.commands.registerCommand("githubAssignedIssues.addressIssueUnavailable", () => this.showDifferentRepository()),
      vscode.commands.registerCommand("githubAssignedIssues.passToReviewUnavailable", () => this.showDifferentRepository()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("githubAssignedIssues.projects")) {
          void this.cache.clear().then(() => this.refresh(true));
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.renderProjects([...this.projects.values()]))
    );
  }

  async initialize(): Promise<void> {
    await this.refresh(false);
  }

  dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
  }

  private async refresh(force: boolean): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh(force).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async performRefresh(force: boolean): Promise<void> {
    const configs = getProjectConfigs();
    const errors = validateProjectConfigs(configs);
    if (errors.length) {
      this.board.setMessage("Invalid project configuration. See the notification for details.");
      void vscode.window.showErrorMessage(`GitHub Assigned Issues: ${errors.join("; ")}`);
      return;
    }
    if (!configs.length) {
      this.projects.clear();
      await this.cache.clear();
      this.board.setWelcome();
      return;
    }

    const cached = this.cache.load(configs);
    if (cached) {
      await this.renderProjects(cached.projects);
      if (!force && isFresh(cached, getRefreshIntervalMinutes())) return;
    } else if (this.projects.size === 0) {
      this.board.setMessage("Loading GitHub Projects…");
    }
    try {
      this.client ??= await GitHubClient.create();
      const results = await Promise.allSettled(configs.map(async config => {
        const project = await loadProject(this.client!, config);
        await this.renderProject(project);
        return project;
      }));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length === results.length && !cached && this.projects.size === 0) {
        this.board.setMessage("Unable to load GitHub Projects.");
      }
      if (failures.length) {
        void vscode.window.showErrorMessage(
          `GitHub Assigned Issues: ${failures.map(result => errorMessage(result.reason)).join("; ")}`
        );
      }
      if (this.projects.size) {
        await this.cache.save(configs, this.client.viewerLogin, [...this.projects.values()]);
      }
    } catch (error) {
      if (!cached && this.projects.size === 0) this.board.setMessage("Unable to load GitHub Projects.");
      void vscode.window.showErrorMessage(`GitHub Assigned Issues: ${errorMessage(error)}`);
    }
  }

  private async renderProjects(projects: readonly LoadedProject[]): Promise<void> {
    this.projects = new Map(projects.map(project => [project.id, project]));
    const issues = projects.flatMap(project => project.issues);
    const localMatches = await Promise.all(issues.map(issue => LocalRepository.find(issue.repository)));
    this.board.setIssues(issues.map((issue, index) => ({
      kind: "issue",
      issue,
      sameRepository: localMatches[index] !== undefined
    })));
  }

  private async renderProject(project: LoadedProject): Promise<void> {
    this.projects.set(project.id, project);
    const localMatches = await Promise.all(project.issues.map(issue => LocalRepository.find(issue.repository)));
    this.board.reconcileProject(project.id, project.issues.map((issue, index) => ({
      kind: "issue",
      issue,
      sameRepository: localMatches[index] !== undefined
    })));
  }

  private async openInWeb(node: IssueNode): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(node.issue.url));
  }

  private async checkout(node: IssueNode): Promise<void> {
    await this.runCommand(async () => {
      const pullRequest = await pickPullRequest(node.issue.pullRequests, "Select a pull request to check out");
      if (!pullRequest) {
        return;
      }
      const repository = await LocalRepository.find(pullRequest.repository);
      if (!repository) {
        throw new Error(`Open ${pullRequest.repository.owner}/${pullRequest.repository.name} in this VS Code window first`);
      }
      if (await repository.isDirty()) {
        throw new Error("The working tree has uncommitted changes. Commit or stash them before checkout.");
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Checking out PR #${pullRequest.number}` },
        () => repository.checkoutPullRequest(pullRequest)
      );
      void vscode.window.showInformationMessage(`Checked out PR #${pullRequest.number} as pr/${pullRequest.number}`);
    });
  }

  private async addressIssue(node: IssueNode): Promise<void> {
    await this.runCommand(async () => {
      const client = await this.getClient();
      const issue = node.issue;
      const repository = await requireLocalRepository(issue);
      if (await repository.isDirty()) {
        throw new Error("The working tree has uncommitted changes. Commit or stash them before addressing this issue.");
      }

      const branches = await repository.baseBranches(issue.repository.defaultBranch);
      const base = await vscode.window.showQuickPick(branches, {
        title: `Address #${issue.number}`,
        placeHolder: "Select the branch to start from"
      });
      if (!base) {
        return;
      }

      const prefix = `feature/#${issue.number}-`;
      const branch = await vscode.window.showInputBox({
        title: `Address #${issue.number}`,
        prompt: "Enter the new feature branch name",
        value: prefix,
        valueSelection: [prefix.length, prefix.length],
        validateInput: validateBranchName
      });
      if (!branch) {
        return;
      }

      await repository.createBranch(branch, base);
      try {
        await Promise.all([
          assignViewer(client, issue),
          this.moveToLane(issue, "inProgress")
        ]);
      } catch (error) {
        throw new Error(`Branch "${branch}" was created, but GitHub could not be updated: ${errorMessage(error)}`);
      }
      void vscode.window.showInformationMessage(`Created ${branch}, assigned #${issue.number}, and moved it to In Progress.`);
      await this.applyLocalWorkflowChange(issue, "inProgress", client.viewerLogin);
    });
  }

  private async passToReview(node: IssueNode): Promise<void> {
    await this.runCommand(async () => {
      const client = await this.getClient();
      const issue = node.issue;
      const repository = await requireLocalRepository(issue);
      if (await repository.isDirty()) {
        throw new Error("The working tree has uncommitted changes. Commit them before creating a pull request.");
      }
      const branch = await repository.currentBranch();
      if (!branch) {
        throw new Error("Cannot create a pull request from a detached HEAD");
      }
      if (branch === issue.repository.defaultBranch) {
        throw new Error(`Switch to a feature branch before creating a pull request from ${branch}`);
      }

      const head = `${repository.owner}:${branch}`;
      const existing = await client.rest<RestPullRequest[]>(
        "GET",
        `/repos/${encodeURIComponent(issue.repository.owner)}/${encodeURIComponent(issue.repository.name)}/pulls?state=open&head=${encodeURIComponent(head)}`
      );
      let pullRequest: RestPullRequest;
      if (existing[0]) {
        pullRequest = existing[0];
      } else {
        await repository.pushCurrentBranch();
        pullRequest = await client.rest<RestPullRequest>(
          "POST",
          `/repos/${encodeURIComponent(issue.repository.owner)}/${encodeURIComponent(issue.repository.name)}/pulls`,
          {
            title: issue.title,
            head,
            base: issue.repository.defaultBranch,
            body: `Closes #${issue.number}`,
            draft: true
          }
        );
      }

      await this.moveToLane(issue, "inReview");
      void vscode.window.showInformationMessage(
        `Draft PR #${pullRequest.number} is ready and the issue was moved to In Review.`,
        "Open PR"
      ).then(selection => {
        if (selection === "Open PR") {
          void vscode.env.openExternal(vscode.Uri.parse(pullRequest.html_url));
        }
      });
      await this.applyLocalWorkflowChange(issue, "inReview", client.viewerLogin, toPullRequest(pullRequest, issue));
    });
  }

  private async openPullRequest(node: IssueNode): Promise<void> {
    const pullRequest = await pickPullRequest(node.issue.pullRequests, "Select a pull request to open");
    if (pullRequest) {
      await vscode.env.openExternal(vscode.Uri.parse(pullRequest.url));
    }
  }

  private async moveToLane(issue: ProjectIssue, lane: "inProgress" | "inReview"): Promise<void> {
    const optionId = this.projects.get(issue.projectId)?.destinationOptionIds[lane];
    if (!optionId) {
      throw new Error(`The configured ${lane} status does not exist in project "${issue.projectTitle}"`);
    }
    await updateIssueStatus(await this.getClient(), issue, optionId);
  }

  private async applyLocalWorkflowChange(
    issue: ProjectIssue,
    lane: "inProgress" | "inReview",
    viewerLogin: string,
    pullRequest?: PullRequest
  ): Promise<void> {
    const project = this.projects.get(issue.projectId);
    if (!project) return;
    const updated: ProjectIssue = {
      ...issue,
      lane,
      status: project.destinationStatusNames[lane] ?? issue.status,
      pullRequests: pullRequest
        ? [...new Map([...issue.pullRequests, pullRequest].map(candidate => [candidate.url, candidate])).values()]
        : issue.pullRequests,
      assigneeLogins: issue.assigneeLogins.some(login =>
        login.toLocaleLowerCase() === viewerLogin.toLocaleLowerCase()
      ) ? issue.assigneeLogins : [...issue.assigneeLogins, viewerLogin]
    };
    const updatedProject = {
      ...project,
      issues: project.issues.map(candidate => candidate.id === issue.id ? updated : candidate)
    };
    this.projects.set(project.id, updatedProject);
    this.board.updateIssue(updated);
    await this.cache.save(getProjectConfigs(), viewerLogin, [...this.projects.values()]);
  }

  private async getClient(): Promise<GitHubClient> {
    this.client ??= await GitHubClient.create();
    return this.client;
  }

  private showDifferentRepository(): void {
    void vscode.window.showInformationMessage("This action is unavailable because the issue belongs to a different repository.");
  }

  private async runCommand(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      void vscode.window.showErrorMessage(`GitHub Assigned Issues: ${errorMessage(error)}`);
    }
  }
}

interface RestPullRequest {
  readonly number: number;
  readonly title: string;
  readonly html_url: string;
  readonly state: "open" | "closed";
  readonly draft: boolean;
  readonly merged_at: string | null;
}

function toPullRequest(pullRequest: RestPullRequest, issue: ProjectIssue): PullRequest {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.html_url,
    state: pullRequest.merged_at ? "MERGED" : pullRequest.state.toUpperCase() as "OPEN" | "CLOSED",
    isDraft: pullRequest.draft,
    repository: issue.repository
  };
}

function getProjectConfigs(): readonly ProjectConfig[] {
  return vscode.workspace.getConfiguration("githubAssignedIssues")
    .get<readonly ProjectConfig[]>("projects", []);
}

function getRefreshIntervalMinutes(): number {
  return vscode.workspace.getConfiguration("githubAssignedIssues")
    .get<number>("refreshIntervalMinutes", 5);
}

async function requireLocalRepository(issue: ProjectIssue): Promise<LocalRepository> {
  const repository = await LocalRepository.find(issue.repository);
  if (!repository) {
    throw new Error(`Open ${issue.repository.owner}/${issue.repository.name} in this VS Code window to use this action`);
  }
  return repository;
}

async function pickPullRequest(
  pullRequests: readonly PullRequest[],
  title: string
): Promise<PullRequest | undefined> {
  if (pullRequests.length === 0) {
    void vscode.window.showInformationMessage("No linked pull request was found.");
    return undefined;
  }
  if (pullRequests.length === 1) {
    return pullRequests[0];
  }
  const selected = await vscode.window.showQuickPick(
    pullRequests.map(pullRequest => ({
      label: `#${pullRequest.number} ${pullRequest.title}`,
      description: `${pullRequest.isDraft ? "Draft · " : ""}${pullRequest.state}`,
      pullRequest
    })),
    { title }
  );
  return selected?.pullRequest;
}

function validateBranchName(value: string): string | undefined {
  if (!value.trim()) {
    return "A branch name is required";
  }
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("@{") ||
    /[\s~^:?*\\[\]]/.test(value)
  ) {
    return "Enter a valid Git branch name";
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new ExtensionController(context);
  context.subscriptions.push(controller);
  void controller.initialize();
}

export function deactivate(): void {}
