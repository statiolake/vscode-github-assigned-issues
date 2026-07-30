import { GitHubClient } from "./client";
import { PullRequest, Repository } from "../model/types";

interface RestPullRequest {
  readonly id: number;
  readonly node_id: string;
  readonly number: number;
  readonly title: string;
  readonly html_url: string;
  readonly state: "open" | "closed";
  readonly draft: boolean;
  readonly merged_at: string | null;
  readonly head: {
    readonly ref: string;
    readonly repo: { readonly owner: { login: string } } | null;
  };
  readonly base: {
    readonly repo: {
      readonly name: string;
      readonly owner: { readonly login: string };
      readonly clone_url: string;
      readonly default_branch: string;
    };
  };
}

export async function collectPullRequestReferences(
  client: GitHubClient,
  body: string,
  issueRepository: Repository,
  linked: readonly PullRequest[]
): Promise<readonly PullRequest[]> {
  const result = new Map<string, PullRequest>();
  for (const pullRequest of linked) {
    result.set(pullRequest.url, pullRequest);
  }

  const references = parseClosingPullRequestReferences(body, issueRepository);
  await Promise.all(references.map(async reference => {
    const key = `https://github.com/${reference.owner}/${reference.repository}/pull/${reference.number}`;
    if (result.has(key)) {
      return;
    }
    try {
      const pullRequest = await client.rest<RestPullRequest>(
        "GET",
        `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repository)}/pulls/${reference.number}`
      );
      result.set(pullRequest.html_url, fromRest(pullRequest));
    } catch {
      // A closing reference can point to an issue. Only actual pull requests belong here.
    }
  }));
  return [...result.values()];
}

export interface PullRequestReference {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}

export function parseClosingPullRequestReferences(
  body: string,
  repository: Repository
): PullRequestReference[] {
  const references: PullRequestReference[] = [];
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))?#(?<number>\d+)\b/giu;
  for (const match of body.matchAll(pattern)) {
    references.push({
      owner: match.groups?.owner ?? repository.owner,
      repository: match.groups?.repo ?? repository.name,
      number: Number(match.groups?.number)
    });
  }
  return references;
}

function fromRest(pullRequest: RestPullRequest): PullRequest {
  return {
    id: pullRequest.node_id,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.html_url,
    state: pullRequest.merged_at ? "MERGED" : pullRequest.state.toUpperCase() as "OPEN" | "CLOSED",
    isDraft: pullRequest.draft,
    headRefName: pullRequest.head.ref,
    headRepositoryOwner: pullRequest.head.repo?.owner.login ?? pullRequest.base.repo.owner.login,
    repository: {
      owner: pullRequest.base.repo.owner.login,
      name: pullRequest.base.repo.name,
      defaultBranch: pullRequest.base.repo.default_branch,
      cloneUrl: pullRequest.base.repo.clone_url
    }
  };
}
