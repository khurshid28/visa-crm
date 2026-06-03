// Passport rasmidan MRZ o'qish (server tomonida, bot uchun).
// tesseract.js Node'da ham ishlaydi. Brauzerdagi PassportReader bilan bir xil
// parseMrz ishlatiladi, lekin bu yerda canvas yo'q — rasm to'g'ridan-to'g'ri
// OCR'ga beriladi (bot rasmi odatda tik turadi).

import { parseMrz, type MrzResult } from "./mrz";

// Rasm buffer'idan MRZ matnini o'qib, parseMrz natijasini qaytaradi.
// OCR muvaffaqiyatsiz bo'lsa null qaytaradi.
export async function readMrzFromImage(buf: Buffer): Promise<MrzResult | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1);
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      tessedit_pageseg_mode: "6" as never,
    });
    const { data } = await worker.recognize(buf);
    await worker.terminate();
    return parseMrz(data.text);
  } catch {
    return null;
  }
}

export type { MrzResult };
