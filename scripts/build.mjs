import { build as esbuild } from "esbuild";
import { build as vite } from "vite";

const node = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
};

await esbuild({
  ...node,
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main.cjs",
  external: ["electron", "@zenbu-labs/pixel", "@agentclientprotocol/claude-agent-acp"],
});

await esbuild({
  ...node,
  entryPoints: ["src/preload/preload.ts"],
  outfile: "dist/preload.cjs",
  external: ["electron"],
});

await vite();
