# app/content_service.py
import random
import json
import os
from typing import List
from sqlmodel import Session, select, func
from .models import (
    PageConfig,
    Image,
    FolderCaption,
    SwipeLinkUsage,
    SwipeLink,
    Folder,
    Page,
)

# URL chính xác của server (Cloudflare Tunnel)
BASE_URL = os.getenv("BASE_URL", "https://api.roninfromvn.pp.ua")

# --- Hàm _get_random_image_for_page ---
def _get_random_image_for_page(session: Session, page_id: str, content_type: str):
    config = session.get(PageConfig, page_id)
    if not config: return None, "Page chưa có cấu hình"

    raw_data = config.folder_ids
    folder_list = []
    
    if isinstance(raw_data, list): folder_list = raw_data
    elif isinstance(raw_data, str):
        try: folder_list = json.loads(raw_data)
        except: return None, "Lỗi format JSON folder_ids"
    else: return None, "Lỗi data folder_ids"

    if not folder_list: return None, "List folder rỗng"

    required_suffix = f"_{content_type.upper()}"
    
    available_folders = session.exec(
        select(Folder)
        .where(Folder.id.in_(folder_list))
        .where(Folder.name.like(f"%{required_suffix}"))
    ).all()
    
    if not available_folders: 
        return None, f"Không tìm thấy Folder loại {required_suffix} nào trong cấu hình Page."

    target_folder_id = random.choice([f.id for f in available_folders])
    
    image = session.exec(select(Image).where(Image.folder_id == target_folder_id).order_by(func.random()).limit(1)).first()
    
    if not image: return None, f"Folder {target_folder_id} không có ảnh"
    return image, None

# --- LOGIC MỚI CHO POST VÀ STORY ---

def generate_regular_post(session: Session, page_id: str):
    image, error = _get_random_image_for_page(session, page_id, "POST")
    if error: return {"error": error}

    caption_entry = session.get(FolderCaption, image.folder_id)
    selected_caption = ""
    if caption_entry and caption_entry.captions:
        if isinstance(caption_entry.captions, list) and len(caption_entry.captions) > 0:
            selected_caption = random.choice(caption_entry.captions)

    return {
        "type": "POST",
        "page_id": page_id,
        "image_id": image.id,
        # [SỬA Ở ĐÂY] Dùng BASE_URL thay vì localhost
        "image_url": f"{BASE_URL}/api/image/{image.id}",
        "caption": selected_caption
    }

def generate_story_post(session: Session, page_id: str):
    image, error = _get_random_image_for_page(session, page_id, "STORY")
    if error: return {"error": error}

    statement = (
        select(SwipeLink)
        .join(SwipeLinkUsage)
        .where(SwipeLinkUsage.page_id == page_id)
        .where(SwipeLink.is_active == True)
        .order_by(func.random())
        .limit(1)
    )
    link_obj = session.exec(statement).first()
    final_link = link_obj.link if link_obj else None

    return {
        "type": "STORY",
        "page_id": page_id,
        "image_id": image.id,
        # [SỬA Ở ĐÂY] Dùng BASE_URL thay vì localhost
        "image_url": f"{BASE_URL}/api/image/{image.id}",
        "swipe_link": final_link
    }

# --- Hàm MỚI: Dùng cho Content Test/Preview ---
def generate_content_by_folder(session: Session, folder_id: str):
    image = session.exec(
        select(Image)
        .where(Image.folder_id == folder_id)
        .order_by(func.random())
        .limit(1)
    ).first()
    if not image:
        return {"error": f"Folder {folder_id} không có ảnh hoặc không tồn tại."}

    folder = session.get(Folder, folder_id)
    is_story = folder and folder.name and folder.name.upper().endswith("_STORY")
    content_type = "STORY" if is_story else "POST"

    selected_caption = ""
    final_link = None

    if content_type == "POST":
        caption_entry = session.get(FolderCaption, image.folder_id)
        if caption_entry and caption_entry.captions:
            selected_caption = random.choice(caption_entry.captions)
    else:
        final_link = "http://test-link.com/preview-story"

    return {
        "type": content_type,
        "page_id": "PREVIEW_MODE",
        "image_id": image.id,
        # [SỬA Ở ĐÂY]
        "image_url": f"{BASE_URL}/api/image/{image.id}",  # Sửa thành BASE_URL
        "caption": selected_caption,
        "swipe_link": final_link
    }


# --- API PHỤC VỤ CẤU HÌNH (New) ---
def get_all_folders(session: Session):
    statement = select(Folder).order_by(Folder.name)
    folders = session.exec(statement).all()

    result = []
    for folder in folders:
        name_upper = (folder.name or "").upper()
        if name_upper.endswith("_STORY"):
            ftype = "STORY"
        elif name_upper.endswith("_POST"):
            ftype = "POST"
        else:
            ftype = "OTHER"

        result.append({
            "id": folder.id,
            "name": folder.name,
            "type": ftype,
        })
    return result


def get_all_configs(session: Session):
    statement = select(PageConfig)
    configs = session.exec(statement).all()

    results = []
    for config in configs:
        folder_ids: List[str] = []
        if config.folder_ids:
            try:
                folder_ids = (
                    json.loads(config.folder_ids)
                    if isinstance(config.folder_ids, str)
                    else config.folder_ids
                )
            except Exception:
                folder_ids = []

        results.append(
            {
                "page_id": config.page_id,
                "config": {
                    "page_id": config.page_id,
                    # ĐÃ XÓA enabled
                    "folder_ids": folder_ids,
                    # ĐÃ XÓA schedule
                    # ĐÃ XÓA posts_per_slot
                    "page_scale": getattr(config, "page_scale", "SMALL"),
                    "has_recommendation": getattr(config, "has_recommendation", True),
                    "note": getattr(config, "note", None),
                },
            }
        )
    return results


def save_page_config(session: Session, data: dict):
    page_id = data.get("page_id")
    if not page_id:
        return {"error": "Thiếu page_id"}

    config = session.get(PageConfig, page_id)
    if not config:
        config = PageConfig(page_id=page_id)
        if not session.get(Page, page_id):
            session.add(Page(page_id=page_id, page_name="Unknown Page"))

    config.folder_ids = json.dumps(data.get("folder_ids", []))
    
    # ĐÃ XÓA CÁC DÒNG GÂY LỖI NÀY:
    # config.schedule = ...
    # config.enabled = ...
    # config.posts_per_slot = ...
    
    config.page_scale = data.get("page_scale", getattr(config, "page_scale", "SMALL"))
    config.has_recommendation = data.get(
        "has_recommendation", getattr(config, "has_recommendation", True)
    )
    config.note = data.get("note", getattr(config, "note", None))

    session.add(config)
    session.commit()
    session.refresh(config)

    return {"success": True, "page_id": page_id}


def test_content_generation(session: Session, folder_id: str):
    image = session.exec(
        select(Image)
        .where(Image.folder_id == folder_id)
        .order_by(func.random())
        .limit(1)
    ).first()

    if not image:
        return {"error": "Folder này không có ảnh nào!"}

    caption_entry = session.get(FolderCaption, folder_id)
    selected_caption = ""
    if (
        caption_entry
        and isinstance(caption_entry.captions, list)
        and len(caption_entry.captions) > 0
    ):
        selected_caption = random.choice(caption_entry.captions)

    return {
        "image_url": f"{BASE_URL}/api/image/{image.id}",
        "caption": selected_caption,
        "type": "POST",
    }
    