from app.services.hardware_capability import GIB, assess_hardware


def test_generous_hardware_recommends_balanced_not_heavy():
    result = assess_hardware(cpu_cores=16, total_ram_bytes=32 * GIB)
    assert result.recommended_tier == "balanced"
    assert result.any_local_capable is True
    heavy = next(t for t in result.tiers if t.tier == "heavy")
    assert heavy.capable is True  # thresholds met...
    # ...but never auto-recommended, per the module's documented policy.


def test_below_light_floor_recommends_api_key():
    result = assess_hardware(cpu_cores=2, total_ram_bytes=4 * GIB)
    assert result.recommended_tier is None
    assert result.any_local_capable is False
    assert all(not t.capable for t in result.tiers)


def test_exact_threshold_boundary_is_capable():
    result = assess_hardware(cpu_cores=2, total_ram_bytes=6 * GIB)
    light = next(t for t in result.tiers if t.tier == "light")
    assert light.capable is True
    assert result.recommended_tier == "light"


def test_meaningfully_below_threshold_is_not_capable():
    # A single byte below a threshold still rounds to the nominal GB (see the
    # rounding-tolerance tests below) — this checks a gap too large to round away.
    result = assess_hardware(cpu_cores=2, total_ram_bytes=round(5 * GIB))
    light = next(t for t in result.tiers if t.tier == "light")
    assert light.capable is False
    assert result.any_local_capable is False


def test_dev_machine_numbers_recommend_light_only():
    # This project's actual dev machine: 4 cores, os.totalmem() reports
    # 6130286592 bytes (~5.71GB) even though the UI rounds it to "6 GB RAM" —
    # this must still count as meeting Light's 6GB floor (see the rounding
    # comment in hardware_capability.assess_hardware).
    result = assess_hardware(cpu_cores=4, total_ram_bytes=6_130_286_592)
    light = next(t for t in result.tiers if t.tier == "light")
    balanced = next(t for t in result.tiers if t.tier == "balanced")
    heavy = next(t for t in result.tiers if t.tier == "heavy")
    assert light.capable is True
    assert balanced.capable is False  # needs 8GB
    assert heavy.capable is False
    assert result.recommended_tier == "light"
    assert result.any_local_capable is True


def test_ram_just_under_nominal_gb_still_rounds_up():
    # 5.6GB is close enough to 6GB nominal that a real machine reporting it
    # should still pass — mirrors the dev-machine case with a tighter margin.
    result = assess_hardware(cpu_cores=2, total_ram_bytes=round(5.6 * GIB))
    light = next(t for t in result.tiers if t.tier == "light")
    assert light.capable is True


def test_ram_meaningfully_under_nominal_gb_does_not_round_up():
    # 5.4GB should round to 5GB, not 6 — the rounding tolerance is for
    # firmware/reserved-memory slack, not a free extra gigabyte.
    result = assess_hardware(cpu_cores=2, total_ram_bytes=round(5.4 * GIB))
    light = next(t for t in result.tiers if t.tier == "light")
    assert light.capable is False


def test_cores_gate_independently_of_ram():
    # Plenty of RAM but too few cores for Balanced.
    result = assess_hardware(cpu_cores=3, total_ram_bytes=16 * GIB)
    balanced = next(t for t in result.tiers if t.tier == "balanced")
    assert balanced.capable is False
    assert result.recommended_tier == "light"
