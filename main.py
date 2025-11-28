# main.py
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel
from app.database import engine

# Import Routers
from app.api_analytics import router as analytics_router
from app.api_extension import router as extension_router
from app.api_dashboard import router as dashboard_router
from app.api_config import router as config_router

app = FastAPI(title="Ronin CMS V2")

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
    return {"status": "Ronin Backend Running 🚀"}

# Register Routers
app.include_router(analytics_router, prefix="/api", tags=["Analytics"])
app.include_router(extension_router, prefix="/api", tags=["Extension"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(config_router, prefix="/api/config", tags=["Config"])

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3210, reload=True)