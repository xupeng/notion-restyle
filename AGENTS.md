# Repository instructions

## Source and generated userscript

- Desktop and browser share `assets/notion-custom.css`, `assets/renderer-inject.js`,
  and `scripts/renderer-payload.mjs`. Keep them as the source of truth.
- `userscripts/notion-restyle.user.js` is a version-controlled build artifact.
  Never edit it manually; regenerate with `npm run build:userscript`.
- `npm test` checks the artifact without rewriting it. Do not replace this check
  with an automatic build in the test lifecycle.

## Creating or updating a pull request

Apply these steps to every PR for this repository, including updates to an
existing PR. Follow the user's PR skill for branch, commit, and remote handling;
these rules add a repository-specific preflight, not permission to publish.

1. Inspect the worktree and authorized PR scope first. If unrelated source,
   package-version, or generated-file edits would be incorporated or overwritten
   by the build, stop and ask; do not silently include or discard them.
2. If the PR changes the installed userscript's behavior or emitted code, ensure
   the three-component `package.json` version is greater than the confirmed PR
   base's version. Increment the patch component once if a version bump is still
   needed; retain an already adequate user-selected version. Do not bump for
   documentation-only changes or every repeated build/PR update.
3. After final source and version edits, run `npm run prepare:pr`. It builds the
   userscript and runs `npm test`, including the read-only consistency check.
   A successful same-task run may be reused only if all build inputs and tested
   content remain unchanged. Stop on failure rather than creating the PR anyway.
4. Review the generated diff and explicitly stage
   `userscripts/notion-restyle.user.js` if it changed, alongside the authorized
   source files and `package.json` if bumped. Never use `git add -A` to capture
   unrelated work. An unchanged artifact needs no extra commit.
5. Inspect the staged artifact as well as source changes before committing. If
   subsequent edits or commit hooks invalidate verification, regenerate, retest,
   and include the resulting artifact before pushing or updating the PR.

The preflight command never stages, commits, pushes, or opens a PR itself. It is
not a GitHub event hook; humans using `gh pr create` directly must run it first.
