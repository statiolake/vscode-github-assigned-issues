import { GitHubClient } from "./client";
import { laneForStatus, isVisibleInLane } from "../model/workflow";
import { Lane, ProjectConfig, ProjectIssue, PullRequest, Repository } from "../model/types";
import { collectPullRequestReferences } from "./pullRequests";

interface ProjectPage {
  readonly title: string;
  readonly id: string;
  readonly field: {
    readonly id: string;
    readonly options: readonly { id: string; name: string }[];
  } | null;
  readonly items: {
    readonly pageInfo: { hasNextPage: boolean; endCursor: string | null };
    readonly nodes: readonly ProjectItemNode[];
  };
}

interface ProjectItemNode {
  readonly id: string;
  readonly status: { name: string } | null;
  readonly content: null | {
    readonly __typename: string;
    readonly id: string;
    readonly number: number;
    readonly title: string;
    readonly body: string;
    readonly url: string;
    readonly assignees: { nodes: readonly { login: string }[] };
    readonly repository: {
      readonly name: string;
      readonly url: string;
      readonly defaultBranchRef: { name: string } | null;
    };
    readonly closedByPullRequestsReferences: {
      readonly nodes: readonly PullRequestNode[];
    };
  };
}

interface PullRequestNode {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly headRepositoryOwner: { login: string } | null;
  readonly repository: {
    readonly name: string;
    readonly url: string;
    readonly defaultBranchRef: { name: string } | null;
  };
}

const projectQuery = `
  query ProjectItems($owner: String!, $number: Int!, $cursor: String) {
    OWNER(login: $owner) {
      projectV2(number: $number) {
        id
        title
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            content {
              __typename
              ... on Issue {
                id number title body url
                assignees(first: 20) { nodes { login } }
                repository {
                  name url
                  defaultBranchRef { name }
                }
                closedByPullRequestsReferences(first: 20) {
                  nodes {
                    id number title url state isDraft headRefName
                    headRepositoryOwner { login }
                    repository {
                      name url
                      defaultBranchRef { name }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export interface LoadedProject {
  readonly id: string;
  readonly title: string;
  readonly statusFieldId: string;
  readonly statusOptions: ReadonlyMap<string, string>;
  readonly destinationOptionIds: Readonly<Partial<Record<Lane, string>>>;
  readonly issues: readonly ProjectIssue[];
}

export async function loadProject(
  client: GitHubClient,
  config: ProjectConfig
): Promise<LoadedProject> {
  let cursor: string | null = null;
  let metadata: ProjectPage | undefined;
  const nodes: ProjectItemNode[] = [];
  do {
    const query = projectQuery.replace("OWNER", config.ownerType);
    const data: {
      organization?: { projectV2: ProjectPage | null };
      user?: { projectV2: ProjectPage | null };
    } = await client.graphql(query, { owner: config.owner, number: config.number, cursor });
    const project: ProjectPage | null = data[config.ownerType]?.projectV2 ?? null;
    if (!project) {
      throw new Error(`Project ${config.owner}/${config.number} was not found`);
    }
    metadata = project;
    nodes.push(...project.items.nodes);
    cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (cursor);

  if (!metadata?.field) {
    throw new Error(`Project ${config.owner}/${config.number} has no single-select Status field`);
  }

  const issues = await Promise.all(nodes.map(async (node): Promise<ProjectIssue | undefined> => {
    const content = node.content;
    if (!content || content.__typename !== "Issue" || !node.status) {
      return undefined;
    }
    const lane = laneForStatus(config, node.status.name);
    const assignees = content.assignees.nodes.map(user => user.login);
    if (!lane || !isVisibleInLane(lane, assignees, client.viewerLogin)) {
      return undefined;
    }
    const repository = toRepository(content.repository);
    const linked = content.closedByPullRequestsReferences.nodes.map(toPullRequest);
    const referenced = await collectPullRequestReferences(client, content.body, repository, linked);
    return {
      id: content.id,
      projectItemId: node.id,
      projectId: metadata!.id,
      projectTitle: metadata!.title,
      statusFieldId: metadata!.field!.id,
      status: node.status.name,
      lane,
      number: content.number,
      title: content.title,
      body: content.body,
      url: content.url,
      repository,
      assigneeLogins: assignees,
      pullRequests: referenced
    };
  }));

  return {
    id: metadata.id,
    title: metadata.title,
    statusFieldId: metadata.field.id,
    statusOptions: new Map(metadata.field.options.map(option => [option.name.toLocaleLowerCase(), option.id])),
    destinationOptionIds: Object.fromEntries(
      (["todo", "inProgress", "inReview"] as const).flatMap(lane => {
        const destination = config.statuses[lane]
          .map(name => metadata!.field!.options.find(option =>
            option.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          ))
          .find(option => option !== undefined);
        return destination ? [[lane, destination.id]] : [];
      })
    ),
    issues: issues.filter((issue): issue is ProjectIssue => issue !== undefined)
  };
}

export async function updateIssueStatus(
  client: GitHubClient,
  issue: ProjectIssue,
  optionId: string
): Promise<void> {
  await client.graphql(`
    mutation UpdateStatus($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project
        itemId: $item
        fieldId: $field
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }
  `, {
    project: issue.projectId,
    item: issue.projectItemId,
    field: issue.statusFieldId,
    option: optionId
  });
}

export async function assignViewer(client: GitHubClient, issue: ProjectIssue): Promise<void> {
  if (issue.assigneeLogins.some(login => login.toLocaleLowerCase() === client.viewerLogin.toLocaleLowerCase())) {
    return;
  }
  await client.graphql(`
    mutation Assign($issue: ID!, $viewer: ID!) {
      addAssigneesToAssignable(input: { assignableId: $issue, assigneeIds: [$viewer] }) {
        assignable { ... on Issue { id } }
      }
    }
  `, { issue: issue.id, viewer: client.viewerId });
}

function toRepository(repository: PullRequestNode["repository"]): Repository {
  const url = new URL(repository.url);
  const owner = url.pathname.split("/").filter(Boolean)[0];
  return {
    owner,
    name: repository.name,
    defaultBranch: repository.defaultBranchRef?.name ?? "main",
    cloneUrl: `${repository.url}.git`
  };
}

function toPullRequest(node: PullRequestNode): PullRequest {
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    isDraft: node.isDraft,
    headRefName: node.headRefName,
    headRepositoryOwner: node.headRepositoryOwner?.login ?? toRepository(node.repository).owner,
    repository: toRepository(node.repository)
  };
}
