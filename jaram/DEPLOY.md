# 자람 배포하기 (PythonAnywhere 무료)

이 안내대로 하면 `https://아이디.pythonanywhere.com` 주소로 **와이파이와 상관없이 어디서나** 자람을 쓸 수 있어요.
HTTPS 주소라서 휴대폰에서 **지난 사진을 겹쳐 보며 찍는 실시간 카메라**도 바로 동작합니다. 처음 한 번 30분 정도 걸려요.

> 아래에서 `아이디`는 PythonAnywhere 가입 때 정한 사용자 이름으로 바꿔 쓰세요. (예: `vatican2026`)

## 0. 알아 둘 점

- **무료 요금제 조건** (2026년 기준, 바뀔 수 있어요): 디스크 512MB, 웹앱 1개, 그리고 **한 달마다** 웹앱 연장 버튼을 눌러야 계속 켜져 있어요. 설치한 패키지가 약 260MB, 실험 사진 140장(분석 이미지 포함)이 약 80~100MB로 예상돼서 512MB 안에 들어가요.
- **팀 비밀번호**: 인터넷에 공개되는 주소라서 비밀번호 없이 올리면 누구나 기록을 보고 지울 수 있어요. 아래 3단계에서 꼭 설정하세요.
- 실험 데이터(사진·DB)는 코드와 다른 폴더(`~/jaram-data`)에 저장돼서, 코드를 업데이트해도 지워지지 않아요.

## 1. 가입하기

1. https://www.pythonanywhere.com 에서 **Pricing & signup → Create a Beginner account** 로 가입합니다.
2. 사용자 이름이 곧 주소(`아이디.pythonanywhere.com`)가 되니 팀에서 정해서 만드세요.

## 2. 코드 받고 설치하기

대시보드에서 **Consoles → Bash** 를 눌러 콘솔을 열고, 한 줄씩 입력합니다.

```bash
git clone https://github.com/jiwoo2009h/Yellow_Raccoon.git
cd Yellow_Raccoon/jaram
python3.11 -m venv ~/jaram-venv
source ~/jaram-venv/bin/activate
pip install --no-cache-dir -r requirements-server.txt
mkdir -p ~/jaram-data
```

- `python3.11` 이 없다고 나오면 `ls /usr/bin/python3.*` 로 있는 버전을 확인해 그 숫자(예: `python3.12`)를 쓰고, 4단계에서도 **같은 버전**을 고르세요.
- `--no-cache-dir` 는 설치 파일 임시 저장을 막아서 디스크(512MB)를 아껴요.
- 설치가 끝나면 확인: `python -c "import cv2, flask; print('ok')"` → `ok`

## 3. 웹앱 만들기

1. 위쪽 메뉴 **Web → Add a new web app → Next**
2. **Manual configuration** 선택 (Flask 를 고르지 마세요) → 2단계와 같은 **Python 버전** → Next
3. 만들어진 설정 화면에서:

**Virtualenv** 칸에 입력

```
/home/아이디/jaram-venv
```

**Code → WSGI configuration file** 링크(`/var/www/아이디_pythonanywhere_com_wsgi.py`)를 눌러 안의 내용을 **모두 지우고** 아래를 붙여 넣은 뒤 **Save**:

```python
import os
import sys

os.environ["JARAM_PASSWORD"] = "여기에-팀-비밀번호"   # 팀원끼리만 공유하세요
os.environ["JARAM_DATA"] = "/home/아이디/jaram-data"
os.environ["JARAM_SECURE_COOKIE"] = "1"

path = "/home/아이디/Yellow_Raccoon/jaram"
if path not in sys.path:
    sys.path.insert(0, path)

from app import create_app  # noqa: E402

application = create_app()
```

**Static files** 에 한 줄 추가 (화면 파일을 더 빠르게 보내 줘요)

| URL | Directory |
|---|---|
| `/static/` | `/home/아이디/Yellow_Raccoon/jaram/static` |

**Security → Force HTTPS** 를 **Enabled** 로 바꿉니다.

4. 맨 위의 초록색 **Reload 아이디.pythonanywhere.com** 버튼을 누릅니다.

## 4. 접속하기

휴대폰에서 `https://아이디.pythonanywhere.com` 에 들어가 팀 비밀번호를 입력하세요.
Safari/Chrome 메뉴의 **홈 화면에 추가** 를 누르면 앱처럼 쓸 수 있어요. 한 번 로그인하면 그 휴대폰에서는 로그인이 유지돼요.

## 5. 꾸준히 할 일

| 언제 | 할 일 |
|---|---|
| **한 달마다** | Web 탭에서 **Run until 1 month from today** 버튼 누르기 (안 누르면 웹앱이 꺼져요. 데이터는 남아요) |
| 일주일마다 | 앱의 **설정 → 전체 백업 받기** 로 사진·DB zip 파일을 받아 두기 |
| 코드가 바뀌었을 때 | 아래 '업데이트하기' |

## 업데이트하기

GitHub에 새 코드가 올라오면 Bash 콘솔에서:

```bash
cd ~/Yellow_Raccoon && git pull
```

그다음 Web 탭에서 **Reload** 를 누르면 끝이에요. (`requirements-server.txt` 가 바뀌었다면 `source ~/jaram-venv/bin/activate` 후 `pip install --no-cache-dir -r jaram/requirements-server.txt` 도 해 주세요.)

- 새 기능 때문에 DB 구조가 바뀌어도(예: 분석 영역, 3D 측정) 서버가 시작할 때 **필요한 칸과 표를 자동으로 추가**해요. 이미 모은 기록은 그대로 남아요. 그래도 업데이트 전에 **전체 백업 받기**를 한 번 해 두세요.
- 3D 측정은 한 번에 사진 4~5장과 분석 이미지를 저장해서 약 2~4MB를 써요. 무료 계정 저장 공간(512MB)이면 식물 4개를 매주 3D 측정해도 한 학기는 충분하지만, Files 탭에서 가끔 사용량을 확인하세요.

## 이미 모은 데이터 옮기기 / 백업 복원하기

1. 컴퓨터에서 쓰던 자람의 **설정 → 전체 백업 받기** 로 zip 파일을 받습니다.
2. PythonAnywhere **Files** 탭에서 `/home/아이디/` 에 그 zip 파일을 올립니다.
3. Bash 콘솔에서 (파일 이름은 실제 이름으로):

```bash
cd ~/jaram-data && unzip -o ~/jaram_backup_20261104.zip
```

4. Web 탭에서 **Reload**.

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| "Something went wrong" 화면 | Web 탭 → **Log files → Error log** 맨 아래 줄 |
| 로그인해도 다시 로그인 화면 | 주소가 `https://` 인지, Force HTTPS 를 켰는지 |
| `No module named cv2` | Virtualenv 경로와 Python 버전이 2단계와 같은지 |
| 디스크가 꽉 참 | Bash 에서 `du -sh ~/* ~/.cache` 로 확인, `rm -rf ~/.cache/pip` |
| 비밀번호를 바꾸고 싶음 | WSGI 파일의 `JARAM_PASSWORD` 를 고치고 Reload (모든 휴대폰이 다시 로그인해야 하게 하려면 `~/jaram-data/secret_key` 파일도 지우고 Reload) |

## 다른 호스팅에 올릴 때

PythonAnywhere 가 아니어도 `wsgi.py` 로 어디서든 실행할 수 있어요.

```bash
pip install -r requirements-server.txt gunicorn
JARAM_PASSWORD=팀비밀번호 JARAM_DATA=/영구저장소/경로 JARAM_SECURE_COOKIE=1 \
  gunicorn -w 1 -b 0.0.0.0:$PORT wsgi:application
```

`JARAM_DATA` 는 **재시작해도 지워지지 않는 저장소**(Render·Railway·Fly.io 의 볼륨/디스크)를 가리켜야 해요. 무료 요금제의 일반 파일 시스템은 재시작할 때 사진과 DB가 사라질 수 있어요.
