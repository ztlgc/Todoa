export async function validateImageFile(file: File): Promise<void> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0)
    throw new Error("请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。");
  const bitmap = await createImageBitmap(file);
  const tooLarge = bitmap.width * bitmap.height > 40_000_000;
  bitmap.close();
  if (tooLarge) throw new Error("图片尺寸过大，请缩小后再插入。");
}
