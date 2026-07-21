import type { Env } from '../env';

export class TavilySearchProvider {
  constructor(private readonly env: Env) {}

  isConfigured(): boolean {
    return Boolean(this.env.TAVILY_API_KEY);
  }

  async searchContext(query: string): Promise<string | undefined> {
    if (!this.env.TAVILY_API_KEY) return undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.env.TAVILY_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          // Tavily currently accepts general or news; travel is a query topic, not an API topic value.
          topic: 'general',
          search_depth: 'basic',
          max_results: 6,
          include_answer: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      const results = payload.results ?? [];
      if (results.length === 0) return undefined;

      return results
        .slice(0, 6)
        .map((item) => `Title: ${item.title ?? 'Untitled'}\nURL: ${item.url ?? ''}\nExcerpt: ${(item.content ?? '').slice(0, 700)}`)
        .join('\n\n---\n\n');
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}
