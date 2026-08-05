# Three agent types: researcher, auditor, architect

The subagent extension defines three agent types rather than a single catch-all worker. A catch-all invites skills to reach for it lazily instead of picking the right mode. The three types map to three distinct modes of thinking: **researcher** (fact-finding, no judgment), **auditor** (compliance checking, structured findings), and **architect** (structural analysis and interface design).

**Considered Options:**
- Single `worker` agent for everything — rejected because it obscures the mode of thinking and encourages lazy dispatch.
- Two agents (`researcher` + `architect`) — considered; `auditor` earned its own slot because code-review sub-agents do structured judgment, not open-ended research.
- Four+ agents with a catch-all default — rejected because a default defeats the purpose of specialization.
