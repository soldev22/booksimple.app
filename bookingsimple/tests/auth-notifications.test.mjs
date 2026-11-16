import assert from "node:assert/strict";
import test from "node:test";
import { sendWithPostmark } from "../src/server/auth-notifications.ts";

test("Postmark responses retain safe error codes without exposing provider messages", async (t) => {
  const originalToken = process.env.POSTMARK_SERVER_TOKEN;
  const originalFrom = process.env.POSTMARK_FROM_EMAIL;
  process.env.POSTMARK_SERVER_TOKEN = "synthetic-token";
  process.env.POSTMARK_FROM_EMAIL = "sender@example.invalid";
  t.after(() => {
    for (const [key, value] of [
      ["POSTMARK_SERVER_TOKEN", originalToken],
      ["POSTMARK_FROM_EMAIL", originalFrom],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const payload = {
    to: "recipient@example.invalid",
    subject: "Synthetic test",
    textBody: "Synthetic message",
    htmlBody: "<p>Synthetic message</p>",
  };
  let response;
  t.mock.method(globalThis, "fetch", async () => response);

  response = Response.json({
    ErrorCode: 400,
    Message: "Private provider detail",
  }, { status: 422 });
  await assert.rejects(sendWithPostmark(payload), (error) => {
    assert.equal(error.providerStatus, 422);
    assert.equal(error.providerCode, 400);
    assert.equal(error.message, "Notification provider did not accept the message.");
    assert.equal(JSON.stringify(error).includes("Private provider detail"), false);
    return true;
  });

  response = new Response("Not JSON", { status: 503 });
  await assert.rejects(sendWithPostmark(payload), {
    providerStatus: 503,
    providerCode: undefined,
  });

  response = Response.json({ ErrorCode: 400 });
  await assert.rejects(sendWithPostmark(payload), {
    providerStatus: 200,
    providerCode: 400,
  });

  response = Response.json({ ErrorCode: 0 });
  await sendWithPostmark(payload);
});
