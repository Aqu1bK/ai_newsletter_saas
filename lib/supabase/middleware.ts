import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no user and not on signin page, redirect to signin
  if (!user && !request.nextUrl.pathname.startsWith("/signin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }

  // If user is authenticated, check subscription only for dashboard
  if (user && request.nextUrl.pathname.startsWith("/dashboard")) {
    try {
      const res = await fetch(
        new URL("/api/subscription-status", request.url),
        { 
          headers: { 
            cookie: request.headers.get("cookie") || "" 
          },
          // Add cache: 'no-store' to prevent caching issues
          cache: 'no-store'
        }
      );
      
      const data = await res.json();
      
      // Only redirect if explicitly not active
      // AND user is not on free plan
      if (!data.active && data.plan !== 'free') {
        const url = request.nextUrl.clone();
        url.pathname = "/subscribe";
        return NextResponse.redirect(url);
      }
      
      // If user is active or on free plan, allow access to dashboard
    } catch (error) {
      console.error("Subscription check failed:", error);
      // Don't redirect on error - let user access dashboard
      // This prevents blocking users due to API issues
    }
  }

  // Allow access to subscribe page for authenticated users
  if (user && request.nextUrl.pathname.startsWith("/subscribe")) {
    // Users can always access the subscribe page
    return supabaseResponse;
  }

  return supabaseResponse;
}