import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  // DEBUG: Log the client
  console.log("📡 Using inngest client from @/inngest/client");
  console.log("🔑 Client has event key:", !!inngest.eventKey);
  
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be logged in to save preferences." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { categories, frequency, email } = body;

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return NextResponse.json(
        { error: "Categories array is required and must not be empty" },
        { status: 400 }
      );
    }

    if (!frequency || !["daily", "weekly", "biweekly"].includes(frequency)) {
      return NextResponse.json(
        { error: "Valid frequency is required (daily, weekly, biweekly)" },
        { status: 400 }
      );
    }

    // Save user preferences to database with is_active: true
    const { error: upsertError } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          categories: categories,
          frequency: frequency,
          email: email,
          is_active: true,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("Error saving preferences:", upsertError);
      return NextResponse.json(
        { error: "Failed to save preferences" },
        { status: 500 }
      );
    }

    // ✅ Send immediate test newsletter NOW
    console.log("📨 Sending immediate test newsletter...");
    const { ids: immediateIds } = await inngest.send({
      name: "newsletter.schedule",
      data: {
        userId: user.id,
        email: email,
        categories: categories,
        frequency: frequency,
        isTest: false, // Set to false so it actually sends the email
      },
    });

    // Schedule the NEXT newsletter based on frequency
    let scheduleTime: Date;
    const now = new Date();

    switch (frequency) {
      case "daily":
        scheduleTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        scheduleTime.setHours(9, 0, 0, 0);
        break;
      case "weekly":
        scheduleTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        scheduleTime.setHours(9, 0, 0, 0);
        break;
      case "biweekly":
        scheduleTime = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        scheduleTime.setHours(9, 0, 0, 0);
        break;
      default:
        scheduleTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        scheduleTime.setHours(9, 0, 0, 0);
    }

    // Schedule the future newsletter
    const { ids: futureIds } = await inngest.send({
      name: "newsletter.schedule",
      data: {
        userId: user.id,
        email: email,
        categories: categories,
        frequency: frequency,
        scheduledFor: scheduleTime.toISOString(),
      },
      ts: scheduleTime.getTime(),
    });

    return NextResponse.json({
      success: true,
      message: "Preferences saved and newsletter scheduled",
      immediateEmailSent: true,
      immediateEventId: immediateIds[0],
      nextScheduleId: futureIds[0],
      nextScheduleTime: scheduleTime.toISOString(),
    });
  } catch (error) {
    console.error("Error in user-preferences API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be logged in to update preferences." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { is_active } = body;

    const { error: updateError } = await supabase
      .from("user_preferences")
      .update({ is_active })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Error updating preferences:", updateError);
      return NextResponse.json(
        { error: "Failed to update preferences" },
        { status: 500 }
      );
    }

    if (!is_active) {
      console.log(`User ${user.id} newsletter paused. Existing events will be skipped when they run.`);
    } else {
      try {
        await rescheduleUserNewsletter(user.id);
      } catch (rescheduleError) {
        console.error("Error rescheduling newsletter:", rescheduleError);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Preferences updated successfully",
    });
  } catch (error) {
    console.error("Error in user-preferences PATCH API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function rescheduleUserNewsletter(userId: string) {
  const supabase = await createClient();

  try {
    const { data: preferences, error } = await supabase
      .from("user_preferences")
      .select("categories, frequency, email")
      .eq("user_id", userId)
      .single();

    if (error || !preferences) {
      throw new Error("User preferences not found");
    }

    const now = new Date();
    let nextScheduleTime: Date;

    switch (preferences.frequency) {
      case "daily":
        nextScheduleTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        break;
      case "weekly":
        nextScheduleTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case "biweekly":
        nextScheduleTime = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        break;
      default:
        nextScheduleTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    nextScheduleTime.setHours(9, 0, 0, 0);

    await inngest.send({
      name: "newsletter.schedule",
      data: {
        userId: userId,
        email: preferences.email,
        categories: preferences.categories,
        frequency: preferences.frequency,
      },
      ts: nextScheduleTime.getTime(),
    });

    console.log(`Rescheduled newsletter for user ${userId} at ${nextScheduleTime.toISOString()}`);
  } catch (error) {
    console.error("Error in rescheduleUserNewsletter:", error);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be logged in to fetch preferences." },
      { status: 401 }
    );
  }

  try {
    const { data: preferences, error } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Error fetching preferences:", error);
      return NextResponse.json(
        { error: "Failed to fetch preferences" },
        { status: 500 }
      );
    }

    if (!preferences) {
      return NextResponse.json(
        { error: "No preferences found" },
        { status: 404 }
      );
    }

    return NextResponse.json(preferences);
  } catch (error) {
    console.error("Error in user-preferences GET API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}