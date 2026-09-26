# Conversation Analysis & Report Generation — Design

How FluencyOS turns a finished conversation into a report the learner can trust.

Spec reference: `fluencyos_spec.md` §6.2 (Post-Chat Analytics) and §6.3 (Dynamic SRS Routing).

---

## 1. The problem this design solves

A conversation report is only worth showing if every number on it means something. The first implementation failed that test in a way that was invisible from the outside:

`end_session()` read six keys out of the model's JSON analysis — `word_usage`, `fluency_score`, `vocabulary_reach_score`, `self_corrections`, `errors`, `summary` — but the prompt that produced that JSON only ever asked for three: `word_usage`, `accuracy_notes`, `summary`.

The consequences on every real session:

| Field | Reality |
| --- | --- |
| `fluency_score` | always `0` — a dial permanently reading zero |
| `vocabulary_reach_score` | always `0` — ditto |
| `errors` | always `[]` — "no notable errors flagged", always |
| `self_corrections` | always `0` |
| `accuracy_notes` | requested from the model, then discarded |

The test suite passed throughout, because the `fake_llm` fixture returned the keys `end_session` *read* rather than the keys the prompt *requested*. The tests asserted on data that no production run could ever produce. **That is the real lesson of this document: a fake that doesn't go through the production parsing path can hide a completely broken feature.**

Two further measurement defects, both of which made the numbers we *did* show misleading:

- `avg_pause_seconds` averaged gaps between *all* turn timestamps, so it was dominated by LLM generation latency. It measured the model, not the learner.
- `words_per_minute` divided learner words by whole-session wall-clock time, which includes the AI thinking and talking. It was not a speech rate.

---

## 2. Core principle: deterministic vs judged

Every field in the report belongs to exactly one category, and knowing which is what makes the report defensible.

### Deterministic — computed from the transcript, no LLM

Reproducible, unit-testable, identical on every run, free.

| Field | Definition |
| --- | --- |
| `words_per_minute` | learner words ÷ learner **speech** seconds (voice only; `null` for text) |
| `filler_rate_per_100w` | filler words per 100 learner words, from an explicit filler list |
| `avg_response_delay_seconds` | gap from the AI's turn to the learner's reply |
| `longest_run_words` | longest single uninterrupted learner turn |
| `type_token_ratio` | distinct lemmas ÷ total learner words |
| `above_level_words` | distinct learner-produced words rated above their CEFR band |
| `pronunciation_score` | mean STT confidence — explicitly a proxy, never a phoneme score |
| `contextual_accuracy_pct` | share of target words used correctly, from routing |

### Judged — the LLM is asked, and the answer is read

Reserved for what genuinely requires understanding language.

| Field | Definition |
| --- | --- |
| `word_usage` | per target word: `spontaneous` / `prompted` / `incorrect` / `avoided` |
| `grammatical_precision` | 0–100 |
| `errors` | the three most instructive, each quoted and corrected |
| `self_corrections` | times the learner caught and repaired themselves |
| `summary` | two or three sentences plus one concrete focus for next time |

The split matters because a model asked for a "fluency score" will happily invent one. A model asked to *classify whether a learner used a word correctly* is doing work only a language model can do.

Existing utilities reused rather than reimplemented: `cefr_lexicon.is_above_level`, `cefr_lexicon.band_of`, `cefr_lexicon.normalise`, `difficulty_heat.distinct_above_level`.

---

## 3. One schema, one prompt

The drift happened because identical prompt text was copy-pasted into three engine modules (`llm_chat_engine`, `cloud_llm_engine`, `gemini_llm_engine`). Re-syncing three copies is not a fix; removing the duplication is.

`backend/app/services/conversation_report.py` owns all three concerns:

- **`LlmReportAnalysis`** — a Pydantic model of the judged fields. The single source of truth.
- **`report_system_prompt(target_words)`** — renders the required-shape line **from the model's own fields**. The prompt cannot ask for a different set than the reader parses, because both are generated from one definition.
- **`compute_metrics(turns, target_cefr)`** — a pure function over turns producing every deterministic metric.

`end_session` parses with `LlmReportAnalysis.model_validate(raw)`. The engines keep only `generate_json`; `generate_report` is deleted from all three. This follows the pattern `vocabulary_ai._generate_json` already established: **the prompt lives in the service, the engines are plumbing.**

```
conversation.end_session
   ├── compute_metrics(turns, cefr)          → deterministic half
   └── _generate_report(target)              → judged half
         └── <engine>.generate_json(report_system_prompt(...))
               └── LlmReportAnalysis.model_validate(...)
```

---

## 4. Honest measurement: storing speech time

A true speech rate needs the learner's actual speaking time. It was not stored — `_insert_turn` records `audio_path` for AI turns only.

`stt_engine.transcribe` already decodes each clip and computes its duration (added alongside the silent-clip guard). That duration is now returned and persisted to a `speech_seconds` column on `conversation_turns`.

- Voice sessions: `words_per_minute` = learner words ÷ summed `speech_seconds`
- Text sessions: `words_per_minute` is `null`, rendered as "—"

Reporting `null` is the point. A wall-clock number for a text session would look like a fluency measurement while being an artifact of how fast the model replied.

---

## 5. Backward compatibility

Reports are stored as a JSON blob in `conversation_sessions.report_json`; `GET .../report` validates it through `ConversationReportOut`. Adding or renaming a field would make every pre-existing report raise a `ValidationError` → 500.

Two mechanisms, covering different failure modes:

1. **Defaults + `report_version`.** New fields are nullable with defaults, so an old report still opens. Crucially this makes *absent* distinguishable from *zero* — the original schema could not express that difference, which is exactly how four permanently-zero fields went unnoticed.
2. **Regenerate on open.** When the UI sees `report_version < CURRENT`, it calls `POST .../report/regenerate`.

Regeneration is a **POST, never part of the GET**. It spends a real LLM call and it rewrites `review_logs` for the session; a GET must do neither. If regeneration fails or is declined, the defaults mean the old report still renders honestly, with unmeasured fields shown as "not measured in this report" rather than a fabricated zero.

> **Cost note:** regeneration is one cloud request per old session, at the moment it is opened. Bounded, but real — cloud quota is a finite resource and has run out in practice.

---

## 6. Report UI

- **Four dials**, all genuinely 0–100: Contextual accuracy · Grammatical precision · Lexical range (type-token ratio ×100) · Pronunciation
- `above_level_words` is a **count and word list**, not a dial. The dial renders `(value / 100) * 360` degrees, so a raw count in that slot would be meaningless.
- **Fluency proxies panel**: words/min (or "—"), filler rate, response delay, longest run, self-corrections, turn count
- **Routing table**: each target word linked back to the turn where it was used
- **"Practise this again"** starts a new session in the same scenario, seeded with this session's target words

---

## 7. Testing strategy

The fixture is why this shipped broken, so it is part of the design rather than an afterthought.

- **Patch `generate_json`, not `generate_report`.** After the refactor there is nothing else to patch, so every fake flows through the real `LlmReportAnalysis.model_validate`. A key the prompt never requested now fails validation instead of silently populating a field.
- **Schema-derived fakes.** `fake_analysis()` fills a sentinel per `LlmReportAnalysis.model_fields`, so a new field appears automatically and a stale one raises.
- **Contract test.** Every `LlmReportAnalysis` field name must appear verbatim in `report_system_prompt(...)`. This is the test that would have caught the original bug, and it is worth deliberately breaking once to confirm it fails.
- **Non-default test.** Every judged field must be non-default in a generated report.
- **Metric unit tests** against hand-built turn lists: filler rate, type-token ratio, longest run, response delay, above-level words with a NULL CEFR level.

Heavy engines are never loaded in tests — no real model, no network.

---

## 8. Deliberate limitations

Stated plainly, because a report that overclaims is worse than one that admits its bounds.

- **`avoided` means "never used"**, not the spec's "opportunity arose three times and the word was never attempted". Detecting an *opportunity* is not something we can do reliably, and inventing the number would undercut the point of the report.
- **Pronunciation is an STT-confidence proxy**, not forced alignment. The spec permits this explicitly, and the UI labels it as a proxy.
- **No FSRS scheduler exists**, so `review_logs` records what really happened without a fabricated schedule to route it into. The spec's "mastery level 5 needs three spontaneous events" rule is not enforceable until that scheduler exists.
- **`users.cefr_level` can be NULL**, in which case a fallback band is resolved before any above-level comparison.

---

## 9. Edge cases

| Case | Behaviour |
| --- | --- |
| No learner turns | every metric degrades to `null`/0, no division by zero |
| No target words | `contextual_accuracy_pct` is `null`, not `0` |
| Text-channel session | `words_per_minute` and `pronunciation_score` are `null` |
| NULL `cefr_level` | fallback band resolved before `is_above_level` |
| Session re-ended | report recomputed over the full transcript; `review_logs` replaced, not appended |
