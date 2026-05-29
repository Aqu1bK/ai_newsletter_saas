// inngest/functions.ts
import { scheduledNewsletter } from "./functions/scheduled-newsletter"; // ← Named import with { }

// Register all functions
export const functions = [scheduledNewsletter];