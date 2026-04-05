"""Server-side face detection for proctoring via MediaPipe."""
from fastapi import APIRouter, UploadFile, File
import cv2
import numpy as np

router = APIRouter()

_detector = None

def _get_detector():
    global _detector
    if _detector is None:
        import mediapipe as mp
        _detector = mp.solutions.face_detection.FaceDetection(
            model_selection=0,          # 0 = short-range (< 2 m), ideal for webcam
            min_detection_confidence=0.5,
        )
    return _detector


@router.post("/detect")
async def detect_faces(file: UploadFile = File(...)):
    data = await file.read()
    arr  = np.frombuffer(data, np.uint8)
    img  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return {"faces": -1, "error": "Could not decode frame"}
    try:
        rgb     = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        results = _get_detector().process(rgb)
        n = len(results.detections) if results.detections else 0
        return {"faces": n}
    except Exception as e:
        return {"faces": -1, "error": str(e)}
