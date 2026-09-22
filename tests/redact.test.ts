import { describe, expect, it } from "vitest";
import { findSecrets, redactSecrets } from "@/shared/redact";

const SECRET = "hunter2hunter2hunter2"; // 21 chars, clears the {16,} floor

describe("credential-assignment", () => {
  it("redacts prefixed identifiers, the most common real config/env-var shape", () => {
    for (const text of [
      `db_password=${SECRET}`,
      `DB_PASSWORD: ${SECRET}`,
      `my_api_key = ${SECRET}`,
      `STRIPE_CLIENT_SECRET=${SECRET}`,
    ]) {
      expect(findSecrets(text)).toContain("credential-assignment");
      expect(redactSecrets(text)).not.toContain(SECRET);
    }
  });

  it("redacts JSON-style quoted keys, how ticket bodies and file contents carry these", () => {
    const text = `{"password": "${SECRET}"}`;
    expect(findSecrets(text)).toContain("credential-assignment");
    expect(redactSecrets(text)).not.toContain(SECRET);
  });

  it("still redacts the unprefixed, unquoted form", () => {
    const text = `password=${SECRET}`;
    expect(findSecrets(text)).toContain("credential-assignment");
    expect(redactSecrets(text)).not.toContain(SECRET);
  });

  it("leaves ordinary prose and short values alone", () => {
    expect(findSecrets("the password policy requires 12 characters")).toEqual([]);
    expect(findSecrets("password_reset_url=https://example.com/reset")).not.toContain(
      "credential-assignment",
    );
    expect(findSecrets("password=short")).toEqual([]);
  });
});
