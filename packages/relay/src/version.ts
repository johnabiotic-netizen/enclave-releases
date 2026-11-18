/** True when version `a` (x.y.z) is older than `b`. A version that isn't x.y.z counts as oldest. */
export function versionBelow(a: unknown, b: string): boolean {
  const parse = (v: unknown): number[] | null => {
    const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(v) : null;
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!y) return false;
  if (!x) return true;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return false;
}
