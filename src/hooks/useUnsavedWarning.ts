import { useEffect } from "react";

/** Warns on browser tab close/refresh when a form has unsaved changes. */
export function useUnsavedWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

/** Prompts before closing a drawer/dialog when dirty. */
export function confirmDiscard(isDirty: boolean): boolean {
  if (!isDirty) return true;
  return window.confirm("You have unsaved changes. Discard them?");
}
