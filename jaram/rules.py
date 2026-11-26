"""행동 추천 규칙 파일(rules.md)을 읽고 적용합니다.

규칙은 코드가 아니라 글(마크다운)로 적습니다. 코드는 '사실'(흙이 말랐는지, 생장이 느려졌는지…)과
'근거 문장'만 계산하고, 어떤 조건에서 어떤 추천을 낼지는 규칙 파일이 정합니다.

규칙 하나의 모양
    ## 물 부족 (water_needed)          ← '## 이름 (코드)'. 코드는 영어·숫자·_ (기록·통계에 쓰여요)
    - 묶음: 흙마름                      ← 같은 묶음에서는 위에서부터 처음 맞는 규칙 하나만 나와요 (선택)
    - 조건: 흙마름 그리고 (생장감소 또는 시듦)
    - 단계: 관리                        ← 관리 / 관찰 / 정상 / 참고
    - 제목: 수분 부족 가능성이 있어요
    - 내용: [시듦 ? 잎이 시들었어요. | 흙이 말랐어요.] 흙 전체가 젖도록 물을 주세요.
    - 근거: 흙마름근거, 시듦근거, [생장감소 ? 생장근거]
    - 행동: 물주기                      ← 물주기 / 조명 조정 / 위치 옮기기 / 비료 (선택)
    - 생장 감소 설명: 예                ← 이 추천이 나오면 '생장 감소의 원인을 찾았다'로 봐요 (선택)
    - 근거 더하기: light_low, stretching (관리)  ← 새 추천 대신 이미 나온 추천에 근거만 더해요 (선택)
    - 코드 추천: 특이사항               ← 코드가 만든 추천(예: 특이 사항 증상 → 병해충)을 이 자리에 넣어요 (선택)
    - 사용: 아니오                      ← 규칙 끄기 (선택)

조건: 사실 이름을 '그리고 / 또는 / 아님 / ( )'로 묶어요.
  특별한 이름: 원인설명됨, 문제추천, 추천없음, 추천:코드,코드 , 관리추천:코드,코드 , 항상
글 안에서: {값 이름} 은 숫자·글로 바뀌고, [조건 ? 글 | 조건 ? 글 | 그 밖의 글] 은 맞는 글 하나만 남아요.
"""

import difflib
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent / "rules.md"
MAX_TEXT = 60_000

LEVELS = {"관리": "care", "관찰": "observe", "정상": "good", "참고": "info",
          "care": "care", "observe": "observe", "good": "good", "info": "info"}
ACTIONS = {"물주기": "water", "물": "water", "조명 조정": "light", "조명": "light", "위치 옮기기": "move",
           "위치": "move", "비료": "fertilize", "비료 주기": "fertilize", "없음": None,
           "water": "water", "light": "light", "move": "move", "fertilize": "fertilize"}
YES = {"예", "네", "항상", "켜기", "사용", "yes", "true", "on"}
NO = {"아니오", "아니요", "끄기", "안 씀", "no", "false", "off"}

# ---------------------------------------------------------------- 규칙에서 쓸 수 있는 이름 (설명은 화면 참고표에 나와요)
FACTS = {
    # 생장
    "생장감소": "생장이 둔화되거나 정체됨 (최근 3D 측정이 있으면 부피 기준, 없으면 정면 사진 면적 기준)",
    "잘자람": "높이·투영 면적(또는 3D 부피)이 꾸준히 늘고 있음",
    "급감": "직전 사진보다 투영 면적이 급감 경고 기준 이상 줄어듦",
    "생장률없음": "사진 간격이 짧아 생장률을 아직 계산하지 못함",
    "판단엇갈림": "정면 사진과 3D 측정의 생장 판단이 엇갈림",
    "3D판단": "최근 3D 측정으로 생장을 판단함",
    "3D부피증가": "3D 부피가 잘 늘고 있음",
    # 흙·급수
    "흙마름": "토양 수분이 기준 미만이거나 최근 2일 안에 만져 본 흙이 '말랐음' (그 뒤에 물을 줬으면 아님)",
    "흙젖음지속": "토양 수분이 계속 기준 초과이거나 흙 만져 보기가 계속 '젖어 있음'",
    "흙안마름": "흙이 마르지 않았다는 근거가 있음 (1일 안에 물을 줌·촉촉함·젖어 있음·토양 수분 정상)",
    "흙상태앎": "토양 수분 기록이나 최근 2일 안의 흙 만져 보기 기록이 있음",
    "촬영후물줌": "마지막 사진을 찍은 뒤에 물을 줬음",
    "시든뒤물줌": "'시듦'을 기록한 뒤에 물을 줬음",
    "최근물줌": "마지막 급수가 1일 안",
    "물준뒤촉촉": "마지막 급수 뒤에 흙이 '촉촉함'이나 '젖어 있음'으로 기록됨",
    "토양수분정상기록": "토양 수분 기록이 있고 기준 미만이 아님",
    "급수기록있음": "물 준 기록이 하나 이상 있음",
    "물확인간격지남": "마지막 급수 뒤 물주기 확인 간격(일)이 지남",
    "과습의심": "과습 근거가 하나라도 있음 (흙이 계속 젖음·물을 자주 줌·젖은/촉촉한 흙에 급수)",
    "물자주줌": "최근 급수 간격의 중앙값이 '물을 자주 줌' 기준보다 짧음",
    "젖은흙급수": "최근 급수 3번 중 흙이 '젖어 있음'일 때 준 적이 있음",
    "촉촉흙급수2회": "최근 급수 3번 중 흙이 '촉촉함'일 때 2번 이상 줬음",
    "촉촉흙급수1회": "최근 급수 3번 중 흙이 '촉촉함'일 때 1번 줬음 (약한 근거)",
    # 식물 특이사항·사진으로 본 잎 색과 모양
    "시듦": "최근 특이사항: 시듦·처짐",
    "특이_노래짐": "최근 특이사항: 잎이 노래짐",
    "특이_연해짐": "최근 특이사항: 잎 색이 연해짐",
    "사진_노래짐": "사진의 잎 색이 노란 쪽으로 변함 (최근 2장 모두, 마지막 사진이 7일 안)",
    "사진_옅어짐": "사진의 잎 색 진하기가 줄어듦 (최근 2장 모두, 마지막 사진이 7일 안)",
    "잎노래짐": "특이_노래짐 또는 사진_노래짐",
    "잎옅어짐": "(특이_연해짐 또는 사진_옅어짐) 그리고 잎노래짐이 아님",
    "잎색회복": "사진의 잎 색이 다시 진해짐",
    "잎색비교됨": "최근 사진으로 잎 색을 비교했음 (마지막 사진이 7일 안)",
    "아래잎노랑": "노란 부분이 주로 아래쪽(오래된) 잎에 있음",
    "위잎노랑": "노란 부분이 주로 위쪽(새로 난) 잎에 있음",
    "노란잎조금": "노란 쪽 잎이 15% 미만",
    "웃자람": "최근 특이사항: 웃자람(줄기만 길게)",
    "길쭉해짐": "사진으로 본 모양(높이 ÷ √면적)이 위로 길쭉해짐 (마지막 사진이 7일 안)",
    "꽃대": "최근 특이사항: 꽃대가 올라옴",
    "잎끝마름": "최근 특이사항: 잎 끝이 마름",
    "병해충": "최근 특이사항: 벌레·곰팡이·반점",
    "빽빽함": "최근 특이사항: 잎이 빽빽하게 겹침",
    "특이사항증상": "사진 기록의 특이 사항(글)에서 증상·병해충 이름을 찾아 병해충 추천을 만들었음 (최근 7일, symptoms.py 사전)",
    "특이사항설명": "특이 사항으로 찾은 병해충이 생장 감소를 설명함 (생장이 느려졌고 병해충 추천이 나옴)",
    # 환경
    "조도낮음": "조도가 기준보다 낮은 기록이 이어짐",
    "조도기록있음": "최근 조도 기록이 있음",
    "빛바꿈": "마지막 사진 뒤에 '조명 조정' 또는 '위치 변경'을 기록함",
    "고온": "온도가 기준보다 높은 기록이 이어짐",
    "저온": "온도가 기준보다 낮은 기록이 이어짐",
    "습도높음": "습도가 기준보다 높은 기록이 이어짐",
    "습도낮음": "습도가 기준보다 낮은 기록이 이어짐",
    "습도기록있음": "최근 습도 기록이 있음",
    "환경기록있음": "최근 7일 안에 온도·습도·토양 수분·조도 중 하나라도 기록함",
    "온습도문제": "고온·저온·습도높음·습도낮음 중 하나 이상",
    # 비료·기록 기간
    "최근비료": "7일 안에 비료를 줬음",
    "비료후변화": "잎 색 변화(사진 또는 특이사항) 뒤에 비료를 줬음",
    "비료오래안줌": "비료 기록이 없거나 마지막 비료가 '양분 부족을 확인할 기간' 이상 지남",
    "최근14일비료조명": "14일 안에 비료를 줬거나 조명을 조정했음",
    "기록14일이상": "첫 사진부터 14일 이상 지남",
    "빠진기록있음": "물 준 기록·흙 상태·환경 기록 중 빠진 것이 있음",
    # 식물 종류
    "바질": "식물 종류가 바질",
    "상추": "식물 종류가 상추",
    "기타": "식물 종류가 기타",
}
DYNAMIC = {
    "원인설명됨": "위쪽 규칙 중 '생장 감소 설명'이 붙은 추천이 이미 나왔음",
    "문제추천": "관찰·관리 단계 추천이 이미 하나 이상 나왔음",
    "추천없음": "아직 나온 추천이 하나도 없음",
    "항상": "언제나 참",
    "추천:코드,코드": "그 코드의 추천이 이미 나왔음 (예: 추천:water_needed,water_done)",
    "관리추천:코드,코드": "그 코드의 '관리' 단계 추천이 이미 나왔음",
}
VALUES = {
    "물준지일": "마지막 급수 뒤 지난 날 수 (반올림)",
    "최저온도": "종류별 온도 최솟값(℃)",
    "비료기록": "'비료를 준 기록이 없어요' 또는 '마지막 비료가 n일 전이에요'",
    "잎색변화": "'노래지고' 또는 '옅어지고'",
    "환경팁": "고온·저온·습도 문제에 맞는 관리 팁 문장들",
    "빠진기록": "빠진 기록 목록 (예: 물 준 날짜와 양, 흙 상태)",
    "식물종류": "바질 / 상추 / 기타",
}
GENERATED = {
    "특이사항": "특이 사항(글)에 적은 증상을 증상 키워드 사전(symptoms.py)과 대조해 만든 병해충 추천. "
               "단계·제목·내용·근거는 코드가 정해요 (여러 개일 수 있어요)",
}
REASONS = {
    "생장근거": "최근 생장률(면적·높이 또는 3D 부피), 둔화·정체 정도",
    "급감근거": "직전 기록 대비 투영 면적 변화",
    "흙마름근거": "토양 수분 수치, 흙 만져 보기 '말랐음'",
    "시듦근거": "'시듦'을 기록한 때",
    "과습근거": "흙이 계속 젖음·잦은 급수·젖은/촉촉한 흙에 급수",
    "약한과습근거": "촉촉한 흙에 한 번 급수",
    "급수근거": "마지막 급수와 물주기 확인 간격",
    "흙상태근거": "마지막 급수 뒤 기록한 흙 상태",
    "토양수분근거": "최근 토양 수분",
    "고온근거": "최근 온도와 최댓값 기준",
    "저온근거": "최근 온도와 최솟값 기준",
    "조도근거": "최근 조도와 기준",
    "습도근거": "최근 습도와 기준 범위",
    "온습도문제근거": "기준을 벗어난 온도·습도",
    "웃자람근거": "'웃자람'을 기록한 때",
    "모양근거": "모양 지수(높이 ÷ √면적) 변화",
    "노래짐근거": "잎이 노래짐 (특이사항·사진 색상각·노란 잎 비율)",
    "옅어짐근거": "잎 색이 연해짐 (특이사항·사진 진하기)",
    "잎색근거": "노래짐근거 또는 옅어짐근거 중 지금 해당하는 것",
    "잎색회복근거": "사진의 잎 색이 다시 진해진 정도",
    "꽃대근거": "'꽃대'를 기록한 때",
    "잎끝마름근거": "'잎 끝이 마름'을 기록한 때",
    "병해충근거": "'벌레·곰팡이·반점'을 기록한 때",
    "빽빽함근거": "'잎이 빽빽하게 겹침'을 기록한 때",
    "비료근거": "마지막으로 비료를 준 때",
    "3D엇갈림근거": "3D 부피 생장률과 정면 사진 생장률",
    "유지근거": "생장률·환경·최근 7일 급수·잎 색 요약",
    "변동근거": "오르내리는 생장률과 잎 색 요약",
}


class RuleError(ValueError):
    """규칙 파일을 읽다가 찾은 문제들 (errors: [{line, message}])"""

    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(f"{e['line']}번째 줄: {e['message']}" for e in errors[:5]))


@dataclass
class Rule:
    name: str
    code: str
    line: int
    group: str = ""
    cond: object = None
    level: list = field(default_factory=list)  # 글 조각 (아래 _template)
    title: list = field(default_factory=list)
    body: list = field(default_factory=list)
    reasons: list = field(default_factory=list)  # [(조건 또는 None, 근거 이름)]
    action: str = None
    explains: object = None
    merge_into: list = field(default_factory=list)
    merge_level: str = None
    generated: str = None
    enabled: bool = True


# ---------------------------------------------------------------- 조건식
_TOKEN = re.compile(r"\s*(\(|\)|[^\s()]+)")


def _suggest(name, names):
    close = difflib.get_close_matches(name, list(names), n=2, cutoff=0.5)
    return f" (혹시 {', '.join(close)}?)" if close else ""


def parse_condition(text):
    """'흙마름 그리고 (생장감소 또는 시듦)' → 트리. 모르는 이름이나 괄호 문제는 ValueError."""
    tokens = [t for t in _TOKEN.findall(text or "") if t]
    if not tokens:
        raise ValueError("조건이 비어 있어요")
    pos = 0

    def peek():
        return tokens[pos] if pos < len(tokens) else None

    def take():
        nonlocal pos
        pos += 1
        return tokens[pos - 1]

    def expr_or():
        node = expr_and()
        while peek() in ("또는", "or", "OR"):
            take()
            node = ("or", node, expr_and())
        return node

    def expr_and():
        node = expr_not()
        while peek() in ("그리고", "and", "AND"):
            take()
            node = ("and", node, expr_not())
        return node

    def expr_not():
        if peek() in ("아님", "아니고", "not", "NOT"):
            take()
            return ("not", expr_not())
        return atom()

    def atom():
        tok = peek()
        if tok is None:
            raise ValueError("조건이 중간에 끝났어요 (그리고/또는 뒤에 이름이 필요해요)")
        if tok == "(":
            take()
            node = expr_or()
            if peek() != ")":
                raise ValueError("닫는 괄호 ')'가 없어요")
            take()
            return node
        if tok == ")":
            raise ValueError("여는 괄호 '('가 없는 ')'가 있어요")
        if tok in ("그리고", "또는", "and", "or", "AND", "OR"):
            raise ValueError(f"'{tok}' 앞에 이름이 필요해요")
        take()
        for prefix, level in (("관리추천:", "care"), ("추천:", None)):
            if tok.startswith(prefix):
                codes = [c for c in tok[len(prefix):].split(",") if c]
                if not codes:
                    raise ValueError(f"'{tok}' 뒤에 추천 코드를 적어 주세요")
                return ("rec", tuple(codes), level)
        if tok in ("항상", "예"):
            return ("const", True)
        if tok in ("원인설명됨", "문제추천", "추천없음"):
            return ("dyn", tok)
        if tok not in FACTS:
            raise ValueError(f"모르는 이름 '{tok}'{_suggest(tok, list(FACTS) + list(DYNAMIC))}")
        return ("fact", tok)

    node = expr_or()
    if peek() is not None:
        raise ValueError(f"'{peek()}' 부분을 이해하지 못했어요 (이름 사이에 그리고/또는이 필요해요)")
    return node


def _eval(node, state):
    kind = node[0]
    if kind == "and":
        return _eval(node[1], state) and _eval(node[2], state)
    if kind == "or":
        return _eval(node[1], state) or _eval(node[2], state)
    if kind == "not":
        return not _eval(node[1], state)
    if kind == "const":
        return node[1]
    if kind == "fact":
        return bool(state["facts"].get(node[1]))
    if kind == "dyn":
        recs = state["recs"]
        if node[1] == "원인설명됨":
            return state["explained"]
        if node[1] == "문제추천":
            return any(r["level"] in ("observe", "care") for r in recs)
        return not recs  # 추천없음
    if kind == "rec":
        return any(r["code"] in node[1] and (node[2] is None or r["level"] == node[2]) for r in state["recs"])
    raise ValueError(kind)


# ---------------------------------------------------------------- 글 (값 {이름}, 고르기 [조건 ? 글 | 글])
_ALT = re.compile(r"\[([^\[\]]*)\]")
_PH = re.compile(r"\{([^{}]*)\}")


def _template(text):
    """글을 조각으로: 일반 글, ('alt', [(조건, 글)…]). 값 이름과 조건을 미리 검사해요."""
    parts, last = [], 0
    for m in _ALT.finditer(text):
        if m.start() > last:
            parts.append(text[last:m.start()])
        options = []
        for piece in m.group(1).split("|"):
            if "?" in piece:
                cond, _, out = piece.partition("?")
                options.append((parse_condition(cond.strip()), out.strip()))
            else:
                options.append((None, piece.strip()))
        if not options or all(c is None for c, _ in options) and len(options) > 1:
            raise ValueError(f"'[{m.group(1)}]' 에 '조건 ? 글' 이 필요해요")
        parts.append(("alt", options))
        last = m.end()
    if last < len(text):
        parts.append(text[last:])
    for name in _PH.findall(text):
        if name.strip() not in VALUES:
            raise ValueError(f"모르는 값 이름 '{{{name}}}'{_suggest(name.strip(), VALUES)}")
    return parts


def _render(parts, state):
    out = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
            continue
        for cond, text in p[1]:
            if cond is None or _eval(cond, state):
                out.append(text)
                break
    text = "".join(out)
    text = _PH.sub(lambda m: str(state["values"].get(m.group(1).strip(), "")), text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


# ---------------------------------------------------------------- 파일 읽기
_HEAD = re.compile(r"^##\s+(.*?)\s*\(([A-Za-z][A-Za-z0-9_]*)\)\s*$")
_ITEM = re.compile(r"^\s*-\s*([^:：]+?)\s*[:：]\s*(.*)$")
KEYS = {
    "묶음": "group", "조건": "cond", "단계": "level", "제목": "title", "내용": "body", "근거": "reasons",
    "행동": "action", "생장 감소 설명": "explains", "원인 설명": "explains", "근거 더하기": "merge",
    "코드 추천": "generated", "사용": "enabled",
}


def _split_reasons(text):
    """'흙마름근거, [생장감소 ? 생장근거]' → [(None, '흙마름근거'), (조건, '생장근거')]"""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    items = []
    for raw in (x.strip() for x in out):
        if not raw:
            continue
        cond = None
        if raw.startswith("[") and raw.endswith("]"):
            inner = raw[1:-1]
            if "?" not in inner:
                raise ValueError(f"'{raw}' 는 '[조건 ? 근거 이름]' 모양이어야 해요")
            c, _, raw = inner.partition("?")
            cond, raw = parse_condition(c.strip()), raw.strip()
        if raw not in REASONS:
            raise ValueError(f"모르는 근거 이름 '{raw}'{_suggest(raw, REASONS)}")
        items.append((cond, raw))
    return items


def parse_rules(text):
    """규칙 파일 글 → [Rule]. 문제가 있으면 줄 번호와 함께 RuleError."""
    if len(text or "") > MAX_TEXT:
        raise RuleError([{"line": 0, "message": f"규칙 파일이 너무 길어요 ({MAX_TEXT:,}자 이하)"}])
    rules, errors, cur, last_key = [], [], None, None
    raw = {}

    def finish():
        if cur is None:
            return
        rule, fields = cur
        try:
            # 근거 더하기·코드 추천 규칙은 글을 직접 만들지 않으니 단계·제목·내용이 없어도 돼요
            needs = ("조건",) if ("근거 더하기" in fields or "코드 추천" in fields) else ("조건", "단계", "제목", "내용")
            for need in needs:
                if need not in fields:
                    raise ValueError(f"'{need}' 이 없어요")
            for key, (line, value) in fields.items():
                try:
                    _apply_field(rule, KEYS[key], value)
                except ValueError as exc:
                    errors.append({"line": line, "message": f"[{rule.name}] {key}: {exc}"})
        except ValueError as exc:
            errors.append({"line": rule.line, "message": f"[{rule.name}] {exc}"})
        rules.append(rule)

    for no, line in enumerate((text or "").splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#"):
            last_key = None
            depth = len(stripped) - len(stripped.lstrip("#"))
            m = _HEAD.match(stripped)
            if m:
                finish()
                cur = (Rule(name=m.group(1), code=m.group(2), line=no), {})
                raw = cur[1]
            elif depth <= 2:
                # '# 제목'·'## 설명' 같은 다른 제목이 나오면 규칙이 끝나요 (### 는 규칙 안의 작은 제목)
                finish()
                cur = None
                if depth == 2 and "(" in stripped and stripped.endswith(")"):
                    errors.append({"line": no, "message": "규칙 코드는 영어로 시작하고 영어·숫자·_ 만 쓸 수 있어요"})
            continue
        if cur is None:
            continue
        m = _ITEM.match(line)
        if m and m.group(1).strip() in KEYS:
            key = m.group(1).strip()
            if key in raw:
                errors.append({"line": no, "message": f"[{cur[0].name}] '{key}' 가 두 번 있어요"})
            raw[key] = (no, m.group(2).strip())
            last_key = key
        elif m and not line.startswith((" ", "\t")):
            errors.append({"line": no, "message": f"[{cur[0].name}] 모르는 항목 '{m.group(1).strip()}' "
                                                  f"(쓸 수 있는 항목: {', '.join(KEYS)})"})
            last_key = None
        elif stripped and last_key and line.startswith((" ", "\t")):
            ln, value = raw[last_key]
            raw[last_key] = (ln, f"{value} {stripped}")  # 들여 쓴 줄은 앞 항목에 이어 붙여요
        elif stripped and not stripped.startswith(">"):
            last_key = None
    finish()
    if not rules and not errors:
        errors.append({"line": 0, "message": "규칙이 하나도 없어요. '## 이름 (code)' 으로 시작해 주세요"})
    if errors:
        raise RuleError(errors)
    return rules


def _apply_field(rule, key, value):
    if key == "group":
        rule.group = value
    elif key == "cond":
        rule.cond = parse_condition(value)
    elif key == "level":
        rule.level = _template(value)
        for p in rule.level:
            texts = [p.strip()] if isinstance(p, str) else [t for _, t in p[1]]
            for t in texts:
                if t and t not in LEVELS:
                    raise ValueError(f"'{t}' 대신 관리·관찰·정상·참고 중 하나를 써 주세요")
    elif key == "title":
        rule.title = _template(value)
    elif key == "body":
        rule.body = _template(value)
    elif key == "reasons":
        rule.reasons = _split_reasons(value)
    elif key == "action":
        if value not in ACTIONS:
            raise ValueError(f"'{value}' 대신 물주기·조명 조정·위치 옮기기·비료·없음 중 하나를 써 주세요")
        rule.action = ACTIONS[value]
    elif key == "explains":
        rule.explains = ("const", True) if value in YES else ("const", False) if value in NO else parse_condition(value)
    elif key == "merge":
        m = re.match(r"^(.*?)\s*\((관리|관찰|정상|참고)\)\s*$", value)
        if m:
            value, rule.merge_level = m.group(1), LEVELS[m.group(2)]
        rule.merge_into = [c.strip() for c in value.split(",") if c.strip()]
        if not rule.merge_into:
            raise ValueError("근거를 더할 추천 코드를 적어 주세요")
    elif key == "generated":
        if value not in GENERATED:
            raise ValueError(f"모르는 코드 추천 '{value}'{_suggest(value, GENERATED)} (쓸 수 있는 것: {', '.join(GENERATED)})")
        rule.generated = value
    elif key == "enabled":
        if value not in YES and value not in NO:
            raise ValueError("'예' 또는 '아니오'로 적어 주세요")
        rule.enabled = value in YES


@lru_cache(maxsize=32)
def _parse_cached(text):
    return tuple(parse_rules(text))


def load(text=None):
    """규칙 글(없으면 기본 파일 rules.md) → 규칙 목록. 같은 글은 다시 읽지 않아요."""
    if text is None:
        text = default_text()
    return list(_parse_cached(text))


def default_text():
    return DEFAULT_PATH.read_text(encoding="utf-8")


def check(text):
    """화면의 '검사하기': {ok, count, errors, rules:[{name, code, group, enabled}]}"""
    try:
        rules = parse_rules(text)
    except RuleError as exc:
        return {"ok": False, "count": 0, "errors": exc.errors, "rules": []}
    return {"ok": True, "count": len(rules), "errors": [],
            "rules": [{"name": r.name, "code": r.code, "group": r.group, "enabled": r.enabled} for r in rules]}


# ---------------------------------------------------------------- 적용
def apply(rules, facts, values, reasons, generated=None):
    """규칙을 위에서부터 차례로 적용해 추천 목록을 만들어요.

    facts: {사실 이름: bool}, values: {값 이름: 글}, reasons: {근거 이름: [문장]}
    generated: {코드 추천 이름: [추천]} ('코드 추천' 규칙이 이 자리에 그대로 넣어요)
    """
    generated = generated or {}
    state = {"facts": facts, "values": values, "recs": [], "explained": False}
    fired = set()
    for rule in rules:
        if not rule.enabled or (rule.group and rule.group in fired):
            continue
        if not _eval(rule.cond, state):
            continue
        lines = []
        for cond, name in rule.reasons:
            if cond is None or _eval(cond, state):
                lines.extend(x for x in reasons.get(name, []) if x not in lines)
        if rule.generated:
            made = generated.get(rule.generated) or []
            if not made:
                continue
            for rec in made:
                rec = {**rec, "reasons": list(rec.get("reasons") or [])}
                rec["reasons"].extend(x for x in lines if x not in rec["reasons"])
                rec.setdefault("rule", rule.name)
                state["recs"].append(rec)
        elif rule.merge_into:
            target = next((r for r in state["recs"] if r["code"] in rule.merge_into
                           and (rule.merge_level is None or r["level"] == rule.merge_level)), None)
            if target is None:
                continue
            target["reasons"].extend(x for x in lines if x not in target["reasons"])
        else:
            level = LEVELS.get(_render(rule.level, state), "observe")
            state["recs"].append({
                "code": rule.code,
                "level": level,
                "title": _render(rule.title, state),
                "body": _render(rule.body, state),
                "reasons": lines,
                "action": rule.action,
                "rule": rule.name,
            })
        if rule.group:
            fired.add(rule.group)
        if rule.explains is not None and _eval(rule.explains, state):
            state["explained"] = True
    return state["recs"]


def reference():
    """화면 참고표: 쓸 수 있는 이름과 설명"""
    return {
        "facts": [{"name": k, "desc": v} for k, v in FACTS.items()],
        "dynamic": [{"name": k, "desc": v} for k, v in DYNAMIC.items()],
        "values": [{"name": k, "desc": v} for k, v in VALUES.items()],
        "generated": [{"name": k, "desc": v} for k, v in GENERATED.items()],
        "reasons": [{"name": k, "desc": v} for k, v in REASONS.items()],
        "levels": ["관리", "관찰", "정상", "참고"],
        "actions": ["물주기", "조명 조정", "위치 옮기기", "비료", "없음"],
    }
