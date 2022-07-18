import * as github from '@actions/github'
import { RequestParameters } from '@octokit/graphql/dist-types/types'
import { PullRequestCommitsQuery, PullRequestCommitsQueryVariables, PullRequestsByRefQuery, PullRequestsByRefQueryVariables } from './generated/graphql'

type Github = ReturnType<typeof github.getOctokit>

type Query = {
  __typename?: 'Query'
}

function query<TQuery extends Query> (gh: Github, query: string, variables: RequestParameters): Promise<TQuery> {
  return gh.graphql<TQuery>(query, variables)
}

const pullRequestsByRefQuery = /* GraphQL */ `
  query pullRequestsByRef($repo: String!, $owner: String!, $ref:String!, $limit: Int!) { 
    repository(name: $repo, owner: $owner) {
      id
      ref(qualifiedName: $ref) {
          associatedPullRequests(first: $limit) {
            nodes {
              number
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    }
`

async function queryPullRequestsByRef (gh: Github, variables: PullRequestsByRefQueryVariables): Promise<PullRequestsByRefQuery> {
  return await query<PullRequestsByRefQuery>(gh, pullRequestsByRefQuery, variables)
}

export async function getPullRequestsByRef (gh: Github, params: { owner: string, repo: string, ref: string, limit: number }) {
  const prNums: number[] = []
  const prs: PullRequestsByRefQuery = await queryPullRequestsByRef(gh, params)
  const nodes = prs.repository?.ref?.associatedPullRequests.nodes
  const hasMore = prs.repository?.ref?.associatedPullRequests.pageInfo.hasNextPage ?? false

  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (node) {
        prNums.push(node.number)
      }
    }
  }

  return { numbers: prNums, hasMore }
}

const pullRequestCommitsQuery = /* GraphQL */ `
  query pullRequestCommits(
    $repo: String!,
    $owner: String!,
    $pullRequestNumber: Int!,
    $lastEndCursor: String
  ) {
    repository(name: $repo, owner: $owner) {
      pullRequest(number: $pullRequestNumber) {
        commits(first: 100, after: $lastEndCursor) {
          nodes {
            commit {
              message
              committer {
                email
              }
              commitUrl
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    }
  }
`

async function queryPullRequestCommits (gh: Github, variables: PullRequestCommitsQueryVariables): Promise<PullRequestCommitsQuery> {
  return await query<PullRequestCommitsQuery>(gh, pullRequestCommitsQuery, variables)
}

export async function getPullRequestCommits (gh: Github, params: { owner: string, repo: string, pullRequestNumber: number }) {
  const commits: Array<{ commiterEmail?: string, message: string }> = []
  let hasNext = true
  let cursor: string | null | undefined = null
  while (hasNext) {
    const prCommits: PullRequestCommitsQuery = await queryPullRequestCommits(gh, { ...params, lastEndCursor: cursor })
    const nodes = prCommits.repository?.pullRequest?.commits.nodes
    hasNext = prCommits.repository?.pullRequest?.commits.pageInfo.hasNextPage ?? false
    cursor = prCommits.repository?.pullRequest?.commits.pageInfo.endCursor

    if (nodes) {
      for (const node of nodes) {
        if (node) {
          commits.push({
            commiterEmail: node.commit.committer?.email ?? undefined,
            message: node.commit.message
          })
        }
      }
    }
  }
  return commits
}
