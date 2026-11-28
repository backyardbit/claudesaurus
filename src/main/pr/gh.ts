import { spawn } from "node:child_process";
import type { z } from "zod";

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 300;

export type GhOptions = {
  cwd: string;
  stdin?: string;
  maxBytes?: number;
  timeoutMs?: number;
};

export type GhOutput = { stdout: Buffer; truncated: boolean };

export type GraphQlValue =
  | string
  | number
  | boolean
  | null
  | GraphQlValue[]
  | { [name: string]: GraphQlValue };

export type GraphQlVariables = { [name: string]: GraphQlValue };

const MISSING_GH =
  "The GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com, then run `gh auth login`.";
const SIGNED_OUT =
  "The GitHub CLI is not signed in. Run `gh auth login` in a terminal, then try again.";
const RATE_LIMITED =
  "GitHub's API rate limit is used up. Try again later; `gh api rate_limit` says when it resets.";

export function ghFailureMessage(stderr: string, exitCode: number | null) {
  const lower = stderr.toLowerCase();
  if (
    lower.includes("gh auth login") ||
    lower.includes("not logged in") ||
    lower.includes("authentication failed") ||
    lower.includes("bad credentials") ||
    lower.includes("http 401")
  ) {
    return SIGNED_OUT;
  }
  if (lower.includes("rate limit")) return RATE_LIMITED;
  const text = stderr
    .split("\n")
    .map((line) => line.replace(/^gh:\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
  if (text.length === 0) return `The GitHub CLI failed (exit code ${exitCode ?? "unknown"}).`;
  const clipped = text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text;
  return `GitHub: ${clipped}`;
}

function ghEnv() {
  return {
    ...process.env,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_SPINNER_DISABLED: "1",
    NO_COLOR: "1",
  };
}

export function runGh(args: string[], options: GhOptions) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise<GhOutput>((resolve, reject) => {
    const child = spawn("gh", args, { cwd: options.cwd, env: ghEnv() });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let stderr = "";
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      if (size + chunk.length > maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          "code" in error && error.code === "ENOENT"
            ? MISSING_GH
            : `Could not run the GitHub CLI: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("The GitHub CLI took too long to answer. Try again."));
      } else if (truncated) {
        resolve({ stdout: Buffer.concat(chunks), truncated: true });
      } else if (code !== 0) {
        reject(new Error(ghFailureMessage(stderr, code)));
      } else {
        resolve({ stdout: Buffer.concat(chunks), truncated: false });
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin ?? "");
  });
}

export function decodeJson<S extends z.ZodType>(schema: S, text: string, what: string) {
  let result: z.ZodSafeParseResult<z.output<S>>;
  try {
    result = schema.safeParse(JSON.parse(text));
  } catch {
    throw new Error(`GitHub sent ${what} that is not JSON.`);
  }
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue === undefined ? "" : ` (${issue.path.join(".")}: ${issue.message})`;
    throw new Error(`GitHub sent ${what} in a form Claudesaurus cannot read${where}.`);
  }
  return result.data;
}

export async function ghJson<S extends z.ZodType>(
  cwd: string,
  args: string[],
  schema: S,
  what: string,
) {
  const output = await runGh(args, { cwd });
  if (output.truncated) throw new Error(`GitHub sent too much ${what} to read.`);
  return decodeJson(schema, output.stdout.toString("utf8"), what);
}

export async function graphql<S extends z.ZodType>(
  cwd: string,
  query: string,
  variables: GraphQlVariables,
  schema: S,
  what: string,
) {
  const output = await runGh(["api", "graphql", "--input", "-"], {
    cwd,
    stdin: JSON.stringify({ query, variables }),
  });
  if (output.truncated) throw new Error(`GitHub sent too much ${what} to read.`);
  return decodeJson(schema, output.stdout.toString("utf8"), what);
}

export async function graphqlWrite(cwd: string, query: string, variables: GraphQlVariables) {
  await runGh(["api", "graphql", "--input", "-"], {
    cwd,
    stdin: JSON.stringify({ query, variables }),
  });
}
