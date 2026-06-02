# Docs Brain Spec

## Responsibility

Provide version-aware library/framework guidance without relying on model memory.

## Inputs

- package files
- lockfiles
- imports
- task graph
- repo-local examples
- optional official docs cache
- optional configured web search results

## Outputs

- DocsPacket

## Required functions

- `detectDependencies()`
- `detectRelevantLibraries(task)`
- `retrieveLocalExamples(library, version)`
- `retrieveOfficialDocs(library, version, query)`
- `retrieveWebResearch(query)`
- `rerankDocs(snippets, task)`
- `buildDocsPacket(task, budget)`

## Rules

- Prefer installed package version over latest public docs.
- Prefer official docs over blog posts.
- Prefer repo-local examples when matching existing patterns.
- Web search must be explicit in the packet with source URLs, snippets, status, and failure reason.
- Do not let docs evidence exceed the Context Governor budget.
