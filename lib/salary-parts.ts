/* The salary category (工资) mixes pay types; the line's 用途 says which.
   Reports split it the way the workbook's Monthly sheet does. */

export const SALARY_CATEGORY = "工资";

export const SALARY_PARTS = [
  { key: "工资", label: "Base salary" },
  { key: "奖金", label: "Bonus" },
  { key: "佣金", label: "Commission" },
] as const;

const OTHER = { key: "", label: "Other" };

/** USD per pay type from per-purpose totals; anything else in the category is "Other". */
export function salaryParts(byPurpose: { purpose: string; usd: number }[]) {
  const parts = [...SALARY_PARTS, OTHER].map((p) => ({ ...p, usd: 0 }));
  for (const p of byPurpose) {
    const part = parts.find((x) => x.key === p.purpose) ?? parts[parts.length - 1];
    part.usd += p.usd;
  }
  return parts;
}
