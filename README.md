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

## Configuration

Add `githubAssignedIssues.projects` to your user or workspace settings:

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
```

Press `F5` in VS Code to launch an Extension Development Host.
