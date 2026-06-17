// CLASSIFY step (architecture §2.2 / techstack §5.1): LLM proposes an HS code,
// validated against the curated hs_reference. Confidence is high when the LLM
// proposal matches a table entry cleanly, low when it's reaching.
//
// Per the build decision: real Anthropic integration with a deterministic
// keyword fallback when ANTHROPIC_API_KEY is unset, so the pipeline is testable
// without a key. Classification stays *assisted research*, never authoritative.
//
// Model: claude-haiku-4-5 — cheapest model ($1/$5 per MTok), supports structured
// outputs; ideal for cheap classification. No thinking/effort (errors on Haiku).
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import Anthropic from '@anthropic-ai/sdk'

// Classification confidence floor (~0.5–0.6, architecture §4.3). Below this we
// emit a LOW_CONFIDENCE control hit -> REVIEW: "we're not confident enough about
// *what this product is* to tell you whether it can ship."
export const CONFIDENCE_FLOOR = 0.6

const CLASSIFY_MODEL = 'claude-haiku-4-5'

export interface HsCandidate {
  hsCode: string
  description: string
}

export interface ClassificationResult {
  hsCode: string | null
  confidence: number // 0..1
  description: string | null
  belowFloor: boolean
  source: 'llm' | 'lookup'
  reasoning: string
}

// Deterministic keyword → HS map for the fallback path. Each target code must
// exist in the curated hs_reference (validated against `candidates` at runtime).
const KEYWORD_HS: Array<{ terms: string[]; hsCode: string; confidence: number }> = [
  { terms: ['notebook', 'laptop', 'portable computer'], hsCode: '8471.30', confidence: 0.93 },
  { terms: ['desktop', 'workstation'], hsCode: '8471.41', confidence: 0.85 },
  { terms: ['router', 'switch', 'network', 'routing'], hsCode: '8517.62', confidence: 0.88 },
  { terms: ['thermal', 'infrared', 'ir camera', 'imaging', 'camera', 'surveillance'], hsCode: '8525.89', confidence: 0.82 },
  { terms: ['radar'], hsCode: '8526.10', confidence: 0.86 },
  { terms: ['turbine', 'turbojet', 'engine', 'aircraft'], hsCode: '8411.91', confidence: 0.84 },
  { terms: ['chip', 'semiconductor', 'integrated circuit', 'processor', 'microcontroller'], hsCode: '8542.31', confidence: 0.83 },
  { terms: ['laser', 'optical', 'lcd'], hsCode: '9013.80', confidence: 0.7 },
]

function lookupClassify(
  productDescription: string,
  candidates: HsCandidate[],
): ClassificationResult {
  const valid = new Map(candidates.map((c) => [c.hsCode, c.description]))
  const text = productDescription.toLowerCase()

  for (const entry of KEYWORD_HS) {
    if (entry.terms.some((t) => text.includes(t)) && valid.has(entry.hsCode)) {
      const confidence = Math.round(entry.confidence * 1000) / 1000
      return {
        hsCode: entry.hsCode,
        confidence,
        description: valid.get(entry.hsCode) ?? null,
        belowFloor: confidence < CONFIDENCE_FLOOR,
        source: 'lookup',
        reasoning: `Keyword match on "${entry.terms.find((t) => text.includes(t))}".`,
      }
    }
  }

  // No confident keyword match — return a low-confidence "unknown" so the
  // verdict logic forces REVIEW rather than guessing.
  return {
    hsCode: null,
    confidence: 0.3,
    description: null,
    belowFloor: true,
    source: 'lookup',
    reasoning: 'No keyword matched the curated HS subset; classification is uncertain.',
  }
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hsCode: {
      type: 'string',
      description: 'The single best HS code from the provided list, or empty string if none fit.',
    },
    confidence: {
      type: 'number',
      description: '0..1 confidence that this HS code is correct for the product.',
    },
    reasoning: {
      type: 'string',
      description: 'One short sentence explaining the choice.',
    },
  },
  required: ['hsCode', 'confidence', 'reasoning'],
}

async function llmClassify(
  productDescription: string,
  candidates: HsCandidate[],
): Promise<ClassificationResult> {
  const client = new Anthropic() // reads ANTHROPIC_API_KEY from env
  const valid = new Map(candidates.map((c) => [c.hsCode, c.description]))
  const list = candidates.map((c) => `${c.hsCode} — ${c.description}`).join('\n')

  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 512,
    system:
      'You classify export products to an HS (Harmonized System) code. You MUST choose ' +
      'a code from the provided list, or return an empty hsCode if none reasonably fit. ' +
      'This is decision-support research, not an authoritative ruling. Be conservative: ' +
      'if the product is ambiguous, lower your confidence.',
    output_config: { format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `Product description:\n"""${productDescription}"""\n\n` +
          `Valid HS codes (choose exactly one, or empty):\n${list}`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '{}'
  let parsed: { hsCode?: string; confidence?: number; reasoning?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = {}
  }

  // Propose-then-VALIDATE: only codes that exist in the curated table survive.
  const proposed = (parsed.hsCode ?? '').trim()
  const exists = valid.has(proposed)
  let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.4
  if (!exists) confidence = Math.min(confidence, 0.35) // hallucinated / no code -> force REVIEW
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000))

  return {
    hsCode: exists ? proposed : null,
    confidence,
    description: exists ? (valid.get(proposed) ?? null) : null,
    belowFloor: confidence < CONFIDENCE_FLOOR,
    source: 'llm',
    reasoning: exists
      ? (parsed.reasoning ?? 'LLM proposal validated against the HS reference.')
      : 'LLM proposed a code not in the curated HS reference; treated as low confidence.',
  }
}

export async function classify(
  productDescription: string,
  candidates: HsCandidate[],
): Promise<ClassificationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return lookupClassify(productDescription, candidates)
  }
  try {
    return await llmClassify(productDescription, candidates)
  } catch (err) {
    // Never let a transient AI error fail a compliance screening — fall back to
    // the deterministic lookup, which is honest about its (lower) confidence.
    const result = lookupClassify(productDescription, candidates)
    result.reasoning = `LLM classify unavailable (${(err as Error).message}); used keyword lookup.`
    return result
  }
}
