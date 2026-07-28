---
name: implement
description: "Implement work from a spec or issue. Picks the next unblocked issue when none is given."
disable-model-invocation: true
---

Implement the work in the given issue, or pick the next unblocked one.

## 1. Pick the work

If the user passed a spec or issue, use it directly and skip to step 2.

Otherwise, query open issues:

1. Unassigned and unblocked — sort by priority then age.
2. If none, assigned to @me and unblocked.

Present the shortlist with a recommendation for the top candidate:

> Three unblocked issues are open. I recommend #42 — Fix login timeout.
> - #42 Fix login timeout (priority: high)
> - #57 Add rate limiting (priority: medium)
> - #63 Update docs (priority: low)
>
> Work on #42?

For assigned-to-you issues, preface with:

> No unassigned issues. These are assigned to you — already in progress, or should I take one?

Once confirmed, check the issue body. If it's empty or a vague one-liner with no clear spec, warn and ask whether to proceed anyway.

*Completion: an issue with a clear spec is confirmed.*

## 2. Implement

Use TDD at pre-agreed seams. Run typechecking and single test files as you go. Run the full test suite once at the end.

*Completion: every spec requirement is implemented and all tests pass.*

## 3. Review and fix

Run code-review against the spec. Fix clear-cut findings directly — naming, duplication, lint-like smells. For architectural judgement calls — Feature Envy, Shotgun Surgery, Divergent Change — pause and present them for approval with a recommendation.

If the review comes back clean, report it briefly and move on.

*Completion: all review findings are resolved.*

## 4. Commit

Create a single commit. The message describes the finished work. Amend an earlier commit if one was already made.

*Completion: one commit on the branch.*
