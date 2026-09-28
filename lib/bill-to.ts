export type BillTo = { name: string; attention: string; lines: string[] };

/** Billed-to block from a client record. Blank or "0" cells (the old
 *  VLOOKUP artefact) are dropped; city and country go on the last line. */
export function billToFromClient(c: {
  name: string;
  directorName: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  country: string;
}): BillTo {
  const clean = (v: string) => (v && v.trim() !== "0" ? v.trim() : "");
  const lines = [c.address1, c.address2, c.address3].map(clean).filter(Boolean);
  const tail = [clean(c.city), clean(c.country)].filter(Boolean).join(", ");
  if (tail && !lines.some((l) => l.toUpperCase().includes(tail.toUpperCase()))) lines.push(tail);
  return { name: c.name, attention: clean(c.directorName), lines };
}
