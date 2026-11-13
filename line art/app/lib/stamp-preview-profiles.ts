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
      { x: 347, y: 350 },
      { x: 907, y: 350 },
      { x: 907, y: 760 },
      { x: 347, y: 760 }
    ],
    cup: [
      { x: 385, y: 475 },
      { x: 869, y: 475 },
      { x: 825, y: 805 },
      { x: 429, y: 805 }
    ],
    bag: [
      { x: 452, y: 640 },
      { x: 822, y: 640 },
      { x: 802, y: 885 },
      { x: 472, y: 885 }
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
