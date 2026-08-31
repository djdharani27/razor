import { NextResponse } from "next/server";
import { getRecentAgentLog, insertAgentLog } from "@/lib/db";

export const runtime = "nodejs";

/** POST /api/agent-log — internal helper used by every WebMCP tool execute(). */
export async function POST(req: Request) {
  let body: { tool_name?: string; arguments_json?: string; result_json?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const toolName = typeof body.tool_name === "string" ? body.tool_name : "unknown";
  const args = typeof body.arguments_json === "string" ? body.arguments_json : "{}";
  const result = typeof body.result_json === "string" ? body.result_json : "{}";

  insertAgentLog({ tool_name: toolName, arguments_json: args, result_json: result });
  return NextResponse.json({ ok: true });
}

/** GET /api/agent-log — last 20 rows, for the polling UI panel. */
export async function GET() {
  return NextResponse.json({ logs: getRecentAgentLog(20) });
}
