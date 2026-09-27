"""Onboarding's model recommendation (services/hardware_capability.py).

What matters is that it recommends a model the app actually has, that the
model it recommends fits next to everything else that runs during a spoken
conversation, and that it prefers a reply the learner does not wait for over
a bigger model that would make them.
"""

import pytest

from app.services import hardware_capability as hc
from app.services.voice import model_catalog

GIB = 1024**3


def _fits(rec):
    return {m.key: m.fit for m in rec.models}


def test_every_shipped_model_is_ranked():
    """A model added to the catalog must be placed in the quality order, or
    it could never be recommended."""
    assert set(hc.QUALITY_ORDER) == {o.key for o in model_catalog.LLM_OPTIONS}


@pytest.mark.parametrize(
    ("cores", "ram_gb", "gpu"),
    [(2, 4, None), (4, 6, None), (4, 6, "amd"), (8, 16, None), (8, 16, "nvidia"), (16, 64, "nvidia")],
)
def test_the_recommendation_is_always_a_real_catalog_key(cores, ram_gb, gpu):
    rec = hc.recommend(cores, ram_gb * GIB, gpu)
    assert rec.recommended in {o.key for o in model_catalog.LLM_OPTIONS}
    assert sum(m.recommended for m in rec.models) == 1


def test_the_reference_machine_gets_the_1_5b_model():
    """4 cores and a nominal 6 GB (the OS reports ~5.7): Qwen2.5 1.5B fits
    comfortably with the voice models; 3B only just; Gemma 4 not at all."""
    rec = hc.recommend(4, int(5.7 * GIB))
    assert rec.recommended == "qwen2.5-1.5b"
    fits = _fits(rec)
    assert fits["qwen2.5-1.5b"] == "good"
    assert fits["qwen2.5-3b"] == "tight"
    assert fits["gemma-4-e2b"] == "too_big"
    assert fits["gemma-4-e4b"] == "too_big"


def test_memory_left_for_the_model_accounts_for_the_rest_of_the_app():
    rec = hc.recommend(8, 16 * GIB)
    assert rec.available_gb == pytest.approx(16 - hc.BASELINE_GB - hc.VOICE_GB, abs=0.05)


def test_the_estimate_agrees_with_the_catalogs_own_memory_notes():
    """The catalog says Gemma 4 E2B needs ~3 GB free and E4B ~5 GB."""
    by_key = {o.key: o for o in model_catalog.LLM_OPTIONS}
    assert 3.0 <= hc.needs_gb(by_key["gemma-4-e2b"].approx_size_mb) <= 4.0
    assert 5.0 <= hc.needs_gb(by_key["gemma-4-e4b"].approx_size_mb) <= 6.0


def test_a_bigger_model_that_would_reply_slowly_is_not_recommended():
    """16 GB fits Gemma 4 E4B, but on 8 cores without a GPU it is slow — a
    conversation partner that makes the learner wait is the worse choice."""
    rec = hc.recommend(8, 16 * GIB, None)
    assert _fits(rec)["gemma-4-e4b"] == "good"
    assert next(m for m in rec.models if m.key == "gemma-4-e4b").speed == "slow"
    assert rec.recommended == "gemma-4-e2b"
    assert "slowly" in rec.reason


def test_a_usable_gpu_allows_a_bigger_model():
    without = hc.recommend(8, 16 * GIB, None)
    with_gpu = hc.recommend(8, 16 * GIB, "nvidia")
    assert with_gpu.gpu_used and with_gpu.gpu == "NVIDIA"
    assert hc.QUALITY_ORDER.index(with_gpu.recommended) > hc.QUALITY_ORDER.index(without.recommended)


def test_a_gpu_with_no_build_for_this_platform_does_not_count():
    rec = hc.recommend(8, 16 * GIB, "nvidia", gpu_build_available=False)
    assert not rec.gpu_used
    assert rec.recommended == hc.recommend(8, 16 * GIB, None).recommended


def test_a_software_renderer_is_not_a_gpu():
    assert hc.gpu_name("microsoft") is None
    assert hc.gpu_name(None) is None
    assert hc.gpu_name("AMD") == "AMD"


def test_a_machine_too_small_for_any_model_is_pointed_at_the_cloud():
    rec = hc.recommend(2, 3 * GIB)
    assert rec.cloud_suggested
    assert rec.recommended == "qwen2.5-0.5b"  # the least bad local choice
    assert "cloud" in rec.reason.lower()


def test_more_cores_never_make_a_model_slower():
    order = {"quick": 0, "steady": 1, "slow": 2}
    for option in model_catalog.LLM_OPTIONS:
        speeds = [
            order[next(m for m in hc.recommend(c, 32 * GIB).models if m.key == option.key).speed] for c in (2, 4, 8)
        ]
        assert speeds == sorted(speeds, reverse=True)
