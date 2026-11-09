import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacSign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function hmacVerify(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(hmacSign(secret, payload), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
