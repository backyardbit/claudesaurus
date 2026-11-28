import type { Element } from "hast";
import { CheckIcon, CopyIcon, WrapTextIcon } from "lucide-react";
import {
  Children,
  type ComponentProps,
  isValidElement,
  memo,
  type ReactNode,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { openLink } from "../lib/links";
import { prBridge } from "../lib/prApi";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./]],
    source: ["srcSet", "media"],
    details: ["open"],
  },
};

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textOf(child.props.children)
        : String(child),
    )
    .join("");
}

function codeLanguage(node: Element | undefined) {
  const code = node?.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
  const classes = code?.properties.className;
  if (!Array.isArray(classes)) return null;
  const language = classes.map(String).find((name) => name.startsWith("language-"));
  return language ? language.slice("language-".length) : null;
}

function CodeBlock({ node, children }: ComponentProps<"pre"> & { node?: Element }) {
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const language = codeLanguage(node);
  const wrapLabel = wrapped ? "Disable line wrapping" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy code";
  return (
    <div
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
      data-wrap={wrapped ? "true" : "false"}
    >
      <div className="chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none">
        <span className="inline-flex min-w-0 items-center gap-[0.4rem] font-mono text-[0.6875rem]">
          {language ?? "text"}
        </span>
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Code block actions">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="chat-markdown-chrome-action"
                  aria-pressed={wrapped}
                  aria-label={wrapLabel}
                  onClick={() => setWrapped((value) => !value)}
                />
              }
            >
              <WrapTextIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{wrapLabel}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="chat-markdown-chrome-action"
                  aria-label={copyLabel}
                  onClick={() => {
                    prBridge().copy(textOf(children).replace(/\n$/, ""));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function Anchor({ href, children }: ComponentProps<"a">) {
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) openLink(href);
      }}
    >
      {children}
    </a>
  );
}

const components = { pre: CodeBlock, a: Anchor };
const remarkPlugins = [remarkGfm];
const rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeHighlight, { detect: false }],
];

const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80 [overflow-wrap:anywhere] [word-break:break-word]">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export default ChatMarkdown;
