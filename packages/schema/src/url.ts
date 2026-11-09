import { z } from "zod";

/** Only http(s) URLs are allowed in project config. Blocks javascript:, data:, file:, etc. */
export const safeUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL must be a valid http(s) URL");
