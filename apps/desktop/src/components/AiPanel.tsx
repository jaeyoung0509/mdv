import {
  ArrowUp,
  Bot,
  FileText,
  MessageSquareQuote,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { DragEvent, FormEvent, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiContextItem, AiProvider, AiSettings } from "../lib/types";

const TEXT_CONTEXT_LIMIT = 40 * 1024;

interface AiPanelProps {
  answer: string;
  contextItems: AiContextItem[];
  currentDocumentLabel?: string;
  error: string | null;
  open: boolean;
  prompt: string;
  settings: AiSettings;
  status: "idle" | "streaming" | "error";
  onCancel: () => void;
  onClose: () => void;
  onContextAdd: (items: AiContextItem[]) => void;
  onContextRemove: (index: number) => void;
  onPromptChange: (prompt: string) => void;
  onProviderChange: (providerId: string) => void;
  onSend: () => void;
}

function contextIcon(kind: AiContextItem["kind"]) {
  if (kind === "file") {
    return <FileText size={13} aria-hidden="true" />;
  }

  if (kind === "selection") {
    return <MessageSquareQuote size={13} aria-hidden="true" />;
  }

  return <Bot size={13} aria-hidden="true" />;
}

function truncateText(value: string): string {
  if (value.length <= TEXT_CONTEXT_LIMIT) {
    return value;
  }

  const head = value.slice(0, TEXT_CONTEXT_LIMIT / 2);
  const tail = value.slice(-TEXT_CONTEXT_LIMIT / 4);
  return `${head}\n\n[truncated: context item exceeded 40KB]\n\n${tail}`;
}

function isTextContextFile(fileName: string): boolean {
  return /\.(md|markdown|txt)$/i.test(fileName);
}

function activeProvider(settings: AiSettings): AiProvider | undefined {
  return (
    settings.providers.find((provider) => provider.id === settings.activeProviderId) ??
    settings.providers[0]
  );
}

export function AiPanel({
  answer,
  contextItems,
  currentDocumentLabel,
  error,
  open,
  prompt,
  settings,
  status,
  onCancel,
  onClose,
  onContextAdd,
  onContextRemove,
  onPromptChange,
  onProviderChange,
  onSend,
}: AiPanelProps) {
  if (!open) {
    return null;
  }

  const provider = activeProvider(settings);
  const canSend = Boolean(
    provider?.baseUrl && provider.model && prompt.trim() && status !== "streaming",
  );
  const contextCount = contextItems.length + (currentDocumentLabel ? 1 : 0);

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const text = event.dataTransfer.getData("text/plain");
    const files = Array.from(event.dataTransfer.files);
    const nextItems: AiContextItem[] = [];

    if (text.trim()) {
      nextItems.push({
        kind: "selection",
        label: "Dropped text",
        text: truncateText(text.trim()),
      });
    }

    for (const file of files) {
      if (!isTextContextFile(file.name)) {
        nextItems.push({
          kind: "file",
          label: file.name,
          text: "Unsupported file type. Only .md, .markdown, and .txt are accepted.",
        });
        continue;
      }

      nextItems.push({
        kind: "file",
        label: file.name,
        text: truncateText(await file.text()),
      });
    }

    if (nextItems.length > 0) {
      onContextAdd(nextItems);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (canSend) {
      onSend();
    }
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (canSend) {
      onSend();
    }
  };

  return (
    <aside
      className="ai-panel"
      aria-label="AI chat"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="ai-panel__header">
        <div className="ai-panel__title">
          <Sparkles size={16} aria-hidden="true" />
          <h2>New AI chat</h2>
        </div>
        <div className="ai-panel__header-actions">
          {settings.providers.length > 0 ? (
            <select
              id="ai-provider"
              className="ai-provider-select"
              aria-label="AI provider"
              value={provider?.id || ""}
              onChange={(event) => onProviderChange(event.currentTarget.value)}
            >
              {settings.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.model || "no model"}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="icon-button" title="Close AI panel" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="ai-panel__conversation">
        {!answer && status !== "streaming" && !error ? (
          <section className="ai-empty-state" aria-label="AI suggestions">
            <div className="ai-avatar">
              <Sparkles size={24} aria-hidden="true" />
            </div>
            <h3>Ask AI</h3>
            <p>Ask about this page, selected text, or dropped context.</p>
            <div className="ai-suggestion-list">
              <button type="button" onClick={() => onPromptChange("Summarize this document.")}>
                <Sparkles size={14} aria-hidden="true" />
                Summarize this document
              </button>
              <button
                type="button"
                onClick={() => onPromptChange("Translate this page to Korean.")}
              >
                <MessageSquareQuote size={14} aria-hidden="true" />
                Translate to Korean
              </button>
              <button
                type="button"
                onClick={() => onPromptChange("List the key decisions and trade-offs.")}
              >
                <Bot size={14} aria-hidden="true" />
                Find key trade-offs
              </button>
            </div>
          </section>
        ) : null}

        {answer ? (
          <section className="ai-answer mdv-markdown markdown-body" aria-live="polite">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          </section>
        ) : null}

        {status === "streaming" && !answer ? (
          <p className="ai-thinking" aria-live="polite">
            Thinking...
          </p>
        ) : null}

        {error ? <p className="ai-error">{error}</p> : null}
      </div>

      <form className="ai-composer" onSubmit={handleSubmit}>
        {contextCount > 0 ? (
          <div className="ai-context-list ai-context-list--composer" aria-label="AI context">
            {currentDocumentLabel ? (
              <div className="ai-context-chip">
                <Bot size={13} aria-hidden="true" />
                <span title={currentDocumentLabel}>{currentDocumentLabel}</span>
              </div>
            ) : null}
            {contextItems.map((item, index) => (
              <div key={`${item.kind}-${item.label}-${index}`} className="ai-context-chip">
                {contextIcon(item.kind)}
                <span title={item.label}>{item.label}</span>
                <button
                  type="button"
                  className="icon-button"
                  title="Remove context"
                  onClick={() => onContextRemove(index)}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          id="ai-prompt"
          className="ai-prompt"
          value={prompt}
          aria-label="Ask AI"
          placeholder="Ask AI anything..."
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={handlePromptKeyDown}
        />

        <div className="ai-composer__footer">
          {settings.providers.length > 0 ? (
            <span className="ai-mode-pill">Auto</span>
          ) : (
            <span className="ai-provider-warning">Add an AI provider in Settings first.</span>
          )}
          <div className="ai-composer__actions">
            <button
              type="button"
              className="ai-cancel-button"
              title="Cancel response"
              disabled={status !== "streaming"}
              onClick={onCancel}
            >
              <Square size={13} aria-hidden="true" />
            </button>
            <button type="submit" className="ai-send-button" title="Send" disabled={!canSend}>
              <ArrowUp size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
