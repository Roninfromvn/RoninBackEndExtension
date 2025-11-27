from sqlmodel import Session, select
from .models import PageConfig, Page, Folder
from typing import List, Dict, Any

# --- 1. Lấy cấu hình của 1 Page ---
def get_page_config(session: Session, page_id: str):
    config = session.get(PageConfig, page_id)
    if not config:
        page = session.get(Page, page_id)
        if not page:
             return None, "Page ID không tồn tại trong hệ thống Pages"
             
        # Cấu hình mặc định
        # SỬ DỤNG CÁC GIÁ TRỊ MẶC ĐỊNH TỪ MODEL VÀ SỬA ĐỔI CHO KHỚP
        config = PageConfig(
            page_id=page_id, 
            enabled=True, 
            folder_ids=[], # SQLModel tự chuyển [] thành JSON string
            schedule=[], 
            posts_per_slot=1,
            caption_by_folder={},
            default_caption=""
        )
        session.add(config)
        session.commit()
        session.refresh(config)
        
    return config, None

# --- 2. Cập nhật/Tạo mới cấu hình Page ---
def upsert_page_config(session: Session, page_config_data: Dict[str, Any]):
    config = session.get(PageConfig, page_config_data.get('page_id'))

    if config:
        for key, value in page_config_data.items():
            # Chỉ cập nhật các trường có trong model và không phải khóa chính
            if hasattr(config, key) and key not in ['page_id', 'created_at']:
                setattr(config, key, value)
    else:
        # Tên cột folder_ids, schedule, caption_by_folder là JSON nên FE phải gửi List/Dict
        config = PageConfig(**page_config_data)

    session.add(config)
    session.commit()
    session.refresh(config)
    return config

# --- 3. Lấy tất cả Page và Cấu hình (dùng cho danh sách quản lý) ---
def get_all_page_configs(session: Session):
    statement = select(Page, PageConfig).join(PageConfig, isouter=True)
    results = session.exec(statement).all()

    output = []
    for page, config in results:
        output.append({
            "page_id": page.page_id,
            "page_name": page.page_name,
            "avatar_url": page.avatar_url,
            "is_configured": config is not None,
            "config": config.model_dump() if config else None
        })
    return output

# --- 4. Lấy tất cả Folders (Dùng cho MultiSelect) ---
def get_all_folders(session: Session):
    statement = select(Folder)
    folders = session.exec(statement).all()
    
    return [
        {
            "id": f.id,
            "name": f.name,
            # Phân loại cho FE dễ hiển thị
            "type": "STORY" if f.name.upper().endswith("_STORY") else "POST" if f.name.upper().endswith("_POST") else "OTHER"
        } 
        for f in folders if f.name
    ]