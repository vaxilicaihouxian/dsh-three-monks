/**
 * @dsh-brains/orchestrator — the hard guard behind an orchestrator agent
 * preset. It enforces one invariant: the **root** agent (the planner) never
 * does concrete work itself.
 *
 * A preset composes the planner with delegation tools (e.g. `tool-subagent`
 * instances that start executor/reviewer children) and a `toolFilter` that
 * removes the write/execute surface from the planner's catalog. That layer is
 * soft: the model simply does not see those tools. This plugin is the hard
 * layer. A `tools/execute` waterfall handler returns an `isError` result —
 * without calling `next()`, so the tool body never runs — for every tool on
 * the configured `forbiddenTools` denylist, but only when the calling agent is
 * the **root**. A child agent (one whose session records a `parentSession`)
 * is never blocked, so the executor and reviewer keep their full tool sets.
 *
 * The plugin registers nothing else. Role wiring (which models the executor and
 * reviewer use, which persona each carries, which tools each keeps) lives in
 * the preset's `agent.cordis.yml` via `tool-subagent` instances and the
 * deployment persona.
 *
 * @module @dsh-brains/orchestrator
 */
/** Cordis plugin name used by loader diagnostics. */
export const name = 'orchestrator';
/** The core service this plugin reads and the seam it wraps. */
export const inject = ['tools', 'systemPrompt'];
/**
 * The error `code` this guard stamps on a blocked planner call, so a retry or
 * replay plugin (and the model) can route on it.
 */
export const PLANNER_BLOCKED = 'PLANNER_DOES_NOT_EXECUTE';
/** A blocked planner call, carrying the structured `PLANNER_BLOCKED` code. */
function plannerBlockedResult(toolName) {
    const message = `planner may not invoke "${toolName}" directly — delegate it to an executor subagent instead`;
    return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
        error: { message, info: { name: 'PlannerBlockedError', code: PLANNER_BLOCKED } },
    };
}
/**
 * Whether `agent` is the orchestration root (the planner). A root agent is one
 * whose session records no `parentSession`; a child spawned through the
 * subagent seam records its parent, so only children are ever considered
 * non-root. This is the single discriminator that leaves the executor and
 * reviewer untouched.
 */
function isPlanner(agent) {
    return agent !== undefined && agent.session.header.parentSession === undefined;
}
export function apply(ctx, config) {
    const forbidden = new Set(config?.forbiddenTools ?? []);
    const planDir = config?.planDir;
    // ── Hard guard: block the planner from executing forbidden tools.
    //
    // `tools/execute` is an around-waterfall: returning a result WITHOUT calling
    // `next()` short-circuits dispatch entirely, so the tool body never runs. The
    // guard registers on this plugin's scope (a preset's standing scope), so it
    // observes every agent that composes this preset; `isPlanner` narrows it to
    // the root so children keep their full tool set.
    if (config.enforcePlannerGuard !== false) {
        ctx.on('tools/execute', async (exec, next) => {
            if (forbidden.size === 0)
                return next();
            if (!isPlanner(exec.agent))
                return next();
            if (!forbidden.has(exec.name))
                return next();
            return plannerBlockedResult(exec.name);
        });
    }
    // ── Guidance only. The hard enforcement is the guard above; this just tells
    // the planner where the plan lands and that it delegates, never acts.
    ctx.systemPrompt.section({
        name: 'orchestrator:plan',
        order: 114,
        text: planDir === undefined || planDir.length === 0
            ? ''
            : `You are the orchestrating planner. Produce the plan document at ${planDir}/plan.md (human-readable) and ${planDir}/plan.json (machine-readable task list). You do not read, edit, or run anything yourself. Delegate every step to an executor subagent, review its output with a reviewer subagent, and re-delegate until the result meets the requirement. Only plan and dispatch.`,
    });
}
//# sourceMappingURL=index.js.map