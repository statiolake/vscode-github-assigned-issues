export type Lane = "todo" | "inProgress" | "inReview";

export interface StatusMapping {
  readonly todo: readonly string[];
  readonly inProgress: readonly string[];
  readonly inReview: readonly string[];
}

export interface ProjectConfig {
  readonly owner: string;
  readonly ownerType: "organization" | "user";
  readonly number: number;
  readonly statuses: StatusMapping;
}

export interface PullRequest {
  readonly id?: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly headRepositoryOwner: string;
  readonly repository: Repository;
}

export interface Repository {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly cloneUrl: string;
}

export interface ProjectIssue {
  readonly id: string;
  readonly projectItemId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly statusFieldId: string;
  readonly status: string;
  readonly lane: Lane;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly repository: Repository;
  readonly assigneeLogins: readonly string[];
  readonly pullRequests: readonly PullRequest[];
}

export const laneLabels: Readonly<Record<Lane, string>> = {
  todo: "To Do",
  inProgress: "In Progress",
  inReview: "In Review"
};
