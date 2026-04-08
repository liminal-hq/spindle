# Agent Communication Protocol

This directory is the shared filesystem-based communication layer for the Spindle agent team.

It exists to keep inter-agent coordination inspectable, durable, and easy to re-enter from the repository itself.

## Core Model

Spindle uses two communication channels under `docs/agents/shared/`:

- `context/` for one-to-many broadcast state
- `handoffs/` for one-to-one task requests and responses

## The Inbox Rule

Point-to-point communication happens through the target agent's inbox under `handoffs/`.

### Request flow

1. The sending agent creates a JSON payload in the receiving agent's folder.
2. The payload should include enough context for a bounded handoff:
   - sender
   - intended receiver
   - timestamp
   - subject
   - task or question
   - relevant repository paths
   - validation expectation
3. The receiving agent reads the payload, performs the requested work or analysis, and records the result as a JSON payload in the sender's folder.

### Response flow

The response should preserve clear linkage back to the original request, typically by including:

- the original request identifier
- the responder
- the status
- the outcome or findings
- any changed files, evidence, or follow-up recommendations

The goal is not chat. The goal is durable, bounded handoff.

## The Context Rule

Global state lives in `context/`.

Typical examples include:

- the current sprint goal
- shared repository-wide cautions
- active release posture
- project-wide priorities that all agents should honour

All agents must read the broadcast files in `context/` before beginning substantial work when the shared coordination layer is relevant.

Only Franklin and Edward are permitted to write or update files in `context/`.

That write restriction exists to keep the broadcast layer stable, curated, and low-noise.

## Source Control and Visibility

The `handoffs/` directory and other agent-specific dynamic states are intentionally ignored by the repository's `.gitignore` rules.

**CRITICAL RULE:** Agents must NEVER use `git add -f`, `git add --force`, or any other mechanism to force these files into a commit or a pull request.

The handoff system exists for local inter-agent coordination and durable workspace state. It is not part of the shipping application code or the canonical project history. Only broadcast context files in `context/` are intended for source control.

## Folder Layout

```text
docs/agents/shared/
├─ communication-protocol.md
├─ context/
└─ handoffs/
   ├─ franklin/
   ├─ edward/
   ├─ jullian/
   ├─ kyle/
   ├─ tristan/
   └─ nicholas/
```

## Naming Guidance

Prefer filenames that are sortable and self-explanatory.

Suggested pattern:

`YYYY-MM-DDTHH-MM-SSZ-from-<sender>-subject.json`

Examples:

- `2026-04-02T20-15-00Z-from-franklin-release-audit.json`
- `2026-04-02T20-42-00Z-from-kyle-build-review-response.json`

## Payload Guidance

JSON is the default format for handoffs because it is easy to validate, diff, and process mechanically later.

Markdown is the default format for broadcast context because it is easier to read and maintain as shared human-facing state.

## Operating Principle

Keep the system lightweight.

Use the inboxes for bounded requests and replies.
Use the context board for durable shared orientation.
Avoid turning either channel into a diary or a noisy chat log.
