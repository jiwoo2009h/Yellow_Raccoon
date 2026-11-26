"""특이 사항 → 증상 → 병해충 연결 사전.

이용자가 측정 기록의 '특이 사항'에 적은 글에서 먼저 '증상'(변색, 반점, 물러짐, 구멍 …)을 찾고,
그 증상들의 조합으로 어떤 병해충일 가능성이 높은지 점수를 매깁니다.
recommend.py 의 '특이 사항 규칙(규칙 J)'이 이 결과를 환경·생장 데이터와 함께 판단해서 추천에 반영합니다.

thresholds.py 와 마찬가지로 이 파일은 개발자만 고칩니다(앱에서 수정하는 API 없음).

출처
  - 농사로 작목별 병해충 · 상추 (https://www.nongsaro.go.kr, 작목코드 VC021005) 상세 정보
      병: 무름병(D00000954), 잿빛곰팡이병(D00000956), 갈색무늬병(D00000958),
          밑둥썩음병(D00000963), 균핵병(D00000964), 흰가루병(D00004374)
      해충: 왕담배나방(H00000399), 아메리카잎굴파리(H00000491), 명주달팽이(H00000544),
            담배거세미나방(H00000807), 작은뾰족민달팽이(H00000835)
  - 제공 자료 '모종이 쓰러지는 주요 원인': 모잘록병, 빛 부족(웃자람), 수분 스트레스, 물리적 상처
  - 제공 자료 '상추': 노균병, 진딧물 / '허브': 흰가루병, 응애
    (허브 자료의 가루이는 증상 설명이 없어서 증상 기반 사전에는 넣지 않았습니다)

키워드 쓰는 법
  - 띄어쓰기는 무시하고 비교합니다. ("흰 가루" == "흰가루")
  - "|" 는 '또는', "+" 는 '같은 글에 함께' 입니다.  "뒷면+곰팡이|포자" → '뒷면'과 ('곰팡이' 또는 '포자')
  - 키워드 바로 뒤에 '없음/않음/아님' 같은 말이 오면 부정으로 보고 넣지 않습니다. ("반점 없음")

증상의 범위 (level) 와 상위 증상 (parent)
  - 넓음: 여러 병해충에 두루 나타나는 말 (변색, 반점, 썩음, 번짐)
  - 중간: 범위를 좁혀 주는 말 (노랗게, 갈색, 곰팡이, 벌레, 물러짐, 구멍)
  - 좁음: 한두 병해충만의 특징 (암갈색, 겹무늬, 잿빛 곰팡이, 균핵, 거미줄, 애벌레, 점액)
  - 좁은 증상은 상위 증상을 포함합니다. 예) 암갈색 → 갈색 → 변색,  잿빛 곰팡이 → 곰팡이,  애벌레 → 벌레
    · 화면에는 가장 구체적인 증상만 보여 줍니다. ('연한 갈색' 을 찾으면 '갈색'·'변색' 은 따로 표시하지 않음)
    · 병해충 점수를 셀 때는 상위 증상도 맞은 것으로 봅니다. ('노랗게' 는 '변색 1점' 인 병해충에도 1점)
    · 단, 같은 줄기(상위-하위)에서는 가장 구체적인 증상 하나만 점수에 넣습니다. (중복 계산 방지)
  - covers: 상위-하위 관계가 아니어도 한 증상이 다른 증상을 대신할 때 (잎 뒷면 곰팡이 → 흰 곰팡이실, 잎 뒷면)
  - 부위(밑동, 잎 뒷면, 새순 …)는 다른 증상과 함께 있을 때만 씁니다. ('새 잎이 났어요' 만으로는 판단하지 않음)

판단 방법 (recommend.py 규칙 J)
  1) 특이 사항에서 증상을 찾습니다.
  2) 병해충마다 '증상별 점수'를 더합니다. 대략 좁음 3~4점(그 병해충만의 특징), 중간 1~2점, 넓음 1점.
     증상 점수가 MIN_SCORE 이상인 병해충만 후보가 됩니다. (예: '노랗게 변함'·'곰팡이'·'벌레' 하나만으로는 후보 없음
     → 관련 병해충과 구분 방법을 안내)
  3) 순위를 정할 때는 '잘 생기는 환경'이 기록으로 확인되면 +1, 그 작물 자료에 있는 병해충이면 +1 을 더합니다.
  4) 증상 점수가 CARE_SCORE 이상이거나, 후보 점수가 SUPPORTED_SCORE 이상이면서 환경·생장 둔화가
     함께 확인되면 '관리 필요', 아니면 '관찰 필요' 입니다.
"""

import re

MIN_SCORE = 2        # 증상 점수가 이 이상이어야 후보
SUPPORTED_SCORE = 3  # 이 이상 + (잘 생기는 환경 또는 생장 둔화) → 관리 필요
CARE_SCORE = 5       # 증상 점수만으로 관리 필요
MAX_GROUPS = 3       # 한 번에 보여 줄 추천(서로 다른 문제) 수
RIVAL_GAP = 2        # 1위와 이 점수 차이 안의 후보만 '또는 …' 으로 함께 안내
NOTE_MAX_AGE_DAYS = 7  # 이보다 오래된 특이 사항은 판단에 쓰지 않음 (가장 최근 기록은 항상 사용)

NEGATIONS = ("없", "않", "아님", "아니", "안보", "안생", "안남", "괜찮", "멀쩡")
NEG_WINDOW = 6
# 증상 없이 이 말만 있으면 '좋아졌다'로 보고 이전 특이 사항을 해결된 것으로 봅니다.
CLEAR_WORDS = "이상없|괜찮아|멀쩡|회복|나아졌|좋아졌|깨끗해|건강해"

LEVELS = ("넓음", "중간", "좁음")
LOCATION_GROUP = "부위"

ENV_LABELS = {
    "humidity_high": "습도가 계속 높아요",
    "humidity_low": "습도가 계속 낮아요",
    "temp_high": "온도가 계속 높아요",
    "temp_low": "온도가 계속 낮아요",
    "soil_high": "흙이 계속 젖어 있어요",
    "soil_low": "흙이 말라 있어요",
    "light_low": "조도가 계속 낮아요",
}

EXPERT_TIP = ("피해가 빠르게 번지거나 원인이 불분명하고 증상이 반복되면, 파종일·물주기 기록을 정리하고 "
              "대표 시료를 챙겨 전문 기관의 진단을 받아 보세요.")

# ---------------------------------------------------------------------------
# 1) 증상 키워드 사전: 이용자가 쓰는 말 → 증상
#    group  : 화면에서 묶어 보여 줄 분류
#    level  : 넓음 / 중간 / 좁음 (부위는 없음)
#    parent : 이 증상을 포함하는 더 넓은 증상
#    covers : 이 증상이 있으면 대신 빼는 증상
# ---------------------------------------------------------------------------
SYMPTOMS = {
    # 변색 ------------------------------------------------------------------
    "discolor": {"group": "변색", "level": "넓음", "label": "색이 변함", "keywords": [
        "변색|색이변|색깔이변|색이바뀌|색깔이바뀌|색이이상|색깔이이상|탈색|퇴색|색이빠|색이바래"]},
    "yellow": {"group": "변색", "level": "중간", "parent": "discolor", "label": "노랗게 변함", "keywords": [
        "노랗|노래|누렇|누래|노란|누런|노르스름|누르스름|황화|황색|노랑|담황"]},
    "brown": {"group": "변색", "level": "중간", "parent": "discolor", "label": "갈색으로 변함", "keywords": [
        "갈색|갈변|밤색"]},
    "black": {"group": "변색", "level": "중간", "parent": "discolor", "label": "검게 변함", "keywords": [
        "검게|검은색|검어|까맣|까매|흑색|거뭇|시커멓|새까"]},
    "light_brown": {"group": "변색", "level": "좁음", "parent": "brown", "label": "연한 갈색", "keywords": [
        "연한갈색|연갈색|옅은갈색|밝은갈색|담갈|연한밤색"]},
    "dark_brown": {"group": "변색", "level": "좁음", "parent": "brown", "label": "짙은 갈색(암갈색)", "keywords": [
        "암갈|짙은갈색|진한갈색|진갈색|고동색|흑갈색"]},
    "gray_white": {"group": "변색", "level": "좁음", "parent": "discolor", "label": "회백색으로 변함", "keywords": [
        "회백색|희끗|허옇|하얗게변|하얗게바|하얗게되|희게변|흰색으로변"]},
    # 반점·무늬 --------------------------------------------------------------
    "spot": {"group": "반점·무늬", "level": "넓음", "label": "반점·얼룩", "keywords": [
        "반점|얼룩|병반|무늬|점박이|점이생|점이있|점들|점같|점이보"]},
    "spread": {"group": "반점·무늬", "level": "넓음", "label": "번짐·빠르게 커짐", "keywords": [
        "번지|번져|퍼지고|퍼져가|점점퍼|다른잎으로|옆잎으로|반점이커|얼룩이커|병반이커|빠르게커|급속"]},
    "speckle": {"group": "반점·무늬", "level": "중간", "parent": "spot", "label": "작은 흰·노란 점(깨알)", "keywords": [
        "깨알|점점이|흰점|노란점|작은점|작은반점|자잘한점|하얀점|흰반점|하얀반점|좁쌀같은점"]},
    "water_soaked": {"group": "반점·무늬", "level": "좁음", "parent": "spot", "label": "물에 젖은 듯한 병반(수침상)",
                     "keywords": ["수침|물에젖|물먹은|물에불은|기름먹은|기름에젖|반투명"]},
    "ring_spot": {"group": "반점·무늬", "level": "좁음", "parent": "spot", "label": "겹무늬(동심원)", "keywords": [
        "겹무늬|동심원|나이테|겹겹이|테두리무늬"]},
    "eye_spot": {"group": "반점·무늬", "level": "좁음", "parent": "spot", "label": "가운데가 회색인 눈동자 모양 반점",
                 "keywords": ["눈동자|과녁|눈알", "가운데|중앙|한가운데+회색|하얗|흰색"]},
    # 곰팡이·가루 ------------------------------------------------------------
    "mold": {"group": "곰팡이·가루", "level": "중간", "label": "곰팡이", "keywords": ["곰팡|곰팽|균사"]},
    "white_mold": {"group": "곰팡이·가루", "level": "중간", "parent": "mold", "label": "흰 곰팡이실(솜 같음)", "keywords": [
        "흰곰팡|하얀곰팡|흰색곰팡|하얀색곰팡|흰실|하얀실|솜같|솜처럼|솜뭉치|흰균사|하얀균사"]},
    "sooty": {"group": "곰팡이·가루", "level": "중간", "parent": "mold", "label": "그을음(검은 곰팡이)", "keywords": [
        "그을음|그을린|검댕|검은가루|까만가루|검은곰팡|까만곰팡"]},
    "white_powder": {"group": "곰팡이·가루", "level": "좁음", "parent": "mold", "label": "흰 가루", "keywords": [
        "흰가루|하얀가루|흰색가루|하얀색가루|밀가루|분가루|분칠|하얀분|흰분"]},
    "gray_mold": {"group": "곰팡이·가루", "level": "좁음", "parent": "mold", "label": "잿빛 곰팡이", "keywords": [
        "잿빛|회색곰팡|회색솜|회색털|곰팡+회색"]},
    "underside_mold": {"group": "곰팡이·가루", "level": "좁음", "parent": "mold", "label": "잎 뒷면 곰팡이",
                       "keywords": ["뒷면|잎뒤+곰팡|포자|흰털|솜털|하얀털"], "covers": ["white_mold", "underside"]},
    "sclerotia": {"group": "곰팡이·가루", "level": "좁음", "label": "검은 알갱이(균핵)", "keywords": [
        "균핵|쥐똥", "검은|까만|검정+알갱|덩어리|알맹이"], "covers": ["frass"]},
    # 조직 변화 --------------------------------------------------------------
    "rot": {"group": "조직 변화", "level": "넓음", "label": "썩음", "keywords": ["썩|부패|문드러|곪"]},
    "soft": {"group": "조직 변화", "level": "중간", "label": "물러짐", "keywords": [
        "물러|무름|물렁|물컹|흐물|진물|녹아|뭉개|짓물"]},
    "wound": {"group": "조직 변화", "level": "중간", "label": "상처", "keywords": [
        "상처|긁혔|긁힌|찢어|찢겨|부러|꺾여|꺾였"]},
    "dry_rot": {"group": "조직 변화", "level": "좁음", "parent": "rot", "label": "마른 채로 썩음", "keywords": [
        "마른채로썩|말라서썩|마르면서썩|말라썩|바싹썩|마른상태로썩"]},
    "odor": {"group": "조직 변화", "level": "좁음", "label": "악취", "keywords": ["악취|냄새|구린|썩은내|고약|비린내|역한"]},
    "constriction": {"group": "조직 변화", "level": "좁음", "label": "잘록해짐", "keywords": [
        "잘록|가늘어|홀쭉|목이가늘|실처럼가늘"]},
    # 모양·생육 --------------------------------------------------------------
    "wilt": {"group": "모양·생육", "level": "중간", "label": "시듦·처짐", "keywords": [
        "시들|시듬|처지|처졌|처짐|축처|축늘|늘어지|늘어졌|힘이없|기운이없|풀이죽|비실"]},
    "dieback": {"group": "모양·생육", "level": "중간", "label": "말라 죽음", "keywords": [
        "말라죽|고사|바싹말|바스러|타들|잎이마르|잎이말라|잎이말랐|잎끝이마르|잎끝이말라|잎이바싹|"
        "식물이말라|식물이말랐|포기가말라|그루가말라|줄기가말라|말라비틀"]},
    "curl": {"group": "모양·생육", "level": "중간", "label": "잎 오그라듦·말림", "keywords": [
        "오그라|쪼그라|쭈글|오글|우글|잎이말리|잎말림|잎이말려|말려들|뒤틀|기형|구겨"]},
    "collapse": {"group": "모양·생육", "level": "중간", "label": "쓰러짐", "keywords": [
        "쓰러|넘어지|넘어졌|드러누|누워|고꾸라"]},
    "leggy": {"group": "모양·생육", "level": "중간", "label": "웃자람", "keywords": [
        "웃자|가늘고길|가늘게길|키만|길쭉|줄기만길|멀대"]},
    # 해충 흔적 --------------------------------------------------------------
    "insect": {"group": "해충 흔적", "level": "중간", "label": "벌레", "keywords": ["벌레|해충|곤충|버러지|벌래"]},
    "holes": {"group": "해충 흔적", "level": "중간", "label": "구멍·갉아 먹은 자국", "keywords": [
        "구멍|갉|뜯어먹|뜯겨|먹은자국|먹힌|먹혔|잎맥만|줄기만남|파먹|씹어"]},
    "small_insects": {"group": "해충 흔적", "level": "좁음", "parent": "insect", "label": "작은 벌레 무리", "keywords": [
        "작은벌레|벌레가모여|벌레무리|벌레떼|벌레가많|벌레가다닥|벌레가바글|벌레가우글|초록색작은|까만작은|검은작은",
        "새순|어린잎|새잎|뒷면+벌레"]},
    "tiny_mites": {"group": "해충 흔적", "level": "좁음", "parent": "insect", "label": "먼지 같은 아주 작은 벌레",
                   "keywords": ["먼지같은|티끌같은|아주작은벌레|아주작은점이움직|점이움직|빨간벌레|붉은벌레|좁쌀만한벌레"],
                   "covers": ["small_insects"]},
    "larva": {"group": "해충 흔적", "level": "좁음", "parent": "insect", "label": "애벌레", "keywords": [
        "애벌레|애벌래|유충|송충이|초록벌레|녹색벌레|청벌레|꿈틀"], "covers": ["small_insects"]},
    "frass": {"group": "해충 흔적", "level": "좁음", "label": "벌레 배설물(똥)", "keywords": [
        "벌레똥|배설물|분변|똥가루|똥이떨어|똥이있|똥이보|검은똥|까만똥"]},
    "egg_mass": {"group": "해충 흔적", "level": "좁음", "label": "알 덩어리", "keywords": [
        "알덩어리|알무더기|알뭉치|알이붙|알을낳|알이있|알들이|알이잔뜩|알이모여"]},
    "tunnel": {"group": "해충 흔적", "level": "좁음", "label": "구불구불한 흰 줄(굴)", "keywords": [
        "구불구불|굴을|굴이|터널|흰줄|하얀줄|낙서|지도모양|길이나있"]},
    "slime": {"group": "해충 흔적", "level": "좁음", "label": "반짝이는 점액 자국", "keywords": [
        "점액|반짝이는자국|반짝이는줄|은색자국|은빛|미끌|미끈|번들|끈끈한자국"]},
    "snail": {"group": "해충 흔적", "level": "좁음", "label": "달팽이", "keywords": ["달팽|괄태충|민달"]},
    "sticky": {"group": "해충 흔적", "level": "좁음", "label": "끈적임(감로)", "keywords": ["끈적|감로|진득|단물"]},
    "webbing": {"group": "해충 흔적", "level": "좁음", "label": "가는 거미줄", "keywords": ["거미줄"]},
    # 부위 (다른 증상과 함께 있을 때만 씀) -------------------------------------
    "base": {"group": LOCATION_GROUP, "label": "밑동(땅 닿는 부분)", "keywords": [
        "밑동|밑둥|줄기밑|아랫줄기|땅가|흙가|지제부|뿌리근처|흙닿|흙에닿|땅에닿|뿌리쪽|줄기아래"]},
    "lower_leaf": {"group": LOCATION_GROUP, "label": "아래쪽 잎부터", "keywords": [
        "아랫잎|아래잎|아래쪽잎|밑잎|아래쪽부터|아래에서부터|아래부터"]},
    "underside": {"group": LOCATION_GROUP, "label": "잎 뒷면", "keywords": ["뒷면|잎뒤"]},
    "new_growth": {"group": LOCATION_GROUP, "label": "새순·어린잎", "keywords": ["새순|어린잎|새잎|생장점|순끝|어린순"]},
    "leaf_tip": {"group": LOCATION_GROUP, "label": "잎 끝·가장자리", "keywords": ["잎끝|잎끄트|가장자리"]},
    "whole_plant": {"group": LOCATION_GROUP, "label": "포기 전체", "keywords": [
        "포기전체|그루전체|식물전체|포기째|통째로|전체적으로"]},
}

# ---------------------------------------------------------------------------
# 2) 병해충: 증상 조합 → 의심 병해충
#    symptoms : {증상 코드: 점수}  좁음 3~4점(특징), 중간 1~2점, 넓음 1점
#               넓은 증상(변색·반점 …)을 적어 두면, 그 아래 구체적인 증상(노랗게·겹무늬 …)도 그 점수를 받습니다.
#    names    : 이용자가 병해충 이름을 직접 적은 경우 (증상 점수 5점으로 봄)
#    crops    : 자료에서 확인된 작물 (순위 +1)
#    env      : 잘 생기는 환경 (기록으로 확인되면 순위 +1, 관리 필요 판단 근거)
#    check    : 다른 후보와 구분하는 특징 (후보가 여럿일 때 안내)
#    body     : 자료에 근거한 증상 설명과 관리 방법
# ---------------------------------------------------------------------------
NAME_SCORE = 5

PESTS = [
    {
        "code": "soft_rot", "name": "무름병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 무름병",
        "symptoms": {"soft": 3, "odor": 3, "water_soaked": 2, "rot": 2, "base": 1, "wilt": 1,
                     "wound": 1, "whole_plant": 1},
        "names": ["무름병"],
        "env": ["soil_high", "humidity_high"],
        "check": "물러진 부위가 흐물흐물하고 악취가 나면 무름병",
        "body": "흙 닿는 밑동이나 잎을 딴 상처에서 물에 젖은 듯한 병반이 생겨 커지고, 심하면 포기 전체가 물러 썩으며 "
                "시들고 악취가 나요(세균이 상처로 들어가요). 병든 포기는 완전히 뽑아 내고 사용한 가위·도구는 깨끗이 "
                "소독하세요. 병원균이 건조에 약하므로 배수와 통풍이 잘되게 하고, 잎을 딸 때 상처를 적게 내 주세요.",
        "action": "prune", "action_label": "병든 포기 정리했어요",
    },
    {
        "code": "gray_mold", "name": "잿빛곰팡이병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 잿빛곰팡이병",
        "symptoms": {"gray_mold": 4, "light_brown": 2, "water_soaked": 1, "brown": 1, "discolor": 1, "mold": 1,
                     "soft": 1, "curl": 1, "rot": 1, "sclerotia": 1, "leaf_tip": 1, "spread": 1},
        "names": ["잿빛곰팡이병", "잿빛곰팡이"],
        "env": ["humidity_high", "soil_high"],
        "check": "병든 부위에 잿빛(회색) 곰팡이가 빽빽하게 피면 잿빛곰팡이병",
        "body": "잎에 연한 갈색의 물에 젖은 듯한 작은 병반이 생겨 빠르게 커지고 잎과 포기가 썩어요. "
                "잎 끝에서 시작하면 잎이 갈색으로 오그라들고 다른 잎으로 옮아요. 병반에는 잿빛 곰팡이가 빽빽이 피고, "
                "밑동에는 나중에 검은 균핵이 생기기도 해요(봄·가을처럼 서늘하고 다습할 때, 20~25℃에서 잘 생겨요). "
                "병든 잎과 떨어진 잎은 보이는 즉시 치우고, 환기가 잘되게 하며 흙이 과습하지 않게 해 주세요. "
                "너무 빽빽하게 심지 말고 질소 비료를 너무 많이 주지 마세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "cercospora", "name": "갈색무늬병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 갈색무늬병",
        "symptoms": {"ring_spot": 4, "eye_spot": 3, "dark_brown": 2, "water_soaked": 1, "brown": 1, "spot": 1,
                     "discolor": 1, "lower_leaf": 1, "yellow": 1, "dieback": 1, "spread": 1},
        "names": ["갈색무늬병"],
        "env": [],
        "check": "암갈색 반점에 겹무늬가 있고 가운데가 눈동자처럼 회색이면 갈색무늬병",
        "body": "잎에 물에 젖은 듯한 작은 반점이 생겨 암갈색의 불규칙한 반점으로 커지고, 겹무늬와 가운데 회색 "
                "눈동자 모양이 생겨요. 아래쪽 잎부터 위로 번지고(주로 자란 뒤 후기에 생겨요), 심하면 반점이 서로 "
                "합쳐지며 잎이 누렇게 말라 죽어요. 병원균이 병든 잎에 남아 공기로 퍼지므로 병든 잎은 일찍 떼어 내고, "
                "비료는 한쪽으로 치우치지 않게 균형 있게 주세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "bottom_rot", "name": "밑둥썩음병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 밑둥썩음병",
        "symptoms": {"dry_rot": 3, "base": 2, "dark_brown": 2, "rot": 2, "brown": 1, "discolor": 1, "spot": 1,
                     "dieback": 1, "whole_plant": 1},
        "names": ["밑둥썩음병", "밑동썩음병"],
        "env": ["soil_high"],
        "check": "흙에 닿은 잎 밑동이 암갈색으로 썩거나 마른 채로 썩으면 밑둥썩음병",
        "body": "흙에 닿은 잎 밑동이 암갈색으로 변해 썩고, 심하면 포기 전체가 말라 죽어요. 둥근 암갈색 반점이 "
                "커지다가 밑동이 마른 채로 썩기도 해요(어릴 때부터 중간 시기까지, 습한 흙에서 잘 생겨요). "
                "병든 포기는 주변 흙과 함께 일찍 제거하고, 흙이 과습하지 않게 하며 질소 비료를 너무 많이 주지 마세요. "
                "병이 났던 흙에는 상추를 바로 다시 심지 말고 새 흙을 쓰는 것이 좋아요.",
        "action": "prune", "action_label": "병든 포기 정리했어요",
    },
    {
        "code": "sclerotinia", "name": "균핵병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 균핵병",
        "symptoms": {"sclerotia": 4, "white_mold": 2, "light_brown": 2, "mold": 1, "brown": 1, "discolor": 1,
                     "base": 1, "soft": 1, "rot": 1, "whole_plant": 1},
        "names": ["균핵병"],
        "env": ["humidity_high", "temp_low"],
        "check": "썩은 밑동에 흰 곰팡이실이 자라고 검은 알갱이(균핵)가 생기면 균핵병",
        "body": "흙 닿는 밑동이 연한 갈색으로 물러 썩고, 흰 곰팡이실이 자라면서 포기 전체가 썩어요. "
                "나중에 썩은 곳에 크고 작은 검은 알갱이(균핵)가 생겨요(습하고 15~25℃로 서늘할 때 심해요). "
                "균핵이 흙에 남아 다음에 다시 병을 일으키므로, 병든 포기는 주변 흙과 함께 일찍 뽑아 버리고 그 흙은 "
                "다시 쓰지 마세요. 서늘하고 다습하지 않게 관리하고, 흙 표면을 비닐 등으로 덮으면(멀칭) 발생을 줄일 수 있어요.",
        "action": "prune", "action_label": "병든 포기 정리했어요",
    },
    {
        "code": "powdery_mildew", "name": "흰가루병", "kind": "병해", "crops": ["lettuce", "basil"],
        "source": "농사로 상추 흰가루병 · 허브 병해 자료",
        "symptoms": {"white_powder": 4, "gray_white": 2, "mold": 1, "yellow": 1, "discolor": 1, "dieback": 1},
        "names": ["흰가루병"],
        "env": ["light_low"],
        "check": "잎 앞면에 밀가루 같은 흰 가루가 덮이면 흰가루병",
        "body": "잎 앞면에 흰 가루가 조금씩 생겨 잎 전체를 덮고, 오래되면 회백색으로 변하며 검은 작은 점이 생기고 "
                "잎이 말라 죽어요(15~28℃, 햇빛 부족, 큰 밤낮 온도 차, 비료 과다에서 잘 생기고 32℃ 이상에서는 줄어요). "
                "병든 잎과 떨어진 잎을 치우고, 병든 식물은 떨어뜨려 두세요. 간격을 넓혀 통풍과 햇빛이 잘 들게 하고 "
                "질소 비료를 너무 많이 주지 마세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "downy_mildew", "name": "노균병", "kind": "병해", "crops": ["lettuce"],
        "source": "제공 자료 상추 노균병",
        "symptoms": {"underside_mold": 4, "white_mold": 1, "mold": 1, "underside": 1, "yellow": 1, "spot": 1,
                     "lower_leaf": 1, "brown": 1, "discolor": 1},
        "names": ["노균병"],
        "env": ["humidity_high", "temp_low", "soil_high"],
        "check": "잎 앞면은 연한 노란 반점, 잎 뒷면에 흰 곰팡이가 피어 있으면 노균병",
        "body": "잎에 연한 노란 반점이 생기고 잎 뒷면에 흰 곰팡이가 피어요(아래쪽 잎부터, 저온다습할 때 잘 생겨요). "
                "환기해서 습도를 낮추고, 물은 잎이 아닌 흙에 줘서 잎에 물방울이 오래 남지 않게 해 주세요. "
                "병든 잎은 빨리 떼어 내고 흙이 과습하지 않게 관리해 주세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "damping_off", "name": "모잘록병", "kind": "병해", "crops": ["lettuce", "basil", "other"],
        "source": "제공 자료 모종 쓰러짐",
        "symptoms": {"constriction": 3, "base": 2, "soft": 1, "collapse": 1},
        "names": ["모잘록병", "잘록병"],
        "env": ["soil_high", "humidity_high", "temp_low"],
        "check": "흙에 닿은 줄기 밑동이 물러지거나 가늘게 잘록해졌으면 모잘록병",
        "body": "흙과 맞닿은 줄기 밑동이 물러지거나 가늘게 잘록해지며 쓰러지는 병이에요(습하고 서늘하거나 과습·통풍 "
                "부족일 때 잘 생겨요). 의심되는 화분·트레이는 다른 식물과 바로 떨어뜨려 두세요. 흙을 무조건 바싹 "
                "말리면 오히려 해로우니, 받침에 고인 물을 비우고 물은 아침에 균일하게 주세요. 너무 빽빽하게 심지 "
                "않았는지, 환기와 밤낮 온도 차, 빛이 가려지는 자리가 없는지 확인하고, 사용한 용기는 흙을 씻어낸 뒤 소독하세요.",
        "action": "move", "action_label": "따로 옮겨 뒀어요",
    },
    {
        # 쓰러짐만 있고 모잘록병 증상은 없을 때: 자료의 '혼동하기 쉬운 원인'을 데이터로 구분
        "code": "collapse", "name": "쓰러짐", "kind": "생육 이상", "crops": [],
        "source": "제공 자료 모종 쓰러짐",
        "symptoms": {"collapse": 2},
        "names": [],
        "env": [],
        "suppressed_by": ["damping_off"],
        "check": "",
        "causes": [
            {"label": "빛 부족(웃자람)", "symptoms": ["leggy"], "facts": ["light_low"],
             "tip": "빛이 부족하면 줄기만 가늘고 길게 자라 스스로 서 있지 못해요. 더 밝은 곳으로 옮기거나 조명을 확인해 주세요."},
            {"label": "수분 스트레스", "symptoms": [], "facts": ["soil_low", "soil_high"],
             "tip": "흙이 너무 마르거나 너무 젖으면 뿌리가 상해요. 받침의 고인 물을 비우고 물은 아침에 균일하게 주세요."},
            {"label": "물리적 상처", "symptoms": ["wound"], "keywords": ["건드|떨어뜨|부딪"], "facts": [],
             "tip": "옮기거나 만지다가 밑동이 상했을 수 있어요. 상처 부위를 확인해 주세요."},
        ],
        "body": "쓰러진 원인은 모잘록병, 빛 부족(웃자람), 수분 스트레스, 물리적 상처 등 여러 가지일 수 있어요. "
                "먼저 줄기 밑동이 물러지거나 잘록해졌는지 확인해 주세요.",
        "action": None,
    },
    {
        "code": "aphid", "name": "진딧물", "kind": "해충", "crops": ["lettuce"],
        "source": "제공 자료 상추 진딧물",
        "symptoms": {"small_insects": 4, "sticky": 3, "sooty": 2, "insect": 1, "curl": 1, "new_growth": 1,
                     "underside": 1},
        "names": ["진딧물", "진디"],
        "env": [],
        "check": "잎 뒷면·새순에 작은 벌레가 모여 있고 잎이 끈적하면 진딧물",
        "body": "작은 벌레가 잎 뒷면·어린잎에 모여 즙을 빨아 먹어 잎이 오그라들고 끈적한 감로가 생기며, "
                "감로 위에 검은 그을음이 끼기도 해요. 잎 뒷면과 새순을 자주 살펴보고, 초기에는 피해 잎을 떼어 내세요. "
                "방충망을 쓰거나 무당벌레·진디벌 같은 천적을 활용할 수 있어요.",
        "action": "prune", "action_label": "피해 잎 뗐어요",
    },
    {
        "code": "spider_mite", "name": "응애", "kind": "해충", "crops": ["basil"],
        "source": "제공 자료 허브 응애",
        "symptoms": {"webbing": 4, "tiny_mites": 3, "speckle": 2, "insect": 1, "underside": 1, "yellow": 1,
                     "discolor": 1, "dieback": 1},
        "names": ["응애"],
        "env": ["temp_high", "humidity_low"],
        "check": "잎 뒷면에 먼지 같은 아주 작은 벌레와 가는 거미줄이 있으면 응애",
        "body": "잎 뒷면에 먼지처럼 아주 작은 응애가 붙어 잎에 작은 흰·노란 점이 생기고, 많아지면 가는 거미줄이 생겨요"
                "(고온·건조할 때 잘 생겨요). 잎 뒷면을 자주 살펴보고, 초기에는 피해 잎을 떼어 내세요. "
                "식물 주변을 깨끗이 하고 건조한 환경이 계속되지 않게 해 주세요. 천적인 이리응애류를 활용할 수 있어요.",
        "action": "prune", "action_label": "피해 잎 뗐어요",
    },
    {
        "code": "leafminer", "name": "아메리카잎굴파리", "kind": "해충", "crops": ["lettuce"],
        "source": "농사로 상추 아메리카잎굴파리",
        "symptoms": {"tunnel": 4, "speckle": 1, "insect": 1, "brown": 1, "discolor": 1, "dieback": 1, "spot": 1},
        "names": ["잎굴파리", "굴파리"],
        "env": ["temp_high"],
        "check": "잎 속에 구불구불한 흰 줄(굴)이 있으면 잎굴파리",
        "body": "애벌레가 잎 속을 파고 다녀 구불구불한 흰 줄(굴)이 생기고, 성충은 잎을 찔러 즙을 먹거나 알을 낳아 "
                "작은 반점을 남겨요. 심하면 잎 전체가 갈색으로 말라 죽어요(따뜻할수록 빨리 늘어나요). "
                "피해 잎은 떼어 내고, 방충망으로 성충이 들어오지 못하게 하세요. 새로 심을 때는 피해 없는 건강한 모종을 쓰고, "
                "노란 끈끈이 트랩으로 발생을 확인할 수 있어요. 잎 피해가 조금이면 생육에 큰 영향이 없으니 약은 신중히 쓰세요.",
        "action": "prune", "action_label": "피해 잎 뗐어요",
    },
    {
        "code": "caterpillar", "name": "나방 애벌레(왕담배나방·담배거세미나방)", "kind": "해충", "crops": ["lettuce"],
        "source": "농사로 상추 왕담배나방 · 담배거세미나방",
        "symptoms": {"larva": 4, "frass": 3, "egg_mass": 2, "holes": 2, "insect": 1, "new_growth": 1},
        "names": ["담배나방", "거세미", "나방"],
        "env": [],
        "check": "애벌레나 배설물(똥)이 보이거나 잎 뒷면에 알 덩어리가 있으면 나방 애벌레",
        "body": "애벌레가 새잎과 잎을 갉아 먹어요. 많으면 줄기만 남기고 먹기도 해요. 담배거세미나방은 잎 뒷면에 "
                "털로 덮인 알 덩어리를 낳고, 어린 애벌레는 모여 있다가 자라면 흩어져요(6~9월에 많아요). "
                "잎 위와 주변의 배설물로 발생을 확인하고, 피해 잎을 살펴 애벌레를 손으로 잡아 없애세요. "
                "알 덩어리가 붙은 잎은 떼어 내고, 애벌레가 어릴 때 없애야 효과가 커요.",
        "action": "other", "action_label": "벌레 잡았어요",
    },
    {
        "code": "slug", "name": "달팽이류(명주달팽이·민달팽이)", "kind": "해충", "crops": ["lettuce"],
        "source": "농사로 상추 명주달팽이 · 작은뾰족민달팽이",
        "symptoms": {"snail": 4, "slime": 3, "holes": 1, "egg_mass": 1},
        "names": ["명주달팽이", "민달팽이", "괄태충"],
        "env": ["humidity_high", "soil_high"],
        "check": "반짝이는 점액 자국이 있거나 밤에 달팽이가 보이면 달팽이류",
        "body": "잎과 꽃을 갉아 먹고 반짝이는 점액 자국을 남겨요(습한 곳을 좋아하고 주로 밤에 활동해요). "
                "흙 표면과 식물 주변을 건조하고 깨끗하게 관리하는 것이 가장 효과적이에요. 습하고 그늘진 은신처"
                "(화분 밑, 잎 사이, 밑동, 떨어진 잎·잡초 아래)를 저녁에 살펴 손으로 잡아 없애세요. "
                "흙 위의 흰 알 덩어리도 보이면 치워 주세요.",
        "action": "other", "action_label": "달팽이 잡았어요",
    },
]

PESTS_BY_CODE = {p["code"]: p for p in PESTS}
_BOUNDARY = re.compile(r"[,.!?;:/\n·~()\[\]]")


def ancestors(code):
    """상위 증상 목록 (가까운 것부터). 예) dark_brown → [brown, discolor]"""
    out = []
    parent = SYMPTOMS[code].get("parent")
    while parent:
        out.append(parent)
        parent = SYMPTOMS[parent].get("parent")
    return out


def normalize(text):
    """띄어쓰기를 지우고 소문자로 바꿉니다."""
    return re.sub(r"\s+", "", text or "").lower()


def _alt_state(text, alternatives):
    """대체어 중 하나라도 긍정으로 나오면 ('pos', 단어), 부정으로만 나오면 ('neg', 단어)."""
    negated = None
    for word in alternatives:
        start = text.find(word)
        while start != -1:
            tail = _BOUNDARY.split(text[start + len(word):start + len(word) + NEG_WINDOW], 1)[0]
            if not any(n in tail for n in NEGATIONS):
                return "pos", word
            negated = negated or word
            start = text.find(word, start + 1)
    return ("neg", negated) if negated else (None, None)


def keyword_state(text, pattern):
    """'A+B|C' 형식의 키워드가 정규화된 글에 있는지: ('pos' / 'neg' / None, 찾은 단어 목록)"""
    results = [_alt_state(text, [normalize(w) for w in part.split("|") if w.strip()])
               for part in pattern.split("+")]
    if any(state is None for state, _ in results):
        return None, []
    words = [w for _, w in results]
    return ("neg" if any(state == "neg" for state, _ in results) else "pos"), words


def find_symptoms(text):
    """특이 사항 글에서 증상을 찾습니다. (찾은 증상 {코드: 찾은 단어}, 부정으로 언급된 증상 코드 집합)
    더 구체적인 증상을 찾으면 그 상위 증상과 covers 에 적힌 증상은 빼고 가장 구체적인 것만 남깁니다."""
    text = normalize(text)
    found, negated = {}, set()
    for code, s in SYMPTOMS.items():
        for pattern in s["keywords"]:
            state, words = keyword_state(text, pattern)
            if state == "pos":
                found[code] = "+".join(words)
                break
            if state == "neg":
                negated.add(code)
    implied = set()
    for code in found:
        implied.update(ancestors(code))
        implied.update(SYMPTOMS[code].get("covers", []))
    found = {c: w for c, w in found.items() if c not in implied}
    return found, negated - set(found) - implied


def has_signal(symptoms):
    """부위(밑동·새순 …)만으로는 판단하지 않습니다."""
    return any(SYMPTOMS[c]["group"] != LOCATION_GROUP for c in symptoms)


def _names_in(text, pest):
    text = normalize(text)
    for name in pest["names"]:
        state, words = keyword_state(text, name)
        if state:
            return state, words[0]
    return None, None


def read_note(text):
    """한 기록의 글 → {'symptoms', 'names', 'negated', 'cleared'}"""
    found, negated = find_symptoms(text)
    names, neg_names = {}, set()
    for pest in PESTS:
        state, word = _names_in(text, pest)
        if state == "pos":
            names[pest["code"]] = word
        elif state == "neg":
            neg_names.add(pest["code"])
    cleared = not has_signal(found) and not names and (
        bool(negated or neg_names) or keyword_state(normalize(text), CLEAR_WORDS)[0] == "pos")
    return {"symptoms": found, "names": names, "negated": negated, "cleared": cleared}


def pick_note(notes):
    """판단에 쓸 특이 사항 하나를 고릅니다(가장 최근에 증상을 적은 기록).
    더 최근 기록이 '이상 없음/회복'처럼 해결을 말하면 None."""
    for note in reversed(notes):
        info = read_note(note["text"])
        if has_signal(info["symptoms"]) or info["names"]:
            return {**note, **info}
        if info["cleared"]:
            return None
    return None


def _match(pest_symptoms, found):
    """병해충의 증상 점수표와 찾은 증상을 맞춰 봅니다.
    찾은 증상의 상위 증상도 맞은 것으로 보되, 같은 줄기에서는 가장 구체적인 증상 하나만 점수에 넣습니다.
    반환: {증상 코드: (점수, 글에서 찾은 단어, 근거가 된 찾은 증상 코드)}"""
    source = {}
    for code, word in found.items():
        source.setdefault(code, (word, code))
        for a in ancestors(code):
            source.setdefault(a, (word, code))
    matched = {c: w for c, w in pest_symptoms.items() if c in source}
    return {c: (w, *source[c]) for c, w in matched.items()
            if not any(c in ancestors(d) for d in matched if d != c)}


def rank(info, species, env_state, min_score=MIN_SCORE):
    """증상·이름 → 병해충 후보 목록(점수순). min_score=1 이면 '관련 있는 병해충' 전체."""
    found = info["symptoms"]
    cands = []
    for pest in PESTS:
        matched = _match(pest["symptoms"], found)
        score = sum(w for w, _, _ in matched.values())
        hits = [f"{SYMPTOMS[c]['label']}('{word}')" for c, (_, word, _) in matched.items()]
        named = pest["code"] in info["names"]
        if named:
            score += NAME_SCORE
            hits.insert(0, f"이름 '{info['names'][pest['code']]}'")
        if score < min_score:
            continue
        env_hits = [e for e in pest["env"] if env_state.get(e)]
        crop = species in pest["crops"]
        cands.append({
            "pest": pest, "score": score,
            # 글에서 실제로 찾은 증상 중 이 병해충 점수의 근거가 된 것 (상위 증상으로 맞은 것도 원래 찾은 증상으로)
            "matched": {src for _, _, src in matched.values()} | ({"name"} if named else set()),
            "hits": hits, "env_hits": env_hits, "crop": crop,
            "total": score + len(env_hits) + (1 if crop else 0),
        })
    codes = {c["pest"]["code"] for c in cands}
    cands = [c for c in cands if not any(s in codes for s in c["pest"].get("suppressed_by", []))]
    cands.sort(key=lambda c: (-c["total"], -c["score"]))
    return cands


def group(cands):
    """같은 증상으로 의심되는 후보는 한 묶음으로(한 추천 안에서 '다른 후보'로 안내),
    증상이 겹치지 않는 후보는 따로 추천합니다. (예: '진딧물 있고 잎에 구멍' → 진딧물 / 나방 애벌레)"""
    groups = []
    for c in cands:
        for g in groups:
            if (c["matched"] & g[0]["matched"]) - {"name"}:
                g.append(c)
                break
        else:
            groups.append([c])
    return groups[:MAX_GROUPS]


def close_rivals(cands):
    """한 묶음에서 1위와 점수가 비슷해 함께 안내할 다른 후보 (최대 2개).
    1위보다 RIVAL_GAP 점을 넘게 낮으면 '또는 …' 으로 보여 주지 않습니다."""
    top = cands[0]["total"]
    return [c for c in cands[1:] if top - c["total"] <= RIVAL_GAP][:2]


def public_rules():
    """설정 화면(읽기 전용)에 보여 줄 증상 키워드와 병해충 연결표."""
    return {
        "symptoms": [{
            "code": code, "group": s["group"], "label": s["label"], "level": s.get("level"),
            "parent": SYMPTOMS[s["parent"]]["label"] if s.get("parent") else None,
            "keywords": [k.replace("|", " / ").replace("+", " + ") for k in s["keywords"]],
        } for code, s in SYMPTOMS.items()],
        "pests": [{
            "code": p["code"], "name": p["name"], "kind": p["kind"], "source": p["source"],
            "symptoms": [{"label": SYMPTOMS[c]["label"], "weight": w, "level": SYMPTOMS[c].get("level")}
                         for c, w in sorted(p["symptoms"].items(), key=lambda x: -x[1])],
            "env": [ENV_LABELS[e] for e in p["env"]],
        } for p in PESTS],
        "rules": {"min_score": MIN_SCORE, "supported_score": SUPPORTED_SCORE, "care_score": CARE_SCORE},
    }
