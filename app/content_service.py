import random
import json
from sqlmodel import Session, select, func
from .models import PageConfig, Image, FolderCaption, SwipeLinkUsage, SwipeLink

# --- Hàm _get_random_image_for_page (Đã fix ở bước trước, giữ nguyên) ---
def _get_random_image_for_page(session: Session, page_id: str):
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

    target_folder_id = random.choice(folder_list)
    image = session.exec(select(Image).where(Image.folder_id == target_folder_id).order_by(func.random()).limit(1)).first()
    
    if not image: return None, f"Folder {target_folder_id} không có ảnh"
    return image, None

# --- LOGIC MỚI CHO POST VÀ STORY ---

def generate_regular_post(session: Session, page_id: str):
    # 1. Lấy ảnh
    image, error = _get_random_image_for_page(session, page_id)
    if error: return {"error": error}

    # 2. Lấy Caption (Logic Mới: Lấy cục JSON ra rồi random Python)
    # Tìm dòng caption của folder đó
    caption_entry = session.get(FolderCaption, image.folder_id)
    
    selected_caption = ""
    if caption_entry and caption_entry.captions:
        # caption_entry.captions bây giờ là 1 List Python (nhờ SQLModel parse JSONB)
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
    # 1. Lấy ảnh
    image, error = _get_random_image_for_page(session, page_id)
    if error: return {"error": error}

    # 2. Lấy Link (Logic Mới: Sửa tên cột url -> link)
    statement = (
        select(SwipeLink)
        .join(SwipeLinkUsage)
        .where(SwipeLinkUsage.page_id == page_id)
        .where(SwipeLink.is_active == True) # Chỉ lấy link đang active
        .order_by(func.random())
        .limit(1)
    )
    link_obj = session.exec(statement).first()
    
    # Lấy cột .link thay vì .url
    final_link = link_obj.link if link_obj else None

    return {
        "type": "STORY",
        "page_id": page_id,
        "image_id": image.id,
        "image_url": f"http://localhost:3210/api/image/{image.id}",
        "swipe_link": final_link
    }