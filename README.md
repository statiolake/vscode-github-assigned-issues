# GitHub Assigned Issues

A focused VS Code extension for working through issues from one or more GitHub
Projects v2 boards.

## Features

- Three canonical lanes: **To Do**, **In Progress**, and **In Review**
- Per-project mapping from GitHub Project status names to those lanes
- Only issues assigned to you or unassigned issues, according to the lane policy
- Linked and closing-reference pull requests with state and draft indicators
- Issue and pull request web links
- Pull request checkout
- **Address This Issue**: create a branch, assign yourself, and move the item
- **Pass to the Review**: push the branch, open a draft PR, and move the item

## Visibility rules

- **To Do**: issues assigned to you or with no assignees
- **In Progress**: issues assigned to you
- **In Review**: issues assigned to you or with no assignees

Issues assigned only to other people are hidden in every lane.

## Synchronization

The last successful Project snapshot is shown immediately when VS Code starts.
Automatic synchronization reuses snapshots for five minutes by default; change
`githubAssignedIssues.refreshIntervalMinutes` to adjust that window. The
**Refresh** command always requests current data.

Pull requests explicitly linked by GitHub are included in the Project query.
Additional closing references found in issue bodies are resolved in GraphQL
batches instead of one request per issue.

## Configuration

Use **Register Project** on the welcome screen shown in the **My Project
Issues** view. You can also run **GitHub Assigned Issues: Register Project**
from the Command Palette or click the view's **+** button. The guided flow lets
you select:

1. A personal or organization owner
2. An accessible GitHub Project
3. One or more Project statuses for each workflow lane
4. User Settings or Workspace Settings as the destination

Running the command again for an existing project updates its registration.

The extension uses VS Code's built-in GitHub authentication. It requests
`read:org` to list organizations you belong to, Project access to read and
change Project items, and `repo` to work with repository issues and pull
requests. VS Code asks for approval when a required permission has not yet been
granted.

You can also edit `githubAssignedIssues.projects` directly in user or workspace
settings:

```json
{
  "githubAssignedIssues.projects": [
    {
      "owner": "your-organization",
      "ownerType": "organization",
      "number": 1,
      "statuses": {
        "todo": ["Todo", "Backlog"],
        "inProgress": ["In Progress"],
        "inReview": ["In Review"]
      }
    }
  ]
}
```

`number` is the number at the end of a project URL such as
`https://github.com/orgs/your-organization/projects/1`.

The first configured status in `inProgress` and `inReview` is the destination
used by workflow actions.

## Development

```sh
npm install
npm test
npm run package
```

`npm run package` compiles the extension and creates a versioned `.vsix` file
in the repository root.

Press `F5` in VS Code to launch an Extension Development Host.
