import { expect, test } from "vitest";
import { ghFailureMessage } from "./gh";
import { checkNumber, parsePullRequestTarget, splitRepository } from "./target";

test("a bare number names a pull request of the current repository", () => {
  expect(parsePullRequestTarget("15")).toEqual({ repository: null, number: 15 });
  expect(parsePullRequestTarget(" #15 ")).toEqual({ repository: null, number: 15 });
});

test("owner/repo#number names the repository too", () => {
  expect(parsePullRequestTarget("backyardbit/claudesaurus#19")).toEqual({
    repository: "backyardbit/claudesaurus",
    number: 19,
  });
});

test("a pull request URL is read with whatever follows the number", () => {
  for (const url of [
    "https://github.com/owner/repo.js/pull/15",
    "https://github.com/owner/repo.js/pull/15/files",
    "https://github.com/owner/repo.js/pull/15#discussion_r123",
    "https://github.com/owner/repo.js/pull/15/commits/abc123?w=1",
    "github.com/owner/repo.js/pull/15",
  ]) {
    expect(parsePullRequestTarget(url)).toEqual({ repository: "owner/repo.js", number: 15 });
  }
});

test("anything else names no pull request", () => {
  for (const arg of [
    "",
    "#",
    "0",
    "-3",
    "1.5",
    "owner/repo",
    "owner/repo/15",
    "owner/repo#x",
    "https://gitlab.com/owner/repo/pull/15",
    "https://github.com/owner/repo/issues/15",
    "https://github.com/owner/repo/pull/15abc",
    "99999999999999999999",
  ]) {
    expect(parsePullRequestTarget(arg)).toBeNull();
  }
});

test("a repository from the page is checked before it reaches a request path", () => {
  expect(splitRepository("backyardbit/claudesaurus")).toEqual({
    owner: "backyardbit",
    name: "claudesaurus",
  });
  for (const bad of ["claudesaurus", "a/b/c", "../etc", "owner/repo?x=1", "-owner/repo", "a b/c"]) {
    expect(() => splitRepository(bad)).toThrow(/not a GitHub repository/);
  }
  expect(checkNumber(3)).toBe(3);
  expect(() => checkNumber(0)).toThrow();
  expect(() => checkNumber(1.5)).toThrow();
});

test("gh failures read as what to do about them", () => {
  expect(
    ghFailureMessage("To get started with GitHub CLI, please run:  gh auth login\n", 4),
  ).toMatch(/not signed in/);
  expect(ghFailureMessage("gh: Bad credentials (HTTP 401)", 1)).toMatch(/not signed in/);
  expect(ghFailureMessage("gh: API rate limit exceeded for user", 1)).toMatch(/rate limit/);
  expect(
    ghFailureMessage("gh: Could not resolve to a PullRequest with the number of 9.\n", 1),
  ).toBe("GitHub: Could not resolve to a PullRequest with the number of 9.");
  expect(ghFailureMessage("", 2)).toBe("The GitHub CLI failed (exit code 2).");
});
