from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware 
from sqlmodel import Session
from app.database import get_session
from app.content_service import (
    generate_regular_post,
    generate_story_post,
    get_all_folders,
    get_all_configs,
    save_page_config,
    test_content_generation,
)
from app.drive_service import download_image_from_drive 
from pydantic import BaseModel
from typing import Any, List

app = FastAPI(title="Posting Content Server")


class ConfigPayload(BaseModel):
    page_id: str
    enabled: bool = True
    folder_ids: List[str] = []
    schedule: List[str] = []
    posts_per_slot: int = 1
    caption_by_folder: Any = {}
    default_caption: str = ""

# --- CẤU HÌNH CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "Server is running 🚀"}

# --- [QUAN TRỌNG] API PROXY ẢNH ĐÃ SỬA ---
@app.get("/api/image/{file_id}")
def get_image_proxy(file_id: str):
    image_stream = download_image_from_drive(file_id)
    
    if not image_stream:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh trên Drive")
    
    # --- BẮT ĐẦU ĐOẠN LOGIC MỚI ---
    # Đọc 4 bytes đầu để đoán định dạng thật của ảnh
    header = image_stream.read(4)
    image_stream.seek(0) # Tua lại về đầu file để đọc lại từ đầu
    
    mime_type = "image/jpeg" # Mặc định là JPG
    
    # Kiểm tra các chữ ký file (Magic Numbers)
    if header.startswith(b'\x89PNG'):
        mime_type = "image/png"
    elif header.startswith(b'GIF8'):
        mime_type = "image/gif"
    elif header.startswith(b'RIFF') and b'WEBP' in image_stream.read(12):
        image_stream.seek(0)
        mime_type = "image/webp"
    else:
        image_stream.seek(0) # Reset nếu không khớp logic trên
    # ------------------------------

    # Trả về với mime_type ĐÚNG thay vì ép cứng
    return Response(content=image_stream.read(), media_type=mime_type)

# --- CÁC API KHÁC GIỮ NGUYÊN ---
@app.get("/api/post/{page_id}")
def get_post_content(page_id: str, session: Session = Depends(get_session)):
    result = generate_regular_post(session, page_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.get("/api/story/{page_id}")
def get_story_content(page_id: str, session: Session = Depends(get_session)):
    result = generate_story_post(session, page_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.get("/api/config/all")
def api_get_configs(session: Session = Depends(get_session)):
    return get_all_configs(session)


@app.post("/api/config")
def api_save_config(payload: ConfigPayload, session: Session = Depends(get_session)):
    return save_page_config(session, payload.dict())


@app.get("/api/folders/all")
def api_get_folders(session: Session = Depends(get_session)):
    return get_all_folders(session)


# --- API MỚI: TEST CONTENT LINH ĐỘNG ---
@app.get("/api/test/content/{folder_id}")
def get_test_content_api(folder_id: str, session: Session = Depends(get_session)):
    result = test_content_generation(session, folder_id)
    if "error" in result:
        return result
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3210, reload=True)