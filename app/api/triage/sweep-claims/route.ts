import { NextResponse } from "next/server";
import { createServiceClient, verifyCronSecret } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("triage_claims_expire_inactive");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ expired: data ?? 0 });
}
