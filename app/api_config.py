# app/api_config.py
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Optional
from app.database import get_session
from app.models import Folder
from app.content_service import save_page_config, get_all_configs, test_content_generation

router = APIRouter()

class PageConfigInput(BaseModel):
    page_id: str
    folder_ids: List[str]
    page_scale: str = "SMALL"
    has_recommendation: bool = True
    note: Optional[str] = None

@router.get("/all")
def api_get_configs(session: Session = Depends(get_session)):
    return get_all_configs(session)

@router.post("/")
def api_save_config(data: PageConfigInput, session: Session = Depends(get_session)):
    return save_page_config(session, data.dict())

@router.get("/folders/simple")
def api_get_folders_simple(session: Session = Depends(get_session)):
    folders = session.exec(select(Folder).order_by(Folder.name)).all()
    return [{"id": f.id, "name": f.name} for f in folders]

@router.get("/test/content/{folder_id}")
def api_test(folder_id: str, session: Session = Depends(get_session)):
    return test_content_generation(session, folder_id)