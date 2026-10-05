// MCDM criterion vocabulary — single source for the 7 fixed criteria of the
// recommendation contract. Scoring itself (TOPSIS) lives only in the FastAPI
// backend; the frontend must not recompute scores.

export type Criterion =
  | 'travelTime'
  | 'cost'
  | 'lezCompliance'
  | 'accessibility'
  | 'convenience'
  | 'environment'
  | 'trend'

export type CriterionVector = Record<Criterion, number>
