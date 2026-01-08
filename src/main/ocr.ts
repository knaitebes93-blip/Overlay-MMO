import { createWorker } from "tesseract.js";

type OcrOutput = {
  text: string;
  confidence: number | null;
};

let workerPromise: ReturnType<typeof createWorker> | null = null;
const OCR_FALLBACK_CONFIDENCE = 45;
const OCR_CHAR_WHITELIST =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  " .,;:!?/\\\\|+-_=()[]{}<>\"'`~@#$%^&*";
const OCR_BASE_PARAMS: Record<string, string> = {
  tessedit_ocr_engine_mode: "1",
  tessedit_pageseg_mode: "6",
  preserve_interword_spaces: "1",
  user_defined_dpi: "240",
  load_system_dawg: "1",
  load_freq_dawg: "1",
  tessedit_char_whitelist: OCR_CHAR_WHITELIST
};
const OCR_SPARSE_PARAMS: Record<string, string> = {
  ...OCR_BASE_PARAMS,
  tessedit_pageseg_mode: "11"
};

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
};

const formatConfidence = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  return null;
};

const recognizeWithParams = async (
  image: Buffer,
  params: Record<string, string>
): Promise<OcrOutput> => {
  const worker = await getWorker();
  await worker.setParameters(params);
  const result = await worker.recognize(image);
  return {
    text: result.data.text ?? "",
    confidence: formatConfidence(result.data.confidence)
  };
};

export const runOcr = async (image: Buffer): Promise<OcrOutput> => {
  const primary = await recognizeWithParams(image, OCR_BASE_PARAMS);
  if (primary.confidence !== null && primary.confidence >= OCR_FALLBACK_CONFIDENCE) {
    return primary;
  }
  const fallback = await recognizeWithParams(image, OCR_SPARSE_PARAMS);
  if (fallback.confidence !== null) {
    if (primary.confidence === null || fallback.confidence > primary.confidence) {
      return fallback;
    }
  }
  return primary;
};

export const shutdownOcrWorker = async (): Promise<void> => {
  if (!workerPromise) {
    return;
  }
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
};
