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
      { x: 241, y: 272 },
      { x: 1013, y: 272 },
      { x: 1013, y: 838 },
      { x: 241, y: 838 }
    ],
    cup: [
      { x: 279, y: 402 },
      { x: 975, y: 402 },
      { x: 913, y: 878 },
      { x: 341, y: 878 }
    ],
    bag: [
      { x: 337, y: 523 },
      { x: 937, y: 523 },
      { x: 905, y: 922 },
      { x: 369, y: 922 }
    ]
  },
  white: {
    box: [
      { x: 241, y: 272 },
      { x: 1013, y: 272 },
      { x: 1013, y: 838 },
      { x: 241, y: 838 }
    ],
    cup: [
      { x: 279, y: 402 },
      { x: 975, y: 402 },
      { x: 913, y: 878 },
      { x: 341, y: 878 }
    ],
    bag: [
      { x: 337, y: 523 },
      { x: 937, y: 523 },
      { x: 905, y: 922 },
      { x: 369, y: 922 }
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
