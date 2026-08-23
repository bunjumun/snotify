# Pitch: local Ollama to stretch Claude token usage

## The idea
Run a local Ollama model alongside Claude Code via an MCP server (e.g.
[OllamaClaude](https://github.com/Jadael/OllamaClaude) or
[claude-sidekick](https://github.com/andrewbrereton/claude-sidekick)).
Claude stays the orchestrator; the local model does cheap, mechanical work
that doesn't need Claude-level reasoning, so fewer tokens get billed against
the weekly limit — the same limit that idled the manager tasks for three days
(notebook item 11).

## Where it actually pays off here
- **File-aware review/summarize calls.** Instead of Claude reading a whole
  file into context to summarize or sanity-check it, a tool call hands the
  path to Ollama locally and gets back a short summary — one write-up cites
  a 4000→50 token drop for exactly this pattern.
- **Bulk mechanical passes**: linting-style checks, "does this file still
  reference X", formatting normalization — the kind of read-only sweep the
  stenographer/workhorse tasks already do a lot of.
- **Draft generation for throwaway text** (changelog phrasing options, first
  drafts of COMPLETED-log wording) that Claude then edits down, rather than
  Claude generating and re-generating drafts itself.

## Where it doesn't
- Anything touching the notebook, the ledger, or a decision with judgment
  calls in it (which reading to take, whether something crosses the ceiling)
  stays Claude's — that's the actual value this setup is paying for, and
  delegating it away would be delegating the thing §7 exists to protect.
- Nothing that touches Supabase or the live site directly; a local model has
  no business anywhere near production data or the push.

## Setup cost
Needs Ollama running locally with a model pulled (context window 32K+,
64K recommended) and the MCP server added to this machine's config. That is
a new local dependency and a new MCP server — both past what a single
session should do without a go, so this pitch stops here rather than
installing anything.

## Recommendation
Worth trying if the weekly-limit idling (item 11) becomes a recurring
problem rather than a one-off. Start with just the file-review tool, since
that's the highest-leverage, lowest-risk piece, and it's the one with a
measured number behind it rather than a marketing claim.

Sources:
- [Ollama Claude: Local LLM Delegation for Claude Code](https://mcpmarket.com/server/ollama-claude)
- [GitHub - Jadael/OllamaClaude](https://github.com/Jadael/OllamaClaude)
- [GitHub - andrewbrereton/claude-sidekick](https://github.com/andrewbrereton/claude-sidekick)
- [Claude Code - Ollama](https://docs.ollama.com/integrations/claude-code)
- [Claude Code with Anthropic API compatibility · Ollama Blog](https://ollama.com/blog/claude)
