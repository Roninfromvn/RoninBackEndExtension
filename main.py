import json
import random
import os
from fastapi import FastAPI, Depends, HTTPException, Response, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select, func, SQLModel
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

# Import các module local
from app.database import get_session, engine
from app.content_service import generate_regular_post, generate_story_post
from app.drive_service import download_image_from_drive
from app.models import Page, PageConfig, Folder, Image, FolderCaption, PageHealth, PostMeta, PostMetric
from app.api_analytics import router as analytics_router


load_dotenv()
API_KEY = os.getenv("RONIN_API_KEY")
api_key_header = APIKeyHeader(name="X-Ronin-Key", auto_error=False)


async def verify_api_key(api_key_header: str = Security(api_key_header)):
    """Allow requests only when api key matches .env; skip check if unset."""
    if not API_KEY:
        return
    if api_key_header == API_KEY:
        return api_key_header
    raise HTTPException(status_code=403, detail="❌ Sai mật khẩu (API Key không khớp)")


app = FastAPI(title="Posting Content Server", dependencies=[Depends(verify_api_key)])

@app.on_event("startup")
def on_startup():
    print("🔄 Đang kiểm tra và cập nhật Schema Database...")
    SQLModel.metadata.create_all(engine)
    print(f"✅ Server đã sẵn sàng! (Chế độ bảo mật: {'BẬT' if API_KEY else 'TẮT'})")

# --- 1. CẤU HÌNH CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. ĐĂNG KÝ ROUTER ANALYTICS ---
# prefix="/api" nghĩa là tất cả API trong file kia sẽ tự động có đầu ngữ /api
# tags=["Analytics"] để gom nhóm đẹp mắt trong Swagger UI
app.include_router(analytics_router, prefix="/api", tags=["Analytics"])

# --- 3. INPUT SCHEMA ---
class ConfigInput(BaseModel):
    page_id: str
    enabled: bool = True 
    folder_ids: List[str]
    page_scale: str = "SMALL"
    has_recommendation: bool = True
    note: Optional[str] = None

@app.get("/")
def read_root():
    return {"status": "Server is running 🚀"}

# --- 4. API PROXY ẢNH ---
@app.get("/api/image/{file_id}")
def get_image_proxy(file_id: str):
    image_stream = download_image_from_drive(file_id)
    if not image_stream:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh trên Drive")
    
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

# --- 5. API LẤY NỘI DUNG ---
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

# --- 6. API GET CONFIG (ĐÃ SỬA LOGIC PARSE JSON MẠNH MẼ HƠN) ---
@app.get("/api/config/all")
def api_get_configs(session: Session = Depends(get_session)):
    configs = session.exec(select(PageConfig)).all()
    result = []
    
    for c in configs:
        f_ids = []
        try:
            raw = c.folder_ids
            if raw:
                # Trường hợp 1: Nó đã là List (do SQLModel tự convert)
                if isinstance(raw, list):
                    f_ids = raw
                # Trường hợp 2: Nó là String
                elif isinstance(raw, str):
                    # Fix lỗi sơ đẳng: Replace dấu nháy đơn thành nháy kép để đúng chuẩn JSON
                    clean_json = raw.replace("'", '"')
                    try:
                        f_ids = json.loads(clean_json)
                    except json.JSONDecodeError:
                        # Nếu vẫn lỗi thì thử parse thủ công hoặc bỏ qua
                        print(f"⚠️ Lỗi JSON data page {c.page_id}: {raw}")
                        f_ids = []
        except Exception as e:
            print(f"❌ Lỗi xử lý config page {c.page_id}: {e}")
            f_ids = []
        
        # [QUAN TRỌNG] Ép kiểu về string hết để khớp với ID của Folder
        f_ids = [str(x) for x in f_ids]

        result.append({
            "page_id": c.page_id,
            "config": {
                "page_id": c.page_id,
                "enabled": True, 
                "folder_ids": f_ids, # <--- Giờ chắc chắn là list string
                "page_scale": c.page_scale,
                "has_recommendation": c.has_recommendation,
                "note": c.note
            }
        })
    return result

@app.post("/api/config")
def api_save_config(data: ConfigInput, session: Session = Depends(get_session)):
    if not session.get(Page, data.page_id):
        session.add(Page(page_id=data.page_id, page_name="Unknown Page"))
        session.commit()

    existing_config = session.get(PageConfig, data.page_id)
    # Lưu dưới dạng chuẩn JSON (dấu nháy kép)
    folder_ids_str = json.dumps(data.folder_ids)

    if existing_config:
        existing_config.folder_ids = folder_ids_str
        existing_config.page_scale = data.page_scale
        existing_config.has_recommendation = data.has_recommendation
        existing_config.note = data.note
        # existing_config.enabled = data.enabled 
        session.add(existing_config)
    else:
        new_config = PageConfig(
            page_id=data.page_id,
            folder_ids=folder_ids_str,
            page_scale=data.page_scale,
            has_recommendation=data.has_recommendation,
            note=data.note,
            # enabled=data.enabled
        )
        session.add(new_config)

    session.commit()
    return {"message": "Lưu cấu hình thành công!", "page_id": data.page_id}

# --- 7. API LẤY DANH SÁCH FOLDER (ĐÃ FIX TYPE VÀ STRING ID) ---
@app.get("/api/folders/all")
def api_get_folders(session: Session = Depends(get_session)):
    folders = session.exec(select(Folder)).all()
    result = []
    
    for f in folders:
        f_type = "OTHER"
        clean_name = f.name
        upper_name = (f.name or "").upper()
        
        if upper_name.endswith("_POST"):
            f_type = "POST"
            clean_name = f.name[:-5]
        elif upper_name.endswith("_STORY"):
            f_type = "STORY"
            clean_name = f.name[:-6]
            
        clean_name = clean_name.replace("_", " ").strip()

        result.append({
            "id": str(f.id), # <--- QUAN TRỌNG: Ép kiểu string
            "name": clean_name,
            "original_name": f.name,
            "type": f_type
        })
        
    return result

# --- 8. API TEST CONTENT ---
@app.get("/api/test/content/{folder_id}")
def get_test_content_api(folder_id: str, session: Session = Depends(get_session)):
    image = session.exec(select(Image).where(Image.folder_id == folder_id).order_by(func.random()).limit(1)).first()
    
    if not image:
        return {"error": "Folder này chưa có ảnh nào được đồng bộ"}
        
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
    uvicorn.run("main:app", host="0.0.0.0", port=3210, reload=False)