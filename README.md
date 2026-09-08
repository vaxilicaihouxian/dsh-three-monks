# dsh-three-monks

A [dsh](https://github.com/deepseek-ai/deepseek-harness) profile bundle that
keeps the **planner** (root agent) from doing concrete work itself — it only
plans and dispatches. An **executor** child implements each task; a **reviewer**
child does read-only review. The bundle supplies the guard; you pair it with a
two-file preset.

## Install

`dsh plugin add <path>` trips pnpm's workspace-root check for a dependency
outside the profile's `packages: [.]` workspace, so install by **cloning and
adding it by hand**. The repo ships `lib/` (compiled) — no build step.

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

### 3. Make it resolvable from the installed harness

A preset's bare plugin name (`name: dsh-three-monks`) resolves from the
**installed harness**'s package base (`agentCtx.baseUrl`), not the profile's
`node_modules`. So the bundle must be reachable from the harness's
`node_modules`. For a source checkout (a git clone of dsh), symlink it:

```sh
ln -s /path/to/dsh-three-monks /path/to/deepseek-harness/node_modules/dsh-three-monks
```

(For an npm-installed dsh, place the bundle in that installation's
`node_modules` instead.)

### 4. Install

```sh
cd ~/.dsh/profiles/<name> && pnpm install
```

Then restart dsh.

## Usage (3 files in 2 minutes)

### 1. Create the preset directory

```sh
mkdir -p ~/.dsh/.agent-presets/three-monks
```

### 2. Create `preset.yml`

The roster needs display metadata; **without it the preset is not listed as
selectable** (picking it silently falls back to the default):

```yaml
name: three-monks（规划者 + 执行 + 审查）
description: 三分工编排：主 agent 只规划与派发，executor 子 agent 按计划实现，reviewer 子 agent 只读审查。
order: 200
```

### 3. Create `agent.cordis.yml`

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
# NOTE: `tool-fs-search` REQUIRES `sampleOverCapGlobResults` — without it the
# preset fails to mount and silently falls back to the default.
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false
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
        # ▼▼▼ FILL IN: a model your provider serves (see "Model config" below).
        #     To force a provider (instead of inheriting the parent's), add a
        #     `provider:` line above `model:`.
        agentOptions:
          model: <executor-model-id>
        persona: >-
          You are an executor subagent. Implement exactly the task assigned.

    - id: tool-subagent-reviewer
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_reviewer
        # ▼▼▼ FILL IN: a model your provider serves (see "Model config" below).
        agentOptions:
          model: <reviewer-model-id>
        toolFilter:
          allow: [read, grep, glob, bash]
        persona: >-
          You are a reviewer subagent. Perform READ-ONLY review.
          You may use bash only for read-only commands such as git status,
          git show, git diff, and python-based inspection.
          Never modify files.

# The guard (from Install step 1).
- id: orchestrator-guard
  name: 'dsh-three-monks'
  config:
    forbiddenTools: [bash, pwsh, edit, write, read, grep, glob, read_image]
```

### 4. Start a session

Restart dsh, start a new session, pick the **`three-monks`** preset. The planner
delegates to `subagent_executor`, then `subagent_reviewer`.

## Model config (the only thing you edit)

Two `agentOptions` blocks are all you change. Each holds the **model id** that
role runs on. The **provider** is optional:

- **Omit `provider`** → the child inherits the **parent's** provider. Common
  case: the child uses whichever provider the **planner session** runs on, so
  you only name the model. But the model must exist on the planner's provider.
- **Add `provider: <name>`** → the child uses **that** provider explicitly.
  Safest when the executor/reviewer should be on a provider different from the
  planner's.

The safest, most explicit form:

```yaml
agentOptions:
  provider: <your-provider-name>   # a route id from your settings (e.g. oneapi, openai)
  model: <model-id>                # a model that provider serves
```

| What you want | What to write in `agentOptions` |
|---|---|
| Child uses the **exact** parent route | omit `agentOptions` entirely |
| Child uses parent **provider**, different **model** | `model: <id>` (no `provider`) |
| Child uses a **specific provider** + model (safest) | `provider: <p>` + `model: <id>` |

`provider` is a route id from your dsh settings (`llm-pi-ai.providers.*`);
`model` is one of that provider's `models` ids.

> **Reviewer uses `bash` for read-only verification.** The reviewer's
> `toolFilter.allow` above includes `bash` so it can run read-only verification
> commands (`git status`, `git show`, `python3 -m json.tool`, etc.) to check the
> executor's work. The persona and the file sandbox keep it from modifying
> files. If you do not want the reviewer to run any command, drop `bash` from
> `toolFilter.allow` (but then it cannot verify with git/python).

## Troubleshooting

- **Preset silently falls back to the default (standard) mode.** Usually a
  missing required config. The common one: `tool-fs-search` needs
  `config: { sampleOverCapGlobResults: false }` (see above). Other causes: the
  preset has no `preset.yml` (so it is not listed), or `dsh-three-monks` is not
  resolvable from the harness (see Install step 3).
- **`dsh plugin add <path>` fails with `ADDING_TO_ROOT`.** A dsh CLI limitation
  for a dependency outside the profile's `packages: [.]` workspace. Use the
  manual install above.
- **`Cannot read properties of undefined (reading 'forbiddenTools')`.** An older
  bundle. Fetch the latest — `apply()` now tolerates an absent `config`.

## How the guard works

`tools/execute` is an around-waterfall. When the calling agent is the **root**
(no `parentSession`) and the tool is on `forbiddenTools`, the handler returns an
`isError` result and never calls `next()` — the tool body never runs. Children
(identified by a present `parentSession`) are never blocked. So `read`/`bash`/
`edit`/`write` in `forbiddenTools` only ever stops the **planner**.

## License

MIT