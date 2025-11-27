from sqlmodel import select
from app.database import engine, Session
from app.models import Folder
from app.sync_service import sync_images_in_folder
import time

def main():
    print("🚀 Bắt đầu đồng bộ TOÀN DIỆN (Sync & Cleanup)...")
    
    with Session(engine) as session:
        folders = session.exec(select(Folder)).all()
        total_folders = len(folders)
        
        total_upsert = 0
        total_delete = 0
        
        for index, folder in enumerate(folders):
            print(f"\n[{index + 1}/{total_folders}] Quét Folder: {folder.name}")
            
            try:
                upsert, delete = sync_images_in_folder(session, folder.id)
                print(f"   ✅ Cập nhật: {upsert} | 🗑️ Đã xóa: {delete}")
                
                total_upsert += upsert
                total_delete += delete
            except Exception as e:
                print(f"   ❌ Lỗi nghiêm trọng: {e}")
                
            time.sleep(0.5)

    print(f"\n✨ TỔNG KẾT: Cập nhật {total_upsert} ảnh | Dọn dẹp {total_delete} ảnh rác.")

if __name__ == "__main__":
    main()