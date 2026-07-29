const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function formatApiMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Kerkesa deshtoi";

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const message = (item as { msg?: unknown }).msg;
        return typeof message === "string" ? message : JSON.stringify(item);
      })
      .join(" ");
  }

  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return "Kerkesa deshtoi";
}

export function getToken() {
  return typeof window === "undefined" ? null : localStorage.getItem("interviewguard_token");
}

export function saveToken(token: string) {
  localStorage.setItem("interviewguard_token", token);
}

export function clearToken() {
  localStorage.removeItem("interviewguard_token");
}

export async function api<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (authenticated && getToken()) headers.set("Authorization", `Bearer ${getToken()}`);

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && authenticated) clearToken();
    throw new ApiError(response.status, formatApiMessage(payload));
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export { API_URL };

export function wsUrl(path: string) {
  const base = API_URL.replace(/^http/, "ws").replace(/\/api$/, "");
  return `${base}/api${path}`;
}
