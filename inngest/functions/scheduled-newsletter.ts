// inngest/functions/scheduled-newsletter.ts
import { inngest } from "@/inngest/client";
import { fetchArticles } from "@/lib/news";
import emailjs from "@emailjs/nodejs";
import { marked } from "marked";
import { createClient } from "@/lib/supabase/server";
import OpenAI from 'openai';

// Define the event data type
type NewsletterEvent = {
  userId: string;
  email: string;
  categories: string[];
  frequency: string;
  isTest?: boolean;
  scheduledFor?: string;
};

export const scheduledNewsletter = inngest.createFunction(
  { 
    id: "newsletter/scheduled",
    triggers: [{ event: "newsletter.schedule" }]
  },
  async ({ event, step, runId }) => {
    // Cast event data to our type
    const eventData = event.data as NewsletterEvent;
    
    console.log("🚀 Function started with data:", eventData);
    
    try {
      // 0️⃣ Check if user's newsletter is still active
      const isUserActive = await step.run("check-user-status", async () => {
        const supabase = await createClient();
        const { data, error } = await supabase
          .from("user_preferences")
          .select("is_active")
          .eq("user_id", eventData.userId)
          .maybeSingle();

        if (error) {
          console.error("❌ Error checking user status:", error);
          return false;
        }

        // If no preferences found, treat as active (first-time user)
        if (!data) {
          console.log("👤 No user preferences found, treating as active");
          return true;
        }

        console.log("👤 User active status:", data?.is_active);
        return data?.is_active || false;
      });

      // If user has paused their newsletter, exit early
      if (!isUserActive) {
        console.log(
          `User ${eventData.userId} has paused their newsletter. Skipping processing.`
        );
        return {
          skipped: true,
          reason: "User newsletter is paused",
          userId: eventData.userId,
          runId: runId,
        };
      }

      // 1️⃣ Fetch articles per category
      const allArticles = await step.run("fetch-news", async () => {
        console.log(
          `📰 Fetching articles for categories: ${eventData.categories.join(", ")}`
        );
        const articles = await fetchArticles(eventData.categories);
        console.log(`📊 Found ${articles.length} articles`);
        return articles;
      });

      // 2️⃣ Generate AI summary using DeepSeek via OpenRouter
      const summary = await step.run("summarize-news", async () => {
        console.log("🤖 Generating AI summary...");
        const client = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY,
        });

        try {
          const response = await client.chat.completions.create({
            model: 'deepseek/deepseek-chat', // Changed to deepseek-chat which is more reliable
            messages: [
              {
                role: "system",
                content: `You are an expert newsletter editor creating a personalized newsletter. 
                Write a concise, engaging summary that:
                - Highlights the most important stories
                - Provides context and insights
                - Uses a friendly, conversational tone
                - Is well-structured with clear sections
                - Keeps the reader informed and engaged
                Format the response as a proper newsletter with a title and organized content.
                Make it email-friendly with clear sections and engaging subject lines.`,
              },
              {
                role: "user",
                content: `Create a newsletter summary for these articles from the past week. 
                Categories requested: ${eventData.categories.join(", ")}
                
                Articles:
                ${allArticles
                  .map(
                    (article: any, index: number) =>
                      `${index + 1}. ${article.title}\n   ${
                        article.description
                      }\n   Source: ${article.url}\n`
                  )
                  .join("\n")}`,
              },
            ],
          });

          // Debug: Log the full response structure
          console.log("📡 AI Response structure:", {
            hasChoices: !!response?.choices,
            choicesLength: response?.choices?.length,
            hasMessage: !!response?.choices?.[0]?.message,
            hasContent: !!response?.choices?.[0]?.message?.content,
            finishReason: response?.choices?.[0]?.finish_reason,
          });

          if (response?.choices?.[0]?.message?.content) {
            console.log("✅ AI summary generated successfully");
            console.log("📝 Content preview:", response.choices[0].message.content.substring(0, 100) + "...");
          } else {
            console.warn("⚠️ AI returned empty or unexpected response:", JSON.stringify(response, null, 2));
          }

          return response;
        } catch (error: any) {
          console.error("❌ AI API Error:", {
            message: error.message,
            status: error.status,
            response: error.response?.data,
          });
          throw error;
        }
      });

      // Extract newsletter content with fallback
      let newsletterContent = summary?.choices?.[0]?.message?.content;

      // If AI didn't return content, create a basic newsletter from the articles
      if (!newsletterContent) {
        console.warn("⚠️ AI returned empty content, generating fallback newsletter");
        newsletterContent = `# Your Personalized Newsletter\n\n` +
          `## Top Stories in ${eventData.categories.join(", ")}\n\n` +
          allArticles
            .map((article: any, index: number) => 
              `### ${index + 1}. ${article.title}\n\n${article.description}\n\n[Read more](${article.url})\n`
            )
            .join("\n\n") +
          `\n\n---\n*This is an automated newsletter generated for you.*`;
      }

      console.log("📝 Final newsletter content length:", newsletterContent.length);

      // Convert markdown to HTML for email
      const htmlContent = marked(newsletterContent);

      // 3️⃣ Send email using EmailJS
      await step.run("send-email", async () => {
        console.log("📧 Attempting to send email to:", eventData.email);
        
        const serviceId = process.env.EMAILJS_SERVICE_ID;
        const templateId = process.env.EMAILJS_TEMPLATE_ID;
        const publicKey = process.env.EMAILJS_PUBLIC_KEY;
        const privateKey = process.env.EMAILJS_PRIVATE_KEY;

        console.log("🔑 EmailJS Config:", {
          serviceId: serviceId ? `${serviceId.substring(0, 5)}...` : "MISSING",
          templateId: templateId ? `${templateId.substring(0, 5)}...` : "MISSING",
          publicKey: publicKey ? `${publicKey.substring(0, 5)}...` : "MISSING",
          privateKey: privateKey ? `${privateKey.substring(0, 5)}...` : "MISSING",
        });

        if (!serviceId || !templateId || !publicKey || !privateKey) {
          console.error("❌ EmailJS configuration missing!");
          throw new Error("EmailJS configuration missing. Check EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, and EMAILJS_PRIVATE_KEY");
        }

        const templateParams = {
          to_email: eventData.email,
          newsletter_content: htmlContent,
          categories: eventData.categories.join(", "),
          article_count: allArticles.length,
          current_date: new Date().toLocaleDateString(),
        };

        console.log("📨 Sending with params:", {
          to_email: templateParams.to_email,
          categories: templateParams.categories,
          article_count: templateParams.article_count,
        });

        try {
          const response = await emailjs.send(
            serviceId,
            templateId,
            templateParams,
            {
              publicKey: publicKey,
              privateKey: privateKey,
            }
          );

          console.log("✅ Email sent successfully:", response);
          return response;
        } catch (error: any) {
          console.error("❌ EmailJS Error Details:", {
            message: error.message,
            status: error.status,
            text: error.text,
          });
          throw error;
        }
      });

      if (!eventData.isTest) {
        // 4️⃣ Schedule the next newsletter based on frequency
        await step.run("schedule-next", async () => {
          console.log("📅 Scheduling next newsletter...");
          const now = new Date();
          let nextScheduleTime: Date;

          switch (eventData.frequency) {
            case "daily":
              nextScheduleTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
              break;
            case "weekly":
              nextScheduleTime = new Date(
                now.getTime() + 7 * 24 * 60 * 60 * 1000
              );
              break;
            case "biweekly":
              nextScheduleTime = new Date(
                now.getTime() + 3 * 24 * 60 * 60 * 1000
              );
              break;
            default:
              nextScheduleTime = new Date(
                now.getTime() + 7 * 24 * 60 * 60 * 1000
              );
          }

          nextScheduleTime.setHours(9, 0, 0, 0);

          // Schedule the next newsletter
          await inngest.send({
            name: "newsletter.schedule",
            data: {
              userId: eventData.userId,
              email: eventData.email,
              categories: eventData.categories,
              frequency: eventData.frequency,
              scheduledFor: nextScheduleTime.toISOString(),
            } as NewsletterEvent,
            ts: nextScheduleTime.getTime(),
          });

          console.log(
            `✅ Next newsletter scheduled for: ${nextScheduleTime.toISOString()}`
          );
        });
      } else {
        console.log("🧪 Test mode - skipping next schedule");
      }

      const result = {
        newsletter: newsletterContent.substring(0, 100) + "...",
        articleCount: allArticles.length,
        categories: eventData.categories,
        emailSent: true,
        nextScheduled: !eventData.isTest,
        success: true,
        runId: runId,
      };

      console.log("✅ Function completed successfully!");
      return result;
    } catch (error) {
      console.error("❌ Scheduled newsletter generation failed:", error);
      throw error;
    }
  }
);