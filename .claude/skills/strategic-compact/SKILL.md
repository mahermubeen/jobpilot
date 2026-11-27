---
name: strategic-compact
description: Decide when to run /compact at a task boundary instead of waiting for auto-compaction. Use when a session is long, a phase just finished (research, planning, a fix), or work is switching to an unrelated task.
---

<!-- Adapted from affaan-m/ECC skills/strategic-compact (MIT). -->

# Strategic compact

Compact at a boundary between phases, not in the middle of one. Before compacting, write anything you still need into a file: the plan, the open steps, the file paths you are working in. A file survives compaction; your reasoning in the conversation does not.

| Moment | Compact? | Why |
|---|---|---|
| Research done, plan written to a file | Yes | The reading is bulky; the plan is the distilled result |
| Plan done, about to code | Yes | Free room for the code you will read and write |
| Feature done and committed, next task unrelated | Yes, or `/clear` | Nothing from the old task is needed |
| Debugging done | Yes | Stack traces and dead ends only add noise |
| A failed approach | Yes | Drop the dead-end reasoning before trying again |
| Mid-implementation | No | You lose file paths, names and partial state |
| Tests failing on code you just wrote | No | You need that code in view |

What survives: CLAUDE.md and AGENTS.md, files on disk, memory files, git state. What is lost: file contents you read earlier, intermediate reasoning, preferences the user stated only in chat (save those to memory first).

Use a focus note: `/compact Next: wire cacheUpTo into draftFollowUp; plan in <path>`.

Between unrelated tasks, `/clear` is cheaper than `/compact`: it costs nothing and starts clean.
