"""ARPABET to IPA, so a word can show its pronunciation without the network.

CMUdict gives 135k American English pronunciations in ARPABET — an ASCII
phoneme notation with a stress digit on every vowel. Learners read IPA, so
this converts between them.

The mapping itself is mechanical and uncontroversial. The part worth reading
is `_syllabify`: IPA places a stress mark at the start of the stressed
SYLLABLE, while ARPABET marks the stressed VOWEL. Putting the mark straight
before the vowel is the obvious shortcut and it is wrong in the common case —
"session" would come out /sɛˈʃən/ rather than /ˈsɛʃən/. Getting it right
needs the syllable boundary, which needs the maximal onset principle.
"""

import re

# Consonants. One IPA symbol each, no context dependence.
_CONSONANTS: dict[str, str] = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

# Vowels. AH and ER differ by stress — an unstressed AH is a schwa, which is
# the single most common vowel in English and looks wrong as /ʌ/.
_VOWELS: dict[str, str] = {
    "AA": "ɑ", "AE": "æ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ",
    "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ",
    "UW": "u",
}
_STRESS_DEPENDENT: dict[str, tuple[str, str]] = {
    # phoneme: (stressed, unstressed)
    "AH": ("ʌ", "ə"),
    "ER": ("ɝ", "ɚ"),
}

_STRESS_RE = re.compile(r"([A-Z]+)([0-2])?$")

# Consonant clusters that can legally begin an English syllable. Used to
# decide where one syllable ends and the next begins: English prefers to give
# a consonant to the FOLLOWING syllable wherever that produces a sayable
# onset ("a-stound", not "as-tound"), which is the maximal onset principle.
_TWO_CONSONANT_ONSETS = {
    "pl", "pr", "bl", "br", "tr", "dr", "tw", "dw", "kl", "kr", "kw", "ɡl", "ɡr", "ɡw",
    "fl", "fr", "θr", "θw", "ʃr", "sl", "sw", "sp", "st", "sk", "sm", "sn", "sf",
    "pj", "bj", "tj", "dj", "kj", "ɡj", "mj", "fj", "vj", "hj", "nj", "lj",
}
_THREE_CONSONANT_ONSETS = {"spl", "spr", "str", "skr", "skw", "spj", "stj", "skj"}


def _split_phone(phone: str) -> tuple[str, int | None]:
    """('EH1') -> ('EH', 1). Stress is absent on consonants."""
    match = _STRESS_RE.match(phone.strip().upper())
    if not match:
        return phone.strip().upper(), None
    base, stress = match.groups()
    return base, int(stress) if stress is not None else None


def _is_legal_onset(cluster: list[str]) -> bool:
    if len(cluster) <= 1:
        # Every English consonant can start a syllable except ŋ, which never
        # does in any native word.
        return not cluster or cluster[0] != "ŋ"
    joined = "".join(cluster)
    if len(cluster) == 2:
        return joined in _TWO_CONSONANT_ONSETS
    if len(cluster) == 3:
        return joined in _THREE_CONSONANT_ONSETS
    return False


def _syllabify(units: list[tuple[str, bool, int | None]]) -> list[int]:
    """Indices in `units` where a syllable starts.

    `units` is (ipa symbol, is_vowel, stress). Each syllable has exactly one
    vowel; the consonants between two vowels are split so that the second
    syllable takes the longest legal onset it can, which is what English
    actually does."""
    vowel_positions = [i for i, (_, is_vowel, _) in enumerate(units) if is_vowel]
    if not vowel_positions:
        return [0] if units else []

    starts = [0]
    for previous, current in zip(vowel_positions, vowel_positions[1:]):
        between = [units[i][0] for i in range(previous + 1, current)]
        if not between:
            # Two vowels in a row: the second simply starts its own syllable.
            starts.append(current)
            continue
        # Longest suffix of the cluster that can legally start a syllable.
        for take in range(min(3, len(between)), -1, -1):
            if _is_legal_onset(between[len(between) - take:]) if take else True:
                starts.append(current - take)
                break
    return starts


def to_ipa(phones: list[str] | str) -> str:
    """A CMUdict pronunciation as IPA, without the enclosing slashes.

    Returns "" for input this cannot read, never a partial transcription:
    half a pronunciation is worse than none, because it looks authoritative."""
    if isinstance(phones, str):
        phones = phones.split()
    if not phones:
        return ""

    units: list[tuple[str, bool, int | None]] = []
    for phone in phones:
        base, stress = _split_phone(phone)
        if base in _STRESS_DEPENDENT:
            stressed, unstressed = _STRESS_DEPENDENT[base]
            units.append((stressed if stress else unstressed, True, stress))
        elif base in _VOWELS:
            units.append((_VOWELS[base], True, stress))
        elif base in _CONSONANTS:
            units.append((_CONSONANTS[base], False, None))
        else:
            return ""

    starts = set(_syllabify(units))
    # The stress of a syllable is the stress of its vowel.
    stress_at_start: dict[int, int] = {}
    ordered = sorted(starts)
    for position, start in enumerate(ordered):
        end = ordered[position + 1] if position + 1 < len(ordered) else len(units)
        for i in range(start, end):
            if units[i][1] and units[i][2]:
                stress_at_start[start] = units[i][2]
                break

    out: list[str] = []
    single_syllable = len(ordered) <= 1
    for i, (symbol, _, _) in enumerate(units):
        if i in stress_at_start and not single_syllable:
            # A one-syllable word needs no stress mark: there is nothing to
            # contrast it with, and /ˈkæt/ only adds noise.
            out.append("ˈ" if stress_at_start[i] == 1 else "ˌ")
        out.append(symbol)
    return "".join(out)
