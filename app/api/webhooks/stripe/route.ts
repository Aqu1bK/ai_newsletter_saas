// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  const supabase = await createClient();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    console.log('✅ Webhook verified:', event.type);
  } catch (err: any) {
    console.error('❌ Webhook verification failed:', err.message);
    return NextResponse.json(
      { error: `Webhook error: ${err.message}` },
      { status: 400 }
    );
  }

  switch (event.type) {
    case "checkout.session.completed": {
  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.userId;

  if (!userId) {
    console.error("❌ Could not find userId in session metadata");
    break;
  }

  // Simple approach: just set status to active with a future end date
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  console.log("💾 Creating subscription for user:", userId);

  const { error: dbErr } = await supabase
    .from("subscriptions")
    .upsert({
      user_id: userId,
      status: "active",
      current_period_end: thirtyDaysFromNow.toISOString(),
    }, { onConflict: "user_id" });

  if (dbErr) {
    console.error("❌ Error upserting subscription:", dbErr);
  } else {
    console.log("✅ Subscription saved successfully!");
  }
  break;
}

    // Handle other events that update subscription status
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      
      console.log("🔄 Subscription updated:", subscription.id, "Status:", subscription.status);
      
      // You might want to find the user by customer ID here
      // For now, let's just log it
      break;
    }

    default:
      console.log('📝 Unhandled event type:', event.type);
      break;
  }

  return NextResponse.json({ received: true });
}
