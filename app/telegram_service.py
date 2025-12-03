# app/telegram_service.py
import os
import requests
import logging
from dotenv import load_dotenv

# Load config từ .env
load_dotenv()

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
logger = logging.getLogger(__name__)

def send_telegram_alert(message: str):
    """
    Gửi tin nhắn thông báo về Telegram.
    """
    if not TOKEN or not CHAT_ID:
        print("⚠️ Chưa cấu hình Telegram Bot (TOKEN hoặc CHAT_ID thiếu)")
        return

    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = {
        "chat_id": CHAT_ID,
        "text": message,
        "parse_mode": "HTML", # Cho phép in đậm, in nghiêng
        "disable_web_page_preview": True
    }

    try:
        # Timeout 5s để không làm treo server nếu mạng Telegram lag
        response = requests.post(url, json=payload, timeout=5)
        if response.status_code != 200:
            print(f"❌ Lỗi gửi Telegram: {response.text}")
        else:
            print(f"🔔 Đã bắn noti Telegram thành công.")
    except Exception as e:
        print(f"❌ Exception gửi Telegram: {e}")