import * as util from 'util'
import { exec as _exec } from 'child_process'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { PushEvent } from '@octokit/webhooks-definitions/schema'
import load from '@commitlint/load'
import lint from '@commitlint/lint'
import { formatResult } from '@commitlint/format'
import { getPullRequestCommits, getPullRequestsByRef } from './query'

const exec = util.promisify(_exec)

export async function main () {
  const token = core.getInput('token', { required: true })
  const excludeCommiters = core.getInput('exclude-commiters', { required: false }).split(/^/m).map(o => o.trim()).filter(o => o).reduce((a, e) => {
    a.add(e)
    return a
  }, new Set<string>())
  const owner = github.context.repo.owner
  const repo = github.context.repo.repo

  if (github.context.eventName !== 'push') {
    core.setFailed('action must be triggered by push event')
    return
  }
  const event = github.context.payload as PushEvent
  core.notice(`linting against ${event.ref} of ${owner}/${repo}`)

  const gh = github.getOctokit(token)

  const pullRequests = await getPullRequestsByRef(gh, { owner, repo, ref: event.ref, limit: 5 })
  if (pullRequests.numbers.length <= 0) {
    core.notice('could not detect pull request number. skipping.')
    return
  }

  await exec('npm install @commitlint/core')

  if (pullRequests.hasMore) {
    core.warning(`${event.ref} is associated with too many pull requests.`)
  }

  for (const prNum of pullRequests.numbers) {
    const commits = await getPullRequestCommits(gh, { owner, repo, pullRequestNumber: prNum })
    if (commits.length <= 0) {
      core.notice('no commits found.')
      return
    }

    const commitlintConfig = await load()

    if (Object.keys(commitlintConfig.rules).length === 0) {
      core.setFailed('no rules. please configure commitlint.')
      return
    }

    const results = (await Promise.all(
      commits.filter(commit =>
        commit.commiterEmail === undefined ||
        !excludeCommiters.has(commit.commiterEmail)
      ).map((commit) => lint(commit.message, commitlintConfig.rules))
    ))

    for (const result of results.map(o => formatResult(o, { color: false }))) {
      core.notice(result.join('\n'))
    }

    const hasError = results.some(o => o.errors.length > 0)
    if (hasError) {
      core.setFailed('commitlint failed.')
    }
  }
}
