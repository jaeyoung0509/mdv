import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { OutlineHeading } from "../lib/types";

interface OutlinePanelProps {
  headings: OutlineHeading[];
  open: boolean;
  onClose: () => void;
}

function scrollToHeading(id: string): void {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `#${id}`);
}

export function OutlinePanel({ headings, open, onClose }: OutlinePanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      return;
    }

    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) {
      setActiveId(null);
      return;
    }

    const updateActiveHeading = () => {
      const isNearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

      if (isNearBottom) {
        setActiveId(headings[headings.length - 1]?.id ?? null);
        return;
      }

      let nextActiveId = headings[0]?.id ?? null;

      for (const heading of headings) {
        const element = document.getElementById(heading.id);

        if (!element) {
          continue;
        }

        if (element.getBoundingClientRect().top <= 120) {
          nextActiveId = heading.id;
          continue;
        }

        break;
      }

      setActiveId(nextActiveId);
    };

    const observer = new IntersectionObserver(updateActiveHeading, {
      rootMargin: "-96px 0px -70% 0px",
      threshold: [0, 1],
    });

    elements.forEach((element) => observer.observe(element));
    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateActiveHeading);
    };
  }, [headings, open]);

  if (!open) {
    return null;
  }

  return (
    <aside className="outline-panel" aria-label="Outline">
      <div className="panel-header">
        <h2>Outline</h2>
        <button
          type="button"
          className="icon-button outline-panel__close"
          title="Close outline"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {headings.length > 0 ? (
        <nav className="outline-nav">
          {headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              className="outline-nav__item"
              data-level={heading.level}
              aria-current={activeId === heading.id ? "true" : undefined}
              onClick={() => scrollToHeading(heading.id)}
            >
              {heading.text}
            </button>
          ))}
        </nav>
      ) : (
        <p className="outline-empty">No headings</p>
      )}
    </aside>
  );
}
