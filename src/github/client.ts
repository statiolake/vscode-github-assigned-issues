import * as vscode from "vscode";

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<T> {
  readonly data?: T;
  readonly errors?: readonly GraphQlError[];
}

export class GitHubClient {
  private constructor(
    private readonly token: string,
    readonly viewerLogin: string,
    readonly viewerId: string
  ) {}

  static async create(): Promise<GitHubClient> {
    const session = await vscode.authentication.getSession(
      "github",
      ["read:user", "read:org", "repo", "project", "read:project"],
      { createIfNone: true }
    );
    const bootstrap = new GitHubClient(session.accessToken, "", "");
    const viewer = await bootstrap.graphql<{ viewer: { login: string; id: string } }>(
      "query Viewer { viewer { login id } }"
    );
    return new GitHubClient(session.accessToken, viewer.viewer.login, viewer.viewer.id);
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, variables })
    });
    const result = await response.json() as GraphQlResponse<T>;
    if (!response.ok || result.errors?.length || !result.data) {
      const details = result.errors?.map(error => error.message).join("; ") ?? response.statusText;
      throw new Error(`GitHub GraphQL request failed: ${details}`);
    }
    return result.data;
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${details}`);
    }
    return await response.json() as T;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }
}
