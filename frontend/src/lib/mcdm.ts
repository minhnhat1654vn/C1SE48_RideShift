// MCDM (TOPSIS) recommendation engine for RideShift
// Objective 6 – Recommendation Engine: explicit normalization, weighting,
// scoring and ranking procedures instead of ad-hoc if/else rules.

export type Criterion =
  | 'travelTime'
  | 'cost'
  | 'lezCompliance'
  | 'accessibility'
  | 'convenience'
  | 'environment'
  | 'trend'

export const CRITERIA: Criterion[] = [
  'travelTime',
  'cost',
  'lezCompliance',
  'accessibility',
  'convenience',
  'environment',
  'trend',
]

/** Criteria where a LOWER raw value is better */
const COST_CRITERIA: Set<Criterion> = new Set(['travelTime', 'cost'])

export type CriterionVector = Record<Criterion, number>

export type Alternative = {
  id: string
  name: string
  raw: CriterionVector // raw criterion values (time in min, cost in VND, others 0..1)
}

export type ScoredAlternative = Alternative & {
  /** TOPSIS closeness score 0..1 */
  score: number
  rank: number
  /** weighted normalized contribution per criterion (for explainability, US-20) */
  contributions: CriterionVector
  /** normalized criterion values 0..1 (higher = better) */
  normalized: CriterionVector
}

/**
 * Classic TOPSIS (Hwang & Yoon, 1981):
 * 1. Vector normalization
 * 2. Apply weights
 * 3. Identify positive/negative ideal solutions
 * 4. Compute separation distances and closeness coefficient
 */
export function topsis(
  alternatives: Alternative[],
  weights: Record<Criterion, number> // percentages summing to ~100
): ScoredAlternative[] {
  if (alternatives.length === 0) return []
  const wSum = CRITERIA.reduce((s, c) => s + Math.max(weights[c] ?? 0, 0), 0) || 1
  const normWeights: Record<Criterion, number> = {} as CriterionVector
  for (const c of CRITERIA) normWeights[c] = Math.max(weights[c] ?? 0, 0) / wSum

  // Step 1: vector normalization denominator per criterion
  const denom: CriterionVector = {} as CriterionVector
  for (const c of CRITERIA) {
    let sum = 0
    for (const a of alternatives) sum += (a.raw[c] ?? 0) ** 2
    denom[c] = Math.sqrt(sum) || 1
  }

  // Step 1+2: normalized weighted decision matrix
  const matrix = alternatives.map((a) => {
    const row = {} as CriterionVector
    for (const c of CRITERIA) {
      const x = (a.raw[c] ?? 0) / denom[c]
      row[c] = x * normWeights[c]
    }
    return row
  })

  // Step 3: ideal best / worst per criterion
  const best: CriterionVector = {} as CriterionVector
  const worst: CriterionVector = {} as CriterionVector
  for (const c of CRITERIA) {
    const col = matrix.map((r) => r[c])
    best[c] = COST_CRITERIA.has(c) ? Math.min(...col) : Math.max(...col)
    worst[c] = COST_CRITERIA.has(c) ? Math.max(...col) : Math.min(...col)
  }

  // Step 4: separation measures + closeness
  const scored = alternatives.map((a, i) => {
    let dPos = 0
    let dNeg = 0
    for (const c of CRITERIA) {
      dPos += (matrix[i][c] - best[c]) ** 2
      dNeg += (matrix[i][c] - worst[c]) ** 2
    }
    dPos = Math.sqrt(dPos)
    dNeg = Math.sqrt(dNeg)
    const score = dPos + dNeg === 0 ? 0.5 : dNeg / (dPos + dNeg)
    const contributions = {} as CriterionVector
    const normalized = {} as CriterionVector
    for (const c of CRITERIA) {
      contributions[c] = matrix[i][c]
      // normalized where higher is better (flip cost criteria for display)
      const nv = (a.raw[c] ?? 0) / denom[c]
      normalized[c] = COST_CRITERIA.has(c) ? 1 - nv : nv
    }
    return { ...a, score, rank: 0, contributions, normalized }
  })

  scored.sort((x, y) => y.score - x.score)
  scored.forEach((s, i) => (s.rank = i + 1))
  return scored
}
