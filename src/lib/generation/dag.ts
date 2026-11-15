/**
 * SOURCE OF TRUTH KEYWORDS: validateTaskGraph, findUnblockedKeys,
 *   collectDependentKeys, task DAG, cycle detection, dependsOn
 *
 * WHAT:  Pure graph helpers over a job's tasks (keyed by `key`, edges from
 *        `dependsOn`).
 * WHY:   Kept pure (no DB, no server-only) so the rules are trivially
 *        correct by inspection and usable from both the router (validating a
 *        DAG before writing it) and the worker (resolving what runs next).
 *        A malformed DAG must fail at creation time — a cycle or dangling
 *        dependency written to the DB would leave tasks BLOCKED forever.
 * WHERE: src/lib/generation/jobs.ts and lifecycle.ts.
 */

import { TaskStatus } from '@/generated/prisma'

interface GraphNode {
  key: string
  dependsOn: readonly string[]
}

interface StatusNode extends GraphNode {
  status: TaskStatus
}

/** Throws a descriptive Error for duplicate keys, unknown deps, or cycles. */
export function validateTaskGraph(nodes: readonly GraphNode[]): void {
  if (nodes.length === 0) throw new Error('A generation job needs at least one task.')

  const keys = new Set<string>()
  for (const node of nodes) {
    if (keys.has(node.key)) throw new Error(`Duplicate task key "${node.key}".`)
    keys.add(node.key)
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (dep === node.key) throw new Error(`Task "${node.key}" depends on itself.`)
      if (!keys.has(dep)) throw new Error(`Task "${node.key}" depends on unknown task "${dep}".`)
    }
  }

  /* Kahn's algorithm: if we cannot order every node, there is a cycle. */
  const remainingDeps = new Map(nodes.map((n) => [n.key, new Set(n.dependsOn)]))
  const queue = nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.key)
  let ordered = 0
  while (queue.length > 0) {
    const key = queue.shift()
    if (key === undefined) break
    ordered++
    for (const [other, deps] of remainingDeps) {
      if (deps.delete(key) && deps.size === 0) queue.push(other)
    }
  }
  if (ordered !== nodes.length) throw new Error('The task graph contains a cycle.')
}

/** BLOCKED tasks whose every dependency has SUCCEEDED. */
export function findUnblockedKeys(nodes: readonly StatusNode[]): string[] {
  const statusByKey = new Map(nodes.map((n) => [n.key, n.status]))
  return nodes
    .filter(
      (n) =>
        n.status === TaskStatus.BLOCKED &&
        n.dependsOn.every((dep) => statusByKey.get(dep) === TaskStatus.SUCCEEDED)
    )
    .map((n) => n.key)
}

/** Every task that (transitively) depends on any of `rootKeys`. */
export function collectDependentKeys(nodes: readonly GraphNode[], rootKeys: readonly string[]): string[] {
  const found = new Set<string>()
  const frontier = [...rootKeys]
  while (frontier.length > 0) {
    const current = frontier.pop()
    if (current === undefined) break
    for (const node of nodes) {
      if (node.dependsOn.includes(current) && !found.has(node.key)) {
        found.add(node.key)
        frontier.push(node.key)
      }
    }
  }
  return [...found]
}
