---
name: implement
description: "Implement work from a spec or issue. Picks the next unblocked issue when none is given."
disable-model-invocation: true
---

Implement the work in the given issue, or pick the next unblocked one.

## 1. Pick the work

If the user passed a spec or issue, use it directly. Read its full body. If it's empty or a vague one-liner with no clear spec, warn and ask whether to proceed anyway. If the user confirms, skip to step 2. If the user says no, fall through to the query path below.

Otherwise, query open issues:

1. Unassigned and unblocked — sort by priority then age.
2. If none, assigned to @me and unblocked.

Read the full body of each candidate. Skip any whose body is empty or a vague one-liner with no clear spec.

Present the shortlist with a recommendation for the top candidate, including a one-line summary from the body:

> Three unblocked issues are open. I recommend #42 — Fix login timeout: adds a lockout after 3 failed attempts.
> - #42 Fix login timeout: adds a lockout after 3 failed attempts (priority: high)
> - #57 Add rate limiting: token-bucket rate limiter on API routes (priority: medium)
>
> Work on #42?

For assigned-to-you issues, preface with:

> No unassigned issues. These are assigned to you — already in progress, or should I take one?

Assign the issue to @me to claim it.

*Completion: an issue with a clear spec is confirmed and assigned.*

## 2. Implement

Use TDD at pre-agreed seams. Run typechecking and single test files as you go. Run the full test suite once at the end.

*Completion: every spec requirement is implemented and all tests pass.*

## 3. Review, fix, and check acceptance criteria

Run code-review against the spec. Fix clear-cut findings directly — naming, duplication, lint-like smells. For architectural judgement calls — Feature Envy, Shotgun Surgery, Divergent Change — pause and present them for approval with a recommendation.

If the review comes back clean, report it briefly.

### 3a. Check acceptance criteria

Read the issue body and all comments for unchecked boxes (`- [ ]` or `* [ ]`). For each, judge whether the implementation satisfied it. Presume satisfied unless you know a criterion was skipped, blocked, or impossible.

For each satisfied criterion, replace `- [ ]` with `- [x]` and update the issue body with `update_issue`. For checkboxes found in comments, post a comment listing which criteria were satisfied. Leave unsatisfied criteria unchecked.

If any criterion is unsatisfied, report which ones and why to the user. Offer to create follow-up tickets using `create_issue`, following the same template structure as `to-tickets` (`## What to build`, `## Acceptance criteria`, `## Blocked by`). Apply the same labels as the current issue. Parent each follow-up to the current issue's parent (if it has one); otherwise create it standalone. Add a comment on the current issue linking each follow-up.

If neither the issue body nor comments contain any checkboxes, skip this step.

*Completion: every satisfied criterion checked off in the issue body; unsatisfied criteria reported to the user with follow-up tickets offered.*

## 4. Commit, push, and close

Create a single commit. Instruct conventional-commits to include `Closes #N` as a footer (N is the issue number from step 1). Amend an earlier commit if one was already made.

Push: `git push -u origin HEAD`. If the push fails, report the failure and stop — do not close the issue.

Verify closure: poll the issue state every 3 seconds, up to 3 attempts. If the issue is now closed, stop. If still open after 3 attempts, close it manually with `update_issue(state: "closed")`.

*Completion: one commit pushed, issue closed.*

## 5. Parent check

If the closed issue has a `parent`, list the parent's sub-issues. When all are closed, tell the user: "All sub-issues of #<parent> are closed. Close it as well?" The user confirms or declines. If confirmed and that parent itself has a parent, recurse.

*Completion: parent closure offered where applicable; user decision handled.*

When a parent `kind:spec` is closed, remind the user: "The spec is closed. Consider running `/update-docs` to bring the README up to date with everything that shipped."
