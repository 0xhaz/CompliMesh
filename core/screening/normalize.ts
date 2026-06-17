// Entity-name normalization (architecture §4.3). Short company names inflate
// trigram similarity on common corporate words ("Co", "Ltd", "Trading",
// "International"), so we strip those before scoring. The SQL screening query
// applies the SAME transformation to stored names (core/screening/screen.ts)
// so the comparison is symmetric — keep the two token lists in sync.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

// Corporate suffix / filler tokens removed before scoring. Lowercase.
export const STOPWORDS = [
  'co',
  'ltd',
  'llc',
  'inc',
  'gmbh',
  'corp',
  'corporation',
  'company',
  'limited',
  'technologies',
  'technology',
  'tech',
  'holdings',
  'group',
  'international',
  'trading',
  'the',
  'and',
  'jsc',
  'ao',
  'pmc',
] as const

// The regex used identically in SQL (see screen.ts NORM()).
const STOPWORD_RE = new RegExp(`\\b(${STOPWORDS.join('|')})\\b`, 'g')

export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,]/g, '') // drop punctuation
    .replace(STOPWORD_RE, '') // drop corporate suffixes / filler
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}
