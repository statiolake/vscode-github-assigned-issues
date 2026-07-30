import { Lane, ProjectConfig } from "./types";

export function laneForStatus(config: ProjectConfig, status: string): Lane | undefined {
  const normalized = status.trim().toLocaleLowerCase();
  for (const lane of ["todo", "inProgress", "inReview"] as const) {
    if (config.statuses[lane].some(value => value.trim().toLocaleLowerCase() === normalized)) {
      return lane;
    }
  }
  return undefined;
}

export function isVisibleInLane(
  lane: Lane,
  assignees: readonly string[],
  viewerLogin: string
): boolean {
  const isAssignedToViewer = assignees.some(login => login.toLocaleLowerCase() === viewerLogin.toLocaleLowerCase());
  if (lane === "inProgress") {
    return isAssignedToViewer;
  }
  return isAssignedToViewer || assignees.length === 0;
}

export function validateProjectConfigs(configs: readonly ProjectConfig[]): string[] {
  const errors: string[] = [];
  configs.forEach((config, index) => {
    const label = `projects[${index}]`;
    if (!config.owner?.trim()) {
      errors.push(`${label}.owner is required`);
    }
    if (config.ownerType !== "organization" && config.ownerType !== "user") {
      errors.push(`${label}.ownerType must be "organization" or "user"`);
    }
    if (!Number.isInteger(config.number) || config.number < 1) {
      errors.push(`${label}.number must be a positive integer`);
    }
    const seen = new Map<string, Lane>();
    for (const lane of ["todo", "inProgress", "inReview"] as const) {
      const statuses = config.statuses?.[lane];
      if (!Array.isArray(statuses) || statuses.length === 0) {
        errors.push(`${label}.statuses.${lane} must contain at least one status`);
        continue;
      }
      for (const status of statuses) {
        const normalized = status.trim().toLocaleLowerCase();
        const previous = seen.get(normalized);
        if (previous && previous !== lane) {
          errors.push(`${label}: status "${status}" is mapped to both ${previous} and ${lane}`);
        }
        seen.set(normalized, lane);
      }
    }
  });
  return errors;
}
