// app/api/debug-keys/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const eventKey = process.env.INNGEST_EVENT_KEY;
  const signingKey = process.env.INNGEST_SIGNING_KEY;
  
  return NextResponse.json({
    eventKey: {
      exists: !!eventKey,
      prefix: eventKey?.substring(0, 15),
      suffix: eventKey?.substring(eventKey.length - 15),
      length: eventKey?.length,
      startsWithEvent: eventKey?.startsWith("event_"),
      startsWithSignkey: eventKey?.startsWith("signkey_"),
      fullKey: eventKey, // TEMPORARY - remove after checking!
    },
    signingKey: {
      exists: !!signingKey,
      prefix: signingKey?.substring(0, 15),
      length: signingKey?.length,
      startsWithSignkey: signingKey?.startsWith("signkey_"),
    },
    allEnvKeys: Object.keys(process.env)
      .filter(k => k.toLowerCase().includes('inngest'))
      .map(k => ({
        name: k,
        valuePrefix: process.env[k]?.substring(0, 15),
        valueLength: process.env[k]?.length,
      })),
  });
}