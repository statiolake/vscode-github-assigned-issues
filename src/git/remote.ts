export function parseGitHubRemote(remote: string): { owner: string; name: string } | undefined {
  const normalized = remote.trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[/:](?<owner>[^/]+)\/(?<name>[^/]+)$/i);
  if (!match?.groups) {
    return undefined;
  }
  return { owner: match.groups.owner, name: match.groups.name };
}
