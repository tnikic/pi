# Tool-owned session lifecycle capture

The session-hook extension delegates session-end capture to individual tools rather than generically recording pi session activity. Each tool declares its own `session_end_command`; the extension runs these at `session_shutdown` and stores their output as per-tool session memory. We chose this over extension-owned capture because the extension has no semantic understanding of what each tool considers meaningful — anvil knows which issues were referenced and PRs touched, but generic bash history or file-touch tracking does not carry that meaning.

**Considered Options:**
- Extension-owned capture recording pi-internal events (bash commands, files edited, tool calls) — rejected because it produces noisy, low-signal data. The hook knows *what* the agent did, but not *why* or *what mattered* to each tool.
- Tool-owned capture — each tool ships its own `session_end_command` that emits tool-specific deltas. The extension is a dumb runner and storage layer.
