import type { Element } from "hast";
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  memo,
  type ReactNode,
  useContext,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMath } from "../math";
import { useActions } from "../store";
import { isVideo } from "../video";
import { CodeBlock } from "./CodeBlock";
import { Video } from "./Video";

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src ?? []), "file"] },
};

function urlTransform(url: string, key: string) {
  return key === "src" && /^file:\/\//i.test(url) ? url : defaultUrlTransform(url);
}

const StreamingContext = createContext(false);

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

function Pre({ node, children }: ComponentProps<"pre"> & { node?: Element }) {
  const streaming = useContext(StreamingContext);
  return (
    <CodeBlock
      language={codeLanguage(node)}
      source={textOf(children).replace(/\n$/, "")}
      streaming={streaming}
    >
      {children}
    </CodeBlock>
  );
}

function Anchor({ href, children }: ComponentProps<"a">) {
  const actions = useActions();
  return (
    <a
      href={href}
      title={href ? `${href} (click to copy)` : undefined}
      onClick={(event) => {
        event.preventDefault();
        if (href) actions.openLink(href);
      }}
    >
      {children}
    </a>
  );
}

function Image({ src, alt, title }: ComponentProps<"img">) {
  if (src !== undefined && isVideo(src)) return <Video src={src} title={title ?? alt ?? ""} />;
  return <img src={src} alt={alt} title={title} />;
}

const components = { pre: Pre, a: Anchor, img: Image };
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  [rehypeHighlight, { detect: false }],
];

type MarkdownProps = { text: string; streaming?: boolean };

export const Markdown = memo(function Markdown({ text, streaming = false }: MarkdownProps) {
  return (
    <StreamingContext.Provider value={streaming}>
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={urlTransform}
        >
          {normalizeMath(text)}
        </ReactMarkdown>
      </div>
    </StreamingContext.Provider>
  );
});
