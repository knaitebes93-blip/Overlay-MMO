import { PNG } from "pngjs";

type PreprocessMeta = {
  inverted: boolean;
  low: number;
  high: number;
  sharpened: boolean;
  mode: "soft" | "binary";
  threshold?: number;
  dilated?: boolean;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, value));

const computeOtsuThreshold = (values: Uint8Array) => {
  const histogram = Array.from({ length: 256 }, () => 0);
  for (let i = 0; i < values.length; i += 1) {
    histogram[values[i] ?? 0] += 1;
  }

  const total = values.length;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) {
    sum += t * (histogram[t] ?? 0);
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxBetween = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t] ?? 0;
    if (wB === 0) {
      continue;
    }
    wF = total - wB;
    if (wF === 0) {
      break;
    }
    sumB += t * (histogram[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxBetween) {
      maxBetween = between;
      threshold = t;
    }
  }

  return threshold;
};

const computePercentileRange = (histogram: number[], total: number) => {
  const lowTarget = Math.max(0, Math.floor(total * 0.02));
  const highTarget = Math.min(total, Math.ceil(total * 0.98));

  let low = 0;
  let high = 255;

  let cumulative = 0;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i] ?? 0;
    if (cumulative >= lowTarget) {
      low = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i] ?? 0;
    if (cumulative >= highTarget) {
      high = i;
      break;
    }
  }

  if (high <= low + 5) {
    return { low: 0, high: 255 };
  }
  return { low, high };
};

const sharpenLuma = (input: Uint8Array, width: number, height: number) => {
  if (width < 3 || height < 3) {
    return { output: input, sharpened: false };
  }
  const output = new Uint8Array(input.length);
  output.set(input);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const value =
        input[i] * 5 -
        input[i - 1] -
        input[i + 1] -
        input[i - width] -
        input[i + width];
      output[i] = clampByte(value);
    }
  }
  return { output, sharpened: true };
};

const dilateBinary = (values: Uint8Array, width: number, height: number) => {
  if (width < 3 || height < 3) {
    return values;
  }
  const output = new Uint8Array(values.length);
  output.set(values);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      if (values[i] === 0) {
        continue;
      }
      const neighborIsInk =
        values[i - 1] === 0 ||
        values[i + 1] === 0 ||
        values[i - width] === 0 ||
        values[i + width] === 0 ||
        values[i - width - 1] === 0 ||
        values[i - width + 1] === 0 ||
        values[i + width - 1] === 0 ||
        values[i + width + 1] === 0;
      if (neighborIsInk) {
        output[i] = 0;
      }
    }
  }
  return output;
};

export const preprocessForOcr = (
  pngBuffer: Buffer,
  mode: "soft" | "binary" = "soft"
): { image: Buffer; meta: PreprocessMeta } => {
  try {
    const png = PNG.sync.read(pngBuffer);
    const { width, height, data } = png;
    const totalPixels = width * height;
    const histogram = Array.from({ length: 256 }, () => 0);
    const luma = new Uint8Array(totalPixels);

    for (let i = 0, p = 0; p < totalPixels; p += 1, i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const y = clampByte(Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722));
      luma[p] = y;
      histogram[y] += 1;
    }

    const { low, high } = computePercentileRange(histogram, totalPixels);
    const denom = high - low || 1;
    for (let p = 0; p < totalPixels; p += 1) {
      const value = ((luma[p] - low) * 255) / denom;
      luma[p] = clampByte(Math.round(value));
    }

    const sharpened = sharpenLuma(luma, width, height);
    const outputLuma = sharpened.output;

    let sum = 0;
    for (let p = 0; p < totalPixels; p += 1) {
      sum += outputLuma[p] ?? 0;
    }
    const mean = sum / Math.max(1, totalPixels);
    const inverted = mean < 110;

    const grayscale = new Uint8Array(totalPixels);
    for (let i = 0, p = 0; p < totalPixels; p += 1, i += 4) {
      const value = inverted ? 255 - (outputLuma[p] ?? 0) : (outputLuma[p] ?? 0);
      grayscale[p] = value;
      data[i + 3] = 255;
    }

    if (mode === "binary") {
      const threshold = computeOtsuThreshold(grayscale);
      const binary = new Uint8Array(totalPixels);
      for (let p = 0; p < totalPixels; p += 1) {
        binary[p] = (grayscale[p] ?? 0) < threshold ? 0 : 255;
      }
      const dilated = dilateBinary(binary, width, height);
      for (let i = 0, p = 0; p < totalPixels; p += 1, i += 4) {
        const value = dilated[p] ?? 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }
      return {
        image: PNG.sync.write(png),
        meta: {
          inverted,
          low,
          high,
          sharpened: sharpened.sharpened,
          mode,
          threshold,
          dilated: true
        }
      };
    }

    for (let i = 0, p = 0; p < totalPixels; p += 1, i += 4) {
      const value = grayscale[p] ?? 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }

    return {
      image: PNG.sync.write(png),
      meta: { inverted, low, high, sharpened: sharpened.sharpened, mode }
    };
  } catch {
    return {
      image: pngBuffer,
      meta: { inverted: false, low: 0, high: 255, sharpened: false, mode }
    };
  }
};
