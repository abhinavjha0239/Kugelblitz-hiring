/**
 * TypeORM returns decimal columns as strings (mysql2 driver behaviour).
 * Without a transformer, code that forgets `Number(...)` ends up with
 * surprises like `"5"+1 = "51"`. Apply this transformer on every decimal
 * column to materialise as a plain JS number.
 */
export const decimalTransformer = {
  to: (n: number | null | undefined): number | null | undefined => n,
  from: (s: string | null | undefined): number | null => {
    if (s === null || s === undefined) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  },
};
