import path from "node:path";
import sharp from "sharp";
import type { InkColor } from "./line-art.server";
import type { StampPreviewKind } from "./stamp-previews.server";

type Point = { x: number; y: number };
type Quad = [Point, Point, Point, Point];

const canvasSize = 1254;
const artworkSize = 768;
const artworkContentSize = 752;
const minimumArtworkContentSize = Math.round(artworkContentSize * 0.58);
const targetInkArea = artworkContentSize * artworkContentSize * 0.5;

const placementQuads: Record<"regular" | "white", Record<StampPreviewKind, Quad>> = {
  regular: {
    box: [
      { x: 363, y: 388 },
      { x: 891, y: 388 },
      { x: 891, y: 916 },
      { x: 363, y: 916 }
    ],
    cup: [
      { x: 426, y: 456 },
      { x: 828, y: 456 },
      { x: 810, y: 841 },
      { x: 444, y: 841 }
    ],
    bag: [
      { x: 425, y: 525 },
      { x: 829, y: 525 },
      { x: 806, y: 895 },
      { x: 448, y: 895 }
    ]
  },
  white: {
    box: [
      { x: 363, y: 350 },
      { x: 891, y: 350 },
      { x: 891, y: 878 },
      { x: 363, y: 878 }
    ],
    cup: [
      { x: 426, y: 456 },
      { x: 828, y: 456 },
      { x: 810, y: 841 },
      { x: 444, y: 841 }
    ],
    bag: [
      { x: 425, y: 525 },
      { x: 829, y: 525 },
      { x: 806, y: 895 },
      { x: 448, y: 895 }
    ]
  }
};

const mockupPath = (kind: StampPreviewKind, color: InkColor) => {
  const palette = color === "white" ? "white" : "regular";
  const filename = `${palette}-${kind}.webp`;

  return path.join(
    process.cwd(),
    "public",
    "stamp-mockups",
    "v3",
    "optimized",
    filename
  );
};

const solveLinearSystem = (matrix: number[][], values: number[]) => {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      throw new Error("Stamp placement geometry could not be resolved.");
    }

    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  return augmented.map((row) => row[size]);
};

const destinationToArtworkTransform = (quad: Quad) => {
  const targets: Quad = [
    { x: 0, y: 0 },
    { x: artworkSize - 1, y: 0 },
    { x: artworkSize - 1, y: artworkSize - 1 },
    { x: 0, y: artworkSize - 1 }
  ];
  const matrix: number[][] = [];
  const values: number[] = [];

  quad.forEach((point, index) => {
    const target = targets[index];
    matrix.push([
      point.x,
      point.y,
      1,
      0,
      0,
      0,
      -target.x * point.x,
      -target.x * point.y
    ]);
    values.push(target.x);
    matrix.push([
      0,
      0,
      0,
      point.x,
      point.y,
      1,
      -target.y * point.x,
      -target.y * point.y
    ]);
    values.push(target.y);
  });

  return solveLinearSystem(matrix, values);
};

const removeOpaqueWhiteBackground = (
  data: Buffer,
  width: number,
  height: number,
  color: InkColor
) => {
  let hasTransparency = false;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) {
      hasTransparency = true;
      break;
    }
  }

  if (hasTransparency || color === "white") {
    return { data, width, height };
  }

  const normalized = Buffer.from(data);
  for (let index = 0; index < normalized.length; index += 4) {
    const distanceFromWhite = Math.max(
      255 - normalized[index],
      255 - normalized[index + 1],
      255 - normalized[index + 2]
    );
    normalized[index + 3] = Math.max(
      0,
      Math.min(255, Math.round((distanceFromWhite - 6) * 1.35))
    );
  }

  return { data: normalized, width, height };
};

const visualContentSize = (
  data: Buffer,
  width: number,
  height: number
) => {
  let alphaTotal = 0;
  for (let index = 3; index < data.length; index += 4) {
    alphaTotal += data[index] / 255;
  }

  const boundingArea = Math.max(1, width * height);
  const inkFillRatio = Math.max(0.04, alphaTotal / boundingArea);
  const aspectRatio = width / Math.max(1, height);
  const aspectSpan = Math.max(aspectRatio, 1 / Math.max(aspectRatio, 0.01));
  const desiredLongEdge = Math.sqrt(
    (targetInkArea * aspectSpan) / inkFillRatio
  );

  return Math.round(
    Math.max(
      minimumArtworkContentSize,
      Math.min(artworkContentSize, desiredLongEdge)
    )
  );
};

const prepareArtwork = async (body: Buffer, color: InkColor) => {
  const decoded = await sharp(body)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const normalized = removeOpaqueWhiteBackground(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    color
  );
  const normalizedPng = await sharp(normalized.data, {
    raw: {
      width: normalized.width,
      height: normalized.height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
  const trimmedPng = await sharp(normalizedPng)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 6
    })
    .png()
    .toBuffer();
  const trimmed = await sharp(trimmedPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const contentSize = visualContentSize(
    trimmed.data,
    trimmed.info.width,
    trimmed.info.height
  );
  const padding = Math.floor((artworkSize - contentSize) / 2);

  return sharp(trimmedPng)
    .resize(contentSize, contentSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .extend({
      top: padding,
      bottom: artworkSize - contentSize - padding,
      left: padding,
      right: artworkSize - contentSize - padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
};

const sampleArtwork = (
  artwork: Buffer,
  sourceX: number,
  sourceY: number
) => {
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = Math.min(artworkSize - 1, x0 + 1);
  const y1 = Math.min(artworkSize - 1, y0 + 1);
  const xWeight = sourceX - x0;
  const yWeight = sourceY - y0;
  const samples = [
    { x: x0, y: y0, weight: (1 - xWeight) * (1 - yWeight) },
    { x: x1, y: y0, weight: xWeight * (1 - yWeight) },
    { x: x0, y: y1, weight: (1 - xWeight) * yWeight },
    { x: x1, y: y1, weight: xWeight * yWeight }
  ];
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (const sample of samples) {
    const index = (sample.y * artworkSize + sample.x) * 4;
    const sampleAlpha = artwork[index + 3] / 255;
    const alphaWeight = sample.weight * sampleAlpha;
    alpha += alphaWeight;
    red += artwork[index] * alphaWeight;
    green += artwork[index + 1] * alphaWeight;
    blue += artwork[index + 2] * alphaWeight;
  }

  if (alpha <= 0.0001) return [0, 0, 0, 0] as const;

  return [
    Math.round(red / alpha),
    Math.round(green / alpha),
    Math.round(blue / alpha),
    Math.round(alpha * 255)
  ] as const;
};

const warpArtwork = (artwork: Buffer, quad: Quad, color: InkColor) => {
  const transform = destinationToArtworkTransform(quad);
  const overlay = Buffer.alloc(canvasSize * canvasSize * 4);
  const minX = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.x))));
  const maxX = Math.min(canvasSize - 1, Math.ceil(Math.max(...quad.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.y))));
  const maxY = Math.min(canvasSize - 1, Math.ceil(Math.max(...quad.map((point) => point.y))));
  const opacity = color === "white" ? 0.95 : 0.93;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const denominator = transform[6] * x + transform[7] * y + 1;
      const sourceX =
        (transform[0] * x + transform[1] * y + transform[2]) / denominator;
      const sourceY =
        (transform[3] * x + transform[4] * y + transform[5]) / denominator;

      if (
        sourceX < 0 ||
        sourceX > artworkSize - 1 ||
        sourceY < 0 ||
        sourceY > artworkSize - 1
      ) {
        continue;
      }

      const [red, green, blue, alpha] = sampleArtwork(artwork, sourceX, sourceY);
      if (alpha === 0) continue;
      const index = (y * canvasSize + x) * 4;
      const fineVariation = ((x * 17 + y * 31) % 7) / 100;
      const broadVariation =
        ((Math.floor(x / 7) * 11 + Math.floor(y / 7) * 19) % 4) / 100;
      const materialVariation = Math.min(
        1,
        0.94 + fineVariation + broadVariation
      );
      const fiberFade = (x * 37 + y * 17) % 97 === 0 ? 0.9 : 1;
      overlay[index] = red;
      overlay[index + 1] = green;
      overlay[index + 2] = blue;
      overlay[index + 3] = Math.round(
        alpha * opacity * materialVariation * fiberFade
      );
    }
  }

  return overlay;
};

const renderPreparedStampPreview = async ({
  kind,
  preparedArtwork,
  color
}: {
  kind: StampPreviewKind;
  preparedArtwork: Buffer;
  color: InkColor;
}) => {
  const startedAt = Date.now();
  const palette = color === "white" ? "white" : "regular";
  const overlay = warpArtwork(preparedArtwork, placementQuads[palette][kind], color);
  const composite = await sharp(mockupPath(kind, color))
    .resize(canvasSize, canvasSize, { fit: "cover" })
    .composite([
      {
        input: overlay,
        raw: { width: canvasSize, height: canvasSize, channels: 4 },
        blend: color === "white" ? "over" : "multiply"
      }
    ])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const compositeInput = {
    raw: {
      width: composite.info.width,
      height: composite.info.height,
      channels: composite.info.channels
    }
  } as const;

  // Compression effort affects CPU time, not visual quality. Encoding both
  // outputs from the same composite avoids decoding the full WEBP again just
  // to create the storefront thumbnail.
  const [body, thumbnail] = await Promise.all([
    sharp(composite.data, compositeInput)
      .webp({ quality: 94, alphaQuality: 100, effort: 3, smartSubsample: true })
      .toBuffer(),
    sharp(composite.data, compositeInput)
      .resize(640, 640, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 84, effort: 3, smartSubsample: true })
      .toBuffer()
  ]);

  return { kind, body, thumbnail, durationMs: Date.now() - startedAt };
};

export const renderStampPreviews = async ({
  kinds,
  artwork,
  color
}: {
  kinds: StampPreviewKind[];
  artwork: Buffer;
  color: InkColor;
}) => {
  // The artwork normalization/trim pass is identical for every mockup and was
  // previously repeated three times. Prepare it once and reuse the pixels.
  const preparedArtwork = await prepareArtwork(artwork, color);

  return Promise.all(
    kinds.map((kind) =>
      renderPreparedStampPreview({ kind, preparedArtwork, color })
    )
  );
};

export const renderStampPreview = async ({
  kind,
  artwork,
  color
}: {
  kind: StampPreviewKind;
  artwork: Buffer;
  color: InkColor;
}) => {
  const [preview] = await renderStampPreviews({ kinds: [kind], artwork, color });

  return preview.body;
};
