import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { PullRequest, RepositoryIdentity } from "../model/types";
import { parseGitHubRemote } from "./remote";

const execFileAsync = promisify(execFile);

export class LocalRepository {
  private constructor(
    readonly root: vscode.Uri,
    readonly remoteName: string,
    readonly owner: string,
    readonly name: string
  ) {}

  static async find(repository: RepositoryIdentity): Promise<LocalRepository | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        const root = (await git(folder.uri.fsPath, ["rev-parse", "--show-toplevel"])).trim();
        const remotes = (await git(root, ["remote", "-v"])).split(/\r?\n/);
        for (const line of remotes) {
          const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
          if (!match) {
            continue;
          }
          const identity = parseGitHubRemote(match[2]);
          if (
            identity &&
            identity.owner.toLocaleLowerCase() === repository.owner.toLocaleLowerCase() &&
            identity.name.toLocaleLowerCase() === repository.name.toLocaleLowerCase()
          ) {
            return new LocalRepository(vscode.Uri.file(root), match[1], identity.owner, identity.name);
          }
        }
      } catch {
        // A workspace folder does not have to be a Git repository.
      }
    }
    return undefined;
  }

  async isDirty(): Promise<boolean> {
    return (await this.run(["status", "--porcelain"])).trim().length > 0;
  }

  async currentBranch(): Promise<string> {
    return (await this.run(["branch", "--show-current"])).trim();
  }

  async baseBranches(defaultBranch: string): Promise<readonly string[]> {
    await this.run(["fetch", "--prune", this.remoteName]);
    const output = await this.run([
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      `refs/remotes/${this.remoteName}`
    ]);
    const branches = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
      .filter(value => value !== `${this.remoteName}/HEAD`);
    const preferred = `${this.remoteName}/${defaultBranch}`;
    return [...new Set([preferred, defaultBranch, ...branches].filter(branch => branches.includes(branch)))];
  }

  async createBranch(branch: string, startPoint: string): Promise<void> {
    await this.run(["switch", "-c", branch, startPoint]);
  }

  async checkoutPullRequest(pullRequest: PullRequest): Promise<void> {
    const localBranch = `pr/${pullRequest.number}`;
    await this.run([
      "fetch",
      this.remoteName,
      `pull/${pullRequest.number}/head:refs/heads/${localBranch}`
    ]);
    await this.run(["switch", localBranch]);
  }

  async pushCurrentBranch(): Promise<string> {
    const branch = await this.currentBranch();
    if (!branch) {
      throw new Error("Cannot create a pull request from a detached HEAD");
    }
    await this.run(["push", "--set-upstream", this.remoteName, branch]);
    return branch;
  }

  private async run(args: readonly string[]): Promise<string> {
    return await git(this.root.fsPath, args);
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(detail.stderr?.trim() || detail.message);
  }
}
