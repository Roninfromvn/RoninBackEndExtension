# main.py
import uvicorn
import os  # Thêm import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles  # Thêm import StaticFiles
from sqlmodel import SQLModel
from app.database import engine
from fastapi import Depends


# Import Routers
from app.api_analytics import router as analytics_router
from app.api_extension import router as extension_router
from app.api_dashboard import router as dashboard_router
from app.api_config import router as config_router
from app.api_links import router as links_router
from app.api_pages import router as pages_router
from app.api_overview import router as overview_router
from app.api_stats import router as stats_router
from app.auth import verify_api_key

app = FastAPI(title="Ronin CMS V2")

# Tạo thư mục chứa ảnh nếu chưa có
os.makedirs("static_images", exist_ok=True)

# Mount thư mục static_images ra đường dẫn /static
# Ví dụ: file tại "static_images/123/abc.jpg" sẽ truy cập được qua "http://.../static/123/abc.jpg"
app.mount("/static", StaticFiles(directory="static_images"), name="static")

@app.on_event("startup")
def on_startup():
    print("🔄 Checking DB Schema...")
    SQLModel.metadata.create_all(engine)
    print("✅ Database Ready!")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Địt con mẹ cả nhà thằng Pháp Lê"}


# Register Routers
app.include_router(analytics_router, prefix="/api", tags=["Analytics"], dependencies=[Depends(verify_api_key)])
app.include_router(extension_router, prefix="/api", tags=["Extension"], dependencies=[Depends(verify_api_key)])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"], dependencies=[Depends(verify_api_key)])
app.include_router(config_router, prefix="/api/config", tags=["Config"], dependencies=[Depends(verify_api_key)])
app.include_router(links_router, prefix="/api/links", tags=["Links"], dependencies=[Depends(verify_api_key)])
app.include_router(pages_router, prefix="/api/pages", tags=["Pages"], dependencies=[Depends(verify_api_key)])
app.include_router(overview_router, prefix="/api/overview", tags=["Overview"], dependencies=[Depends(verify_api_key)])
app.include_router(stats_router, prefix="/api/stats", tags=["Stats"], dependencies=[Depends(verify_api_key)])


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3210, reload=True)