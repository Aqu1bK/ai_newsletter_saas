// app/api/subscription-status/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json({ 
        active: false,
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    // Check if subscription exists
    let { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    // If no subscription exists, create one with free plan
    if (!subscription) {
      const { data: newSub, error: createError } = await supabase
        .from('subscriptions')
        .insert({
          user_id: user.id,
          status: 'active', // Changed from 'inactive' to 'active'
          plan: 'free'
        })
        .select()
        .single();

      if (createError) {
        console.error("Error creating subscription:", createError);
        return NextResponse.json({ 
          active: true, // Allow access even if creation fails temporarily
          plan: 'free',
          status: 'active'
        });
      }

      subscription = newSub;
    }

    // User is active if they have:
    // - active or trialing subscription
    // - free plan (always active)
    const isActive = 
      subscription?.status === 'active' || 
      subscription?.status === 'trialing' || 
      subscription?.plan === 'free';

    return NextResponse.json({ 
      active: isActive,
      subscription: subscription,
      plan: subscription?.plan || 'free',
      status: subscription?.status || 'active'
    });
  } catch (error) {
    console.error("Subscription status error:", error);
    // Default to active to prevent blocking users
    return NextResponse.json({ 
      active: true,
      error: 'Error checking status, defaulting to active'
    });
  }
}