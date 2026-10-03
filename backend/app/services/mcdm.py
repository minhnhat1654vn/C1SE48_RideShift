"""MCDM — TOPSIS (Hwang & Yoon, 1981) recommendation engine (Objective 6).

Vector normalization -> weighting -> positive/negative ideal solutions ->
separation distances -> closeness coefficient. Numeric work on numpy arrays.
"""
from typing import Dict, List, Sequence

import numpy as np

CRITERIA = [
    "travelTime",
    "cost",
    "lezCompliance",
    "accessibility",
    "convenience",
    "environment",
    "trend",
]
COST_CRITERIA = {"travelTime", "cost"}  # lower raw value is better


def topsis(
    alternatives: Sequence[dict],  # {id, name, raw: {criterion: value}}
    weights: Dict[str, float],     # percentages summing to ~100
) -> List[dict]:
    if not alternatives:
        return []

    w_sum = sum(max(weights.get(c, 0), 0) for c in CRITERIA) or 1.0
    norm_w = {c: max(weights.get(c, 0), 0) / w_sum for c in CRITERIA}

    raw = np.array(
        [[float(a["raw"].get(c, 0) or 0) for c in CRITERIA] for a in alternatives],
        dtype=float,
    )

    # Step 1: vector normalization denominators
    denom = np.sqrt((raw ** 2).sum(axis=0))
    denom[denom == 0] = 1.0

    # Steps 1+2: weighted normalized decision matrix
    matrix = (raw / denom) * np.array([norm_w[c] for c in CRITERIA])

    # Step 3: ideal best / worst per criterion
    best = np.where(np.isin(CRITERIA, list(COST_CRITERIA)), matrix.min(axis=0), matrix.max(axis=0))
    worst = np.where(np.isin(CRITERIA, list(COST_CRITERIA)), matrix.max(axis=0), matrix.min(axis=0))

    # Step 4: separation + closeness
    d_pos = np.sqrt(((matrix - best) ** 2).sum(axis=1))
    d_neg = np.sqrt(((matrix - worst) ** 2).sum(axis=1))
    total = d_pos + d_neg
    scores = np.where(total == 0, 0.5, d_neg / total)

    order = np.argsort(-scores)
    results = []
    for rank, idx in enumerate(order, start=1):
        a = alternatives[idx]
        contributions = {c: float(matrix[idx][i]) for i, c in enumerate(CRITERIA)}
        normalized = {}
        for i, c in enumerate(CRITERIA):
            nv = float(raw[idx][i] / denom[i])
            normalized[c] = 1 - nv if c in COST_CRITERIA else nv
        results.append(
            {
                "id": a["id"],
                "name": a["name"],
                "score": float(scores[idx]),
                "rank": rank,
                "contributions": contributions,
                "normalized": normalized,
            }
        )
    return results
