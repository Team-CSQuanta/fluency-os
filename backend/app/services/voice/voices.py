"""The voices each text-to-speech engine can speak in, and which one a
learner has picked.

The two engines package voices differently, and that difference is the whole
reason this module has a download step at all:

- Kokoro ships every voice inside voices-v1.0.bin, so once the engine is
  downloaded, every Kokoro voice is too. Its names encode the voice: af_/bf_
  are female, am_/bm_ male, a American and b British.
- Pocket TTS keeps one small embedding per voice (~6MB of precomputed state).
  The engine download fetches only the default one, so any other voice is
  fetched on its own the first time it is chosen or previewed.

Gender is what the voice sounds like, and was measured rather than read off
the names: each Pocket voice spoke the same two sentences and was placed by
median pitch together with its formants (F2/F3 — vocal-tract length, which
tells a low female voice from a high male one where pitch alone overlaps).
The female voices came out at 165-220 Hz with F3 ~2790-3040 Hz, the male ones
at 83-152 Hz with F3 ~2245-2675 Hz. Three are worth knowing about:

- Alba, the default, reads as a female name but measured ~145 Hz with male
  formants, and that is how it sounds.
- Caro sits at 150-180 Hz, but its formants are firmly in the female group.
- Marius is too breathy to track pitch reliably (a handful of voiced frames
  where the others have dozens); its formants are male.

Accents come from the recordings' own metadata (VCTK's speaker list for the
vctk-sourced voices) and are left blank where the source does not say.

Only voices worth hearing are listed. Kokoro's own grading puts several of
its voices at D or F; those are left out rather than offered as a trap.
Pocket's non-English voices (giovanni, lola, juergen, rafael, estelle) are
left out too — this app speaks English with its English model.
"""

from dataclasses import dataclass
from typing import Literal

from app.services.voice import model_catalog, model_manager

Gender = Literal["female", "male"]


@dataclass(frozen=True)
class Voice:
    key: str
    name: str
    gender: Gender
    accent: str | None
    note: str | None = None


KOKORO_VOICES: tuple[Voice, ...] = (
    Voice("af_heart", "Heart", "female", "American", "the clearest Kokoro voice"),
    Voice("af_bella", "Bella", "female", "American", "warm and expressive"),
    Voice("af_nicole", "Nicole", "female", "American", "soft, close to the microphone"),
    Voice("af_sarah", "Sarah", "female", "American"),
    Voice("af_kore", "Kore", "female", "American"),
    Voice("bf_emma", "Emma", "female", "British"),
    Voice("bf_isabella", "Isabella", "female", "British"),
    Voice("am_michael", "Michael", "male", "American"),
    Voice("am_fenrir", "Fenrir", "male", "American"),
    Voice("am_puck", "Puck", "male", "American"),
    Voice("bm_george", "George", "male", "British"),
    Voice("bm_fable", "Fable", "male", "British"),
)

POCKET_VOICES: tuple[Voice, ...] = (
    Voice("eve", "Eve", "female", "American"),
    Voice("jane", "Jane", "female", "American"),
    Voice("mary", "Mary", "female", "American"),
    Voice("cosette", "Cosette", "female", "American"),
    Voice("azelma", "Azelma", "female", "Canadian"),
    Voice("anna", "Anna", "female", "British"),
    Voice("vera", "Vera", "female", "British"),
    Voice("fantine", "Fantine", "female", "British"),
    Voice("eponine", "Éponine", "female", "Scottish"),
    Voice("caro_davy", "Caro", "female", None),
    Voice("alba", "Alba", "male", None, "the original voice"),
    Voice("george", "George", "male", "American"),
    Voice("michael", "Michael", "male", "American"),
    Voice("charles", "Charles", "male", "British"),
    Voice("paul", "Paul", "male", "British"),
    Voice("jean", "Jean", "male", None),
    Voice("marius", "Marius", "male", None, "breathier and less clear than the others"),
    Voice("javert", "Javert", "male", None),
    Voice("bill_boerst", "Bill", "male", None),
    Voice("peter_yearsley", "Peter", "male", None),
    Voice("stuart_bell", "Stuart", "male", None),
)

CATALOG: dict[str, tuple[Voice, ...]] = {"kokoro": KOKORO_VOICES, "pocket": POCKET_VOICES}
DEFAULT: dict[str, str] = {"kokoro": model_manager.TTS_VOICE, "pocket": model_manager.POCKET_VOICE}
# Where each engine's choice is stored. Two columns rather than one so that
# switching engines and back does not lose the voice picked for either.
COLUMN: dict[str, str] = {"kokoro": "tts_kokoro_voice", "pocket": "tts_pocket_voice"}


def find(engine: str, key: str | None) -> Voice | None:
    return next((v for v in CATALOG.get(engine, ()) if v.key == key), None)


def normalise(engine: str, key: str | None) -> str:
    """An unknown voice (a downgrade, a hand-edited DB) speaks in the
    engine's default rather than failing."""
    return key if find(engine, key) is not None else DEFAULT[engine]


def is_downloaded(engine: str, key: str) -> bool:
    if engine == "kokoro":
        return model_catalog.tts_is_downloaded()
    return model_manager.pocket_voice_path(key).exists()
