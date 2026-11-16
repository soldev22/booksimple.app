import "server-only";

import { applicationOrigin } from "./auth-notifications";

const MAX_BODY_BYTES = 8_192;

export async function parseMutationJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json."), {
      status: 415,
    });
  }
  const origin = request.headers.get("origin");
  let matchesOrigin = false;
  try {
    matchesOrigin =
      Boolean(origin) && new URL(origin!).origin === applicationOrigin();
  } catch {
    matchesOrigin = false;
  }
  if (!matchesOrigin) {
    throw Object.assign(new Error("The request origin is not allowed."), {
      status: 403,
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      status: 400,
    });
  }
}
