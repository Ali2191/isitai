// ─── Public benchmark harness ────────────────────────────────────────────────
// Runs the forensic pipeline over a labeled sample set and computes accuracy,
// precision/recall for the "AI" class, ROC-AUC (Mann-Whitney U) and confusion
// matrix. Samples live in .data/benchmark.jsonl as {label: 0=real|1=ai, score}
// — scores are produced by running /api/detect offline against dataset images
// (DiffusionDB / GenImage / WildRF subsets); labels only, never pixels, are
// persisted, which keeps us compliant with dataset redistribution terms.

export function evaluate(samples) {
  const pos = samples.filter(s => s.label === 1)
  const neg = samples.filter(s => s.label === 0)
  if (!pos.length || !neg.length) return null
  const thr = 50
  const tp = pos.filter(s => s.score >= thr).length
  const fn = pos.length - tp
  const fp = neg.filter(s => s.score >= thr).length
  const tn = neg.length - fp
  // Mann–Whitney U based AUC
  let wins = 0, ties = 0
  for (const p of pos) for (const n of neg) {
    if (p.score > n.score) wins++
    else if (p.score === n.score) ties++
  }
  const auc = (wins + 0.5 * ties) / (pos.length * neg.length)
  const acc = (tp + tn) / samples.length
  return {
    n: samples.length, real: neg.length, ai: pos.length,
    accuracyPct: +(acc * 100).toFixed(1),
    precisionPct: tp + fp ? +(tp / (tp + fp) * 100).toFixed(1) : null,
    recallPct: +(tp / pos.length * 100).toFixed(1),
    auc: +auc.toFixed(3),
    confusion: { tp, fp, fn, tn },
  }
}
