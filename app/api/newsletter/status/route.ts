import { NextRequest, NextResponse } from "next/server";

// const INNGEST_API = "http://localhost:8288/v1";
const INNGEST_API = "https://api.inngest.com/v1";

// Define interfaces for better type safety
interface InngestRun {
  id: string;
  status: "Completed" | "Failed" | "Cancelled" | "Running" | string;
  output?: {
    error?: string;
    [key: string]: unknown;
  };
  event_id?: string;
  started_at?: string;
  ended_at?: string;
}

interface InngestRunResponse {
  data: InngestRun[];
}

/** Fetch all runs for a given event ID */
async function getRuns(eventId: string): Promise<InngestRun[]> {
  const res = await fetch(`${INNGEST_API}/events/${eventId}/runs`, {
    headers: {
      Authorization: `Bearer ${process.env.INGGEST_SIGNING_KEY}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Inngest list-runs error: ${err}`);
  }
  const json: InngestRunResponse = await res.json();
  return json.data;
}

/** Poll until the first run is Completed/Failed/Cancelled */
async function getRunOutput(eventId: string): Promise<InngestRun> {
  const runs = await getRuns(eventId);
  if (!runs.length) {
    throw new Error("No runs found for event");
  }
  const run = runs[0];
  // If still in progress, return current status without waiting
  if (
    run.status !== "Completed" &&
    run.status !== "Failed" &&
    run.status !== "Cancelled"
  ) {
    return run;
  }
  // Already terminal
  return run;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("runId"); // still named runId on client
    if (!eventId) {
      return NextResponse.json(
        { error: "Missing runId (event ID)" },
        { status: 400 }
      );
    }

    const run = await getRunOutput(eventId);

    // Map Inngest run.status to your client statuses
    let status: "fetching" | "summarizing" | "completed" | "error" = "fetching";
    if (run.status === "Completed") status = "completed";
    else if (run.status === "Failed" || run.status === "Cancelled")
      status = "error";

    return NextResponse.json({
      status,
      // run.output is whatever your function returned
      result: run.output,
      error: run.output?.error || undefined,
    });
  } catch (error: unknown) {  // Changed from 'e: any' to 'error: unknown'
    console.error("Error in status route:", error);
    
    // Type-safe error handling
    const errorMessage = error instanceof Error 
      ? error.message 
      : "An unexpected error occurred";
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}