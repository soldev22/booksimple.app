import { NextResponse } from "next/server";
import { getSafeError, listAdminData, validateAdminCursor } from "@/server/auth-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const data = await listAdminData(
      request,
      validateAdminCursor(url.searchParams.get("usersCursor")),
      validateAdminCursor(url.searchParams.get("businessesCursor")),
    );
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    });
  } catch (error) {
    const safe = getSafeError(error);
    return NextResponse.json(
      { error: safe.message },
      {
        status: safe.status,
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      },
    );
  }
}
