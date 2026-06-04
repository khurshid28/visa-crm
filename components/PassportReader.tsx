"use client";

import { useState } from "react";
import { Scan, TickCircle, Warning2, Gallery, Refresh } from "iconsax-react";
import { parseMrz, type MrzResult } from "@/lib/mrz";
import { normalizeNationality, countryLabel } from "@/lib/options";
import PassportCropper, { type CropBox } from "@/components/PassportCropper";

export type PassportFields = {
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string;
  birthdate: string;
  gender: string;
  passportValidity: string;
};

// Rasmni berilgan burchakka (0/90/180/270) burib, rangli canvasga chizadi.
// Saqlash uchun shu rangli canvas ishlatiladi (to'g'rilangan holatda).
const TARGET_W = 1600;

function drawRotated(
  bitmap: ImageBitmap,
  rotation: number,
): HTMLCanvasElement {
  const scale = bitmap.width > TARGET_W ? TARGET_W / bitmap.width : 1;
  const sw = Math.round(bitmap.width * scale);
  const sh = Math.round(bitmap.height * scale);
  const swap = rotation === 90 || rotation === 270;

  const canvas = document.createElement("canvas");
  canvas.width = swap ? sh : sw;
  canvas.height = swap ? sw : sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  return canvas;
}

// OCR uchun: kulrang + kontrastni cho'zish (asl canvasga tegmaydi, nusxa oladi).
function enhanceForOcr(source: HTMLCanvasElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source.toDataURL("image/png");
  ctx.drawImage(source, 0, 0);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  // 1) Kulrang (luminance)
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  }

  // 2) Kontrastni cho'zish (2–98 persentil)
  const hist = new Array(256).fill(0);
  for (let j = 0; j < gray.length; j++) hist[gray[j]]++;
  const total = gray.length;
  const lowCut = total * 0.02;
  const highCut = total * 0.98;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowCut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= highCut) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((gray[j] - lo) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// MrzResult dagi to'g'ri check-digitlar soni (eng yaxshi burilishni tanlash uchun).
function validCount(res: MrzResult): number {
  return (
    (res.checks.passportNumber ? 1 : 0) +
    (res.checks.birthdate ? 1 : 0) +
    (res.checks.expiry ? 1 : 0)
  );
}

function canvasToFile(
  canvas: HTMLCanvasElement,
  baseName: string,
): Promise<File> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const safe = blob ?? new Blob([], { type: "image/png" });
      resolve(new File([safe], `${baseName}.png`, { type: "image/png" }));
    }, "image/png");
  });
}

// Passportdagi yuz (rasm) sohasini normallashtirilgan (0..1) box sifatida
// aniqlaydi. Avval brauzer FaceDetector'ini sinaymiz (aniq), bo'lmasa
// TD3 passport tuzilishiga mos standart joyni qaytaramiz. Box keyin
// foydalanuvchi tomonidan qo'lda aniqlanadi (PassportCropper).
async function detectFaceBox(source: HTMLCanvasElement): Promise<CropBox> {
  const W = source.width;
  const H = source.height;

  type Box = { x: number; y: number; width: number; height: number };

  const FaceDetectorCtor = (
    window as unknown as { FaceDetector?: new () => unknown }
  ).FaceDetector;
  if (FaceDetectorCtor) {
    try {
      const detector = new FaceDetectorCtor() as {
        detect: (s: CanvasImageSource) => Promise<{ boundingBox: Box }[]>;
      };
      const faces = await detector.detect(source);
      if (faces.length > 0) {
        const f = faces.sort(
          (a, b) =>
            b.boundingBox.width * b.boundingBox.height -
            a.boundingBox.width * a.boundingBox.height,
        )[0].boundingBox;
        // Yuz atrofiga bo'sh joy (passport foto uslubida).
        const padX = f.width * 0.45;
        const padTop = f.height * 0.35;
        const padBot = f.height * 0.35;
        const x = Math.max(0, f.x - padX);
        const y = Math.max(0, f.y - padTop);
        const x2 = Math.min(W, f.x + f.width + padX);
        const y2 = Math.min(H, f.y + f.height + padBot);
        return { x: x / W, y: y / H, w: (x2 - x) / W, h: (y2 - y) / H };
      }
    } catch {
      /* fallback */
    }
  }

  // TD3 (Uzbekiston) passport: foto chap tomonda, pastki yarmida.
  return { x: 0.04, y: 0.52, w: 0.3, h: 0.4 };
}

export default function PassportReader({
  onFill,
  onImage,
  onPhoto,
}: {
  onFill: (f: PassportFields) => boolean | void;
  onImage?: (file: File) => void;
  onPhoto?: (file: File) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [correctedSrc, setCorrectedSrc] = useState<string | null>(null);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);
  const [result, setResult] = useState<MrzResult | null>(null);
  const [error, setError] = useState("");

  function apply(res: MrzResult) {
    const applied = onFill({
      surname: res.surname,
      name: res.name,
      passportNumber: res.passportNumber,
      nationality: normalizeNationality(res.nationality),
      birthdate: res.birthdate,
      gender: res.gender,
      passportValidity: res.passportValidity,
    });
    // Ota komponent pasport mos kelmadi deb rad etsa — formani buzmaymiz.
    if (applied === false) {
      setResult(null);
      setError(
        `Pasport raqami mos kelmadi (skan: ${res.passportNumber || "—"}). Forma o'zgartirilmadi.`,
      );
      return false;
    }
    setResult(res);
    setError("");
    return true;
  }

  async function onImageFile(file: File) {
    setBusy(true);
    setProgress(0);
    setError("");
    setResult(null);
    setCorrectedSrc(null);
    setCropBox(null);
    try {
      const bitmap = await createImageBitmap(file);
      const baseName = file.name.replace(/\.[^.]+$/, "") || "passport";

      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        tessedit_pageseg_mode: "6" as never,
      });

      // 4 tomonni ham sinaymiz: 0, 90, 270, 180. Eng yaxshi check-digitli
      // burilishni tanlaymiz (rasm chap/o'ng/teskari yotgan bo'lsa ham).
      const rotations = [0, 90, 270, 180];
      let bestRes: MrzResult | null = null;
      let bestValid = -1;
      let bestRotation = 0;

      for (const r of rotations) {
        const colorCanvas = drawRotated(bitmap, r);
        const enhanced = enhanceForOcr(colorCanvas);
        const { data } = await worker.recognize(enhanced);
        const res = parseMrz(data.text);
        const valid = res ? validCount(res) : -1;
        if (valid > bestValid) {
          bestValid = valid;
          bestRes = res;
          bestRotation = r;
        }
        // Hammasi to'g'ri bo'lsa, qidiruvni to'xtatamiz.
        if (res && res.ok) break;
      }
      await worker.terminate();

      // To'g'rilangan (tik turgan) rangli rasmni saqlash uchun tayyorlaymiz.
      const correctedCanvas = drawRotated(bitmap, bestRotation);
      const correctedFile = await canvasToFile(correctedCanvas, baseName);
      const correctedUrl = URL.createObjectURL(correctedFile);

      if (!bestRes) {
        setError(
          "MRZ topilmadi. Rasm aniqroq (yaxshi yorug'lik) bo'lsin yoki pastdagi formani qo'lda to'ldiring.",
        );
        return;
      }

      // Pasport raqamini avval tekshiramiz. Mos kelmasa — rasm ham, kesilgan
      // foto ham saqlanmaydi (preview/cropper ko'rsatilmaydi).
      const matched = apply(bestRes);
      if (!matched) {
        URL.revokeObjectURL(correctedUrl);
        setPreview(null);
        setCorrectedSrc(null);
        setCropBox(null);
        return;
      }

      // Moslik bor — endi rasmni staged qilamiz va kesish UI'sini ko'rsatamiz.
      setPreview(correctedUrl);
      setCorrectedSrc(correctedUrl);
      onImage?.(correctedFile);

      // Yuz sohasini taxminiy aniqlaymiz — foydalanuvchi qo'lda to'g'rilaydi.
      try {
        const initial = await detectFaceBox(correctedCanvas);
        setCropBox(initial);
      } catch {
        setCropBox({ x: 0.04, y: 0.46, w: 0.3, h: 0.42 });
      }
    } catch {
      setError("Rasmni o'qib bo'lmadi. Pastdagi formani qo'lda to'ldiring.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-700">
        <Scan size={18} variant="Bold" />
        Passportdan avtomatik o'qish
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <label
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-white px-4 py-6 text-center transition hover:border-brand-400 hover:bg-brand-50 ${
            busy ? "pointer-events-none opacity-70" : ""
          }`}
        >
          {busy ? (
            <>
              <Refresh size={26} className="animate-spin text-brand-500" />
              <span className="text-sm font-medium text-brand-700">
                O'qilyapti... {progress}%
              </span>
            </>
          ) : (
            <>
              <Gallery size={26} variant="Bold" className="text-brand-500" />
              <span className="text-sm font-medium text-brand-700">
                Passport rasmini tanlang
              </span>
              <span className="text-xs text-slate-400">
                Pastki 2 qator (MRZ) ko'rinib tursin
              </span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImageFile(f);
            }}
          />
        </label>

        {preview && (
          <div className="hidden w-40 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200 sm:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="passport"
              className="h-full w-full object-cover"
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700">
          <Warning2 size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {correctedSrc && cropBox && (
        <div className="mt-3">
          <PassportCropper
            src={correctedSrc}
            initialBox={cropBox}
            onCropped={(_png, jpeg) => onPhoto?.(jpeg)}
          />
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-100">
          <div
            className={`flex items-center gap-1.5 text-xs font-semibold ${
              result.ok ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {result.ok ? (
              <TickCircle size={16} variant="Bold" />
            ) : (
              <Warning2 size={16} variant="Bold" />
            )}
            {result.ok
              ? "Tasdiqlandi — pastdagi forma to'ldirildi"
              : "Forma to'ldirildi, lekin tekshirib chiqing"}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>Familiya: <b>{result.surname || "—"}</b></span>
            <span>Ism: <b>{result.name || "—"}</b></span>
            <span>Pasport: <b>{result.passportNumber || "—"}</b></span>
            <span>Millat: <b>{result.nationality ? countryLabel(normalizeNationality(result.nationality)) : "—"}</b></span>
            <span>Tug'ilgan: <b>{result.birthdate || "—"}</b></span>
            <span>Amal muddati: <b>{result.passportValidity || "—"}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
