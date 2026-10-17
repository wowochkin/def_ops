import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def pytest_configure(config):
    # новая starlette советует httpx2 вместо httpx для TestClient — к сервису отношения не имеет
    config.addinivalue_line("filterwarnings", "ignore:Using `httpx` with `starlette.testclient` is deprecated")
