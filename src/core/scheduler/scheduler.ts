import type { HardwareProfile } from "../hardware/profile.js";
import type { RuntimeTask, TaskGraph } from "../spec/compiler.js";

export function selectNextTask(graph: TaskGraph): RuntimeTask | null {
  return graph.tasks.find((task) => task.status === "ready") ?? graph.tasks.find((task) => task.status === "todo" && dependenciesComplete(graph, task)) ?? null;
}

export function computeExecutionWave(graph: TaskGraph, profile: HardwareProfile): RuntimeTask[] {
  const runnable = graph.tasks.filter((task) => (task.status === "ready" || task.status === "todo") && dependenciesComplete(graph, task));
  const max = Math.max(1, profile.parallel_model_calls);
  const selected: RuntimeTask[] = [];
  const locked = new Set<string>();
  for (const task of runnable) {
    const files = task.allowed_files ?? [];
    if (files.some((file) => locked.has(file))) continue;
    selected.push(task);
    files.forEach((file) => locked.add(file));
    if (selected.length >= max) break;
  }
  return selected;
}

function dependenciesComplete(graph: TaskGraph, task: RuntimeTask): boolean {
  return task.depends_on.every((dependency) => graph.tasks.find((candidate) => candidate.id === dependency)?.status === "complete");
}
