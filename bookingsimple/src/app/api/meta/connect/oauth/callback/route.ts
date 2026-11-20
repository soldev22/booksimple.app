import { getSafeError } from "@/server/auth-service";
import { parseMetaOAuthConfig } from "@/server/meta-connection-config";
import { completeMetaOAuthConnection } from "@/server/meta-connection-service";

export const runtime = "nodejs";

function continueToSettings(url: URL): Response {
  const href = url
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="refresh" content="0;url=${href}">
    <title>Returning to BookSimple</title>
  </head>
  <body>
    <p>Returning to BookSimple...</p>
    <p><a href="${href}">Continue to BookSimple</a></p>
  </body>
</html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function GET(request: Request) {
  try {
    const config = parseMetaOAuthConfig(process.env);
    const result = await completeMetaOAuthConnection(request);
    const url = new URL("/settings", config.appOrigin);
    if (result.outcome === "SELECT_PAGE") {
      url.searchParams.set("meta", "select");
      url.searchParams.set("state", result.state);
    } else {
      url.searchParams.set("meta", "cancelled");
    }
    return continueToSettings(url);
  } catch (error) {
    getSafeError(error);
    return continueToSettings(new URL("/settings?meta=error", request.url));
  }
}
