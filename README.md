# Yellow_Raccoon

2026 과학과제연구 — **컴퓨터 비전 기반 식물 생육 분석 및 맞춤형 관리 추천 시스템** (팀: 바티칸 시국)

## 🌱 자람 (모바일 웹앱)

식물 사진을 주기적으로 찍어 이전 사진과 비교해 생장량을 계산하고, 바질·상추 실험 데이터를 바탕으로 한 규칙 기반 알고리즘으로 관리 행동을 추천하는 앱입니다.

→ 실행 방법과 설명은 [`jaram/README.md`](jaram/README.md)를 보세요.

```bash
cd jaram
python -m pip install -r requirements.txt
python app.py
```

## 이전 프로토타입

- `app.py`, `index.html` — Flask 단일 페이지 분석기 (첫 프로토타입)
- `측정 알고리즘` — Streamlit 버전
