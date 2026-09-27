# Should Jev merge with your Claude Code? Verdict and evidence

Date: 2026-09-27. Scope: the two X articles you screenshotted (@polydao "Loop Engineering Meets Jev Engineering" and @thegreatest_sv "JEV: Your LLM's Second Brain"), Claude Code's own current features, the agentmemory fork on this branch, and your Jev-related forks on GitHub.

Note on the name: the product is "Jev" (by TypeSafe AI), not "Jeff".

## Verdict in one paragraph

Do not merge Jev into your Claude Code setup as the articles describe it. Two of the three "builds" (the Bash safety gate and the "only wake Claude when there is work" triage) duplicate features Claude Code now ships natively, at no extra charge on Pro, Max and Team plans, with a better-tested classifier and fail-safe semantics that a third-party hook cannot match. The one build with real value, a Stop-hook "done check" backed by evidence from your own scripts, does not need Jev to work and is safer with a local rule set plus Claude Code's built-in `/goal` evaluator. For the agentmemory codebase, Jev does not replace anything that exists today, because agentmemory never gates agent actions and its LLM provider interface is text in, text out. There is one narrow, opt-in experiment worth running there (observation relevance scoring), and it should be behind a flag with shadow mode first. The cost story ($765 to $3 a month) is modeled, not measured, and it compares against a strawman nobody runs.

## What Jev actually is (verified)

- A "System One" zero-shot classifier: you send a JSON or text state plus typed questions (Choice, Score, Noul which is a yes/no probability). It returns a label, per-option probabilities and a confidence. No text generation. Confirmed from Cloudflare's public model catalog entry for `typesafe/jev`, not only from vendor copy.
- Model id `jev-1.13.0`; 32k context; price $0.042 per million input tokens, output free. Confirmed in the Cloudflare catalog JSON.
- SDKs are real but days old: Python `typesafe-sdk` 0.7.2 released 2026-09-26 (first release 2026-09-09); JS `@typesafe-ai/sdk` 0.6.0 released 2026-09-15 and not updated since; `langchain-typesafe` 0.0.1a3 is a pre-release under an "experimental" namespace.
- Company: TypeSafe AI, San Francisco, out of stealth on 2026-09-15 with a $40M seed. The X launch was run by a paid creator-seeding agency (Doomers, 80 to 100 seeded creators). That context matters when weighing X articles.
- Access: general availability was announced around 2026-09-20, then new signups were paused on 2026-09-22 due to demand. No source shows direct signups reopened as of 2026-09-25. Existing keys work; gateways (Vercel AI Gateway, Cloudflare Workers AI, OpenRouter) also expose it, but Vercel community threads since 2026-09-26 report 429 "upstream high demand" errors on most requests.
- Privacy: policy says inputs are not used for training and not disclosed to third parties except service providers, but the customer agreement carves out "telemetry" (logs, hashes, summary statistics, classifications) that can be used "to improve the Services". US-only processing, no EU residency, no HIPAA. SOC 2 claim appears only on a third-party aggregator.

## What the articles claim versus what holds up

| Claim in screenshots | What the evidence says |
|---|---|
| ~100 ms per decision, median 300 ms | Builder-measured medians for Claude Code gates are 350 to 371 ms (jev-gate, the-jev-enator). Vendor floor is 70 ms. Plan on 250 to 400 ms plus your network. |
| $765 to $3 a month | Modeled from 600 decisions a night at 4,000 tokens each, list prices, 30 nights. The article's own FAQ says these are "modeled monthly prices, not measured bills". It assumes you would otherwise make 600 separate Fable 5.1 API calls for yes/no questions. Nobody does that; on Max the decisions are inside your subscription turns. A PreToolUse gate adds a call, it does not remove Claude's call. |
| "10,000 decisions for $0.42" | Consistent with $0.042/M at ~1k tokens each. True but irrelevant to whether the decisions are correct. |
| Confidence you can threshold on (0.9, 0.95) | TypeSafe's own limitations page says adversarial text "can move the answer". Independent tests: accuracy fell to 44.7% while average confidence stayed 0.74 when the rule was not decidable from the text; jev-gate's 300-call test shows authority-style injection let 3 to 10% of dangerous commands through and dropped confidence only from 0.68 to 0.40; a statistics post argues raw confidences cannot be treated as calibrated. |
| "Hard rules run in code before Jev because Jev trusts whatever text is in its state" | Correct, and it is the strongest admission in the article: the classifier is injectable by the very commands it is asked to judge. |
| Compaction demo 1M to 86K tokens in a second | Existence proof from one run (tamara's fast-jev-compaction), not a benchmark. The repo README itself has no numbers. |
| TypeSafe evals: 193.6x faster, 444.6x cheaper | Scored against the average of two LLMs rather than ground truth; TypeSafe discloses this. On its own 711-case eval Jev scored 67.8% vs 74.1% for the best comparator. |

## Build by build against what Claude Code already does

### Build One: the 100 ms Bash safety gate. Do not build.

- Claude Code auto mode became the default starting mode for Pro, Max and Team on 2026-08-14, and its classifier overhead is no longer charged on those plans. On v2.1.283 and later it is the default for all interactive sessions.
- The built-in classifier runs on Sonnet 5 in a two-stage pipeline, is deliberately reasoning-blind (tool results are stripped so hostile file content cannot steer it), reviews shell commands and network operations, runs `git status` before destructive commands, and has published rates: 0.4% false positives on 10,000 real calls, 17% false negatives on real overeager actions.
- It is layered: allow/ask/deny rules first, then read-only and working-directory edits auto-approved, then the classifier. A PreToolUse hook "allow" can never approve a critical-path `rm`. A Jev hook cannot reach any of this.
- PreToolUse hooks fail open. The docs say: "A timed-out command, http, or mcp_tool hook doesn't block the tool call... don't count on a stalled hook to act as a gate." With Jev returning 429s under load, your gate silently becomes a no-op exactly when you are running overnight.
- Data exposure: the hook sends every Bash command and cwd to a third party. Commands routinely contain tokens, URLs with credentials and internal hostnames. Auto mode keeps that inside your existing Anthropic trust boundary.
- If you still want a second opinion on commands, the supported path is a PostToolUse hook that adds `classifierContext` for the built-in classifier, or `permissions.ask` rules for specific commands. Neither needs a vendor.

### Build Two: the Stop hook "are we actually done?" check. Worth the pattern, not the vendor.

- The problem is real: the official loops guide (2026-06-30) says a reviewer with fresh context is less biased, and `/goal` already uses "an evaluator model" that checks your condition each time Claude tries to stop, with an attempt cap.
- The valuable part of the article's build is `checks.sh`: print tests, TODO grep, README diff, lighthouse score as evidence, and block the stop when a hard check fails. That part is deterministic code and needs no model.
- The Jev Noul on top ("does checks output prove every line of GOAL.md?") is the injectable, uncalibrated part. Claude wrote the code that produced the evidence Jev reads. If you want a model judgment here, `/goal` with an explicit condition is already wired in, or a fresh-context `/code-review` subagent.
- Stop hooks that block need a counter or you loop forever; the article's `.pushes` file is the right idea. Claude Code also lets a Stop hook block via exit 2 with a reason.
- In agentmemory specifically, the Stop hook is telemetry-only by project rule (fire-and-forget, 1.5 s exit). Turning it into a blocking judge would violate the hook contract in AGENTS.md and reintroduce the Stop-hook recursion class of bugs the project already fought once.

### Build Three: only wake Claude when there is work. Duplicate.

- `/schedule` runs a routine in the cloud on a cron; the routine's first step can be a cheap triage. The article's cron plus `claude -p` is the same shape with an external key added.
- The triage in the article labels GitHub issues by reading the body. That body is untrusted text going straight into the classifier; the article's own rule says hard rules must run first.

## For the agentmemory codebase on this branch

What the code does today (mapped file by file):

- No hook gates anything. The PreToolUse matcher is `Edit|Write|Read|Glob|Grep` with no Bash. No hook returns `permissionDecision`, `decision: block` or exit 2. All hooks fail open and exit 0 on any error. The only allow decision in the repo is a hardcoded allow in the Antigravity bridge.
- The provider interface has three methods: compress, summarize, describeImage. Text in, text out. Nothing calls an LLM for a bare yes/no.
- The judgment calls are hand-written heuristics, several of them crude: supersede on token Jaccard > 0.7 (`src/functions/remember.ts`), "contradiction" on Jaccard > 0.9 (`src/functions/auto-forget.ts`), lesson detection by regex for words like "always" and "never" (`src/functions/replay.ts`), enrich injection with no relevance threshold at all (`src/functions/enrich.ts`), and in the default keyless mode every observation gets importance 5 and confidence 0.3, which makes every downstream importance threshold inert (`src/functions/compress-synthetic.ts`).
- The one existing scorer precedent is the local cross-encoder reranker (`src/state/reranker.ts`, `Xenova/ms-marco-MiniLM-L-6-v2`), opt-in via `RERANK_ENABLED`, lazily loaded, disables itself on failure.

So a Jev "merge" would not replace anything. It would add a new remote dependency to a project whose selling points are keyless, local-first, zero external databases.

Where Jev could plausibly help, in order:

1. Observation relevance at capture time. Today post-tool-use stores everything up to 8,000 chars, and keyless mode assigns a flat importance. A Noul "will this tool result matter later?" per observation is exactly the question fast-jev-compaction and jev-pruner ask, and it is where the compaction demo numbers come from. This is the only experiment I would run.
2. Supersede and contradiction. Replacing Jaccard 0.7/0.9 with a Noul "does B make A obsolete?" is a better question, but the failure mode is silent memory loss, so it needs shadow mode and labeled data before it can decide anything.
3. Everything else (lesson detection, enrich thresholding) is cheap to improve locally and does not justify a vendor.

Conditions if you run experiment 1:

- Opt-in flag (for example `AGENTMEMORY_DECISION_PROVIDER=jev`), default off, keyless mode untouched.
- A new small provider family, not a fourth method on MemoryProvider: `decide(state, questions)` with its own detection and factory, mirroring how embedding providers are separate. Wrap it with the existing circuit breaker.
- Shadow mode first: log the Jev score next to the current heuristic for a week, then compare. The article's own rule seven says the same.
- Fail open to current behavior on timeout or error, with a 2 s budget, because it runs inside the hook path.
- Redact with the existing privacy regexes before sending state; today they run after capture, and this would be data leaving the machine.
- Pin `jev-1.13.0`, never `jev-latest`.
- Honest expectation: the local cross-encoder path may get you most of the benefit with no key and no data leaving the box. Try that comparison first.

## Your Jev forks (20 on your account, 9 cloned and read)

Read directly: awesome-jev, awesome-jev-by-typesafe, jev-mcp, fast-jev-compaction, jev-pruner, jev-review, Jev-Calibration, jev-curate, jev-codex-router. Not read: jev-drone, jev-voice-browser, jev-trader, jev-traders, jev-ultrafast, neo4jev, OneVOneJev, jevpilot, mobile-jev, jevlike, typesafe-mario. None of these touch Claude Code memory.

No hardcoded real keys were found in any of the nine; no shipped tool code has third-party analytics (jev-curate's marketing site pages load Vercel analytics).

- fast-jev-compaction (tamaratran, MIT, 2026-09-17, ~1.3k lines, 29 real offline tests). The one fork that maps onto agentmemory. It sends the whole conversation as state, including user text, Bash commands and Edit/Write contents (tool results replaced by size notes), asks two Nouls per tool call (keep the call, keep the result verbatim), drops or truncates below 0.5, never rewrites text. It has no request timeout. It relies on Claude Code's early-access "function hooks" API (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, v2.1.274+), not settings.json hooks. On any Jev failure the hook falls back to the built-in summary, so it fails safe. No measured numbers in the repo; the "1M to 86K" figure lives only in a tweet. Its library core has an injectable `JevAsker`, so the design works with any Noul-shaped backend, including a local model. This is the design to copy for an agentmemory relevance experiment.
- jev-pruner (tamaratran, MIT, 2026-09-19, ~2.5k lines TS plus a Python eval harness, ~6.4k lines of tests). Trims Bash stdout over 10k estimated tokens before Claude sees it, with deterministic guards (skips errors, JSON, diffs, docs, source), archives full output locally, fails open. Same function-hooks dependency. It sends the full session history (user and assistant text, complete tool inputs and results) to Jev on every eligible call. Its secret regex only blocks local archiving; the README states it "does not redact secrets or prevent content from being sent to Jev". The only committed eval results show a pass rate of 0 (no pruning happened in those runs); the 76k-to-4k anecdote has no data file.
- jev-mcp (burnigtm, MIT, 2026-09-21, ~2.5k lines, ~3.3k lines of tests, CI on Windows and Linux). The best-engineered of the nine: official SDK, base URL locked to api.typesafe.ai, 30 s deadline, fails closed with typed errors, thresholds auto 0.8 / review 0.5 / block 0.75. Targets Cursor and Codex. Its own README says "live quality and cost savings have not been measured"; the benchmark is mock-only.
- Jev-Calibration (Ryan Alyn Porter, no license file, 2026-09-19). The most valuable fork for deciding anything. 8,801 committed raw Jev answers on `jev-1.13.0`; every README number reproduces from the results files without a key. Findings: raw confidences are not calibrated (ECE 0.117); Noul is modestly overconfident (79.0% mean confidence vs 72.3% accuracy), but Noul above 0.95 was 2,104 of 2,104 correct; Choice raw confidence is nearly useless below 95% (50 to 57% accuracy across the 50 to 95% bands) and the API `confidence` field is just 2·p_top−1; isotonic calibration on a few hundred labels brings ECE to 0.008, Platt only to 0.052; measured median latency 235 ms. Practical rule from the repo: use Noul not Choice, auto-apply only above about 0.9, route the middle band to review, recalibrate per question and per model version.
- jev-codex-router (0xNatoshi, MIT, 2026-09-22, embeds a 130k-line fork of codex-router plus ~6.4k lines of Python). Codex-only, macOS launchd services, fails open to the default tier. Sends a bounded dossier rather than the transcript, which is a good pattern. Red flag: its quota fallback can route the full conversation to a third-party model (default DeepSeek) when such a route is configured. The "−60% vs full Astra" figure is a simulation on 237 private turns.
- jev-review (Dev Agrawal, MIT, ~1.8k lines, no tests) sends full patches or whole source files to TypeSafe; exceptions abort the run. jev-curate (Akash Priyadarshi, Rust, ~1.2k lines) filters dataset rows, unrelated to coding agents, with an inflated README (mock-only throughput claim, vendor "444.6x" figure) and the AI-scaffold pattern (STATE.md, memory/MEMORIES.md) the awesome-jev maintainers flag as "unproven".
- awesome-jev (yibie) and awesome-jev-by-typesafe (Anil-matcha; its README says "not an official TypeSafe AI repository"). agentmemory is listed in neither. Relevant leads not cloned: jev-axi and jev-gate (PreToolUse gates, rules first, Jev on the gray zone), jev-belay and limpet (Stop hooks), MemSearch Jev reranking and hippo-memory (memory recall reranking, private-store numbers only), Waxmell/jev-compaction (low scorers moved behind an `expand()` pointer).

Net: nothing you forked changes the verdict, and two of them strengthen it. Jev-Calibration shows that the 0.9 and 0.95 thresholds in the articles are only meaningful for Noul after per-question calibration, and that Choice confidence (which the article's Bash gate uses) is close to noise below 0.95. fast-jev-compaction and jev-pruner show the real data cost: whole transcripts, commands and edits leave the machine on every call, with no redaction.

## What it would cost you to be wrong

- A gate that fails open under vendor load gives false safety on overnight runs.
- Confident wrong decisions delete memories or block valid stops; both are silent.
- Commands, file paths and tool outputs leave your machine to a two-week-old vendor whose signups are paused and whose terms allow telemetry-derived learning.
- Version and API churn: three Python SDK releases in the last eleven days, JS SDK stalled.

## Recommendation

- Personal Claude Code: keep auto mode, add `permissions.ask` rules for the few commands you want a human on (`git push`, `npm publish`, `rm -rf` outside the repo), use `/goal` with an explicit condition and a turn cap for overnight loops, and put your `checks.sh` evidence into a Stop hook that blocks on hard failures only. No Jev key required.
- agentmemory: no merge. If you want to explore Jev, do it as an opt-in decision-provider experiment for observation relevance, shadow mode, behind a flag, and compare against the local reranker first. I would not open that PR until signups reopen and the SDK has been stable for a month.
- Revisit in 60 to 90 days: if independent calibration studies hold up, if TypeSafe publishes a trust page, and if Claude Code has not shipped equivalent relevance-based compaction natively.

## Sources

Claude Code: code.claude.com/docs/en/permission-modes; code.claude.com/docs/en/hooks; claude.com/blog/auto-mode-default-in-claude-code; anthropic.com/engineering/claude-code-auto-mode; claude.com/blog/getting-started-with-loops.
Jev: github.com/cloudflare/cloudflare-docs (catalog-models/typesafe-jev.json); pypi.org/project/typesafe-sdk; registry.npmjs.org/@typesafe-ai/sdk; pypi.org/project/langchain-typesafe; github.com/typesafe-ai/skills; github.com/eugeniughelbur/jev-gate; github.com/jakenbear/the-jev-enator; github.com/tamaratran/fast-jev-compaction; docs.typesafe.ai/model-jaggedness/jev-1.13 (via third-party quotes); x.com/typesafeai posts of 2026-09-20 and 2026-09-22 (via third-party quotes); doomers.ai/work/typesafe-ai-case-study; alexmolas.com/2026/09/23/jev-cant-be-calibrated.html; actionbox.cloud/blog/typesafe-ai-jev-review.
The two articles: x.com/polydao/article/2103689373774483815; x.com/thegreatest_sv/article/2102802378378621355. No sponsorship disclosure was found for either author; none was ruled out. @polydao's bio advertises growth services for AI brands.
