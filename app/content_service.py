import random
import json
from typing import List
from sqlmodel import Session, select, func
# [ĐÃ SỬA] Import thêm Folder để có thể truy vấn tên folder
from .models import (
    PageConfig,
    Image,
    FolderCaption,
    SwipeLinkUsage,
    SwipeLink,
    Folder,
    Page,
)

# --- Hàm _get_random_image_for_page (Đã sửa đổi) ---
# [ĐÃ SỬA] Thêm tham số content_type
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

    # --- [LOGIC MỚI] Lọc Folder theo loại POST/STORY ---
    required_suffix = f"_{content_type.upper()}" # Tạo hậu tố cần tìm: _POST hoặc _STORY
    
    # 1. Truy vấn các Folder có ID nằm trong danh sách của page VÀ tên kết thúc bằng hậu tố
    available_folders = session.exec(
        select(Folder)
        .where(Folder.id.in_(folder_list))
        .where(Folder.name.like(f"%{required_suffix}"))
    ).all()
    
    # 2. Kiểm tra kết quả lọc
    if not available_folders: 
        return None, f"Không tìm thấy Folder loại {required_suffix} nào trong cấu hình Page."

    # 3. Chọn ngẫu nhiên một folder từ danh sách đã lọc
    target_folder_id = random.choice([f.id for f in available_folders])
    # --- [KẾT THÚC LOGIC MỚI] ---
    
    # 4. Lấy ảnh ngẫu nhiên từ folder đã chọn
    image = session.exec(select(Image).where(Image.folder_id == target_folder_id).order_by(func.random()).limit(1)).first()
    
    if not image: return None, f"Folder {target_folder_id} không có ảnh"
    return image, None

# --- LOGIC MỚI CHO POST VÀ STORY ---

def generate_regular_post(session: Session, page_id: str):
    # [ĐÃ SỬA] Truyền 'POST' vào hàm helper
    image, error = _get_random_image_for_page(session, page_id, "POST")
    if error: return {"error": error}

    # 2. Lấy Caption (Giữ nguyên logic cũ)
    caption_entry = session.get(FolderCaption, image.folder_id)
    
    selected_caption = ""
    if caption_entry and caption_entry.captions:
        if isinstance(caption_entry.captions, list) and len(caption_entry.captions) > 0:
            selected_caption = random.choice(caption_entry.captions)

    return {
        "type": "POST",
        "page_id": page_id,
        "image_id": image.id,
        "image_url": f"http://localhost:3210/api/image/{image.id}",
        "caption": selected_caption
    }

def generate_story_post(session: Session, page_id: str):
    # [ĐÃ SỬA] Truyền 'STORY' vào hàm helper
    image, error = _get_random_image_for_page(session, page_id, "STORY")
    if error: return {"error": error}

    # 2. Lấy Link (Giữ nguyên logic cũ)
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
        "image_url": f"http://localhost:3210/api/image/{image.id}",
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
        "image_url": f"http://localhost:3210/api/image/{image.id}",
        "caption": selected_caption,
        "swipe_link": final_link
    }


# --- API PHỤC VỤ CẤU HÌNH (New) ---
def get_all_folders(session: Session):
    statement = select(Folder).order_by(Folder.name)
    folders = session.exec(statement).all()

    result = []
    for folder in folders:
        # Logic chuẩn: Dựa vào hậu tố _STORY để phân loại
        name_upper = (folder.name or "").upper()
        if name_upper.endswith("_STORY"):
            ftype = "STORY"
        elif name_upper.endswith("_POST"):
            ftype = "POST"
        else:
            ftype = "OTHER" # Hoặc mặc định là POST tùy bạn

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
                    "enabled": config.enabled,
                    "folder_ids": folder_ids,
                    "schedule": config.schedule or [],
                    "posts_per_slot": config.posts_per_slot,
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
    config.schedule = data.get("schedule", [])
    config.enabled = data.get("enabled", True)
    config.posts_per_slot = data.get("posts_per_slot", 1)

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
        "image_url": f"http://localhost:3210/api/image/{image.id}",
        "caption": selected_caption,
        "type": "POST",
    }