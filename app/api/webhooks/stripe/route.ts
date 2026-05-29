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
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error('❌ Webhook verification failed:', errorMessage);
    return NextResponse.json(
      { error: `Webhook error: ${errorMessage}` },
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
      
      // TODO: Find user by customer ID and update subscription
      // const { data: user } = await supabase
      //   .from("subscriptions")
      //   .select("user_id")
      //   .eq("stripe_customer_id", customerId)
      //   .single();
      
      // if (user) {
      //   await supabase
      //     .from("subscriptions")
      //     .update({
      //       status: subscription.status,
      //       current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      //     })
      //     .eq("user_id", user.user_id);
      // }
      
      break;
    }

    default:
      console.log('📝 Unhandled event type:', event.type);
      break;
  }

  return NextResponse.json({ received: true });
}
