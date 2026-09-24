// Shared shapes for guided workflows: wizard steps and "what's left" checklists.
// Kept free of React so server components, API routes and tests can share them.

export type WizardStep = {
  id: string;
  label: string;
  description?: string;
};

export type ChecklistItem = {
  id: string;
  label: string;
  detail?: string;
  done: boolean;
  /** Where to go to complete this item. */
  href?: string;
  /** Optional items don't count toward completion. */
  optional?: boolean;
};

export function checklistProgress(items: ChecklistItem[]) {
  const required = items.filter((item) => !item.optional);
  const done = required.filter((item) => item.done).length;
  const total = required.length;
  return {
    done,
    total,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    complete: done === total,
    next: items.find((item) => !item.done && !item.optional) ?? null,
  };
}

/** Resolves a `?step=` value to a known step id, falling back to the first step. */
export function resolveStepId<T extends { id: string }>(
  steps: readonly T[],
  requested: string | string[] | undefined
): T["id"] {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return steps.some((step) => step.id === value) ? (value as T["id"]) : steps[0].id;
}

/** Roles that can run governance workflows (create, edit, assess, decide). */
export const WORKFLOW_EDIT_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

export function canRunWorkflows(role: string | null | undefined) {
  return Boolean(role && WORKFLOW_EDIT_ROLES.includes(role));
}
