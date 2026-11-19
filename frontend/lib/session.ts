"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

/** Probes the session on mount; a 401 makes api() redirect to /login. For pages that load nothing authenticated themselves. */
export function useRequireSession() {
  useEffect(() => {
    api("/auth/me").catch(() => undefined);
  }, []);
}
