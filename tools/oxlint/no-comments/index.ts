import type { ESTree, Range, SourceCode } from "@oxlint/plugins";
import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

const directive =
  /^(?:\s*(?:biome-ignore|oxlint-|eslint-|@ts-|SAFETY\s*:|[#@]__[A-Z_]+__)|\/\s*<reference\b)/u;

function continuesPrevious(comment: ESTree.Comment, previous: ESTree.Comment): boolean {
  return (
    comment.type === "Line" &&
    previous.type === "Line" &&
    comment.loc.start.line === previous.loc.end.line + 1 &&
    comment.loc.start.column === previous.loc.start.column
  );
}

function exemptComments(comments: ESTree.Comment[]): Set<ESTree.Comment> {
  const exempt = new Set<ESTree.Comment>();
  comments.forEach((comment, index) => {
    const previous = comments[index - 1];
    if (comment.type === "Shebang" || directive.test(comment.value)) exempt.add(comment);
    else if (previous && exempt.has(previous) && continuesPrevious(comment, previous)) {
      exempt.add(comment);
    }
  });
  return exempt;
}

function removedSpan(
  sourceCode: SourceCode,
  comment: ESTree.Comment,
): ESTree.Node | ESTree.Comment {
  const enclosing = sourceCode.getNodeByRangeIndex(comment.start);
  if (enclosing?.type === "JSXEmptyExpression") return enclosing.parent;
  return comment;
}

function removal(text: string, span: ESTree.Node | ESTree.Comment): [Range, string] {
  const { start, end } = span;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline === -1 ? text.length : newline;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd);
  if (before.trim() === "" && after.trim() === "") {
    return [[lineStart, newline === -1 ? lineEnd : newline + 1], ""];
  }
  if (after.trim() === "") return [[lineStart + before.trimEnd().length, end], ""];
  if (span.type !== "Line" && span.type !== "Block") return [[start, end], ""];
  const spaceBefore = before !== before.trimEnd();
  const spaceAfter = after !== after.trimStart();
  if (spaceBefore) return [[start, end + after.length - after.trimStart().length], ""];
  return [[start, end], spaceAfter ? "" : " "];
}

interface Removal {
  comments: ESTree.Comment[];
  range: Range;
  replacement: string;
}

function mergedRemovals(sourceCode: SourceCode, comments: ESTree.Comment[]): Removal[] {
  const removals: Removal[] = [];
  for (const comment of comments) {
    const [range, replacement] = removal(sourceCode.text, removedSpan(sourceCode, comment));
    const last = removals.at(-1);
    if (last && range[0] <= last.range[1]) {
      if (range[0] === last.range[1]) last.replacement += replacement;
      last.range[1] = Math.max(last.range[1], range[1]);
      last.comments.push(comment);
    } else {
      removals.push({ comments: [comment], range, replacement });
    }
  }
  return removals;
}

const noCommentsRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Disallow comments, except tool directives and the SAFETY notes anti-slop requires.",
    },
    messages: {
      comment:
        "Remove this comment. Let names, types and structure carry the meaning, and put the why in the commit message.",
    },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const comments = sourceCode.getAllComments();
        const exempt = exemptComments(comments);
        const banned = comments.filter((comment) => !exempt.has(comment));
        for (const { comments: group, range, replacement } of mergedRemovals(sourceCode, banned)) {
          const [first, ...rest] = group;
          context.report({
            loc: first.loc,
            messageId: "comment",
            fix: (fixer) => fixer.replaceTextRange(range, replacement),
          });
          for (const comment of rest) context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
});

const noCommentsPlugin = eslintCompatPlugin({
  meta: { name: "no-comments" },
  rules: { "no-comments": noCommentsRule },
});

export default noCommentsPlugin;
