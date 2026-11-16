import { extractText, getDocumentProxy } from "unpdf";
import { HttpError, route } from "@/lib/api";
import { parseCv } from "@/lib/ai/tasks";

/** Reads an uploaded CV (PDF or text) into a structured profile for the user to confirm. */
export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a CV file first.");
  if (file.size > 8 * 1024 * 1024) throw new HttpError(400, "That file is larger than 8 MB.");

  let text: string;
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else {
    text = await file.text();
  }
  if (text.trim().length < 200) {
    throw new HttpError(
      400,
      "Could not read text from that file. If it is a scanned image, export a text PDF instead.",
    );
  }
  return { profile: await parseCv(text) };
});
