import { TestAnswer, TestQuestion } from "@/lib/types";

// What a candidate has answered so far in a public exam. Two copies are kept: here in this tab's session storage, so a
// refresh, a crash or a restored tab does not lose it, and on the server (see the exam page), so a change of device does
// not either. Session storage, not local storage: it goes when the tab closes, so answers do not stay behind on a shared
// computer. Storage can be blocked or full, so every call is guarded.
const key = (attempt: string) => `ng-exam-draft-${attempt}`;

export type Draft = Record<string, TestAnswer>;

/** The part of a saved draft (from this tab or from the server) that still fits the questions as they are now: an option that no longer exists is dropped. */
export function fitDraft(saved: unknown, questions: TestQuestion[]): Draft {
  if (typeof saved !== "object" || saved === null) return {};
  const draft: Draft = {};
  for (const question of questions) {
    const value = (saved as Record<string, unknown>)[question.id];
    if (question.question_type === "short_text") {
      if (typeof value === "string") draft[question.id] = value;
    } else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < question.options.length) {
      draft[question.id] = value;
    }
  }
  return draft;
}

/** This tab's saved answers for the attempt. */
export function loadDraft(attempt: string, questions: TestQuestion[]): Draft {
  try {
    return fitDraft(JSON.parse(window.sessionStorage.getItem(key(attempt)) ?? "{}"), questions);
  } catch {
    return {};
  }
}

export function saveDraft(attempt: string, answers: Draft): void {
  try {
    window.sessionStorage.setItem(key(attempt), JSON.stringify(answers));
  } catch {
    // Blocked or full: the exam still works, a refresh just starts the answers over.
  }
}

export function clearDraft(attempt: string): void {
  try {
    window.sessionStorage.removeItem(key(attempt));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
