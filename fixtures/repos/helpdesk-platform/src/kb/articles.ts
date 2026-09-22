// EVALUATION FIXTURE - fictional code.
export interface Article {
  id: string;
  title: string;
  body: string;
  published: boolean;
}

const STOPWORDS = new Set(["the", "a", "an", "to", "is", "are", "how", "do", "i", "my", "and", "for", "of", "on"]);

function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((w) => w.length > 2 && !STOPWORDS.has(w)) ?? [];
}

/**
 * Ranks published articles by overlapping keywords with the query (title matches count double).
 * Unpublished (draft) articles are never suggested, to requesters or agents.
 */
export function searchArticles(articles: Article[], query: string, limit = 5): Article[] {
  const queryWords = new Set(keywordsOf(query));
  if (queryWords.size === 0) return [];
  const scored = articles
    .filter((a) => a.published)
    .map((a) => {
      const titleHits = keywordsOf(a.title).filter((w) => queryWords.has(w)).length;
      const bodyHits = keywordsOf(a.body).filter((w) => queryWords.has(w)).length;
      return { article: a, score: titleHits * 2 + bodyHits };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.article);
}
