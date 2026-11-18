"""Local OCR worker.

Runs entirely on this machine: no document leaves the host. PDFs with a real text layer
are read directly; scanned pages and images go through RapidOCR (PaddleOCR models on
ONNX Runtime). Every page comes back with a confidence score so the Go backend can
decide whether a scan is weak enough to re-read with Claude vision.

    uv run uvicorn app:app --port 8001
"""

from __future__ import annotations

import io
import os
import threading

import cv2
import numpy as np
import pypdfium2 as pdfium
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from rapidocr import RapidOCR
from rapidocr.utils.typings import LangRec, ModelType, OCRVersion

register_heif_opener()

# Detection: "server" finds every text region on dense pages such as invoice tables
# (about 2 s/page on a laptop CPU); "mobile" is about 4x faster and misses a little more.
OCR_DET = os.environ.get("OCR_DET", "server")
# Recognition defaults to the multilingual PP-OCRv6 model, which handles Latin-script
# languages including Polish, German and French diacritics. Set OCR_LANG to use a
# script-specific PP-OCRv5 model instead (e.g. cyrillic, eslav, arabic, korean, el).
OCR_LANG = os.environ.get("OCR_LANG", "")
RENDER_DPI = int(os.environ.get("OCR_RENDER_DPI", "200"))
MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "3000"))  # longest image side sent to OCR
MIN_TEXT_LAYER_CHARS = 40  # a PDF page with at least this much embedded text skips OCR
RETRY_BELOW = 0.90  # lines scoring under this are cropped and recognised a second time
WEAK_BELOW = 0.80  # lines still under this count as weak when reporting page quality

app = FastAPI(title="doc_doctor OCR worker")

_engine: RapidOCR | None = None
_engine_lock = threading.Lock()
# ONNX sessions and pdfium are not safe to share across threads; serialise the heavy work.
_work_lock = threading.Lock()


def engine() -> RapidOCR:
    global _engine
    with _engine_lock:
        if _engine is None:
            params = {
                "Global.log_level": "warning",
                "Det.ocr_version": OCRVersion.PPOCRV5,
                "Det.model_type": ModelType(OCR_DET),
            }
            if OCR_LANG:
                # Script-specific recognition models ship in the "mobile" size only.
                params |= {
                    "Rec.lang_type": LangRec(OCR_LANG),
                    "Rec.ocr_version": OCRVersion.PPOCRV5,
                    "Rec.model_type": ModelType.MOBILE,
                }
            _engine = RapidOCR(params=params)
        return _engine


def prepare(img: Image.Image) -> Image.Image:
    """Apply EXIF rotation, flatten to RGB and cap the size."""
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        background = Image.new("RGB", img.size, "white")
        rgba = img.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        img = background
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return img


def layout(boxes, txts, scores) -> tuple[str, float]:
    """Order detected text boxes into reading order and join them into lines.

    Boxes whose vertical centres fall within half a line height of each other are
    treated as one line and sorted left to right. Wide horizontal gaps become tabs so
    table columns stay distinguishable.
    """
    items = []
    for box, txt, score in zip(boxes, txts, scores):
        txt = txt.strip()
        if not txt:
            continue
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        items.append(
            {
                "x0": min(xs), "x1": max(xs), "cy": (min(ys) + max(ys)) / 2,
                "h": max(ys) - min(ys), "txt": txt, "score": float(score),
            }
        )
    if not items:
        return "", 0.0

    items.sort(key=lambda i: i["cy"])
    lines: list[list[dict]] = []
    for it in items:
        if lines:
            last = lines[-1]
            line_cy = sum(i["cy"] for i in last) / len(last)
            line_h = sum(i["h"] for i in last) / len(last)
            if abs(it["cy"] - line_cy) < 0.5 * max(line_h, it["h"]):
                last.append(it)
                continue
        lines.append([it])

    out = []
    for line in lines:
        line.sort(key=lambda i: i["x0"])
        parts = [line[0]["txt"]]
        for prev, cur in zip(line, line[1:]):
            gap = cur["x0"] - prev["x1"]
            parts.append("\t" if gap > 2.5 * max(prev["h"], 1) else " ")
            parts.append(cur["txt"])
        out.append("".join(parts))

    # Weight confidence by text length so one-character noise does not dominate.
    weight = sum(len(i["txt"]) for i in items)
    conf = sum(i["score"] * len(i["txt"]) for i in items) / weight
    return "\n".join(out), conf


def crop_line(img: np.ndarray, box) -> np.ndarray:
    """Cut one detected text line out of the page and straighten it."""
    quad = np.array(box, dtype=np.float32)
    w = int(max(np.linalg.norm(quad[0] - quad[1]), np.linalg.norm(quad[2] - quad[3])))
    h = int(max(np.linalg.norm(quad[0] - quad[3]), np.linalg.norm(quad[1] - quad[2])))
    target = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    matrix = cv2.getPerspectiveTransform(quad, target)
    return cv2.warpPerspective(img, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)


def ocr_image(img: Image.Image) -> tuple[str, float, float]:
    """Return (text, confidence, weak_ratio) for one page image."""
    page = np.asarray(prepare(img))
    # Flags are passed explicitly: RapidOCR remembers them between calls, and the
    # line re-read below switches detection off.
    result = engine()(page, use_det=True, use_cls=True, use_rec=True)
    if result is None or result.txts is None or len(result.txts) == 0:
        return "", 0.0, 0.0
    txts, scores = list(result.txts), [float(s) for s in result.scores]

    # The full pipeline occasionally garbles a clearly legible line (its orientation
    # classifier misfires on slightly skewed text). Re-reading just that line from a
    # straightened crop usually recovers it, so keep whichever reading scores higher.
    for i, score in enumerate(scores):
        if score >= RETRY_BELOW:
            continue
        line = crop_line(page, result.boxes[i])
        if line.shape[0] < 8 or line.shape[1] < 8:
            continue
        retry = engine()(line, use_det=False, use_cls=False, use_rec=True)
        if retry is not None and retry.txts and float(retry.scores[0]) > score:
            txts[i], scores[i] = retry.txts[0], float(retry.scores[0])

    text, conf = layout(result.boxes, txts, scores)
    total = sum(len(t.strip()) for t in txts) or 1
    weak = sum(len(t.strip()) for t, sc in zip(txts, scores) if sc < WEAK_BELOW)
    return text, conf, weak / total


def ocr_pdf(data: bytes) -> list[dict]:
    pages = []
    pdf = pdfium.PdfDocument(data)
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            textpage = page.get_textpage()
            embedded = textpage.get_text_bounded().strip()
            textpage.close()
            if len(embedded) >= MIN_TEXT_LAYER_CHARS:
                pages.append({"page_no": index + 1, "text": embedded, "confidence": 1.0, "weak_ratio": 0.0, "engine": "pdf-text"})
            else:
                image = page.render(scale=RENDER_DPI / 72).to_pil()
                text, conf, weak = ocr_image(image)
                pages.append({"page_no": index + 1, "text": text, "confidence": conf, "weak_ratio": weak, "engine": "rapidocr"})
            page.close()
    finally:
        pdf.close()
    return pages


def open_image(data: bytes) -> list[Image.Image]:
    """Open an image; multi-frame files (TIFF) yield one image per frame."""
    img = Image.open(io.BytesIO(data))
    frames = []
    for i in range(getattr(img, "n_frames", 1)):
        img.seek(i)
        frames.append(img.copy())
    return frames


@app.get("/health")
def health():
    return {"ok": True, "detector": OCR_DET, "lang": OCR_LANG or "multilingual"}


@app.post("/ocr")
def ocr(file: UploadFile = File(...)):
    data = file.file.read()
    if not data:
        raise HTTPException(400, "empty file")
    with _work_lock:
        try:
            if data[:5] == b"%PDF-":
                pages = ocr_pdf(data)
            else:
                pages = []
                for i, frame in enumerate(open_image(data)):
                    text, conf, weak = ocr_image(frame)
                    pages.append({"page_no": i + 1, "text": text, "confidence": conf, "weak_ratio": weak, "engine": "rapidocr"})
        except HTTPException:
            raise
        except Exception as exc:  # unreadable or corrupt input
            raise HTTPException(422, f"could not read file: {exc}") from exc

    engines = {p["engine"] for p in pages}
    weight = sum(max(len(p["text"]), 1) for p in pages) or 1
    confidence = sum(p["confidence"] * max(len(p["text"]), 1) for p in pages) / weight
    weak_ratio = sum(p["weak_ratio"] * max(len(p["text"]), 1) for p in pages) / weight
    return {
        "engine": engines.pop() if len(engines) == 1 else "mixed",
        "confidence": round(confidence, 4),
        # Share of the text that sits in lines the recogniser was unsure about.
        "weak_ratio": round(weak_ratio, 4),
        "pages": [
            {**p, "confidence": round(p["confidence"], 4), "weak_ratio": round(p["weak_ratio"], 4)} for p in pages
        ],
    }


@app.post("/convert")
def convert(file: UploadFile = File(...)):
    """Convert any supported image (HEIC, TIFF, BMP...) to JPEG for the Claude API."""
    try:
        img = prepare(open_image(file.file.read())[0])
    except Exception as exc:
        raise HTTPException(422, f"could not read image: {exc}") from exc
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return Response(buf.getvalue(), media_type="image/jpeg")


@app.post("/preview")
def preview(page: int = 1, file: UploadFile = File(...)):
    """Render one page of a PDF or image as a JPEG for on-screen viewing."""
    data = file.file.read()
    with _work_lock:
        try:
            if data[:5] == b"%PDF-":
                pdf = pdfium.PdfDocument(data)
                try:
                    if not 1 <= page <= len(pdf):
                        raise HTTPException(404, "no such page")
                    img = pdf[page - 1].render(scale=130 / 72).to_pil()
                finally:
                    pdf.close()
            else:
                frames = open_image(data)
                if not 1 <= page <= len(frames):
                    raise HTTPException(404, "no such page")
                img = frames[page - 1]
            img = prepare(img)
            img.thumbnail((1600, 1600), Image.LANCZOS)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, f"could not render page: {exc}") from exc
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return Response(buf.getvalue(), media_type="image/jpeg")
