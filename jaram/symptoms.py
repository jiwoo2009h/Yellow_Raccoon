"""특이 사항 → 증상 → 병해충 연결 사전.

이용자가 측정 기록의 '특이 사항'에 적은 글에서 먼저 '증상'(변색, 반점, 물러짐, 구멍 …)을 찾고,
그 증상들의 조합으로 어떤 병해충일 가능성이 높은지 점수를 매깁니다.
recommend.py 의 '특이 사항 규칙(규칙 J)'이 이 결과를 환경·생장 데이터와 함께 판단해서 추천에 반영합니다.

thresholds.py 와 마찬가지로 이 파일은 개발자만 고칩니다(앱에서 수정하는 API 없음).

출처
  - 농사로 작목별 병해충 · 상추 (https://www.nongsaro.go.kr, 작목코드 VC021005)
      병: 무름병, 잿빛곰팡이병, 갈색무늬병, 밑둥썩음병, 균핵병, 흰가루병
      해충: 왕담배나방, 담배거세미나방, 아메리카잎굴파리, 명주달팽이, 작은뾰족민달팽이
  - 제공 자료 '모종이 쓰러지는 주요 원인': 모잘록병, 빛 부족(웃자람), 수분 스트레스, 물리적 상처
  - 제공 자료 '상추': 노균병, 진딧물 / '허브': 흰가루병, 응애
    (허브 자료의 가루이는 증상 설명이 없어서 증상 기반 사전에는 넣지 않았습니다)

키워드 쓰는 법
  - 띄어쓰기는 무시하고 비교합니다. ("흰 가루" == "흰가루")
  - "|" 는 '또는', "+" 는 '같은 글에 함께' 입니다.  "뒷면+곰팡이|포자" → '뒷면'과 ('곰팡이' 또는 '포자')
  - 키워드 바로 뒤에 '없음/않음/아님' 같은 말이 오면 부정으로 보고 넣지 않습니다. ("반점 없음")

판단 방법 (recommend.py 규칙 J)
  1) 특이 사항에서 증상을 찾습니다.
  2) 병해충마다 '증상별 점수'를 더합니다. 그 병해충만의 특징 4점, 흔히 함께 나타나는 증상 1~3점.
     증상 점수가 MIN_SCORE 이상인 병해충만 후보가 됩니다. (예: '노랗게 변함' 하나만으로는 후보 없음)
  3) 순위를 정할 때는 '잘 생기는 환경'이 기록으로 확인되면 +1, 그 작물 자료에 있는 병해충이면 +1 을 더합니다.
  4) 증상 점수가 CARE_SCORE 이상이거나, 후보 점수가 SUPPORTED_SCORE 이상이면서 환경·생장 둔화가
     함께 확인되면 '관리 필요', 아니면 '관찰 필요' 입니다.
"""

import re

MIN_SCORE = 2        # 증상 점수가 이 이상이어야 후보
SUPPORTED_SCORE = 3  # 이 이상 + (잘 생기는 환경 또는 생장 둔화) → 관리 필요
CARE_SCORE = 5       # 증상 점수만으로 관리 필요
MAX_GROUPS = 3       # 한 번에 보여 줄 추천(서로 다른 문제) 수
NOTE_MAX_AGE_DAYS = 7  # 이보다 오래된 특이 사항은 판단에 쓰지 않음 (가장 최근 기록은 항상 사용)

NEGATIONS = ("없", "않", "아님", "아니", "안보", "안생", "안남", "괜찮", "멀쩡")
NEG_WINDOW = 6
# 증상 없이 이 말만 있으면 '좋아졌다'로 보고 이전 특이 사항을 해결된 것으로 봅니다.
CLEAR_WORDS = "이상없|괜찮아|멀쩡|회복|나아졌|좋아졌|깨끗해|건강해"

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
# ---------------------------------------------------------------------------
SYMPTOMS = {
    # 변색
    "discolor": {"group": "변색", "label": "색이 변함", "keywords": ["변색|색이변|색깔이변|색이바뀌|색이이상"]},
    "yellow": {"group": "변색", "label": "노랗게 변함", "keywords": ["노랗|노래|누렇|누래|노란|누런|황화|연노랑|담황"]},
    "brown": {"group": "변색", "label": "갈색으로 변함", "keywords": ["갈색|갈변|밤색|고동색|암갈|담갈"]},
    "black": {"group": "변색", "label": "검게 변함", "keywords": ["검게|검은색|검어|까맣|까매|흑색|거뭇"]},
    # 반점·무늬
    "spot": {"group": "반점", "label": "반점·얼룩", "keywords": ["반점|얼룩|병반|무늬|점박이|점이생|점이있|점들|점같"]},
    "ring_spot": {"group": "반점", "label": "겹무늬·눈동자 모양 반점", "keywords": ["겹무늬|동심원|눈동자|과녁"]},
    "speckle": {"group": "반점", "label": "작은 흰·노란 점(깨알)", "keywords": ["깨알|점점이|흰점|노란점|작은점|작은반점|자잘한점|하얀점"]},
    "tunnel": {"group": "반점", "label": "구불구불한 흰 줄(굴)", "keywords": ["구불구불|굴을|굴이|터널|흰줄|하얀줄|낙서|지도모양"]},
    # 곰팡이·가루
    "white_powder": {"group": "곰팡이·가루", "label": "흰 가루", "keywords": ["흰가루|하얀가루|흰색가루|밀가루|분가루"]},
    "gray_mold": {"group": "곰팡이·가루", "label": "잿빛 곰팡이", "keywords": ["잿빛|회색곰팡이|회색솜|곰팡이+회색"]},
    "white_mold": {"group": "곰팡이·가루", "label": "흰 곰팡이실(솜 같음)", "keywords": ["흰곰팡이|하얀곰팡이|흰색곰팡이|흰실|하얀실|솜같|솜처럼"]},
    "underside_mold": {"group": "곰팡이·가루", "label": "잎 뒷면 곰팡이", "keywords": ["뒷면+곰팡이|포자|흰털"],
                       "covers": ["white_mold"]},
    "sclerotia": {"group": "곰팡이·가루", "label": "검은 알갱이(균핵)", "keywords": ["균핵|쥐똥", "검은|까만+알갱이|덩어리|알맹이"]},
    "sooty": {"group": "곰팡이·가루", "label": "그을음", "keywords": ["그을음|검댕|검은가루|까만가루"]},
    # 조직 변화
    "soft": {"group": "조직 변화", "label": "물러짐(물에 젖은 듯)", "keywords": ["물러|무름|물렁|물컹|흐물|수침|진물|물에젖|녹아"]},
    "rot": {"group": "조직 변화", "label": "썩음", "keywords": ["썩|부패|문드러"]},
    "odor": {"group": "조직 변화", "label": "악취", "keywords": ["악취|냄새|구린"]},
    "constriction": {"group": "조직 변화", "label": "잘록해짐", "keywords": ["잘록|가늘어|홀쭉"]},
    # 모양·생육
    "wilt": {"group": "모양·생육", "label": "시듦·처짐", "keywords": ["시들|시듬|처지|처졌|처짐|축처|힘이없"]},
    "dieback": {"group": "모양·생육", "label": "말라 죽음", "keywords": ["말라죽|고사|바싹말|바스러|타들|말라가|말랐"]},
    "curl": {"group": "모양·생육", "label": "잎 오그라듦·말림", "keywords": ["오그라|쪼그라|쭈글|말리|말림|뒤틀|기형"]},
    "collapse": {"group": "모양·생육", "label": "쓰러짐", "keywords": ["쓰러|넘어지|넘어졌|드러누|누워"]},
    "leggy": {"group": "모양·생육", "label": "웃자람", "keywords": ["웃자|가늘고길|가늘게길|키만"]},
    # 해충 흔적
    "holes": {"group": "해충 흔적", "label": "구멍·갉아 먹은 자국", "keywords": ["구멍|갉아|뜯어먹|먹은자국|먹힌|잎맥만|줄기만남|파먹"]},
    "larva": {"group": "해충 흔적", "label": "애벌레·배설물", "keywords": ["애벌레|애벌래|유충|송충이|초록벌레|녹색벌레|벌레똥|배설물"]},
    "slime": {"group": "해충 흔적", "label": "반짝이는 점액 자국", "keywords": ["점액|반짝이는자국|은색자국|은빛|미끌|미끈|끈끈한자국"]},
    "snail": {"group": "해충 흔적", "label": "달팽이", "keywords": ["달팽이"]},
    "sticky": {"group": "해충 흔적", "label": "끈적임(감로)", "keywords": ["끈적|감로"]},
    "small_insects": {"group": "해충 흔적", "label": "작은 벌레 무리", "keywords": [
        "작은벌레|벌레가모여|벌레무리|벌레떼|벌레가많", "새순|어린잎|뒷면+벌레"]},
    "webbing": {"group": "해충 흔적", "label": "가는 거미줄", "keywords": ["거미줄"]},
    # 부위
    "base": {"group": "부위", "label": "밑동(땅 닿는 부분)", "keywords": ["밑동|밑둥|줄기밑|아랫줄기|땅가|흙가|지제부|뿌리근처|흙닿|흙에닿"]},
    "lower_leaf": {"group": "부위", "label": "아래쪽 잎부터", "keywords": ["아랫잎|아래잎|아래쪽잎|밑잎|아래쪽부터"]},
}

# ---------------------------------------------------------------------------
# 2) 병해충: 증상 조합 → 의심 병해충
#    symptoms : {증상 코드: 점수}  특징 증상 4점, 함께 나타나는 증상 1~3점
#    names    : 이용자가 병해충 이름을 직접 적은 경우 (증상 점수 5점으로 봄)
#    crops    : 자료에서 확인된 작물 (순위 +1)
#    env      : 잘 생기는 환경 (기록으로 확인되면 순위 +1, 관리 필요 판단 근거)
#    check    : 다른 후보와 구분하는 특징 (후보가 여럿일 때 안내)
# ---------------------------------------------------------------------------
NAME_SCORE = 5

PESTS = [
    {
        "code": "soft_rot", "name": "무름병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 무름병",
        "symptoms": {"soft": 3, "odor": 3, "rot": 2, "base": 1, "wilt": 1},
        "names": ["무름병"],
        "env": ["soil_high", "humidity_high"],
        "check": "물러진 부위에서 악취가 나면 무름병",
        "body": "밑동이나 상처에서 물에 젖은 듯한 병반이 생겨 커지고, 심하면 포기 전체가 물러 썩으며 악취가 나요. "
                "병든 포기는 완전히 뽑아 내고 사용한 도구는 깨끗이 소독하세요. "
                "병원균이 건조에 약하므로 배수와 통풍이 잘되게 해 주세요.",
        "action": "prune", "action_label": "병든 포기 정리했어요",
    },
    {
        "code": "gray_mold", "name": "잿빛곰팡이병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 잿빛곰팡이병",
        "symptoms": {"gray_mold": 4, "brown": 1, "soft": 1, "curl": 1, "rot": 1, "sclerotia": 1, "discolor": 1},
        "names": ["잿빛곰팡이병"],
        "env": ["humidity_high", "soil_high"],
        "check": "병든 부위에 잿빛 곰팡이가 빽빽하면 잿빛곰팡이병",
        "body": "연한 갈색의 물에 젖은 듯한 작은 병반이 빠르게 커지고, 병반에 잿빛 곰팡이가 빽빽이 생겨요"
                "(서늘하고 다습할 때, 20~25℃에서 잘 생겨요). 병든 잎은 보이는 즉시 떼어 내고, "
                "환기가 잘되게 하고 흙이 과습하지 않게 해 주세요. 너무 빽빽하게 심지 말고 질소 비료를 너무 많이 주지 마세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "cercospora", "name": "갈색무늬병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 갈색무늬병",
        "symptoms": {"ring_spot": 4, "brown": 1, "spot": 1, "lower_leaf": 1, "yellow": 1, "dieback": 1, "discolor": 1},
        "names": ["갈색무늬병"],
        "env": [],
        "check": "반점에 겹무늬가 있고 가운데가 눈동자처럼 회색이면 갈색무늬병",
        "body": "작은 반점이 암갈색 반점으로 커지고 겹무늬와 가운데 회색 눈동자 모양이 생겨요. "
                "아래쪽 잎부터 위로 번지고, 심하면 잎이 누렇게 말라 죽어요. 병든 잎은 일찍 떼어 내고 비료를 균형 있게 주세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "bottom_rot", "name": "밑둥썩음병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 밑둥썩음병",
        "symptoms": {"base": 2, "rot": 2, "brown": 1, "dieback": 1, "discolor": 1},
        "names": ["밑둥썩음병", "밑동썩음병"],
        "env": ["soil_high"],
        "check": "잎 밑동이 암갈색으로 썩으면 밑둥썩음병",
        "body": "잎 밑동이 암갈색으로 변해 썩고, 심하면 포기 전체가 말라 죽어요(습한 흙에서 잘 생겨요). "
                "병든 포기는 주변 흙과 함께 일찍 제거하고, 흙이 과습하지 않게 하며 질소 비료를 너무 많이 주지 마세요.",
        "action": "prune", "action_label": "병든 포기 정리했어요",
    },
    {
        "code": "sclerotinia", "name": "균핵병", "kind": "병해", "crops": ["lettuce"],
        "source": "농사로 상추 균핵병",
        "symptoms": {"sclerotia": 4, "white_mold": 2, "base": 1, "soft": 1, "rot": 1, "brown": 1},
        "names": ["균핵병"],
        "env": ["humidity_high", "temp_low"],
        "check": "썩은 부위에 흰 곰팡이실과 검은 알갱이(균핵)가 생기면 균핵병",
        "body": "밑동이 연한 갈색으로 물러 썩고 흰 곰팡이실이 자라며, 나중에 검은 알갱이(균핵)가 생겨요"
                "(습하고 15~25℃로 서늘할 때 심해요). 병든 포기는 주변 흙과 함께 일찍 뽑아 버리고, "
                "서늘하고 다습하지 않게 관리해 주세요. 흙 표면을 비닐 등으로 덮으면(멀칭) 발생을 줄일 수 있어요.",
        "action": "prune", "action_label": "병든 포기 정리했어요",
    },
    {
        "code": "powdery_mildew", "name": "흰가루병", "kind": "병해", "crops": ["lettuce", "basil"],
        "source": "농사로 상추 흰가루병 · 허브 병해 자료",
        "symptoms": {"white_powder": 4, "yellow": 1, "dieback": 1, "discolor": 1},
        "names": ["흰가루병"],
        "env": ["light_low"],
        "check": "잎 표면에 흰 가루가 덮이면 흰가루병",
        "body": "잎 표면에 흰 가루가 생겨 잎 전체로 퍼지고, 오래되면 회백색으로 변하며 잎이 말라 죽어요"
                "(15~28℃, 일조 부족, 큰 일교차, 비료 과다에서 잘 생겨요). 병든 잎과 떨어진 잎을 치우고, "
                "병든 식물은 떨어뜨려 두세요. 간격을 넓혀 통풍과 햇빛이 잘 들게 하고 질소 비료를 너무 많이 주지 마세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "downy_mildew", "name": "노균병", "kind": "병해", "crops": ["lettuce"],
        "source": "제공 자료 상추 노균병",
        "symptoms": {"underside_mold": 4, "yellow": 1, "spot": 1, "lower_leaf": 1, "brown": 1, "discolor": 1},
        "names": ["노균병"],
        "env": ["humidity_high", "temp_low", "soil_high"],
        "check": "잎 뒷면에 흰 곰팡이가 피어 있으면 노균병",
        "body": "잎에 연한 노란 반점이 생기고 잎 뒷면에 흰 곰팡이가 피어요(아래쪽 잎부터, 저온다습할 때 잘 생겨요). "
                "환기해서 습도를 낮추고, 물은 잎이 아닌 흙에 줘서 잎에 물방울이 오래 남지 않게 해 주세요. "
                "병든 잎은 빨리 떼어 내고 흙이 과습하지 않게 관리해 주세요.",
        "action": "prune", "action_label": "병든 잎 뗐어요",
    },
    {
        "code": "damping_off", "name": "모잘록병", "kind": "병해", "crops": ["lettuce", "basil", "other"],
        "source": "제공 자료 모종 쓰러짐",
        "symptoms": {"base": 2, "constriction": 2, "soft": 1, "collapse": 1},
        "names": ["모잘록병", "잘록병"],
        "env": ["soil_high", "humidity_high", "temp_low"],
        "check": "줄기 밑동이 물러지거나 잘록해졌으면 모잘록병",
        "body": "흙과 맞닿은 줄기 밑동이 물러지거나 잘록해지며 쓰러지는 병이에요. 의심되는 화분은 다른 식물과 바로 떨어뜨려 두세요. "
                "받침에 고인 물을 비우고, 물은 아침에 균일하게 주세요. 너무 빽빽하게 심지 않았는지, "
                "환기와 밤낮 온도 차를 확인하고, 사용한 용기는 흙을 씻어낸 뒤 소독하세요.",
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
            {"label": "물리적 상처", "keywords": ["상처|부러|꺾|건드|떨어뜨|부딪"], "symptoms": [], "facts": [],
             "tip": "옮기거나 만지다가 밑동이 상했을 수 있어요. 상처 부위를 확인해 주세요."},
        ],
        "body": "쓰러진 원인은 모잘록병, 빛 부족(웃자람), 수분 스트레스, 물리적 상처 등 여러 가지일 수 있어요. "
                "먼저 줄기 밑동이 물러지거나 잘록해졌는지 확인해 주세요.",
        "action": None,
    },
    {
        "code": "aphid", "name": "진딧물", "kind": "해충", "crops": ["lettuce"],
        "source": "제공 자료 상추 진딧물",
        "symptoms": {"small_insects": 4, "sticky": 3, "sooty": 2, "curl": 1},
        "names": ["진딧물", "진디"],
        "env": [],
        "check": "잎 뒷면·새순에 작은 벌레가 모여 있고 끈적하면 진딧물",
        "body": "작은 벌레가 잎 뒷면·어린잎에 모여 즙을 빨아 먹어 잎이 오그라들고 끈적한 감로가 생겨요. "
                "잎 뒷면과 새순을 자주 살펴보고, 초기에는 피해 잎을 떼어 내세요. "
                "방충망을 쓰거나 무당벌레·진디벌 같은 천적을 활용할 수 있어요.",
        "action": "prune", "action_label": "피해 잎 뗐어요",
    },
    {
        "code": "spider_mite", "name": "응애", "kind": "해충", "crops": ["basil"],
        "source": "제공 자료 허브 응애",
        "symptoms": {"webbing": 4, "speckle": 2, "yellow": 1, "dieback": 1, "discolor": 1},
        "names": ["응애"],
        "env": ["temp_high", "humidity_low"],
        "check": "잎 뒷면에 아주 작은 벌레와 가는 거미줄이 있으면 응애",
        "body": "잎 뒷면에 아주 작은 응애가 붙어 잎에 작은 흰·노란 점이 생기고, 많아지면 가는 거미줄이 생겨요"
                "(고온·건조할 때 잘 생겨요). 잎 뒷면을 자주 살펴보고, 초기에는 피해 잎을 떼어 내세요. "
                "식물 주변을 깨끗이 하고 건조한 환경이 계속되지 않게 해 주세요. 천적인 이리응애류를 활용할 수 있어요.",
        "action": "prune", "action_label": "피해 잎 뗐어요",
    },
    {
        "code": "leafminer", "name": "아메리카잎굴파리", "kind": "해충", "crops": ["lettuce"],
        "source": "농사로 상추 아메리카잎굴파리",
        "symptoms": {"tunnel": 4, "speckle": 1, "brown": 1, "dieback": 1, "spot": 1, "discolor": 1},
        "names": ["잎굴파리", "굴파리"],
        "env": [],
        "check": "잎 속에 구불구불한 흰 줄(굴)이 있으면 잎굴파리",
        "body": "애벌레가 잎 속을 파고 다녀 구불구불한 흰 줄이 생기고, 성충은 잎에 작은 반점을 남겨요. "
                "심하면 잎 전체가 갈색으로 말라 죽어요. 피해 잎은 떼어 내고, 방충망으로 성충이 들어오지 못하게 하세요. "
                "새로 심을 때는 피해 없는 건강한 모종을 쓰고, 노란 끈끈이 트랩으로 발생을 확인할 수 있어요.",
        "action": "prune", "action_label": "피해 잎 뗐어요",
    },
    {
        "code": "caterpillar", "name": "나방 애벌레(왕담배나방·담배거세미나방)", "kind": "해충", "crops": ["lettuce"],
        "source": "농사로 상추 왕담배나방 · 담배거세미나방",
        "symptoms": {"larva": 4, "holes": 2},
        "names": ["담배나방", "거세미", "나방"],
        "env": [],
        "check": "애벌레나 배설물이 보이면 나방 애벌레",
        "body": "애벌레가 잎과 새순을 갉아 먹어요. 많으면 줄기만 남기고 먹기도 해요. "
                "피해 잎을 살펴 애벌레를 손으로 잡아 없애세요. 애벌레가 어릴 때 없애야 효과가 커요. "
                "잎 위나 주변에 배설물이 있는지도 함께 확인해 주세요.",
        "action": "other", "action_label": "벌레 잡았어요",
    },
    {
        "code": "slug", "name": "달팽이류(명주달팽이·민달팽이)", "kind": "해충", "crops": ["lettuce"],
        "source": "농사로 상추 명주달팽이 · 작은뾰족민달팽이",
        "symptoms": {"snail": 4, "slime": 3, "holes": 1},
        "names": [],
        "env": ["humidity_high", "soil_high"],
        "check": "반짝이는 점액 자국이 있거나 밤에 달팽이가 보이면 달팽이류",
        "body": "잎을 갉아 먹고 반짝이는 점액 자국을 남겨요(습한 곳을 좋아하고 주로 밤에 활동해요). "
                "흙 표면과 식물 주변을 건조하고 깨끗하게 관리하고, 습하고 그늘진 은신처(화분 밑, 잎 사이, 밑동)를 "
                "살펴 손으로 잡아 없애세요.",
        "action": "other", "action_label": "달팽이 잡았어요",
    },
]

PESTS_BY_CODE = {p["code"]: p for p in PESTS}
_BOUNDARY = re.compile(r"[,.!?;:/\n·~()\[\]]")


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
    """특이 사항 글에서 증상을 찾습니다. (찾은 증상 {코드: 찾은 단어}, 부정으로 언급된 증상 코드 집합)"""
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
    for code in list(found):
        for covered in SYMPTOMS[code].get("covers", []):
            found.pop(covered, None)
    return found, negated - set(found)


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
    cleared = not found and not names and (
        bool(negated or neg_names) or keyword_state(normalize(text), CLEAR_WORDS)[0] == "pos")
    return {"symptoms": found, "names": names, "negated": negated, "cleared": cleared}


def pick_note(notes):
    """판단에 쓸 특이 사항 하나를 고릅니다(가장 최근에 증상을 적은 기록).
    더 최근 기록이 '이상 없음/회복'처럼 해결을 말하면 None."""
    for note in reversed(notes):
        info = read_note(note["text"])
        if info["symptoms"] or info["names"]:
            return {**note, **info}
        if info["cleared"]:
            return None
    return None


def rank(info, species, env_state, min_score=MIN_SCORE):
    """증상·이름 → 병해충 후보 목록(점수순). min_score=1 이면 '관련 있는 병해충' 전체."""
    found = info["symptoms"]
    cands = []
    for pest in PESTS:
        matched = {c: w for c, w in pest["symptoms"].items() if c in found}
        score = sum(matched.values())
        hits = [f"{SYMPTOMS[c]['label']}('{found[c]}')" for c in matched]
        if pest["code"] in info["names"]:
            score += NAME_SCORE
            hits.insert(0, f"이름 '{info['names'][pest['code']]}'")
        if score < min_score:
            continue
        env_hits = [e for e in pest["env"] if env_state.get(e)]
        crop = species in pest["crops"]
        cands.append({
            "pest": pest, "score": score, "matched": set(matched) | ({"name"} if pest["code"] in info["names"] else set()),
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


def public_rules():
    """설정 화면(읽기 전용)에 보여 줄 증상 키워드와 병해충 연결표."""
    return {
        "symptoms": [{
            "code": code, "group": s["group"], "label": s["label"],
            "keywords": [k.replace("|", " / ").replace("+", " + ") for k in s["keywords"]],
        } for code, s in SYMPTOMS.items()],
        "pests": [{
            "code": p["code"], "name": p["name"], "kind": p["kind"], "source": p["source"],
            "symptoms": [{"label": SYMPTOMS[c]["label"], "weight": w}
                         for c, w in sorted(p["symptoms"].items(), key=lambda x: -x[1])],
            "env": [ENV_LABELS[e] for e in p["env"]],
        } for p in PESTS],
        "rules": {"min_score": MIN_SCORE, "supported_score": SUPPORTED_SCORE, "care_score": CARE_SCORE},
    }
