from sqlmodel import select, Session
from app.database import engine
from app.models import Image, Folder

def test_db():
    with Session(engine) as session:
        # Thử lấy 1 ảnh và xem folder của nó
        statement = select(Image).limit(1)
        image = session.exec(statement).first()
        
        if image:
            print(f"✅ Kết nối thành công!")
            print(f"Ảnh ID: {image.id}")
            print(f"Folder ID (Mới): {image.folder_id}")
            if image.folder:
                print(f"Thuộc Folder tên: {image.folder.name}")
            else:
                print("⚠️ Ảnh này chưa link được với bảng Folders (Kiểm tra lại dữ liệu folder)")
        else:
            print("Database kết nối được nhưng không có ảnh nào.")

if __name__ == "__main__":
    test_db()