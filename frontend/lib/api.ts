import { fallbackMessages, translateMessage } from "@/lib/messages";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api";

/** The API's answer to a correct password for an account with two-step verification. Deliberately left untranslated in messages.ts. */
export const MFA_REQUIRED = "mfa_required";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function formatApiMessage(status: number, payload: unknown): string {
  const fallback = fallbackMessages[status] ?? "Kërkesa dështoi. Provo përsëri.";
  if (!payload || typeof payload !== "object") return fallback;

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return translateMessage(detail);

  if (Array.isArray(detail)) {
    const fields = detail
      .map((item) => (item && typeof item === "object" && Array.isArray((item as { loc?: unknown }).loc) ? String((item as { loc: unknown[] }).loc.slice(1).join(".")) : ""))
      .filter(Boolean);
    return fields.length ? `Të dhëna të pavlefshme: ${fields.join(", ")}.` : "Të dhënat e futura nuk janë të vlefshme.";
  }
  return fallback;
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (["/login", "/register"].includes(window.location.pathname)) return;
  window.location.replace("/login");
}

// Older versions kept the JWT in localStorage; the session now lives in an HttpOnly cookie.
if (typeof window !== "undefined") {
  try {
    localStorage.removeItem("interviewguard_token");
  } catch {
    // storage can be unavailable (private mode); nothing to clean up then
  }
}

/**
 * Calls the API. `authenticated` requests (and /auth/*) send the session cookie; candidate-facing
 * /public/* calls pass `false` and carry no credentials. A 401 on an authenticated call sends the user to /login.
 */
export async function api<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const isAuthRoute = path.startsWith("/auth/");

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: authenticated || isAuthRoute ? "include" : "omit" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && authenticated && !isAuthRoute) redirectToLogin();
    throw new ApiError(response.status, formatApiMessage(response.status, payload));
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.replace("/login");
}

// API_URL may be absolute (http://host:8100/api) or relative (/api, behind a reverse proxy).
export function wsUrl(path: string) {
  const base = API_URL.startsWith("/") ? `${window.location.origin}${API_URL}` : API_URL;
  return `${base.replace(/^http/, "ws")}${path}`;
}
