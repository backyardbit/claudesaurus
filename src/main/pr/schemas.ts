/**
 * What GitHub's answers are expected to look like. Every field is optional, and enum-like fields
 * are plain strings normalised in mapping.ts: a gh release or an API change that adds a state
 * must not fail the whole page.
 */
import { z } from "zod";

const text = z.string().nullish();
const flag = z.boolean().nullish();
const count = z.number().nullish();

const ActorSchema = z.object({ login: text, name: text, avatarUrl: text });
const actor = ActorSchema.nullish();
export type RawActor = z.infer<typeof actor>;

const ReactionGroupsSchema = z
  .array(
    z.object({
      content: text,
      viewerHasReacted: flag,
      reactors: z
        .object({
          totalCount: count,
          nodes: z.array(z.object({ login: text }).nullish()).nullish(),
        })
        .nullish(),
    }),
  )
  .nullish();
export type RawReactionGroups = z.infer<typeof ReactionGroupsSchema>;

const ReviewRequestsSchema = z
  .object({ nodes: z.array(z.object({ requestedReviewer: actor }).nullish()) })
  .nullish();
const LatestReviewsSchema = z
  .object({ nodes: z.array(z.object({ author: actor }).nullish()) })
  .nullish();

const CheckSchema = z.object({
  __typename: text,
  name: text,
  status: text,
  conclusion: text,
  title: text,
  detailsUrl: text,
  startedAt: text,
  completedAt: text,
  checkSuite: z
    .object({
      workflowRun: z.object({ workflow: z.object({ name: text }).nullish() }).nullish(),
    })
    .nullish(),
  context: text,
  state: text,
  description: text,
  targetUrl: text,
  createdAt: text,
});
export type RawCheck = z.infer<typeof CheckSchema>;
export type RawReviewRequests = z.infer<typeof ReviewRequestsSchema>;
export type RawLatestReviews = z.infer<typeof LatestReviewsSchema>;

export const DetailResponseSchema = z.object({
  data: z.object({
    viewer: z.object({ login: text }).nullish(),
    repository: z.object({
      nameWithOwner: z.string(),
      mergeCommitAllowed: z.boolean(),
      squashMergeAllowed: z.boolean(),
      rebaseMergeAllowed: z.boolean(),
      viewerPermission: text,
      pullRequest: z.object({
        number: z.number(),
        title: z.string(),
        body: text,
        url: z.string(),
        state: text,
        isDraft: flag,
        mergeable: text,
        additions: count,
        deletions: count,
        changedFiles: count,
        headRefName: z.string(),
        baseRefName: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        mergedAt: text,
        closedAt: text,
        headRepositoryOwner: z.object({ login: text }).nullish(),
        author: actor,
        viewerCanUpdate: flag,
        viewerDidAuthor: flag,
        viewerCanUpdateBranch: flag,
        autoMergeRequest: z.object({ enabledAt: text }).nullish(),
        labels: z
          .object({ nodes: z.array(z.object({ name: text, color: text }).nullish()) })
          .nullish(),
        reviewRequests: ReviewRequestsSchema,
        latestReviews: LatestReviewsSchema,
        commits: z
          .object({
            nodes: z.array(
              z
                .object({
                  commit: z.object({
                    statusCheckRollup: z
                      .object({ contexts: z.object({ nodes: z.array(CheckSchema.nullish()) }) })
                      .nullish(),
                  }),
                })
                .nullish(),
            ),
          })
          .nullish(),
      }),
    }),
  }),
});
export type DetailResponse = z.infer<typeof DetailResponseSchema>;

export const BaseComparisonSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            baseRef: z.object({ compare: z.object({ behindBy: z.number() }).nullish() }).nullish(),
          })
          .nullish(),
      })
      .nullish(),
  }),
});

const ThreadCommentSchema = z.object({
  id: z.string(),
  author: actor,
  body: text,
  createdAt: z.string(),
  url: text,
  reactionGroups: ReactionGroupsSchema,
});

const ReactableSchema = z.object({
  id: text,
  author: actor,
  url: text,
  reactionGroups: ReactionGroupsSchema,
});

export const ActivityResponseSchema = z.object({
  data: z.object({
    viewer: z.object({ login: text }).nullish(),
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          pageInfo: z.object({ hasNextPage: flag, endCursor: text }).nullish(),
          nodes: z.array(
            z.object({
              id: text,
              isResolved: flag,
              isOutdated: flag,
              path: text,
              line: count,
              diffSide: text,
              comments: z.object({
                totalCount: count,
                pageInfo: z.object({ hasNextPage: flag }).nullish(),
                nodes: z.array(ThreadCommentSchema),
              }),
            }),
          ),
        }),
        author: actor,
        reactionGroups: ReactionGroupsSchema,
        comments: z.object({ nodes: z.array(ReactableSchema.nullish()) }).nullish(),
        reviews: z.object({ nodes: z.array(ReactableSchema.nullish()) }).nullish(),
        reviewRequests: ReviewRequestsSchema,
        latestReviews: LatestReviewsSchema,
        reviewDismissals: z
          .object({
            nodes: z.array(
              z
                .object({ dismissalMessage: text, review: z.object({ id: text }).nullish() })
                .nullish(),
            ),
          })
          .nullish(),
        commits: z
          .object({
            nodes: z.array(
              z
                .object({
                  commit: z.object({
                    oid: z.string(),
                    messageHeadline: text,
                    committedDate: text,
                    additions: count,
                    deletions: count,
                    authors: z
                      .object({
                        nodes: z.array(
                          z
                            .object({
                              name: text,
                              avatarUrl: text,
                              user: z.object({ login: text }).nullish(),
                            })
                            .nullish(),
                        ),
                      })
                      .nullish(),
                  }),
                })
                .nullish(),
            ),
          })
          .nullish(),
      }),
    }),
  }),
});
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

/** `gh pr view --json comments,reviews`, which follows GitHub's cursors itself. */
export const ConversationSchema = z.object({
  comments: z
    .array(
      z.object({ id: z.string(), author: actor, body: text, createdAt: z.string(), url: text }),
    )
    .nullish(),
  reviews: z
    .array(z.object({ id: z.string(), author: actor, body: text, state: text, submittedAt: text }))
    .nullish(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ReviewerCandidatesSchema = z.object({
  data: z.object({
    repository: z.object({
      assignableUsers: z.object({
        pageInfo: z.object({ hasNextPage: flag }).nullish(),
        nodes: z.array(actor),
      }),
      pullRequest: z
        .object({
          author: actor,
          reviewRequests: z
            .object({
              nodes: z.array(
                z
                  .object({ requestedReviewer: ActorSchema.extend({ slug: text }).nullish() })
                  .nullish(),
              ),
            })
            .nullish(),
        })
        .nullish(),
    }),
  }),
});
export type ReviewerCandidatesResponse = z.infer<typeof ReviewerCandidatesSchema>;

export const PullRequestIdSchema = z.object({
  data: z.object({ repository: z.object({ pullRequest: z.object({ id: z.string() }) }) }),
});

export const SubjectScopeSchema = z.object({
  data: z.object({
    repository: z.object({ pullRequest: z.object({ id: z.string() }).nullish() }).nullish(),
    node: z
      .object({ id: z.string(), pullRequest: z.object({ id: z.string() }).nullish() })
      .nullish(),
  }),
});

export type SubjectScope = z.infer<typeof SubjectScopeSchema>;

/** One entry of the REST files list, for a pull request or a single commit. */
export const FilesSchema = z.array(
  z.object({
    filename: z.string(),
    status: text,
    previous_filename: text,
    /** Absent for a binary file, and for one GitHub considers too large to diff. */
    patch: text,
    additions: count,
    deletions: count,
  }),
);
export type ChangedFile = z.infer<typeof FilesSchema>[number];
