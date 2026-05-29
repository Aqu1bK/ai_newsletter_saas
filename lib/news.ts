// Define interfaces for the News API response
interface NewsApiArticle {
  title: string;
  url: string;
  description: string;
  source?: {
    id: string | null;
    name: string;
  };
  author?: string;
  publishedAt?: string;
  content?: string;
  [key: string]: unknown; // For any additional fields we don't use
}

interface NewsApiResponse {
  status: string;
  totalResults?: number;
  articles: NewsApiArticle[];
  message?: string;
}

// Define the return type interface
interface Article {
  title: string;
  url: string;
  description: string;
}

/**
 * Fetches articles from News API for the specified categories
 * Returns articles from the past week, limited to 5 per category
 */
export async function fetchArticles(
  categories: string[]
): Promise<Article[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const promises = categories.map(async (category) => {
    try {
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(
          category
        )}&from=${since}&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`
      );

      if (!response.ok) {
        console.error(
          `Failed to fetch news for category ${category}:`,
          response.statusText
        );
        return [];
      }

      const data: NewsApiResponse = await response.json();

      if (data.status === "error") {
        console.error(`News API error for category ${category}:`, data.message);
        return [];
      }

      // Ensure articles array exists before slicing
      const articles = data.articles || [];
      
      return articles.slice(0, 5).map((article: NewsApiArticle): Article => ({
        title: article.title || "No title",
        url: article.url || "#",
        description: article.description || "No description available",
      }));
    } catch (error) {
      console.error(`Error fetching news for category ${category}:`, error);
      return [];
    }
  });

  const results = await Promise.all(promises);
  return results.flat();
}