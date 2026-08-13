import * as vscode from "vscode";
import { Lane, laneLabels, ProjectIssue, PullRequest } from "../model/types";
import { reconcileByKey } from "../model/reconcile";

export type BoardNode = LaneNode | IssueNode | PullRequestNode | MessageNode;

export interface LaneNode {
  readonly kind: "lane";
  readonly lane: Lane;
  readonly issues: readonly IssueNode[];
}

export interface IssueNode {
  readonly kind: "issue";
  issue: ProjectIssue;
  sameRepository: boolean;
}

export interface PullRequestNode {
  readonly kind: "pullRequest";
  readonly pullRequest: PullRequest;
}

export interface MessageNode {
  readonly kind: "message";
  readonly message: string;
}

export class BoardProvider implements vscode.TreeDataProvider<BoardNode> {
  private readonly changed = new vscode.EventEmitter<BoardNode | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private issues: readonly IssueNode[] = [];
  private message = "";
  private welcome = true;

  setIssues(issues: readonly IssueNode[]): void {
    this.reconcileIssues(issues);
    this.message = "";
    this.welcome = false;
  }

  reconcileProject(projectId: string, issues: readonly IssueNode[]): void {
    this.reconcileIssues([
      ...this.issues.filter(node => node.issue.projectId !== projectId),
      ...issues
    ]);
    this.message = "";
    this.welcome = false;
  }

  updateIssue(updated: ProjectIssue): void {
    const node = this.issues.find(candidate =>
      candidate.issue.projectItemId === updated.projectItemId
    );
    if (!node) return;
    const laneChanged = node.issue.lane !== updated.lane;
    node.issue = updated;
    this.changed.fire(laneChanged ? undefined : node);
  }

  setMessage(message: string): void {
    this.issues = [];
    this.message = message;
    this.welcome = false;
    this.changed.fire();
  }

  setWelcome(): void {
    this.issues = [];
    this.message = "";
    this.welcome = true;
    this.changed.fire();
  }

  refresh(): void {
    this.changed.fire();
  }

  private reconcileIssues(next: readonly IssueNode[]): void {
    let laneChanged = false;
    const reconciled = reconcileByKey(this.issues, next, node => node.issue.projectItemId, (existing, candidate) => {
      if (existing.issue.lane !== candidate.issue.lane) laneChanged = true;
      existing.issue = candidate.issue;
      existing.sameRepository = candidate.sameRepository;
      this.changed.fire(existing);
    });
    this.issues = reconciled.values;
    if (reconciled.structureChanged || laneChanged) this.changed.fire();
  }

  getTreeItem(node: BoardNode): vscode.TreeItem {
    switch (node.kind) {
      case "lane": {
        const item = new vscode.TreeItem(
          laneLabels[node.lane],
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = `lane:${node.lane}`;
        item.description = String(node.issues.length);
        item.iconPath = new vscode.ThemeIcon(laneIcon(node.lane));
        item.contextValue = "lane";
        return item;
      }
      case "issue": {
        const { issue } = node;
        const item = new vscode.TreeItem(
          `#${issue.number} ${issue.title}`,
          issue.pullRequests.length
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );
        item.id = `issue:${issue.projectItemId}`;
        const pullRequestSummary = issue.pullRequests.length
          ? ` · ${issue.pullRequests.map(pr => `PR #${pr.number} ${pr.isDraft ? "Draft" : formatState(pr.state)}`).join(", ")}`
          : "";
        item.description = `${issue.repository.owner}/${issue.repository.name} · ${issue.projectTitle}${pullRequestSummary}`;
        item.tooltip = issueTooltip(issue);
        item.iconPath = new vscode.ThemeIcon("issues");
        item.command = {
          command: "githubAssignedIssues.openInWeb",
          title: "Open in Web",
          arguments: [node]
        };
        item.contextValue = [
          "issue",
          issue.lane,
          node.sameRepository ? "sameRepo" : "differentRepo",
          issue.pullRequests.length ? "hasPr" : "noPr"
        ].join("-");
        return item;
      }
      case "pullRequest": {
        const pr = node.pullRequest;
        const item = new vscode.TreeItem(`#${pr.number} ${pr.title}`);
        item.id = `pr:${pr.url}`;
        item.description = `${pr.isDraft ? "Draft · " : ""}${formatState(pr.state)}`;
        item.iconPath = new vscode.ThemeIcon(pr.state === "MERGED" ? "git-merge" : "git-pull-request");
        item.command = {
          command: "vscode.open",
          title: "Open PR in Web",
          arguments: [vscode.Uri.parse(pr.url)]
        };
        item.contextValue = "pullRequest";
        return item;
      }
      case "message":
        return new vscode.TreeItem(node.message);
    }
  }

  getChildren(node?: BoardNode): BoardNode[] {
    if (!node) {
      if (this.welcome) {
        return [];
      }
      if (this.message) {
        return [{ kind: "message", message: this.message }];
      }
      return (["todo", "inProgress", "inReview"] as const).map(lane => ({
        kind: "lane",
        lane,
        issues: this.issues.filter(issue => issue.issue.lane === lane)
      }));
    }
    if (node.kind === "lane") {
      return [...node.issues];
    }
    if (node.kind === "issue") {
      return node.issue.pullRequests.map(pullRequest => ({ kind: "pullRequest", pullRequest }));
    }
    return [];
  }
}

function laneIcon(lane: Lane): string {
  switch (lane) {
    case "todo": return "circle-outline";
    case "inProgress": return "play-circle";
    case "inReview": return "eye";
  }
}

function formatState(state: PullRequest["state"]): string {
  return state[0] + state.slice(1).toLocaleLowerCase();
}

function issueTooltip(issue: ProjectIssue): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown(`**${issue.repository.owner}/${issue.repository.name}#${issue.number}**  \n`);
  tooltip.appendText(issue.title);
  tooltip.appendMarkdown(`  \nProject: ${issue.projectTitle} · Status: ${issue.status}`);
  if (issue.pullRequests.length) {
    tooltip.appendMarkdown(`  \nPull requests: ${issue.pullRequests.length}`);
  }
  return tooltip;
}
