from fastapi import FastAPI, Depends, HTTPException, Response
from sqlmodel import Session
from app.database import get_session
from app.content_service import generate_regular_post, generate_story_post
# Import thêm cái này
from app.drive_service import download_image_from_drive 

app = FastAPI(title="Posting Content Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Cho phép tất cả nguồn (Extension, Browser...)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "Server is running 🚀"}

# --- API MỚI: PROXY ẢNH ---
@app.get("/api/image/{file_id}")
def get_image_proxy(file_id: str):
    # 1. Tải ảnh từ Drive (qua RAM server)
    image_stream = download_image_from_drive(file_id)
    
    if not image_stream:
        # Nếu lỗi thì trả về ảnh rỗng hoặc 404
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh trên Drive")
    
    # 2. Trả về dạng luồng dữ liệu (Stream)
    # Mặc định là image/jpeg, nếu kỹ tính có thể lưu mime_type trong DB để trả đúng
    return Response(content=image_stream.read(), media_type="image/jpeg")

# --- CÁC API CŨ ---
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