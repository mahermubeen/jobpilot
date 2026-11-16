/**
 * Reads one JSON value out of a model reply: the whole reply, the body of a
 * code fence, or the text from the first bracket to the last.
 */
export function extractJson<T = unknown>(text: string): T {
  const attempts: string[] = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) attempts.push(fence[1].trim());
  const first = text.search(/[[{]/);
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next shape
    }
  }
  throw new Error("The AI reply did not contain valid JSON.");
}
