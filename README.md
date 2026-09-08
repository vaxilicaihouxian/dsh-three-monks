# dsh-three-monks

A [dsh](https://github.com/deepseek-ai/deepseek-harness) profile bundle that
keeps the **planner** (root agent) from doing concrete work itself — it only
plans and dispatches. An **executor** child implements each task; a **reviewer**
child does read-only review. The bundle supplies the guard; you pair it with a
one-file preset.

## Install

`dsh plugin add <path>` currently trips pnpm's workspace-root check for a
dependency that lives outside the profile's `packages: [.]` workspace, so
install the bundle by **cloning it and adding it to the profile by hand**.
The repo ships `lib/` (compiled), so no build step is needed.

### 1. Clone the bundle

```sh
git clone https://github.com/vaxilicaihouxian/dsh-three-monks /path/to/dsh-three-monks
```

### 2. Register it as a profile dependency

Edit `~/.dsh/profiles/<name>/package.json` and add `dsh-three-monks` to
`dependencies`:

```json
{
  "dependencies": {
    "dsh-three-monks": "link:/path/to/dsh-three-monks"
  }
}
```

### 3. Register it as a profile bundle

Edit `~/.dsh/profiles/<name>/cordis.patch.yml` and add an insert row:

```yaml
- insert:
    - id: dsh-three-monks
      name: dsh-three-monks
```

### 4. Install

```sh
cd ~/.dsh/profiles/<name> && pnpm install
```

Then restart dsh, start a session, and pick the preset described below. The
bundle's guard (`name: dsh-three-monks`) loads with no extra dependencies.

## Usage (3 files in 2 minutes)

### 1. Create the preset

```sh
mkdir -p ~/.dsh/.agent-presets/three-monks
# then edit the file below
```

### 2. Paste this `agent.cordis.yml`

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

# Tools a delegated executor/reviewer needs (so they can actually work).
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'

# Two delegation tools — one per role. This is where you set each role's model.
- id: delegation
  name: cordis:group
  group: true
  config:
    - id: tool-subagent-executor
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_executor
        # ▼▼▼ FILL IN: a model your provider serves (see "Model config" below)
        agentOptions:
          model: <executor-model-id>
        persona: >-
          You are an executor subagent. Implement exactly the task assigned.

    - id: tool-subagent-reviewer
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_reviewer
        # ▼▼▼ FILL IN: a model your provider serves
        agentOptions:
          model: <reviewer-model-id>
        toolFilter:
          allow: [read, grep, glob]
        persona: >-
          You are a reviewer subagent. Perform READ-ONLY review.

# The guard (from step "Install").
- id: orchestrator-guard
  name: 'dsh-three-monks'
  config:
    forbiddenTools: [bash, pwsh, edit, write, read, grep, glob, read_image]
```

### 3. Start a session, pick the `three-monks` preset, ask it a task

The planner will delegate to `subagent_executor`, then `subagent_reviewer`.

## Model config (the only thing you edit)

Two `agentOptions.model` lines above are all you change. **You do NOT add a
`provider` under `agentOptions`** — a `tool-subagent` child inherits the
parent's provider, so it uses whatever provider the **planner session** is
running on. You only name the **model id** that provider serves.

| What you want | What to write in `agentOptions` |
|---|---|
| Child uses the **exact** parent model | omit `agentOptions` entirely |
| Child uses parent **provider**, different **model** | `model: <id>` (no `provider`) |
| Child uses a **different provider** + model | `provider: <p>` + `model: <id>` |

So you **never need a specific provider installed**. If your deployment's
model catalog exposes a model id, put it here.

> **Reviewer may need `bash`.** The reviewer's `toolFilter` above only allows
> `read`/`grep`/`glob` (read-only). If your review task runs verification
> commands (e.g. `git status`, `git show`, `python3 -m json.tool`), add `bash`
> to `toolFilter.allow` — otherwise the reviewer is blocked with
> `not allowed` / `subagent run failed` and cannot verify the work. The file
> sandbox still prevents it from modifying files.

## How the guard works

`tools/execute` is an around-waterfall. When the calling agent is the **root**
(no `parentSession`) and the tool is on `forbiddenTools`, the handler returns an
`isError` result and never calls `next()` — the tool body never runs. Children
(identified by a present `parentSession`) are never blocked. So `read`/`bash`/
`edit`/`write` in `forbiddenTools` only ever stops the **planner**.

## License

MIT