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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "orchestrator";
/** The core service this plugin reads and the seam it wraps. */
export declare const inject: string[];
/**
 * The error `code` this guard stamps on a blocked planner call, so a retry or
 * replay plugin (and the model) can route on it.
 */
export declare const PLANNER_BLOCKED = "PLANNER_DOES_NOT_EXECUTE";
/**
 * Deployment policy for the guard.
 *
 * `forbiddenTools` is the authoritative denylist of tools the planner (root
 * agent) may not invoke itself. Because the planner must not do any concrete
 * work — including reading the codebase, which is itself a task to delegate —
 * the shipped preset lists every tool that is not a pure delegation/planning
 * affordance. A child agent is never blocked.
 */
export interface Config {
    /**
     * Global tool names the planner (root agent) may not execute directly.
     * This is the hard, second-layer enforcement behind `tools.restrict()`: even
     * if a tool sneaks past the first layer, the guard returns an `isError`
     * result without invoking `next()`.
     */
    forbiddenTools: string[];
    /**
     * Directory (relative to the session cwd) the plan document lives in, used
     * only to word the prompt section. Default `.dsh`.
     */
    planDir?: string;
    /** Whether to enforce the guard at all. Default `true`. */
    enforcePlannerGuard?: boolean;
}
/** Schemastery configuration for the orchestrator plugin. */
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
