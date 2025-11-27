import io
import os
from google.oauth2 import service_account
from googleapiclient.discovery import build

def get_drive_service():
    # Đường dẫn đến file JSON bạn vừa tạo
    # (Lưu ý: Nếu chạy từ thư mục gốc backend_refactor thì đường dẫn là service_account.json)
    SERVICE_ACCOUNT_FILE = 'service_account.json'
    
    # Kiểm tra file có tồn tại không để tránh lỗi khó hiểu
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise FileNotFoundError(f"Không tìm thấy file {SERVICE_ACCOUNT_FILE}. Hãy tạo nó ngay!")

    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, 
        scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    
    return build('drive', 'v3', credentials=creds)

def download_image_from_drive(file_id: str):
    try:
        service = get_drive_service()
        
        # Tải nội dung ảnh
        file_content = service.files().get_media(fileId=file_id).execute()
        
        return io.BytesIO(file_content)
        
    except Exception as e:
        print(f"Lỗi tải ảnh từ Drive (ID: {file_id}): {e}")
        return None