# Pi Config

Extensions and configuration for the pi coding agent.

## Subagent Extension

A pi extension that delegates tasks to specialized subagents running in isolated pi processes, supporting single, parallel, and chained execution modes.

## Language

**Subagent**:
A separate `pi` process spawned with a one-shot prompt and an isolated context window. The subagent receives a task, executes it using its own tools, and reports back.
_Avoid_: child process, worker, delegate

**Completion contract**:
The mechanism by which a subagent signals it has finished its task. The contract is enforced via a mandatory `report_done` tool call — if the subagent stops without calling it, the result is treated as incomplete.
_Avoid_: stop signal, done detection, exit condition

**`report_done`**:
The tool that a subagent MUST call as its final action. It carries a `status` (success, partial, or failed), a `summary` of what was accomplished, and optional `findings` (files changed, discoveries). This tool call is the definitive completion signal.
_Avoid_: final message, completion marker, done token

**Agent scope**:
Where agents are discovered from. `user` scope loads from the user's agent directory (`~/.pi/agent/agents/`). `project` scope loads from the nearest `.pi/agents/` directory walking up from the working directory. `both` merges them, with project agents taking precedence.
_Avoid_: agent source, agent location

**Safety caps**:
Per-agent limits that prevent runaway subagents: a tool-level timeout (default 60s), a global process timeout (default 5 minutes), and a maximum turn count (default 20). All three are overridable in the agent's frontmatter.
_Avoid_: guardrails, limits, bounds

**Chain**:
Sequential execution mode where subagents run one after another. Each agent after the first receives the previous agent's output via a `{previous}` placeholder in its task.
_Avoid_: pipeline, sequence, waterfall

**Parallel**:
Concurrent execution mode where multiple subagents run simultaneously with a controlled concurrency limit (max 4 concurrent, 8 total).
_Avoid_: batch, fan-out, concurrent

## Agent Types

**Researcher**:
An agent type for fact-finding and investigation. Researches tools, APIs, documentation, and third-party resources against primary sources. Reports findings without judgment — discovers, does not evaluate.
_Avoid_: worker, investigator, finder

**Auditor**:
An agent type for analysis and judgment. Audits code against standards, specs, or taxonomies. Runs tools (linters, formatters), detects violations and smells, produces structured findings. Distinguishes hard violations from judgment calls.
_Avoid_: reviewer, checker, inspector

**Architect**:
An agent type for structural analysis and design. Walks codebases for architectural friction, detects shallow modules, applies the deep-module vocabulary (module, interface, seam, adapter, depth, leverage, locality). Designs deepened interfaces with trade-off analysis.
_Avoid_: scout, designer, explorer

**Agent definition**:
A markdown file in `~/.pi/agent/agents/` (user) or `.pi/agents/` (project) with YAML frontmatter (`name`, `description`, optional `tools`, `model`, `timeout`, `maxTurns`, `toolTimeout`) and a system prompt body. Discovered by the subagent extension at invocation time.
_Avoid_: agent config, agent spec, agent file

## Session Hook Extension

A pi extension that runs named shell commands at session start and injects their output as ambient context for the agent. Also supports session-end capture for per-project session memory.

### Language

**Session hook**:
A named shell command registered in `session-hook.json` that runs at session start (and optionally at session end). Its output is injected into the agent's context as ambient information.
_Avoid_: startup hook, bootstrap command

**Hook config**:
A JSON file (`session-hook.json`) containing an array of hook entries, each with a `name`, `command`, and optional `timeout`, `managed_by`, and `session_end_command`. Stored globally at `~/.pi/agent/session-hook.json` or per-project at `.pi/session-hook.json`.
_Avoid_: hook registry, hook manifest

**Managed-by marker**:
The `managed_by` field on a hook entry that identifies which tool owns it. Tools use this to idempotently update their own hooks without clobbering hooks owned by other tools or the user.
_Avoid_: owner field, source tag

**Ambient context**:
Context injected into the agent's session at startup without the agent having to invoke a tool. The agent sees it as given, not as the result of an action it took.
_Avoid_: preloaded context, bootstrap context

**Session-end command**:
A tool-specific command declared via `session_end_command` on a hook entry. Runs at `session_shutdown` to capture what happened (issues referenced, PRs touched, etc.). Output is stored as session memory and surfaced inline in the next session's hook output.
_Avoid_: shutdown hook, teardown command, capture script

**Session memory**:
Per-tool, per-project data captured by session-end commands and stored in `session-hook/memory.json`. Surfaced as a compact "last session:" line in the tool's session-start output block so the next session inherits awareness of what happened previously.
_Avoid_: session history, session delta, context carryover
