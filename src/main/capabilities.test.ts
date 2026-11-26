import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import { agentFeatures, pickStartupConfig } from "./capabilities";

test("Claude and Codex can resume, steer and take the system prompt", () => {
  const features = agentFeatures({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      sessionCapabilities: { list: {}, resume: {}, systemPrompt: {} },
    },
    _meta: { steering: { supported: true } },
  });
  expect(features).toEqual({
    resume: true,
    steer: true,
    systemPrompt: true,
    embeddedContext: true,
  });
});

test("Grok resumes but cannot steer or take the system prompt", () => {
  const features = agentFeatures({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { embeddedContext: true },
      sessionCapabilities: { list: {}, resume: {}, close: {} },
      _meta: { "x.ai/fs_notify": true },
    },
    _meta: { agentVersion: "1.0.93" },
  });
  expect(features).toEqual({
    resume: true,
    steer: false,
    systemPrompt: false,
    embeddedContext: true,
  });
});

test("Antigravity's own system prompt flag does not count, since it ignores the prompt", () => {
  const features = agentFeatures({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { embeddedContext: true },
      sessionCapabilities: { list: {} },
      _meta: { antigravity: { tier: true, systemPrompt: { append: true } } },
    },
  });
  expect(features).toMatchObject({ resume: true, systemPrompt: false, embeddedContext: true });
});

test("an agent that advertises nothing gets the baseline", () => {
  expect(agentFeatures({ protocolVersion: 1 })).toEqual({
    resume: false,
    steer: false,
    systemPrompt: false,
    embeddedContext: false,
  });
  // Loading alone is not enough for /resume, which first lists the sessions.
  const loadOnly = agentFeatures({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
  expect(loadOnly.resume).toBe(false);
  const steerOff = agentFeatures({ protocolVersion: 1, _meta: { steering: { supported: false } } });
  expect(steerOff.steer).toBe(false);
});

function select(
  id: string,
  category: string,
  choices: { value: string; name?: string }[] = [],
): SessionConfigOption {
  return {
    id,
    name: id,
    category,
    type: "select",
    currentValue: choices[0]?.value ?? "a",
    options: choices.map((choice) => ({ value: choice.value, name: choice.name ?? choice.value })),
  };
}

test("applies command line settings to the options the session has", () => {
  const options = [select("model", "model"), select("reasoning", "thought_level")];
  const requested = new Map([
    ["model", "gpt-6"],
    ["effort", "high"],
    ["mode", "plan"],
  ]);
  expect(pickStartupConfig(requested, options)).toEqual({
    applied: [
      { configId: "model", value: "gpt-6" },
      { configId: "reasoning", value: "high" },
    ],
    skipped: ["mode"],
  });
  expect(pickStartupConfig(new Map(), options)).toEqual({ applied: [], skipped: [] });
});

test("leaves out values the agent does not offer, such as a Claude model on Antigravity", () => {
  const options = [
    select("model", "model", [
      { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { value: "gemini-4-neon", name: "Gemini 4 Neon" },
    ]),
    select("thinking_level", "thought_level", [{ value: "low" }, { value: "high" }]),
  ];
  const requested = new Map([
    ["model", "haiku"],
    ["effort", "LOW"],
  ]);
  expect(pickStartupConfig(requested, options)).toEqual({
    applied: [{ configId: "thinking_level", value: "low" }],
    skipped: [],
  });
});

test("matches a choice by display name when the value differs", () => {
  const options = [
    select("model", "model", [{ value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }]),
  ];
  expect(pickStartupConfig(new Map([["model", "Gemini 3.8 Flash"]]), options)).toEqual({
    applied: [{ configId: "model", value: "gemini-3.8-flash" }],
    skipped: [],
  });
});
