import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

// Server-side persistence for the step inputs/outputs so the filled-in
// workflow survives even after the browser cache is cleared. Credentials no
// longer live here — they come from server-side env vars (see /api/rzp-sbmd).
// The file is gitignored and never sent back to the browser in full.

const DATA_DIR = path.join(process.cwd(), ".rzpdata-sbmd");
const DATA_FILE = path.join(DATA_DIR, "session.json");

interface SessionData {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

async function readSession(): Promise<SessionData> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SessionData>;
    return {
      inputs: parsed.inputs ?? {},
      outputs: parsed.outputs ?? {},
    };
  } catch {
    return { inputs: {}, outputs: {} };
  }
}

export async function GET() {
  const session = await readSession();
  return NextResponse.json({
    inputs: session.inputs ?? {},
    outputs: session.outputs ?? {},
  });
}

export async function POST(request: Request) {
  let payload: { inputs?: unknown; outputs?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON body." }, { status: 400 });
  }

  const session = await readSession();
  const next = { ...session };

  if (payload.inputs && typeof payload.inputs === "object") {
    next.inputs = payload.inputs as Record<string, string>;
  }
  if (payload.outputs && typeof payload.outputs === "object") {
    next.outputs = payload.outputs as Record<string, string>;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(next, null, 2), "utf8");
  return NextResponse.json({ ok: true });
}
