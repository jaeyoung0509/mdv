import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import css from "shiki/langs/css.mjs";
import docker from "shiki/langs/docker.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import kotlin from "shiki/langs/kotlin.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import swift from "shiki/langs/swift.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import type { EffectiveTheme } from "./types";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function normalizeLanguage(language: string | undefined): string {
  const normalized = (language || "text").toLowerCase();

  if (["sh", "shell", "zsh"].includes(normalized)) {
    return "bash";
  }

  if (normalized === "dockerfile") {
    return "docker";
  }

  return normalized;
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [
        typescript,
        tsx,
        javascript,
        jsx,
        go,
        rust,
        python,
        java,
        kotlin,
        swift,
        sql,
        bash,
        shellscript,
        json,
        yaml,
        toml,
        docker,
        markdown,
        html,
        css,
      ],
      engine: createJavaScriptRegexEngine(),
    }).catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }

  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  language: string | undefined,
  theme: EffectiveTheme,
): Promise<string | null> {
  const highlighter = await getHighlighter();
  const lang = normalizeLanguage(language);
  const shikiTheme = theme === "dark" ? "github-dark" : "github-light";

  try {
    return highlighter.codeToHtml(code, {
      lang,
      theme: shikiTheme,
    });
  } catch {
    try {
      return highlighter.codeToHtml(code, {
        lang: "text",
        theme: shikiTheme,
      });
    } catch {
      return null;
    }
  }
}
