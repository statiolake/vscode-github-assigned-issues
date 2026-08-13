import { GitHubClient } from "./client";
import { PullRequest, Repository } from "../model/types";

export async function resolvePullRequestReferences(
  client: GitHubClient,
  references: readonly PullRequestReference[]
): Promise<ReadonlyMap<string, PullRequest>> {
  const unique = [...new Map(references.map(reference => [referenceKey(reference), reference])).values()];
  const result = new Map<string, PullRequest>();
  for (let offset = 0; offset < unique.length; offset += 50) {
    const batch = unique.slice(offset, offset + 50);
    const selections = batch.map((_, index) => `
      resource${index}: resource(url: $url${index}) {
        ... on PullRequest {
          id number title url state isDraft headRefName
          headRepositoryOwner { login }
          repository { name url defaultBranchRef { name } }
        }
      }
    `).join("\n");
    const declarations = batch.map((_, index) => `$url${index}: URI!`).join(", ");
    const variables = Object.fromEntries(batch.map((reference, index) => [
      `url${index}`,
      `https://github.com/${reference.owner}/${reference.repository}/pull/${reference.number}`
    ]));
    const data = await client.graphql<Record<string, GraphQlPullRequest | null>>(
      `query PullRequestReferences(${declarations}) { ${selections} }`,
      variables
    );
    batch.forEach((reference, index) => {
      const pullRequest = data[`resource${index}`];
      if (pullRequest) {
        result.set(referenceKey(reference), fromGraphQl(pullRequest));
      }
    });
  }
  return result;
}

export interface PullRequestReference {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}

interface GraphQlPullRequest {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly headRepositoryOwner: { readonly login: string } | null;
  readonly repository: {
    readonly name: string;
    readonly url: string;
    readonly defaultBranchRef: { readonly name: string } | null;
  };
}

export function referenceKey(reference: PullRequestReference): string {
  return `${reference.owner.toLocaleLowerCase()}/${reference.repository.toLocaleLowerCase()}#${reference.number}`;
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

function fromGraphQl(pullRequest: GraphQlPullRequest): PullRequest {
  const url = new URL(pullRequest.repository.url);
  const owner = url.pathname.split("/").filter(Boolean)[0];
  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    headRefName: pullRequest.headRefName,
    headRepositoryOwner: pullRequest.headRepositoryOwner?.login ?? owner,
    repository: {
      owner,
      name: pullRequest.repository.name,
      defaultBranch: pullRequest.repository.defaultBranchRef?.name ?? "main",
      cloneUrl: `${pullRequest.repository.url}.git`
    }
  };
}
