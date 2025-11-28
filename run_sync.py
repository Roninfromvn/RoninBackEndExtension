# run_sync.py
from sqlmodel import Session
from app.database import engine
from app.sync_service import sync_all_folders

def main():
    # Tạo session kết nối DB
    with Session(engine) as session:
        # Gọi hàm sync toàn bộ (đã bao gồm logic lặp, nghỉ, và in log)
        sync_all_folders(session)

if __name__ == "__main__":
    main()