import sharp from "sharp";

const outputSize = 1024;
const contentSize = 860;
const analysisSize = 384;

type RgbaImage = {
  data: Buffer;
  width: number;
  height: number;
};

const parseHexColor = (hex: string) => {
  const value = hex.replace(/^#/, "");
  if (!/^[a-f0-9]{6}$/i.test(value)) {
    throw new Error("Ink color must be a six-digit hex value.");
  }

  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16)
  };
};

const percentile = (values: number[], ratio: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const decodeRgba = async (body: Buffer, resizeForAnalysis = false): Promise<RgbaImage> => {
  const pipeline = sharp(body, { limitInputPixels: 40_000_000 }).rotate();
  const decoded = await (resizeForAnalysis
    ? pipeline.resize(analysisSize, analysisSize, {
        fit: "inside",
        withoutEnlargement: true
      })
    : pipeline
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height
  };
};

type MonochromeAnalysis =
  | { mode: "transparent" }
  | { mode: "white-background"; darkestLuminance: number };

const analyzeMonochromeArtwork = (image: RgbaImage): MonochromeAnalysis | null => {
  const { data, width, height } = image;
  const pixelCount = width * height;
  let transparentPixels = 0;

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 24) transparentPixels += 1;
  }

  const hasTransparentBackground = transparentPixels / pixelCount >= 0.015;
  if (hasTransparentBackground) {
    const opaqueColors: Array<[number, number, number]> = [];
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] >= 210) {
        opaqueColors.push([data[index], data[index + 1], data[index + 2]]);
      }
    }

    if (opaqueColors.length < Math.max(24, pixelCount * 0.001)) return null;
    if (opaqueColors.length > pixelCount * 0.92) return null;

    const medianRed = percentile(opaqueColors.map((color) => color[0]), 0.5);
    const medianGreen = percentile(opaqueColors.map((color) => color[1]), 0.5);
    const medianBlue = percentile(opaqueColors.map((color) => color[2]), 0.5);
    const distances = opaqueColors.map(([red, green, blue]) =>
      Math.sqrt(
        (red - medianRed) ** 2 +
          (green - medianGreen) ** 2 +
          (blue - medianBlue) ** 2
      )
    );

    return percentile(distances, 0.95) <= 26 ? { mode: "transparent" } : null;
  }

  const borderValues: number[] = [];
  const foregroundLuminance: number[] = [];
  const foregroundChannelSpread: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const border = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;

      if (border) {
        borderValues.push(Math.min(red, green, blue));
      }

      if (luminance <= 220) {
        foregroundLuminance.push(luminance);
        foregroundChannelSpread.push(
          Math.max(red, green, blue) - Math.min(red, green, blue)
        );
      }
    }
  }

  if (percentile(borderValues, 0.1) < 238) return null;
  if (foregroundLuminance.length < Math.max(24, pixelCount * 0.001)) return null;
  if (foregroundLuminance.length > pixelCount * 0.75) return null;
  if (percentile(foregroundChannelSpread, 0.95) > 22) return null;

  return {
    mode: "white-background",
    darkestLuminance: Math.max(0, percentile(foregroundLuminance, 0.02))
  };
};

const buildRecoloredArtwork = (
  image: RgbaImage,
  analysis: MonochromeAnalysis,
  inkHex: string
) => {
  const ink = parseHexColor(inkHex);
  const recolored = Buffer.alloc(image.width * image.height * 4);
  const contrastRange =
    analysis.mode === "white-background"
      ? Math.max(32, 255 - analysis.darkestLuminance)
      : 255;

  for (let index = 0; index < image.data.length; index += 4) {
    recolored[index] = ink.red;
    recolored[index + 1] = ink.green;
    recolored[index + 2] = ink.blue;

    if (analysis.mode === "transparent") {
      recolored[index + 3] = image.data[index + 3];
      continue;
    }

    const luminance =
      0.2126 * image.data[index] +
      0.7152 * image.data[index + 1] +
      0.0722 * image.data[index + 2];
    recolored[index + 3] = Math.max(
      0,
      Math.min(255, Math.round(((255 - luminance) / contrastRange) * 255))
    );
  }

  return recolored;
};

export const recolorMonochromeLineArt = async ({
  source,
  inkHex
}: {
  source: Buffer;
  inkHex: string;
}) => {
  const image = await decodeRgba(source);
  const pixelCount = image.width * image.height;
  let transparentPixels = 0;
  const foregroundLuminance: number[] = [];

  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] < 250) transparentPixels += 1;

    const luminance =
      0.2126 * image.data[index] +
      0.7152 * image.data[index + 1] +
      0.0722 * image.data[index + 2];
    if (luminance < 245) foregroundLuminance.push(luminance);
  }

  const analysis: MonochromeAnalysis =
    transparentPixels / pixelCount >= 0.001
      ? { mode: "transparent" }
      : {
          mode: "white-background",
          darkestLuminance: Math.max(0, percentile(foregroundLuminance, 0.02))
        };
  const recolored = buildRecoloredArtwork(image, analysis, inkHex);

  return sharp(recolored, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4
    }
  })
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
};

export const tryCreateMonochromeLineArt = async ({
  source,
  inkHex
}: {
  source: Buffer;
  inkHex: string;
}) => {
  const analysisImage = await decodeRgba(source, true);
  const analysis = analyzeMonochromeArtwork(analysisImage);
  if (!analysis) return null;

  const fullImage = await decodeRgba(source);
  const recolored = buildRecoloredArtwork(fullImage, analysis, inkHex);
  const padding = Math.floor((outputSize - contentSize) / 2);

  return sharp(recolored, {
    raw: {
      width: fullImage.width,
      height: fullImage.height,
      channels: 4
    }
  })
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 4
    })
    .resize(contentSize, contentSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false
    })
    .extend({
      top: padding,
      bottom: outputSize - contentSize - padding,
      left: padding,
      right: outputSize - contentSize - padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
};
