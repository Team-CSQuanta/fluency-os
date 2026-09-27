# Testing FluencyOS — the beginner tests

A **test** is a small program that runs part of the app and checks the result
is what we expect. If someone later breaks that part, the test fails and says
where. FluencyOS has 1,000+ tests; these 15 are the simple ones, written to
show the idea.

## Run them

```bash
npm run test:beginner
```

About 3 seconds. Every test is printed by name with `PASSED` (Python) or `✓`
(TypeScript), and the last line says whether all passed.

## How every test is written

Each test follows the same three steps, marked with comments in the code:

| Step        | Meaning                     | Example                                      |
| ----------- | --------------------------- | -------------------------------------------- |
| **Arrange** | set up the input            | `words_read = 550`                           |
| **Act**     | run the code being tested   | `pages = pagination.pages_from_words(words_read)` |
| **Assert**  | check the result            | `assert pages == 2`                          |

## The 15 tests

**Part 1 — plain functions (unit tests)** · `backend/tests/beginner/test_1_simple_functions.py`

| Test | What it checks |
| --- | --- |
| 550 words count as 2 pages | the reading goal's page count (275 words = 1 page) |
| reading nothing counts as 0 pages | an edge case: 0 or negative never counts |
| the level test pass mark is 80% | 12 of 15 questions are needed to pass |
| a learner cannot jump up a level without the test | going up needs the test, going down is free |
| a reply is split into sentences for the voice | the AI's voice speaks one sentence at a time |

**Part 2 — the backend API (integration tests)** · `backend/tests/beginner/test_2_api_basics.py`

These send real HTTP requests to the backend, each against its own fresh,
empty database.

| Test | What it checks |
| --- | --- |
| the backend is running | `GET /health` answers `200 OK` |
| requests without the secret token are refused | security: `401 Unauthorized` without the app's token |
| a new learner can be created and read back | create a user, then read the same name back |
| a saved word appears in the vocabulary list | save "harbour", then find it in the list |
| a saved word becomes a flashcard to review | saving a word adds one new review card |
| a new learner cannot pick a high level without the test | the level rule, through the API: `403 Forbidden` |

**Part 3 — frontend code (TypeScript)** · `renderer/src/tests-beginner/simple.test.ts`

| Test | What it checks |
| --- | --- |
| shows 65 seconds as 1:05 | the time shown under a video |
| looks up "findings", not "findings." | clicking a subtitle word ignores the full stop |
| stays quiet at 23:30 at night | review reminders respect quiet hours (22:00–08:00) |
| can remind at 12:00 midday | …and are allowed outside them |

## Show a test catching a mistake

1. Open `backend/tests/beginner/test_1_simple_functions.py`.
2. In `test_550_words_count_as_2_pages`, change `assert pages == 2` to `assert pages == 3`.
3. Run `npm run test:beginner`. That test turns red:

   ```
   >       assert pages == 3
   E       assert 2 == 3
   ```

   The app really returned 2, the test expected 3, and pytest points at the line.
4. Change it back to `2` and run again — everything passes.

## The full test suite

`npm test` runs every test — TypeScript type-checking, 45 frontend tests and
970+ backend tests — in about 3 minutes, and writes a report to
`test-reports/index.html` listing every test by feature, with code coverage.
GitHub Actions runs the same command on every push.
