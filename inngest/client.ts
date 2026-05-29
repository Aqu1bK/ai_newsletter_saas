import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "personalized-newsletter",
  name: "Personalized Newsletter Generator",
  signingKey: process.env.INNGEST_SIGNING_KEY,
  eventKey: process.env.INNGEST_EVENT_KEY,
  mode: "cloud",
  baseUrl: "https://api.inngest.com",
});
// CRITICAL DEBUG LINE
console.log("✅ Inngest client loaded with event key:", process.env.INNGEST_EVENT_KEY?.substring(0, 10) + "...");   