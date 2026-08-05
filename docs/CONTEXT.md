# Subagent Extension

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
