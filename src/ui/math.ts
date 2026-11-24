/** Fenced blocks and inline code spans, which are never math. */
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/** A dollar sign that starts an amount of money, like `$5`, `$1,200.50` or `$3k`. */
const MONEY = /\$(?=\d[\d,.]*[kKmMbB]?(?:[\s.,;:!?)\]]|$))/g;

const DISPLAY = "$$";

function escapeMoney(line: string) {
  return line.replace(MONEY, (dollar, offset: number) => {
    const closing = line.indexOf("$", offset + 1);
    const closesMath = closing !== -1 && !/\d/.test(line[closing + 1] ?? "");
    return closesMath ? dollar : "\\$";
  });
}

function displayBlock(body: string) {
  return `${DISPLAY}\n${body.trim()}\n${DISPLAY}`;
}

function normalizeProse(prose: string) {
  return prose
    .split("\n")
    .map(escapeMoney)
    .join("\n")
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n${displayBlock(body)}\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body.trim()}$`)
    .replace(/^[ \t]*\$\$(.+?)\$\$[ \t]*$/gm, (_, body: string) => displayBlock(body));
}

/**
 * Rewrites the math Claude writes into the forms remark-math reads: `\(…\)` and `\[…\]` become
 * dollar delimiters, a one-line `$$…$$` becomes a display block, and amounts of money keep their
 * dollar sign instead of opening a formula.
 */
export function normalizeMath(text: string) {
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : normalizeProse(part)))
    .join("");
}
