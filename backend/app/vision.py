from functools import lru_cache

from .config import get_settings


@lru_cache(maxsize=1)
def get_model():
    # Lazy loading keeps API startup fast. Ultralytics downloads yolo11n.pt on
    # first use when the default model path is used.
    try:
        from ultralytics import YOLO
    except ModuleNotFoundError as exc:
        raise RuntimeError("YOLO dependencies are not installed in this runtime") from exc

    return YOLO(get_settings().yolo_model_path)


def detect_objects(image_bytes: bytes) -> dict:
    try:
        import cv2
        import numpy as np
    except ModuleNotFoundError:
        return {
            "person_count": 0,
            "person_confidence": 0.0,
            "phone_detected": False,
            "phone_confidence": 0.0,
            "vision_available": False,
        }

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Invalid image")
    try:
        result = get_model().predict(image, classes=[0, 67], conf=0.35, imgsz=640, verbose=False)[0]
    except RuntimeError:
        return {
            "person_count": 0,
            "person_confidence": 0.0,
            "phone_detected": False,
            "phone_confidence": 0.0,
            "vision_available": False,
        }
    people: list[float] = []
    phones: list[float] = []
    for box in result.boxes:
        class_id = int(box.cls.item())
        confidence = float(box.conf.item())
        if class_id == 0:
            people.append(confidence)
        elif class_id == 67:
            phones.append(confidence)
    return {
        "person_count": len(people),
        "person_confidence": max(people, default=0.0),
        "phone_detected": bool(phones),
        "phone_confidence": max(phones, default=0.0),
        "vision_available": True,
    }
