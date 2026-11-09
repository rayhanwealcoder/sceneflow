export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4800").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Fetch wrapper for the SceneFlow API. Sends the session cookie and raises ApiError on failures. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, e.error ?? "REQUEST_FAILED", e.message ?? `Request failed (${res.status})`, e.details);
  }
  return data as T;
}

/** PUT a file to a signed upload URL with progress (fetch has no upload progress yet). */
export function uploadFile(url: string, method: string, headers: Record<string, string>, file: File, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message;
        } catch {
          /* keep default */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.send(file);
  });
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

export interface UploadTicket {
  assetId: string;
  upload: { url: string; method: string; headers: Record<string, string> };
  /** Present when storage is remote (S3/R2): call it after the PUT so processing starts. */
  complete: string | null;
}

/** Full upload flow: ask for a ticket, PUT the bytes (local or presigned S3/R2), confirm when needed. */
export async function uploadMedia(workspaceId: string, file: File, onProgress: (ratio: number) => void): Promise<string> {
  const ticket = await api<UploadTicket>("/api/v1/media/uploads", {
    method: "POST",
    json: { workspaceId, filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size },
  });
  await uploadFile(ticket.upload.url, ticket.upload.method, ticket.upload.headers, file, onProgress);
  if (ticket.complete) await api(ticket.complete, { method: "POST" });
  return ticket.assetId;
}
