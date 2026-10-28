import cv2
import numpy as np

import base64
from io import BytesIO

from flask import Flask, render_template, request


app = Flask(__name__)


# ==========================================
# 1. 식물 이미지 분석 클래스
# ==========================================

class PlantAnalyzer:

    def __init__(self, pixel_to_cm_ratio=0.05):
        self.pixel_to_cm_ratio = pixel_to_cm_ratio

        # HSV 기준 초록색 범위
        self.lower_green = np.array([30, 35, 35])
        self.upper_green = np.array([85, 255, 255])

    def process_image(self, image):

        if image is None:
            raise ValueError("이미지를 읽을 수 없습니다.")

        # 원본 이미지 크기
        image_height, image_width = image.shape[:2]

        # 원본 이미지 복사
        result_img = image.copy()

        # 1. 이미지 블러 처리
        blurred = cv2.GaussianBlur(
            image, (5, 5), 0
        )

        # 2. BGR -> HSV 변환
        hsv = cv2.cvtColor(
            blurred, cv2.COLOR_BGR2HSV
        )

        # 3. 초록색 영역 추출
        mask = cv2.inRange(
            hsv,
            self.lower_green,
            self.upper_green
        )

        # 4. 노이즈 제거 및 빈 공간 보정
        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (5, 5)
        )

        mask = cv2.morphologyEx(
            mask, cv2.MORPH_OPEN, kernel
        )

        mask = cv2.morphologyEx(
            mask, cv2.MORPH_CLOSE, kernel
        )

        # 5. 윤곽선 검출
        contours, _ = cv2.findContours(
            mask.copy(),
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        # 식물 영역을 찾지 못한 경우
        if not contours:
            raise ValueError(
                "초록색 영역을 찾지 못했습니다. "
                "다른 사진을 사용하거나 색상 범위를 조정해 주세요."
            )

        # 6. 가장 큰 윤곽선 선택
        main_contour = max(
            contours,
            key=cv2.contourArea
        )

        # 7. 윤곽선을 둘러싸는 사각형 계산
        x, y, w, h = cv2.boundingRect(
            main_contour
        )

        # 8. 측정값 계산
        metrics = {
            "height_px": int(h),
            "width_px": int(w),

            "height_cm": round(
                h * self.pixel_to_cm_ratio, 2
            ),

            "width_cm": round(
                w * self.pixel_to_cm_ratio, 2
            ),

            "projected_area_px": int(
                cv2.countNonZero(mask)
            ),

            "image_width_px": int(image_width),
            "image_height_px": int(image_height)
        }

        # 9. 검출 결과 표시
        cv2.rectangle(
            result_img,
            (x, y),
            (x + w, y + h),
            (0, 255, 0),
            2
        )

        cv2.drawContours(
            result_img,
            [main_contour],
            -1,
            (0, 0, 255),
            2
        )

        label = (
            f"H: {metrics['height_cm']} cm"
        )

        cv2.putText(
            result_img,
            label,
            (max(x, 5), max(y - 10, 25)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 0, 255),
            2
        )

        return metrics, result_img, mask


# ==========================================
# 2. 이미지 변환 함수
# ==========================================

def image_to_base64(image):

    # OpenCV BGR -> RGB
    image_rgb = cv2.cvtColor(
        image, cv2.COLOR_BGR2RGB
    )

    # RGB 이미지를 JPEG 형식으로 인코딩
    success, encoded_image = cv2.imencode(
        ".jpg",
        cv2.cvtColor(
            image_rgb, cv2.COLOR_RGB2BGR
        )
    )

    if not success:
        raise ValueError("결과 이미지 변환에 실패했습니다.")

    # Base64로 변환하여 HTML에 표시
    return base64.b64encode(
        encoded_image.tobytes()
    ).decode("utf-8")


def mask_to_base64(mask):

    success, encoded_image = cv2.imencode(
        ".png", mask
    )

    if not success:
        raise ValueError("마스크 이미지 변환에 실패했습니다.")

    return base64.b64encode(
        encoded_image.tobytes()
    ).decode("utf-8")


# ==========================================
# 3. 메인 페이지
# ==========================================

@app.route("/", methods=["GET", "POST"])
def index():

    metrics = None
    original_image = None
    result_image = None
    mask_image = None
    error_message = None

    plant_id = "Basil_01"
    pixel_ratio = 0.05

    if request.method == "POST":

        plant_id = request.form.get(
            "plant_id", "Basil_01"
        )

        try:
            pixel_ratio = float(
                request.form.get(
                    "pixel_ratio", "0.05"
                )
            )

            if pixel_ratio <= 0:
                raise ValueError(
                    "픽셀 환산 비율은 0보다 커야 합니다."
                )

            uploaded_file = request.files.get(
                "plant_image"
            )

            if (
                uploaded_file is None
                or uploaded_file.filename == ""
            ):
                raise ValueError(
                    "분석할 식물 사진을 선택해 주세요."
                )

            # 업로드 파일 읽기
            file_bytes = np.frombuffer(
                uploaded_file.read(),
                dtype=np.uint8
            )

            # OpenCV 이미지로 변환
            image = cv2.imdecode(
                file_bytes,
                cv2.IMREAD_COLOR
            )

            if image is None:
                raise ValueError(
                    "이미지를 읽을 수 없습니다. "
                    "JPG 또는 PNG 파일을 사용해 주세요."
                )

            # 이미지 분석
            analyzer = PlantAnalyzer(
                pixel_to_cm_ratio=pixel_ratio
            )

            metrics, processed_img, mask = (
                analyzer.process_image(image)
            )

            # HTML에 표시할 이미지 변환
            original_image = image_to_base64(
                image
            )

            result_image = image_to_base64(
                processed_img
            )

            mask_image = mask_to_base64(
                mask
            )

            # 이미지 크기와 측정값 일관성 검사
            if (
                metrics["width_px"]
                > metrics["image_width_px"]
            ):
                error_message = (
                    "측정 너비가 이미지 너비를 초과했습니다. "
                    "입력 이미지와 분석 과정을 확인해 주세요."
                )

        except Exception as e:
            error_message = str(e)

    return render_template(
        "index.html",
        metrics=metrics,
        original_image=original_image,
        result_image=result_image,
        mask_image=mask_image,
        error_message=error_message,
        plant_id=plant_id,
        pixel_ratio=pixel_ratio
    )


# ==========================================
# 4. 서버 실행
# ==========================================

if __name__ == "__main__":
    app.run(
        debug=True,
        host="127.0.0.1",
        port=5000
    )
