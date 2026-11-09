import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalString, normalizeSiteUrl, restUrl, sha256Hex, signConnectorRequest, verifyConnectorSignature } from "./connector.js";
import { decryptString, deriveKey, encryptString } from "./crypto.js";

// Deterministic vector shared with the PHP plugin test (connectors/wordpress/sceneflow/tests/run.php).
const vector = {
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  siteId: "6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c",
  method: "POST",
  route: "/sceneflow/v1/publish",
  timestamp: 1794200000,
  nonce: "a1b2c3d4e5f60718a1b2c3d4e5f60718",
  body: JSON.stringify({ projectId: "p1", name: "Demo", version: 3, checksum: sha256Hex('{"schemaVersion":"1.0"}'), configJson: '{"schemaVersion":"1.0"}' }),
};

describe("connector signature", () => {
  it("signs and verifies, and rejects tampering / replay windows", async () => {
    const headers = signConnectorRequest({ ...vector });
    expect(headers["x-sceneflow-signature"]).toMatch(/^[a-f0-9]{64}$/);
    const ok = verifyConnectorSignature({ secret: vector.secret, method: vector.method, route: vector.route, body: vector.body, timestamp: headers["x-sceneflow-timestamp"], nonce: headers["x-sceneflow-nonce"], signature: headers["x-sceneflow-signature"], now: vector.timestamp + 10 });
    expect(ok).toEqual({ ok: true });
    expect(verifyConnectorSignature({ secret: vector.secret, method: vector.method, route: vector.route, body: vector.body + " ", timestamp: vector.timestamp, nonce: vector.nonce, signature: headers["x-sceneflow-signature"], now: vector.timestamp })).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyConnectorSignature({ secret: vector.secret, method: vector.method, route: vector.route, body: vector.body, timestamp: vector.timestamp, nonce: vector.nonce, signature: headers["x-sceneflow-signature"], now: vector.timestamp + 301 })).toEqual({ ok: false, error: "stale_timestamp" });
    expect(verifyConnectorSignature({ secret: "wrong", method: vector.method, route: vector.route, body: vector.body, timestamp: vector.timestamp, nonce: vector.nonce, signature: headers["x-sceneflow-signature"], now: vector.timestamp })).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyConnectorSignature({ secret: vector.secret, method: vector.method, route: vector.route, body: vector.body, timestamp: vector.timestamp, nonce: "short", signature: headers["x-sceneflow-signature"], now: vector.timestamp })).toEqual({ ok: false, error: "invalid_nonce" });

    // Write the fixture the PHP test consumes so both implementations stay in lock-step.
    const dir = fileURLToPath(new URL("../../../connectors/wordpress/sceneflow/tests/fixtures/", import.meta.url));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}signature.json`, JSON.stringify({ ...vector, canonical: canonicalString(vector.method, vector.route, vector.timestamp, vector.nonce, vector.body), bodySha256: sha256Hex(vector.body), signature: headers["x-sceneflow-signature"] }, null, 2));
  });

  it("normalizes site URLs and builds REST urls for both permalink styles", () => {
    expect(normalizeSiteUrl("https://Shop.Example.com/wp-admin/")).toBe("https://shop.example.com");
    expect(normalizeSiteUrl("http://sceneflow.local/blog/?x=1#y")).toBe("http://sceneflow.local/blog");
    expect(() => normalizeSiteUrl("ftp://x")).toThrow();
    expect(restUrl("http://sceneflow.local", "pretty", "/sceneflow/v1/health")).toBe("http://sceneflow.local/wp-json/sceneflow/v1/health");
    expect(restUrl("http://sceneflow.local", "plain", "/sceneflow/v1/media", { search: "a b" })).toBe("http://sceneflow.local/?rest_route=%2Fsceneflow%2Fv1%2Fmedia&search=a+b");
  });
});

describe("secret encryption", () => {
  it("round-trips and binds to the key", () => {
    const key = deriveKey("app-secret", "site-secrets");
    const token = encryptString("hunter2", key);
    expect(token.startsWith("v1.")).toBe(true);
    expect(decryptString(token, key)).toBe("hunter2");
    expect(() => decryptString(token, deriveKey("other", "site-secrets"))).toThrow();
    expect(encryptString("hunter2", key)).not.toBe(token); // random IV
  });
});
