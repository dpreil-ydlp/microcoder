# Repo Brain Spec

## Responsibility

Maintain fresh, semantic repository intelligence and produce compact evidence packets for models.

## Index contents

- file tree
- language map
- symbols
- definitions
- references
- imports/exports
- routes
- API endpoints
- DB/schema files
- test map
- package versions
- diagnostics
- git SHA and dirty state
- component inventory for frontend repos

## Freshness rule

If Repo Brain status is not `fresh`, model code generation must block.

The coder must never bypass Repo Brain and search the repo directly. Raw grep is an internal Repo Brain capability only.

## Required adapters

- file scanner
- git status/SHA watcher
- Tree-sitter parser
- basic symbol extractor
- ripgrep internal search
- LSP adapter later
- test discovery

## Required functions

- `indexRepo()`
- `refreshDirtyFiles()`
- `getStatus()`
- `markStale(paths)`
- `waitUntilFresh()`
- `localizeTask(task)`
- `buildEvidencePacket(task, budget)`
- `findTestsForFiles(paths)`
- `findReferences(symbol)`
- `findDefinitions(symbol)`

## Evidence quality ranking

Prefer exact source snippets over summaries when patch generation depends on code syntax.

Ranking:

1. direct failing test / stack trace
2. exact target file snippet
3. direct caller/callee snippet
4. type/interface definition
5. repo-local pattern example
6. summarized architecture note
7. docs snippet

## Staleness triggers

- file changed
- patch applied
- branch/worktree changed
- package lock changed
- test file changed
- LSP diagnostic change
- merge completed
