export const PAGE_SIZE = 100;

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

export const BASE_COMPARISON_QUERY = `query($owner: String!, $name: String!, $number: Int!, $headRef: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      baseRef { compare(headRef: $headRef) { behindBy } }
    }
  }
}`;

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

export const ADD_REVIEW = `mutation($pullRequestId: ID!, $event: PullRequestReviewEvent!, $body: String, $threads: [DraftPullRequestReviewThread!]) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, event: $event, body: $body, threads: $threads }) {
    pullRequestReview { id }
  }
}`;
