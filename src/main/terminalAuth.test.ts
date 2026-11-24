import { expect, test } from "vitest";
import { type LaunchCommand, shellCommand, terminalLogin } from "./agent";
import { rexPaneArgs } from "./launch";

/** Claude's adapter as Claudesaurus launches it, and its own `terminal` sign-in method. */
const claude: LaunchCommand = {
  command: "/usr/local/bin/node",
  args: ["/app/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"],
  env: new Map(),
};
const subscription = { args: ["--cli", "auth", "login", "--claudeai"] };

test("a terminal sign-in runs the agent with the method's arguments and variables", () => {
  expect(terminalLogin(claude, subscription)).toEqual({
    command: "/usr/local/bin/node",
    args: [
      "/app/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
      "--cli",
      "auth",
      "login",
      "--claudeai",
    ],
    env: new Map(),
  });
  const binary: LaunchCommand = {
    command: "/cache/agents/kiro/3.0.0/kiro",
    args: ["acp"],
    env: new Map([["KIRO_MODE", "acp"]]),
  };
  const login = terminalLogin(binary, { args: ["login"], env: { KIRO_MODE: "login", A: "1" } });
  expect(login.args).toEqual(["acp", "login"]);
  expect([...login.env]).toEqual([
    ["KIRO_MODE", "login"],
    ["A", "1"],
  ]);
});

test("shows a sign-in command the way it would be typed in a shell", () => {
  const login = terminalLogin(claude, subscription);
  expect(shellCommand(login)).toBe(
    "/usr/local/bin/node /app/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js --cli auth login --claudeai",
  );
  const odd: LaunchCommand = {
    command: "/Users/me/My Agents/agent",
    args: ["--name=it's"],
    env: new Map([["TOKEN_HINT", "a b"]]),
  };
  expect(shellCommand(odd)).toBe("TOKEN_HINT='a b' '/Users/me/My Agents/agent' '--name=it'\\''s'");
});

test("opens the sign-in in a Rex pane below, and waits for it to finish", () => {
  const login = terminalLogin(claude, subscription);
  login.env.set("NO_COLOR", "1");
  expect(rexPaneArgs("block:1", login, "/work", "Claude sign-in")).toEqual([
    "split",
    "-b",
    "block:1",
    "--split=below",
    "--ratio=40",
    "--label=Claude sign-in",
    "--cwd=/work",
    "--wait",
    "--",
    "env",
    "NO_COLOR=1",
    "/usr/local/bin/node",
    "/app/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    "--cli",
    "auth",
    "login",
    "--claudeai",
  ]);
});
