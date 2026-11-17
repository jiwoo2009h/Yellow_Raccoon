"""배포용 진입점 (PythonAnywhere, gunicorn 등).

    gunicorn -w 2 -b 0.0.0.0:$PORT wsgi:application

설정은 환경 변수로 합니다 (app.py 맨 위 설명 참고).
인터넷에 배포할 때는 JARAM_PASSWORD 를 꼭 설정하세요.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app  # noqa: E402

application = create_app()

if not application.config["PASSWORD"]:
    print("⚠ JARAM_PASSWORD 가 설정되지 않아 누구나 접속할 수 있어요.", file=sys.stderr)
