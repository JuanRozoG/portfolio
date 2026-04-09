#!/usr/bin/env python3
"""
Seed MongoDB Atlas with the local JSON data files.
Run this ONCE before deploying to Vercel.

Usage:
    MONGO_URI="mongodb+srv://..." python3 data/seed_mongodb.py

The script uploads:
  data/site.json
  data/pages.json
  data/images.json
  data/navigation.json
  data/projects.json
"""

import json
import os
import sys
from pathlib import Path

MONGO_URI = os.environ.get("MONGO_URI", "")
if not MONGO_URI:
    print("ERROR: Set the MONGO_URI environment variable before running this script.")
    print("  Example: MONGO_URI='mongodb+srv://...' python3 data/seed_mongodb.py")
    sys.exit(1)

try:
    from pymongo import MongoClient
except ImportError:
    print("ERROR: pymongo not installed. Run: pip install pymongo")
    sys.exit(1)

DATA_DIR = Path(__file__).parent
FILES    = ["site.json", "pages.json", "images.json", "navigation.json", "projects.json"]

def main():
    print(f"Connecting to MongoDB...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db     = client["portfolio"]

    # Verify connection
    client.admin.command("ping")
    print("Connected.\n")

    for filename in FILES:
        path = DATA_DIR / filename
        if not path.exists():
            print(f"  SKIP  {filename} (file not found)")
            continue
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        result = db.data.replace_one(
            {"_id": filename},
            {"_id": filename, "data": data},
            upsert=True,
        )
        action = "inserted" if result.upserted_id else "updated"
        count  = len(data) if isinstance(data, list) else "object"
        print(f"  OK    {filename} — {action} ({count} items)")

    print("\nDone. Your MongoDB Atlas database is ready for Vercel deployment.")
    client.close()

if __name__ == "__main__":
    main()
