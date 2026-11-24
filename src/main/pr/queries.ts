/**
 * The GraphQL documents the pull request viewer sends, after T3 Code's
 * (apps/server/src/pullRequest/gitHubPullRequestJson.ts, MIT).
 */

/** GitHub's ceiling on one page of a connection. */
export const PAGE_SIZE = 100;

/** How many of a reaction's people are named; past that the count says the rest. */
const REACTORS_PER_GROUP = 10;

const REACTION_GROUPS = `reactionGroups {
  content
  viewerHasReacted
  reactors(first: ${REACTORS_PER_GROUP}) {
    totalCount
    nodes {
      ... on User { login }
      ... on Bot { login }
      ... on Organization { login }
      ... on Mannequin { login }
    }
  }
}`;

const ACTOR = "login avatarUrl ... on User { name }";

/**
 * Everything the header, the merge box and the checks list need, in one request. The repository's
 * merge settings and the viewer's role ride along because they hang off the same repository.
 */
export const DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    viewerPermission
    pullRequest(number: $number) {
      number
      title
      body
      url
      state
      isDraft
      mergeable
      additions
      deletions
      changedFiles
      headRefName
      baseRefName
      createdAt
      updatedAt
      mergedAt
      closedAt
      headRepositoryOwner { login }
      author { ${ACTOR} }
      viewerCanUpdate
      viewerDidAuthor
      viewerCanUpdateBranch
      autoMergeRequest { enabledAt }
      labels(first: 50) { nodes { name color } }
      reviewRequests(first: 50) {
        nodes { requestedReviewer { ... on User { login name avatarUrl } ... on Bot { login avatarUrl } } }
      }
      latestReviews(first: 50) { nodes { author { ${ACTOR} } } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: ${PAGE_SIZE}) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                    title
                    detailsUrl
                    startedAt
                    completedAt
                    checkSuite { workflowRun { workflow { name } } }
                  }
                  ... on StatusContext { context state description targetUrl createdAt }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * How far the branch trails its base. `mergeStateStatus` is no answer: GitHub reports BEHIND only
 * where the repository requires branches to be up to date. `headRef` is `owner:branch`, the only
 * form a fork's branch resolves under in the base repository.
 */
export const BASE_COMPARISON_QUERY = `query($owner: String!, $name: String!, $number: Int!, $headRef: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      baseRef { compare(headRef: $headRef) { behindBy } }
    }
  }
}`;

/**
 * One page of review threads, with what `gh pr view --json` cannot give: reactions, avatars, the
 * people on the review, the commits with their line counts, and dismissal reasons. Everything but
 * the threads is read off the first page only. Commits are the newest hundred (`last`), which is
 * what a reader scoping the diff to a commit wants.
 */
export const ACTIVITY_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          diffSide
          comments(first: ${PAGE_SIZE}) {
            totalCount
            pageInfo { hasNextPage }
            nodes { id author { ${ACTOR} } body createdAt url ${REACTION_GROUPS} }
          }
        }
      }
      author { ${ACTOR} }
      ${REACTION_GROUPS}
      comments(first: ${PAGE_SIZE}) { nodes { id author { ${ACTOR} } ${REACTION_GROUPS} } }
      reviews(first: ${PAGE_SIZE}) { nodes { id url ${REACTION_GROUPS} } }
      reviewRequests(first: 50) {
        nodes { requestedReviewer { ... on User { login name avatarUrl } ... on Bot { login avatarUrl } } }
      }
      latestReviews(first: 50) { nodes { author { ${ACTOR} } } }
      reviewDismissals: timelineItems(itemTypes: [REVIEW_DISMISSED_EVENT], first: ${PAGE_SIZE}) {
        nodes { ... on ReviewDismissedEvent { dismissalMessage review { id } } }
      }
      commits(last: ${PAGE_SIZE}) {
        nodes {
          commit {
            oid
            messageHeadline
            committedDate
            additions
            deletions
            authors(first: 3) { nodes { name avatarUrl user { login } } }
          }
        }
      }
    }
  }
}`;

/**
 * Who a review may be asked of. `assignableUsers` is what GitHub's own picker lists; teams appear
 * only once requested, because listing an organization's teams needs `read:org`, and a refused
 * query would take the people down with it.
 */
export const REVIEWER_CANDIDATES_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    assignableUsers(first: ${PAGE_SIZE}) {
      pageInfo { hasNextPage }
      nodes { login name avatarUrl }
    }
    pullRequest(number: $number) {
      author { login }
      reviewRequests(first: ${PAGE_SIZE}) {
        nodes {
          requestedReviewer {
            ... on User { login name avatarUrl }
            ... on Team { slug name avatarUrl }
            ... on Bot { login avatarUrl }
          }
        }
      }
    }
  }
}`;

export const PULL_REQUEST_ID_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id } }
}`;

/**
 * Where a node the page names actually hangs. A node id can belong to any pull request on GitHub,
 * so a mutation is only sent once this confirms it belongs to the one the page is showing.
 */
export const SUBJECT_SCOPE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $subjectId: ID!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id } }
  node(id: $subjectId) {
    id
    ... on IssueComment { pullRequest { id } }
    ... on PullRequestReviewComment { pullRequest { id } }
    ... on PullRequestReview { pullRequest { id } }
  }
}`;

export const ADD_REACTION = `mutation($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $subjectId, content: $content }) { reaction { content } }
}`;

export const REMOVE_REACTION = `mutation($subjectId: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $subjectId, content: $content }) { reaction { content } }
}`;

export const RESOLVE_THREAD = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

export const UNRESOLVE_THREAD = `mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

export const REPLY_TO_THREAD = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id }
  }
}`;

/** A variable left out of the request leaves its field as it was, rather than clearing it. */
export const UPDATE_PULL_REQUEST = `mutation($pullRequestId: ID!, $title: String, $body: String) {
  updatePullRequest(input: { pullRequestId: $pullRequestId, title: $title, body: $body }) {
    pullRequest { id }
  }
}`;

export const UPDATE_ISSUE_COMMENT = `mutation($commentId: ID!, $body: String!) {
  updateIssueComment(input: { id: $commentId, body: $body }) { issueComment { id } }
}`;

export const UPDATE_REVIEW_COMMENT = `mutation($commentId: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $commentId, body: $body }) {
    pullRequestReviewComment { id }
  }
}`;

/**
 * The whole review in one request, so nothing of it is visible to anyone until the verdict is
 * sent. `body` is left out when empty: a bare approval has nothing to say.
 */
export const ADD_REVIEW = `mutation($pullRequestId: ID!, $event: PullRequestReviewEvent!, $body: String, $threads: [DraftPullRequestReviewThread!]) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, event: $event, body: $body, threads: $threads }) {
    pullRequestReview { id }
  }
}`;
