export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function isTextContextPath(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

export function isImagePath(path: string): boolean {
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(path);
}
