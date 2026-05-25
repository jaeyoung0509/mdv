import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ImageRendererProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  markdownPath: string;
}

function isBrowserSafeSource(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src) || src.startsWith("#");
}

export function ImageRenderer({ markdownPath, src, alt, ...props }: ImageRendererProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!src) {
      setResolvedSrc(null);
      setMissing(true);
      return;
    }

    if (isBrowserSafeSource(src)) {
      setResolvedSrc(src);
      setMissing(false);
      return;
    }

    invoke<string>("resolve_image_src", { src, markdownPath })
      .then((value) => {
        if (!cancelled) {
          setResolvedSrc(value);
          setMissing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc(null);
          setMissing(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [markdownPath, src]);

  if (missing || !resolvedSrc) {
    return (
      <span className="missing-image" role="img" aria-label={alt || "Missing image"}>
        Missing image: {src}
      </span>
    );
  }

  return <img {...props} src={resolvedSrc} alt={alt || ""} />;
}
