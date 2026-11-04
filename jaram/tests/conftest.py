import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path):
    from app import create_app

    app = create_app(tmp_path / "data")
    app.config["TESTING"] = True
    return app.test_client()
