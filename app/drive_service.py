import os
import io
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from dotenv import load_dotenv

load_dotenv()

def get_drive_service():
    # 1. Tái tạo lại credential dict từ file .env
    private_key = os.getenv("GOOGLE_PRIVATE_KEY")
    if private_key:
        # Fix lỗi xuống dòng trong file .env
        private_key = private_key.replace('\\n', '\n')

    creds_info = {
        "type": "service_account",
        "project_id": os.getenv("GOOGLE_CLOUD_PROJECT"),
        "private_key": private_key,
        "client_email": os.getenv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
        "client_id": os.getenv("GOOGLE_CLIENT_ID"),
        "token_uri": "https://oauth2.googleapis.com/token",
    }

    creds = service_account.Credentials.from_service_account_info(
        creds_info, 
        scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    
    return build('drive', 'v3', credentials=creds)

def download_image_from_drive(file_id: str):
    """
    Hàm này trả về binary data của ảnh để stream ra API
    """
    try:
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        
        file_stream = io.BytesIO()
        downloader = MediaIoBaseDownload(file_stream, request)
        
        done = False
        while done is False:
            status, done = downloader.next_chunk()
            
        file_stream.seek(0) # Tua lại đầu file để đọc
        return file_stream
    except Exception as e:
        print(f"Lỗi tải ảnh từ Drive: {e}")
        return None