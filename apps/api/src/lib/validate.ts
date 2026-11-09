import type { z } from "zod";
import { HttpError } from "../context.js";

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "INVALID_BODY", "Request body failed validation", r.error.issues);
  return r.data;
}

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, what = "id"): string {
  if (!uuidRe.test(value)) throw new HttpError(400, "INVALID_ID", `Invalid ${what}`);
  return value;
}
