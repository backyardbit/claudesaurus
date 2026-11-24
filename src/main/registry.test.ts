import { expect, test } from "vitest";
import {
  agentName,
  parseRegistry,
  pickDistribution,
  pickerOrder,
  platformTarget,
  type RegistryAgent,
  resolveAgentId,
} from "./registry";

const antigravity = {
  id: "antigravity-acp",
  name: "Google Antigravity",
  version: "1.5.2",
  description: "Google’s AI coding agent",
  distribution: {
    binary: {
      "darwin-aarch64": {
        archive: "https://dl.google.com/agy-acp-server-1.5.2-darwin-arm64.zip",
        cmd: "./agy_acp_server.par",
        sha256: "123a16d5c40a8ac99e20f01a62b68dd860fd96b1c528dfb8eaa37ca8733d4845",
      },
      "linux-x86_64": {
        archive: "https://dl.google.com/agy-acp-server-1.5.2-linux-x86_64.zip",
        cmd: "./agy_acp_server.par",
        args: ["--uid="],
      },
    },
  },
};

const grok = {
  id: "grok-build",
  name: "Grok Build",
  version: "1.0.93",
  distribution: { npx: { package: "@xai-official/grok@1.0.93", args: ["agent", "stdio"] } },
};

const kilo = {
  id: "kilo",
  name: "Kilo",
  version: "7.8.32",
  distribution: {
    binary: { "darwin-aarch64": { archive: "https://example.com/kilo.zip", cmd: "./kilo" } },
    npx: { package: "@kilocode/cli@7.8.32", args: ["acp"] },
  },
};

const index = JSON.stringify({
  version: "1.0.0",
  agents: [antigravity, grok, kilo, { id: "broken", distribution: "nope" }],
  extensions: [],
});

function agent(id: string): RegistryAgent {
  const found = parseRegistry(index).find((entry) => entry.id === id);
  if (!found) throw new Error(`no ${id} in the test index`);
  return found;
}

test("reads the agents of an index and leaves out entries it cannot read", () => {
  expect(parseRegistry(index).map((entry) => entry.id)).toEqual([
    "antigravity-acp",
    "grok-build",
    "kilo",
  ]);
  expect(agent("grok-build").distribution.npx?.args).toEqual(["agent", "stdio"]);
});

test("leaves out an entry whose id or version could climb out of the download cache", () => {
  const entry = (id: string, version: string) => ({
    id,
    name: id,
    version,
    distribution: { npx: { package: "x" } },
  });
  const json = JSON.stringify({
    agents: [entry("../escape", "1.0.0"), entry("ok", "../../x"), entry("fine", "1.2.0-rc.1")],
  });
  expect(parseRegistry(json).map((found) => found.id)).toEqual(["fine"]);
});

test("an index that is not JSON, or has no agents, lists none", () => {
  expect(parseRegistry("<html>")).toEqual([]);
  expect(parseRegistry('{"version":"1.0.0"}')).toEqual([]);
});

test("names platforms the way the registry does", () => {
  expect(platformTarget("darwin", "arm64", false)).toBe("darwin-aarch64");
  expect(platformTarget("darwin", "x64", false)).toBe("darwin-x86_64");
  expect(platformTarget("linux", "x64", false)).toBe("linux-x86_64");
  expect(platformTarget("linux", "arm64", true)).toBe("linux-aarch64-musl");
  expect(platformTarget("win32", "x64", false)).toBe("windows-x86_64");
  expect(platformTarget("freebsd", "x64", false)).toBeNull();
  expect(platformTarget("linux", "ia32", false)).toBeNull();
});

test("picks the binary for this platform first, then the npm package", () => {
  expect(pickDistribution(agent("kilo"), "darwin-aarch64")).toMatchObject({
    kind: "binary",
    target: { cmd: "./kilo" },
  });
  expect(pickDistribution(agent("kilo"), "linux-x86_64")).toEqual({
    kind: "npx",
    package: "@kilocode/cli@7.8.32",
    args: ["acp"],
  });
  expect(pickDistribution(agent("antigravity-acp"), "linux-x86_64")).toMatchObject({
    kind: "binary",
    target: { args: ["--uid="] },
  });
});

test("a musl Linux does not fall back to the glibc binary", () => {
  expect(pickDistribution(agent("antigravity-acp"), "linux-x86_64-musl")).toBeNull();
  expect(pickDistribution(agent("kilo"), "linux-x86_64-musl")).toMatchObject({ kind: "npx" });
});

test("an agent with nothing for the platform cannot be run", () => {
  expect(pickDistribution(agent("antigravity-acp"), "windows-aarch64")).toBeNull();
  expect(pickDistribution(agent("antigravity-acp"), null)).toBeNull();
});

test("resolves short names to registry ids and passes ids through", () => {
  expect(resolveAgentId("claude")).toBe("claude-acp");
  expect(resolveAgentId("Codex")).toBe("codex-acp");
  expect(resolveAgentId("grok")).toBe("grok-build");
  expect(resolveAgentId(" antigravity ")).toBe("antigravity-acp");
  expect(resolveAgentId("grok-build")).toBe("grok-build");
  expect(resolveAgentId("goose")).toBe("goose");
});

test("offers the featured agents first and only what runs here", () => {
  const order = pickerOrder(parseRegistry(index), "linux-aarch64").map((entry) => entry.id);
  expect(order).toEqual(["grok-build", "kilo"]);
  const mac = pickerOrder(parseRegistry(index), "darwin-aarch64").map((entry) => entry.id);
  expect(mac).toEqual(["grok-build", "antigravity-acp", "kilo"]);
});

test("featured agents get short names, and others the registry's", () => {
  expect(agentName("claude-acp", null)).toBe("Claude");
  expect(agentName("grok-build", agent("grok-build"))).toBe("Grok");
  expect(agentName("antigravity-acp", null)).toBe("Antigravity");
  expect(agentName("kilo", agent("kilo"))).toBe("Kilo");
  expect(agentName("unknown-agent", null)).toBe("unknown-agent");
});
