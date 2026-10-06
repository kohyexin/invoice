import { isAnext, parseAnext } from "./anext";
import type { ParsedStatement } from "./types";

/** Reads a bank statement PDF. Only ANEXT is supported so far. */
export async function parseStatement(data: ArrayBuffer | Uint8Array): Promise<ParsedStatement> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data instanceof Uint8Array ? data : new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  if (isAnext(pages.join("\n"))) return parseAnext(pages);
  throw new Error("This bank's statements aren't supported yet. Only ANEXT can be imported for now.");
}
