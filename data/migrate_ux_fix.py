#!/usr/bin/env python3
"""
One-off data migration for the UX fix (idempotent — safe to run twice).

Runs against the same store as server.py:
  local files:  python3 data/migrate_ux_fix.py
  MongoDB:      MONGO_URI="mongodb+srv://…" python3 data/migrate_ux_fix.py
Add --dry-run to print the changes without writing them.

What it does
  images.json      width/height on every library image (read from the file header)
  pages.json       home = intro · main menu = People, Things, Personal, Info / Contact
                   archived experiments move to /lab/<name>, noindex, out of the menu
  navigation.json  menu links mirror the above (used by the admin navigation editor)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402  (reuses read_json / write_json / probe_image_dims)

DRY = "--dry-run" in sys.argv

HOME_ID = "intro"
MENU = [("people", "People"), ("things", "Things"), ("personal-v2", "Personal"), ("info", "Info / Contact")]
LAB_SLUGS = {
    "archive":                 "lab/grid",
    "archive-intro-v1":        "lab/archive-intro-v1",
    "archive-personal-v1":     "lab/archive-personal-v1",
    "archive-intro-loader-v1": "lab/archive-intro-loader-v1",
    "archive-filmstrip-v1":    "lab/filmstrip",
    "elastic-grid-v1":         "lab/grid-v2",
}


def migrate_images():
    images = server.read_json("images.json") or []
    changed = 0
    for img in images:
        if img.get("width") and img.get("height"):
            continue
        dims = server.probe_image_dims(img.get("url", ""))
        if not dims:
            print(f"  ! {img.get('id')}: could not read size ({img.get('url')})")
            continue
        img["width"], img["height"] = int(dims[0]), int(dims[1])
        changed += 1
        print(f"  {img['id']}: {dims[0]}×{dims[1]}")
    if changed and not DRY:
        server.write_json("images.json", images)
    print(f"images.json: {changed} image(s) updated")
    return changed


def migrate_pages():
    pages = server.read_json("pages.json") or []
    menu = dict(MENU)
    order = {pid: i + 1 for i, (pid, _) in enumerate(MENU)}
    changes = []
    for p in pages:
        pid, before = p.get("id"), json.dumps(p, sort_keys=True)
        p["isHome"] = pid == HOME_ID
        p["inMenu"] = pid in menu
        if pid in menu:
            p["menuLabel"] = menu[pid]
            p["menuOrder"] = order[pid]
        if pid in LAB_SLUGS:
            p["slug"] = LAB_SLUGS[pid]
            p.setdefault("seo", {})["indexable"] = False
        if json.dumps(p, sort_keys=True) != before:
            changes.append(pid)
    for pid in changes:
        p = next(x for x in pages if x["id"] == pid)
        print(f"  {pid}: home={p['isHome']} menu={p['inMenu']} slug={p.get('slug')} label={p.get('menuLabel')}")
    if changes and not DRY:
        server.write_json("pages.json", pages)
    print(f"pages.json: {len(changes)} page(s) updated")
    return len(changes)


def migrate_navigation():
    nav = server.read_json("navigation.json") or {}
    links = [{"pageId": pid, "label": label, "visible": True, "order": i + 1} for i, (pid, label) in enumerate(MENU)]
    if nav.get("menuLinks") == links:
        print("navigation.json: up to date")
        return 0
    nav["menuLinks"] = links
    if not DRY:
        server.write_json("navigation.json", nav)
    print("navigation.json: menu links updated")
    return 1


def main():
    print(f"Store: {'MongoDB' if server.MONGO_URI else 'local files'}{' (dry run)' if DRY else ''}")
    changed = migrate_images() + migrate_pages() + migrate_navigation()
    if changed and not DRY:
        server.regenerate_config_js()
    print("Done.")


if __name__ == "__main__":
    main()
