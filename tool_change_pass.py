import requests
import getpass
import sys

API_URL = "http://localhost:3210/api"

def main():
    print("=== RONIN CHANGE PASSWORD TOOL ===")
    
    # 1. Login
    username = input("Username: ")
    password = getpass.getpass("Current Password: ")
    
    try:
        print("Logging in...")
        res = requests.post(f"{API_URL}/auth/login", json={
            "username": username,
            "password": password
        })
        
        if not res.ok:
            print(f"❌ Login failed: {res.text}")
            return
            
        data = res.json()
        token = data["token"]
        print(f"✅ Login success! (User ID: {data['user']['id']})")
        print("-" * 30)
        
    except Exception as e:
        print(f"❌ Connection error: {e}")
        print("Make sure backend is running at http://localhost:3210")
        return

    # 2. Change Password
    while True:
        new_pass = getpass.getpass("Enter NEW Password: ")
        confirm_pass = getpass.getpass("Confirm NEW Password: ")
        
        if new_pass != confirm_pass:
            print("❌ Passwords do not match. Try again.")
            continue
        
        if not new_pass:
            print("❌ Password cannot be empty.")
            continue
            
        break
    
    try:
        print("Updating password...")
        res = requests.post(
            f"{API_URL}/auth/change-password",
            json={
                "old_password": password,
                "new_password": new_pass
            },
            headers={
                "Authorization": f"Bearer {token}"
            }
        )
        
        if res.ok:
            print("✅ PASSWORD UPDATED SUCCESSFULLY!")
            print("Please logout and login with your new password.")
        else:
            print(f"❌ Failed to update password: {res.text}")
            
    except Exception as e:
        print(f"❌ Error calling API: {e}")

if __name__ == "__main__":
    main()
