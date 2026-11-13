import type { InkColor } from "./line-art.server";

export const stampPreviewKinds = ["bag", "cup", "box"] as const;
export type StampPreviewKind = (typeof stampPreviewKinds)[number];

export const stampPreviewProfiles = ["permanent", "custom"] as const;
export type StampPreviewProfile = (typeof stampPreviewProfiles)[number];

export type StampPreviewPalette = "regular" | "white";

type Point = { x: number; y: number };
export type StampPreviewQuad = [Point, Point, Point, Point];

export const resolveStampPreviewProfile = (
  value: string | null | undefined
): StampPreviewProfile => (value === "custom" ? "custom" : "permanent");

export const resolveStampPreviewPalette = (
  color: InkColor
): StampPreviewPalette => (color === "white" ? "white" : "regular");

const permanentPlacementQuads: Record<
  StampPreviewPalette,
  Record<StampPreviewKind, StampPreviewQuad>
> = {
  regular: {
    box: [
      { x: 291, y: 309 },
      { x: 963, y: 309 },
      { x: 963, y: 801 },
      { x: 291, y: 801 }
    ],
    cup: [
      { x: 337, y: 442 },
      { x: 917, y: 442 },
      { x: 865, y: 838 },
      { x: 389, y: 838 }
    ],
    bag: [
      { x: 406, y: 569 },
      { x: 868, y: 569 },
      { x: 843, y: 876 },
      { x: 431, y: 876 }
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

const customPlacementQuads: Record<StampPreviewKind, StampPreviewQuad> = {
  bag: [
    { x: 297, y: 420 },
    { x: 957, y: 420 },
    { x: 957, y: 1080 },
    { x: 297, y: 1080 }
  ],
  cup: [
    { x: 297, y: 420 },
    { x: 957, y: 420 },
    { x: 957, y: 1080 },
    { x: 297, y: 1080 }
  ],
  box: [
    { x: 327, y: 475 },
    { x: 927, y: 475 },
    { x: 927, y: 1075 },
    { x: 327, y: 1075 }
  ]
};

export const stampPreviewPlacementQuads: Record<
  StampPreviewProfile,
  Record<StampPreviewPalette, Record<StampPreviewKind, StampPreviewQuad>>
> = {
  permanent: permanentPlacementQuads,
  custom: {
    regular: customPlacementQuads,
    white: customPlacementQuads
  }
};

const permanentAssetFilename = (
  palette: StampPreviewPalette,
  kind: StampPreviewKind
) => `${palette}-${kind}.webp`;

const customAssetFilenames: Record<StampPreviewKind, string> = {
  bag: "custom-kraft-bag.webp",
  cup: "custom-white-bag.webp",
  box: "custom-box.webp"
};

export const stampPreviewAssetFilename = ({
  profile,
  palette,
  kind
}: {
  profile: StampPreviewProfile;
  palette: StampPreviewPalette;
  kind: StampPreviewKind;
}) =>
  profile === "custom"
    ? customAssetFilenames[kind]
    : permanentAssetFilename(palette, kind);
