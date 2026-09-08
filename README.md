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
model/persona/tool-filter. Here is the whole flow.

### 1. Install the bundle into a profile

```sh
dsh plugin --profile <name> add dsh-three-monks
```

This registers the `dsh-three-monks` guard (a `tools/execute` handler) on the
profile. It does nothing by itself yet — you still create the roles in a preset.

### 2. Create an agent preset

Make a directory under your user presets and add an `agent.cordis.yml`:

```sh
mkdir -p ~/.dsh/.agent-presets/three-monks
# edit ~/.dsh/.agent-presets/three-monks/agent.cordis.yml
```

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

# The concrete-work tools a delegated executor/reviewer needs.
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'

# The two delegation tools, one per role.
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
          model: <executor-model-id>   # <-- your provider's model id
        persona: >-
          You are an executor subagent. Implement exactly the task assigned.

    - id: tool-subagent-reviewer
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_reviewer
        agentOptions:
          model: <reviewer-model-id>   # <-- your provider's model id
        toolFilter:
          allow: [read, grep, glob]
        persona: >-
          You are a reviewer subagent. Perform READ-ONLY review.

# The guard. `dsh-three-monks` must be installable (see step 1).
- id: orchestrator-guard
  name: 'dsh-three-monks'
  config:
    forbiddenTools: [bash, pwsh, edit, write, read, grep, glob, read_image]
```

### 3. Fill in the model ids

Put a **model id your provider serves** in each `agentOptions.model`. You do
**not** add a `provider` under `agentOptions` — a `tool-subagent` child inherits
the parent's provider, so it uses whichever provider the **planner** session is
already running on. This is the key point:

- Omit `agentOptions.provider` (or the whole `agentOptions`) → the child uses
  the **parent's** provider and model.
- Set only `agentOptions.model` → the child uses the **parent's** provider with
  **that** model.
- Set `agentOptions.provider` + `agentOptions.model` → the child uses **that**
  provider with **that** model (only if you deliberately want a different
  provider than the parent).

So you never need a specific provider (e.g. `oneapi`) installed. If your
deployment's model catalog exposes an id, put it here.

### 4. Start a session on the preset

New session → pick the **`three-monks`** preset. The planner (root) is guarded;
`subagent_executor` and `subagent_reviewer` appear as tools. Ask the planner to
do a task and it will delegate to the executor, then the reviewer.

### How the per-role model resolves

The child's provider/model come from `agentOptions` **overlaid on the parent's
route** (see `subagent-in-process-driver` / `resolveChildAgentOptions`). This is
why you can run the executor and reviewer on different models than the planner
without touching any provider config.

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