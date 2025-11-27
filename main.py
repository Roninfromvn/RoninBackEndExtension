import json
import random
from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select, func
from pydantic import BaseModel
from typing import List, Optional

# Import các module local
from app.database import get_session
from app.content_service import generate_regular_post, generate_story_post
from app.drive_service import download_image_from_drive
from app.models import Page, PageConfig, Folder, Image, FolderCaption

app = FastAPI(title="Posting Content Server")

# --- 1. CẤU HÌNH CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. INPUT SCHEMA (Đã bỏ schedule, posts_per_slot) ---
class ConfigInput(BaseModel):
    page_id: str
    enabled: bool = True # Frontend vẫn gửi lên, nhưng backend sẽ tạm lờ đi nếu chưa có cột DB
    folder_ids: List[str]
    # Các trường mới
    page_scale: str = "SMALL"
    has_recommendation: bool = True
    note: Optional[str] = None

@app.get("/")
def read_root():
    return {"status": "Server is running 🚀"}

# --- 3. API PROXY ẢNH (Logic thông minh) ---
@app.get("/api/image/{file_id}")
def get_image_proxy(file_id: str):
    image_stream = download_image_from_drive(file_id)
    
    if not image_stream:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh trên Drive")
    
    # Đọc magic bytes để đoán định dạng
    header = image_stream.read(4)
    image_stream.seek(0)
    
    mime_type = "image/jpeg"
    if header.startswith(b'\x89PNG'):
        mime_type = "image/png"
    elif header.startswith(b'GIF8'):
        mime_type = "image/gif"
    elif header.startswith(b'RIFF') and b'WEBP' in image_stream.read(12):
        image_stream.seek(0)
        mime_type = "image/webp"
    else:
        image_stream.seek(0)

    return Response(content=image_stream.read(), media_type=mime_type)

# --- 4. API LẤY NỘI DUNG (POST/STORY) ---
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

# --- 5. QUẢN LÝ CONFIG (Đã sửa khớp DB mới) ---
@app.get("/api/config/all")
def api_get_configs(session: Session = Depends(get_session)):
    # Lấy tất cả config
    configs = session.exec(select(PageConfig)).all()
    result = []
    for c in configs:
        f_ids = []
        try:
            if c.folder_ids:
                f_ids = json.loads(c.folder_ids)
        except: pass
        
        result.append({
            "page_id": c.page_id,
            "config": {
                "page_id": c.page_id,
                "enabled": True, # Tạm để True vì DB chưa có cột enabled
                "folder_ids": f_ids,
                "page_scale": c.page_scale,
                "has_recommendation": c.has_recommendation,
                "note": c.note
            }
        })
    return result

@app.post("/api/config")
def api_save_config(data: ConfigInput, session: Session = Depends(get_session)):
    # Tạo Page ảo nếu chưa có để tránh lỗi khóa ngoại
    if not session.get(Page, data.page_id):
        session.add(Page(page_id=data.page_id, page_name="Unknown Page"))
        session.commit()

    existing_config = session.get(PageConfig, data.page_id)
    folder_ids_str = json.dumps(data.folder_ids)

    if existing_config:
        existing_config.folder_ids = folder_ids_str
        existing_config.page_scale = data.page_scale
        existing_config.has_recommendation = data.has_recommendation
        existing_config.note = data.note
        # existing_config.enabled = data.enabled  <-- Bỏ comment nếu DB đã có cột enabled
        session.add(existing_config)
    else:
        new_config = PageConfig(
            page_id=data.page_id,
            folder_ids=folder_ids_str,
            page_scale=data.page_scale,
            has_recommendation=data.has_recommendation,
            note=data.note,
            # enabled=data.enabled <-- Bỏ comment nếu DB đã có cột enabled
        )
        session.add(new_config)

    session.commit()
    return {"message": "Lưu cấu hình thành công!", "page_id": data.page_id}

# --- 6. API LẤY DANH SÁCH FOLDER (Mới thêm) ---
@app.get("/api/folders/all")
def api_get_folders(session: Session = Depends(get_session)):
    folders = session.exec(select(Folder)).all()
    result = []
    
    for f in folders:
        # Logic phân loại và làm sạch tên
        f_type = "OTHER"
        clean_name = f.name
        
        # Kiểm tra đuôi để phân loại (Case insensitive)
        upper_name = f.name.upper()
        
        if upper_name.endswith("_POST"):
            f_type = "POST"
            clean_name = f.name[:-5] # Cắt bỏ 5 ký tự cuối (_POST)
        elif upper_name.endswith("_STORY"):
            f_type = "STORY"
            clean_name = f.name[:-6] # Cắt bỏ 6 ký tự cuối (_STORY)
            
        # Làm đẹp tên: Thay dấu gạch dưới còn lại bằng khoảng trắng
        clean_name = clean_name.replace("_", " ").strip()

        result.append({
            "id": f.id,
            "name": clean_name, # Tên hiển thị (đã sạch)
            "original_name": f.name, # Tên gốc (để debug nếu cần)
            "type": f_type # Loại folder để Frontend lọc
        })
        
    return result

# --- 7. API TEST CONTENT (Mới thêm) ---
@app.get("/api/test/content/{folder_id}")
def get_test_content_api(folder_id: str, session: Session = Depends(get_session)):
    # 1. Random ảnh
    image = session.exec(select(Image).where(Image.folder_id == folder_id).order_by(func.random()).limit(1)).first()
    
    if not image:
        return {"error": "Folder này chưa có ảnh nào được đồng bộ"}
        
    # 2. Random caption
    caption_entry = session.get(FolderCaption, folder_id)
    selected_caption = ""
    if caption_entry and caption_entry.captions:
        if isinstance(caption_entry.captions, list) and len(caption_entry.captions) > 0:
            selected_caption = random.choice(caption_entry.captions)
            
    return {
        "type": "TEST",
        "image_url": f"http://localhost:3210/api/image/{image.id}",
        "caption": selected_caption
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3210, reload=True)