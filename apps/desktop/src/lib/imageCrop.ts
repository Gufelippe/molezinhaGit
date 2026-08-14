import { MEDIA_LIMITS, type MediaKind } from "./mediaLimits";

export type CropShape = "round" | "rect";

export type CropTarget = {
  /** Output pixels — also what keeps uploads inside the storage limits. */
  width: number;
  height: number;
  shape: CropShape;
  title: string;
  hint: string;
};

/** Output sizes stay under the `maxSide` of the matching media limit. */
export const CROP_TARGETS: Record<
  Extract<MediaKind, "avatar" | "banner" | "groupIcon" | "groupWallpaper" | "sticker">,
  CropTarget
> = {
  avatar: {
    width: 512,
    height: 512,
    shape: "round",
    title: "Ajustar avatar",
    hint: "Arraste para posicionar e use o zoom.",
  },
  banner: {
    width: 1200,
    height: 400,
    shape: "rect",
    title: "Ajustar banner",
    hint: "Arraste para escolher a faixa que aparece no perfil.",
  },
  groupIcon: {
    width: 512,
    height: 512,
    shape: "round",
    title: "Ajustar ícone do grupo",
    hint: "Arraste para posicionar e use o zoom.",
  },
  groupWallpaper: {
    width: 1920,
    height: 1080,
    shape: "rect",
    title: "Ajustar papel de parede",
    hint: "Arraste para escolher o enquadramento.",
  },
  sticker: {
    width: 320,
    height: 320,
    shape: "rect",
    title: "Ajustar figurinha",
    hint: "Enquadre em 320×320 — o arquivo é compactado sozinho.",
  },
};

export type CropRect = { sx: number; sy: number; sw: number; sh: number };

export type CropKind = keyof typeof CROP_TARGETS;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Draws the selected region at the target size and re-encodes it, dropping
 * quality until it fits `maxBytes`. A 6000px phone photo comes out as a few
 * dozen KB, so uploads never hit the storage limits again.
 */
export async function cropImageToFile(opts: {
  image: HTMLImageElement;
  crop: CropRect;
  kind: CropKind;
}): Promise<File> {
  const { image, crop, kind } = opts;
  const target = CROP_TARGETS[kind];
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    target.width,
    target.height
  );

  const maxBytes = MEDIA_LIMITS[kind].maxBytes;
  for (const [type, quality] of [
    ["image/webp", 0.92],
    ["image/webp", 0.8],
    ["image/webp", 0.65],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.7],
  ] as const) {
    const blob = await toBlob(canvas, type, quality);
    if (!blob || blob.type !== type) continue;
    if (blob.size <= maxBytes) {
      const ext = type === "image/webp" ? "webp" : "jpg";
      return new File([blob], `${kind}-${Date.now()}.${ext}`, { type });
    }
  }

  throw new Error("Não foi possível comprimir a imagem — tente outra.");
}
