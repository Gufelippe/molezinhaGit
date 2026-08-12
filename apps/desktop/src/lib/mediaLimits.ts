export const MEDIA_LIMITS = {
  avatar: { maxBytes: 1.5 * 1024 * 1024, maxSide: 512, accept: "image/png,image/jpeg,image/webp,image/gif" },
  banner: { maxBytes: 2 * 1024 * 1024, maxSide: 1280, accept: "image/png,image/jpeg,image/webp,image/gif" },
  sticker: { maxBytes: 512 * 1024, maxSide: 320, accept: "image/png,image/jpeg,image/webp,image/gif" },
  attachment: {
    maxBytes: 10 * 1024 * 1024,
    maxSide: 4096,
    accept:
      "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,application/zip,video/mp4,audio/mpeg,audio/ogg",
  },
  groupIcon: { maxBytes: 1.5 * 1024 * 1024, maxSide: 512, accept: "image/png,image/jpeg,image/webp,image/gif" },
  groupWallpaper: {
    maxBytes: 3 * 1024 * 1024,
    maxSide: 2560,
    accept: "image/png,image/jpeg,image/webp,image/gif",
  },
} as const;

export type MediaKind = keyof typeof MEDIA_LIMITS;

export async function validateImageFile(
  file: File,
  kind: MediaKind
): Promise<{ ok: true } | { ok: false; message: string }> {
  const lim = MEDIA_LIMITS[kind];
  const accepted = lim.accept.split(",");
  if (!accepted.includes(file.type)) {
    return {
      ok: false,
      message:
        kind === "attachment"
          ? "Formato não suportado."
          : "Formato inválido. Use PNG, JPEG, WebP ou GIF.",
    };
  }
  if (file.size > lim.maxBytes) {
    const mb = (lim.maxBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, message: `Arquivo grande demais (máx. ${mb} MB).` };
  }
  if (!file.type.startsWith("image/")) return { ok: true };
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.max(bmp.width, bmp.height);
    bmp.close();
    if (side > lim.maxSide) {
      return { ok: false, message: `Imagem grande demais (máx. ${lim.maxSide}px de lado).` };
    }
  } catch {
    return { ok: false, message: "Não foi possível ler a imagem." };
  }
  return { ok: true };
}

export async function readImageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  } catch {
    return null;
  }
}
