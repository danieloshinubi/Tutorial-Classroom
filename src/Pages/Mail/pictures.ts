// Pictures put inside a message (supabase/241): made a sensible size before
// they go into the body as a data: URI. Photos from a phone are often 4–12 MB;
// mail does not need more than 1600 pixels across. Outside mail carries them
// as inline attachments (mail-outbound), so they show in any mail app.

const MAX_SIDE = 1600;
export const MAX_INLINE_TOTAL = 10 * 1024 * 1024;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that picture."));
    r.readAsDataURL(blob);
  });

export const isPicture = (f: File) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.type);

/** A picture as a data: URI, shrunk to at most 1600 px across (GIFs and small files as they are). */
export async function pictureForMail(file: File): Promise<string> {
  if (!isPicture(file)) throw new Error(`${file.name} is not a picture.`);
  if (/gif/i.test(file.type) || file.size < 300 * 1024) return readAsDataUrl(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Could not open ${file.name}.`));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return readAsDataUrl(file);
    const png = /png/i.test(file.type);
    if (!png) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Roughly how many bytes of pictures a message body carries. */
export const inlineBytes = (html: string) =>
  Array.from(html.matchAll(/data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/gi)).reduce((n, m) => n + Math.floor(m[1].length * 0.75), 0);
