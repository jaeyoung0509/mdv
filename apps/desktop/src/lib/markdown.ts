import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { Options as RehypeAutolinkHeadingsOptions } from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const autolinkHeadingOptions: RehypeAutolinkHeadingsOptions = {
  behavior: "append",
  properties: {
    className: ["heading-anchor"],
    ariaLabel: "Link to heading",
  },
  content: {
    type: "text",
    value: "#",
  },
};

export async function renderMarkdownHtml(markdown: string, allowHtml = false): Promise<string> {
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: allowHtml });

  if (allowHtml) {
    processor = processor.use(rehypeRaw).use(rehypeSanitize);
  }

  const file = await processor
    .use(rehypeKatex)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, autolinkHeadingOptions)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}
