# dsh-three-monks

A [dsh](https://github.com/deepseek-ai/deepseek-harness) profile bundle that
hard-enforces one invariant in an orchestrator agent preset: **the root agent
(the planner) never does concrete work itself.**

It pairs with a user-authored `agent.cordis.yml` preset that splits a session
into three roles — a **planner** (root), an **executor** (child), and a
**reviewer** (child). The bundle supplies the hard guard; the preset supplies
the role wiring (which model each role uses, which persona it carries, which
tools it keeps).

| Role | Who | What it does | Guard |
|---|---|---|---|
| **planner** | the root agent | plans and dispatches only | every `forbiddenTools` invocation is blocked |
| **executor** | a child agent | reads the plan and implements | never blocked |
| **reviewer** | a child agent | read-only review | never blocked |

## What the bundle actually does

`dsh-three-monks` registers **one** thing in its `apply()`:

- **A hard `tools/execute` guard.** `tools/execute` is an around-waterfall. When
  the calling agent is the **root** (its session records no `parentSession`) and
  the tool is on the configured `forbiddenTools` denylist, the handler returns an
  `isError` result and **never calls `next()`** — so the tool body never runs.
  A child (identified by a present `parentSession`) is never blocked, so the
  executor and reviewer keep their full tool set.

That is a hard guarantee: even if a tool slides past the preset's `toolFilter`
(which only removes tools from the catalog — soft), the guard returns
`PLANNER_DOES_NOT_EXECUTE` without executing it.

## Install

The bundle declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`,
so it installs into a dsh profile with `dsh plugin`:

```sh
dsh plugin --profile <name> add dsh-three-monks
```

Or directly from git / a local checkout:

```sh
dsh plugin --profile <name> add github:vaxilicaihouxian/dsh-three-monks
```

It must load on top of a host composition that provides the `tools` and
`systemPrompt` services (e.g. `@deepseek-ai/dsh-base`).

## Configuration

The bundle's `cordis.patch.yml` mounts the guard with a `forbiddenTools`
denylist. It is *advisory* by default — adjust it to your deployment's full
write/execute surface:

```yaml
- insert:
    - id: orchestrator-guard
      name: '@dsh-three-monks'          # or the installed package name
      config:
        planDir: .dsh
        enforcePlannerGuard: true
        forbiddenTools:
          - bash
          - pwsh
          - edit
          - write
          - read
          - grep
          - glob
          - read_image
```

### Config reference

| Key | Default | Meaning |
|---|---|---|
| `forbiddenTools` | `[]` | Tool names the planner (root) may not run — hard-blocked. |
| `planDir` | `.dsh` | Directory used to word the planner prompt section. |
| `enforcePlannerGuard` | `true` | Set `false` to disable the guard (bring-up only). |

## Building the three-role preset

The guard alone does not create the roles. You pair it with an
`agent.cordis.yml` preset that registers the delegation tools and the per-role
model/persona/tool-filter. A minimal example:

```yaml
# ~/.dsh/.agent-presets/three-monks/agent.cordis.yml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are the orchestrating planner. You NEVER perform a concrete step
      yourself. Decompose the work, dispatch each task to an executor subagent
      (subagent_executor), and review its output with a reviewer subagent
      (subagent_reviewer). Delegate everything; the guard blocks any tool you
      try to call yourself.

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'

- id: delegation
  name: cordis:group
  group: true
  config:
    - id: tool-subagent-executor
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_executor
        agentOptions:
          model: <your-executor-model>
        persona: >-
          You are an executor subagent. Implement exactly the task assigned.

    - id: tool-subagent-reviewer
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_reviewer
        agentOptions:
          model: <your-reviewer-model>
        toolFilter:
          allow: [read, grep, glob]
        persona: >-
          You are a reviewer subagent. Perform READ-ONLY review.

- id: orchestrator-guard
  name: 'dsh-three-monks'          # the bundle's guard
  config:
    forbiddenTools: [bash, pwsh, edit, write, read, grep, glob, read_image]
```

## How the guard identifies the planner

The guard identifies the planner as the **root** agent — one whose session
records no `parentSession`. A child spawned through the subagent seam records
its parent, so only children are ever treated as non-root. This keeps the guard
from ever blocking an executor or reviewer.

## Development

```sh
pnpm install
pnpm build        # tsc -> lib/ + lib/types
```

The plugin must be loaded in a real dsh harness to run; `tsc --noEmit` covers
type checking. There is no standalone runtime.

## License

MIT