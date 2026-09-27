"""Where local models run: the setting, and how each engine honours it."""

import pytest

from app.services.voice import compute, llama_runtime, llm_chat_engine


@pytest.fixture(autouse=True)
def _restore_mode():
    before = compute.current()
    yield
    compute._mode = before


@pytest.mark.parametrize(
    ("system", "machine", "asset"),
    [
        ("Windows", "AMD64", f"llama-{llama_runtime.TAG}-bin-win-vulkan-x64.zip"),
        ("Linux", "x86_64", f"llama-{llama_runtime.TAG}-bin-ubuntu-vulkan-x64.tar.gz"),
        ("Linux", "aarch64", f"llama-{llama_runtime.TAG}-bin-ubuntu-vulkan-arm64.tar.gz"),
        ("Darwin", "arm64", f"llama-{llama_runtime.TAG}-bin-macos-arm64.tar.gz"),
        # No GPU build published: these run on the CPU.
        ("Darwin", "x86_64", None),
        ("Windows", "ARM64", None),
    ],
)
def test_each_platform_gets_its_own_gpu_build(system, machine, asset):
    assert llama_runtime.gpu_asset(system, machine) == asset


def test_the_gpu_list_is_read_from_the_runtime():
    out = (
        "0.00.000.352 I srv  llama_server: initializing ...\n"
        "Available devices:\n"
        "  Vulkan0: AMD Radeon Vega 8 Graphics (RADV RAVEN) (4971 MiB, 4280 MiB free)\n"
        "  Vulkan1: llvmpipe (LLVM 19.1.1, 256 bits) (7777 MiB, 7777 MiB free)\n"
    )
    assert llama_runtime.parse_devices(out) == ["AMD Radeon Vega 8 Graphics (RADV RAVEN)", "llvmpipe (LLVM 19.1.1, 256 bits)"]
    assert llama_runtime.parse_devices("Available devices:\n") == []


def test_the_voice_asks_for_a_gpu_provider_only_when_allowed():
    available = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    compute._mode = "auto"
    assert compute.ort_providers(available) == ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    compute._mode = "cpu"
    assert compute.ort_providers(available) == ["CPUExecutionProvider"]
    compute._mode = "gpu"
    assert compute.ort_providers(["CPUExecutionProvider"]) == ["CPUExecutionProvider"]


def test_speech_to_text_uses_the_gpu_only_on_cuda():
    compute._mode = "gpu"
    assert compute.whisper_device(cuda_devices=1) == ("cuda", "float16")
    assert compute.whisper_device(cuda_devices=0) == ("cpu", "int8")
    compute._mode = "cpu"
    assert compute.whisper_device(cuda_devices=1) == ("cpu", "int8")


def test_the_setting_is_saved_and_checked(tmp_path):
    from app.config import settings
    from app.db import get_connection
    from app.migrations.runner import run_migrations

    settings.db_path = str(tmp_path / "c.db")
    conn = get_connection()
    run_migrations(conn)
    assert compute.load(conn) == "auto"
    compute.save(conn, "cpu")
    compute._mode = "auto"
    assert compute.load(conn) == "cpu"
    with pytest.raises(ValueError):
        compute.save(conn, "quantum")


class _FakeLlama:
    def __init__(self, **kw):
        self.kw = kw

    def create_chat_completion(self, **kw):
        return {"choices": [{"message": {"content": "from the cpu"}}]}


def _fake_model(monkeypatch, tmp_path):
    path = tmp_path / "m.gguf"
    path.write_bytes(b"gguf")
    monkeypatch.setattr(llm_chat_engine.model_manager, "llm_model_path", lambda repo, name: path)
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", _FakeLlama)
    llm_chat_engine.unload()


def test_a_gpu_that_fails_falls_back_to_the_cpu_and_says_why(monkeypatch, tmp_path):
    _fake_model(monkeypatch, tmp_path)
    compute._mode = "gpu"
    monkeypatch.setattr(llama_runtime, "gpu_asset", lambda *a: "some-build.zip")
    monkeypatch.setattr(llama_runtime, "is_installed", lambda: True)

    def refuse(path, **kw):
        raise llm_chat_engine.EngineUnavailable("No GPU that Vulkan can use was found on this computer.")

    monkeypatch.setattr(llama_runtime, "start", refuse)
    reply = llm_chat_engine.generate_reply("sys", [("user", "hi")], repo_id="r", filename="m.gguf")
    info = llm_chat_engine.runtime_info()
    assert reply == "from the cpu"
    assert info["device"] == "cpu" and "No GPU" in info["note"]
    llm_chat_engine.unload()


def test_cpu_mode_never_touches_the_gpu_runtime(monkeypatch, tmp_path):
    _fake_model(monkeypatch, tmp_path)
    compute._mode = "cpu"

    def must_not_start(*a, **kw):
        raise AssertionError("the GPU runtime was started in CPU mode")

    monkeypatch.setattr(llama_runtime, "start", must_not_start)
    assert llm_chat_engine.generate_reply("sys", [("user", "hi")], repo_id="r", filename="m.gguf") == "from the cpu"
    assert llm_chat_engine.runtime_info() == {"device": "cpu", "backend": "CPU", "detail": None, "note": None}
    llm_chat_engine.unload()


def test_the_compute_route_reports_and_changes_the_setting(client, auth_headers):
    from tests.test_conversation import _create_user

    user_id = _create_user(client, auth_headers)
    got = client.get("/engine/compute", headers=auth_headers, params={"user_id": user_id})
    assert got.status_code == 200
    body = got.json()
    assert body["mode"] in compute.MODES
    assert {"chat_model", "speech_to_text", "voice", "gpu_runtime"} <= set(body)

    changed = client.put("/engine/compute", headers=auth_headers, params={"user_id": user_id}, json={"mode": "cpu"})
    assert changed.status_code == 200 and changed.json()["mode"] == "cpu"
    bad = client.put("/engine/compute", headers=auth_headers, params={"user_id": user_id}, json={"mode": "fast"})
    assert bad.status_code == 400


def test_the_gpu_server_starts_with_thinking_off(monkeypatch, tmp_path):
    """Gemma 4 thinks before answering, and the server files thoughts apart
    from the answer — a whole reply budget of thinking came back as an empty
    conversation turn."""
    seen = {}

    class _Exited:
        def __init__(self, args, **kw):
            seen["args"] = args

        def poll(self):
            return 1

        def terminate(self):
            pass

    monkeypatch.setattr(llama_runtime, "server_exe", lambda: tmp_path / "llama-server")
    monkeypatch.setattr(llama_runtime, "gpu_devices", lambda: ["Test GPU"])
    monkeypatch.setattr(llama_runtime.model_manager, "models_dir", lambda: tmp_path)
    (tmp_path / "runtimes").mkdir()
    monkeypatch.setattr(llama_runtime.subprocess, "Popen", _Exited)
    with pytest.raises(llm_chat_engine.EngineUnavailable):
        llama_runtime.start(str(tmp_path / "m.gguf"))
    args = seen["args"]
    assert args[args.index("--reasoning") + 1] == "off"


def _answer(monkeypatch, message):
    import io
    import json

    class _Res(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    body = json.dumps({"choices": [{"message": message}]}).encode()
    monkeypatch.setattr(llama_runtime.urllib.request, "urlopen", lambda *a, **kw: _Res(body))


def test_an_empty_answer_is_an_error_not_a_reply(monkeypatch):
    server = llama_runtime.Server(None, 1, "k", "m", "gpu", None)  # type: ignore[arg-type]
    _answer(monkeypatch, {"content": "", "reasoning_content": "Let me think about the barista…"})
    with pytest.raises(llm_chat_engine.EngineUnavailable, match="thinking"):
        llama_runtime.chat(server, [], max_tokens=10, temperature=0.5)
    _answer(monkeypatch, {"content": "   "})
    with pytest.raises(llm_chat_engine.EngineUnavailable, match="empty"):
        llama_runtime.chat(server, [], max_tokens=10, temperature=0.5)
    _answer(monkeypatch, {"content": " Hello! "})
    assert llama_runtime.chat(server, [], max_tokens=10, temperature=0.5) == "Hello!"


def test_a_conversation_never_stores_an_empty_ai_turn(monkeypatch):
    from app.services import conversation

    monkeypatch.setattr(conversation.llm_chat_engine, "generate_reply", lambda *a, **kw: "")
    target = {"provider": "local", "option": type("O", (), {"repo_id": "r", "filename": "f"})()}
    with pytest.raises(llm_chat_engine.EngineUnavailable, match="empty"):
        conversation._generate_reply(target, "sys", [("user", "hi")])


def test_every_gpu_server_is_started_from_the_same_long_lived_thread(monkeypatch, tmp_path):
    """On Linux the server is tied to the thread that started it. Started from
    a request's worker thread, it was killed seconds after that thread retired
    — so all of them start from one thread that lives as long as the backend."""
    import threading

    starters = []

    class _Exited:
        def __init__(self, args, **kw):
            starters.append(threading.current_thread())

        def poll(self):
            return 1

        def terminate(self):
            pass

    monkeypatch.setattr(llama_runtime, "server_exe", lambda: tmp_path / "llama-server")
    monkeypatch.setattr(llama_runtime, "gpu_devices", lambda: ["Test GPU"])
    monkeypatch.setattr(llama_runtime.model_manager, "models_dir", lambda: tmp_path)
    (tmp_path / "runtimes").mkdir()
    monkeypatch.setattr(llama_runtime.subprocess, "Popen", _Exited)

    def attempt():
        with pytest.raises(llm_chat_engine.EngineUnavailable):
            llama_runtime.start(str(tmp_path / "m.gguf"))

    worker = threading.Thread(target=attempt)
    worker.start()
    worker.join()
    attempt()
    assert len(starters) == 2
    assert starters[0] is starters[1]
    assert starters[0] is not threading.current_thread()
