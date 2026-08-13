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
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly repository: RepositoryIdentity;
}

export interface RepositoryIdentity {
  readonly owner: string;
  readonly name: string;
}

export interface Repository extends RepositoryIdentity {
  readonly defaultBranch: string;
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
