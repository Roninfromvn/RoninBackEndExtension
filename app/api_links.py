# app/api_links.py
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List

from app.database import get_session
from app.models import SwipeLink  # Bỏ SwipeLinkUsage, Page vì không dùng nữa

router = APIRouter()

# Input đơn giản hơn (Bỏ page_ids)
class LinkInput(BaseModel):
    url: str
    title: str = "Xem thêm"


class LinkOutput(BaseModel):
    id: str
    link: str
    title: str
    is_active: bool


@router.get("/", response_model=List[LinkOutput])
def get_links(session: Session = Depends(get_session)):
    """Lấy danh sách Link trong kho"""
    links = session.exec(select(SwipeLink)).all()
    results = []
    for link in links:
        results.append({
            "id": link.id,
            "link": link.link,
            "title": link.title or "Xem thêm",
            "is_active": link.is_active
        })
    return results


@router.post("/")
def create_link(data: LinkInput, session: Session = Depends(get_session)):
    """Thêm Link mới vào kho chung"""
    new_link = SwipeLink(
        id=str(uuid.uuid4()),
        link=data.url,
        title=data.title,
        is_active=True
    )
    session.add(new_link)
    session.commit()
    return {"status": "success", "id": new_link.id}


@router.delete("/{link_id}")
def delete_link(link_id: str, session: Session = Depends(get_session)):
    """Xóa link khỏi kho"""
    link = session.get(SwipeLink, link_id)
    if not link:
        raise HTTPException(404, "Link not found")
        
    session.delete(link)
    session.commit()
    return {"status": "success"}


@router.post("/{link_id}/toggle")
def toggle_link(link_id: str, session: Session = Depends(get_session)):
    """Bật/Tắt link"""
    link = session.get(SwipeLink, link_id)
    if not link: raise HTTPException(404, "Link not found")
    
    link.is_active = not link.is_active
    session.add(link)
    session.commit()
    return {"status": "success", "is_active": link.is_active}

