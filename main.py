from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware 
from sqlmodel import Session
from app.database import get_session
from app.content_service import generate_regular_post, generate_story_post
from app.drive_service import download_image_from_drive 

app = FastAPI(title="Posting Content Server")

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3210, reload=True)