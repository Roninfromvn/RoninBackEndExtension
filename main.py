import json
from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware 
from sqlmodel import Session
from app.database import get_session
from app.content_service import (
    generate_regular_post,
    generate_story_post,
    get_all_folders,
    get_all_configs,
    test_content_generation,
)
from app.drive_service import download_image_from_drive 
from app.models import Page, PageConfig
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="Posting Content Server")


class ConfigInput(BaseModel):
    page_id: str
    enabled: bool = True
    folder_ids: List[str]
    schedule: List[str] = []
    posts_per_slot: int = 1
    page_scale: str = "SMALL"
    has_recommendation: bool = True
    note: Optional[str] = None

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
def api_save_config(data: ConfigInput, session: Session = Depends(get_session)):
    existing_config = session.get(PageConfig, data.page_id)

    if not session.get(Page, data.page_id):
        session.add(Page(page_id=data.page_id, page_name="Unknown Page"))

    folder_ids_str = json.dumps(data.folder_ids)

    if existing_config:
        existing_config.folder_ids = folder_ids_str
        existing_config.enabled = data.enabled
        existing_config.schedule = data.schedule
        existing_config.posts_per_slot = data.posts_per_slot
        existing_config.page_scale = data.page_scale
        existing_config.has_recommendation = data.has_recommendation
        existing_config.note = data.note
        session.add(existing_config)
    else:
        new_config = PageConfig(
            page_id=data.page_id,
            folder_ids=folder_ids_str,
            enabled=data.enabled,
            schedule=data.schedule,
            posts_per_slot=data.posts_per_slot,
            page_scale=data.page_scale,
            has_recommendation=data.has_recommendation,
            note=data.note,
        )
        session.add(new_config)

    session.commit()
    return {"message": "Lưu cấu hình thành công!", "page_id": data.page_id}


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