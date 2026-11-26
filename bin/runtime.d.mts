export type RestartRequest = {
  sessionId?: string | null;
  agentId?: string | null;
  root?: string | null;
  version?: string | null;
};

export function runtimeHome(): string;
export function compareVersions(a: string, b: string): number;
export function isInsideDir(target: string, parent: string): boolean;
export function electronIntact(root: string): boolean;
export function isRuntimeReady(root: string): boolean;
export function latestInstalledVersion(
  home: string,
  afterVersion: string,
): { version: string; root: string } | null;
export function restartArgs(previousArgs: string[], request: RestartRequest): string[];
export function envWithoutResumeToken(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function resolveResumeFileArgs(args: string[]): string[];
export function prepareRuntime(appRoot: string, version: string): string;
