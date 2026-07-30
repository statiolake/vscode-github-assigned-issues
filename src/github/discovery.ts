import { GitHubClient } from "./client";
import { Lane, StatusMapping } from "../model/types";

export interface ProjectOwner {
  readonly login: string;
  readonly type: "organization" | "user";
}

export interface ProjectSummary {
  readonly number: number;
  readonly title: string;
  readonly shortDescription: string;
  readonly statusOptions: readonly string[];
}

export async function listProjectOwners(client: GitHubClient): Promise<readonly ProjectOwner[]> {
  const result = await client.graphql<{
    viewer: {
      login: string;
      organizations: {
        nodes: readonly { login: string }[];
      };
    };
  }>(`
    query ProjectOwners {
      viewer {
        login
        organizations(first: 100) {
          nodes { login }
        }
      }
    }
  `);
  return [
    { login: result.viewer.login, type: "user" },
    ...result.viewer.organizations.nodes.map(organization => ({
      login: organization.login,
      type: "organization" as const
    }))
  ];
}

export async function listProjects(
  client: GitHubClient,
  owner: ProjectOwner
): Promise<readonly ProjectSummary[]> {
  const query = `
    query Projects($login: String!, $cursor: String) {
      OWNER(login: $login) {
        projectsV2(first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            shortDescription
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                options { name }
              }
            }
          }
        }
      }
    }
  `.replace("OWNER", owner.type);

  const projects: ProjectSummary[] = [];
  let cursor: string | null = null;
  do {
    const result: {
      organization?: ProjectConnection;
      user?: ProjectConnection;
    } = await client.graphql(query, { login: owner.login, cursor });
    const connection: ProjectConnection["projectsV2"] | undefined = result[owner.type]?.projectsV2;
    if (!connection) {
      break;
    }
    projects.push(...connection.nodes.map(project => ({
      number: project.number,
      title: project.title,
      shortDescription: project.shortDescription ?? "",
      statusOptions: project.field?.options.map(option => option.name) ?? []
    })));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return projects;
}

interface ProjectConnection {
  readonly projectsV2: {
    readonly pageInfo: { hasNextPage: boolean; endCursor: string | null };
    readonly nodes: readonly {
      number: number;
      title: string;
      shortDescription: string | null;
      field: { options: readonly { name: string }[] } | null;
    }[];
  };
}

const suggestions: Readonly<Record<Lane, readonly RegExp[]>> = {
  todo: [/^to ?do$/i, /^backlog$/i, /^ready$/i],
  inProgress: [/^in progress$/i, /^doing$/i, /^started$/i],
  inReview: [/^in review$/i, /^review$/i, /^reviewing$/i]
};

export function suggestedStatuses(
  lane: Lane,
  options: readonly string[]
): readonly string[] {
  return options.filter(option => suggestions[lane].some(pattern => pattern.test(option.trim())));
}

export function emptyStatusMapping(): Record<Lane, string[]> {
  return { todo: [], inProgress: [], inReview: [] };
}

export function isCompleteStatusMapping(
  mapping: Partial<StatusMapping>
): mapping is StatusMapping {
  return Boolean(mapping.todo?.length && mapping.inProgress?.length && mapping.inReview?.length);
}
