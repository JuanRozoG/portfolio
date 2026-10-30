#!/usr/bin/env python3
"""
Mini CMS Server — Juan Rozo Portfolio
──────────────────────────────────────
Local dev:  python3 server.py          (uses data/*.json files)
Vercel:     set MONGO_URI env var      (uses MongoDB Atlas)
Portfolio:  http://localhost:8080/
Admin:      http://localhost:8080/admin/
Password:   set ADMIN_PASSWORD env var (default: portfolio2026)
Debug:      set DEBUG=1 for verbose logging
"""

import copy
import hashlib
import html
import json
import logging
import os
import re
import struct
import traceback
import urllib.request
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_file, send_from_directory, Response

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / "data"
ADMIN_DIR  = BASE_DIR / "admin"

# On Vercel the task directory is read-only; use /tmp for uploads
_MONGO_URI_CHECK = os.environ.get("MONGO_URI", "")
UPLOAD_DIR = Path("/tmp/uploads") if _MONGO_URI_CHECK else BASE_DIR / "uploads"

DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

# ── Config ─────────────────────────────────────────────────────────────────────
ADMIN_PASSWORD     = os.environ.get("ADMIN_PASSWORD", "portfolio2026")
ADMIN_USERNAME     = os.environ.get("ADMIN_USERNAME", "")   # if set, both email AND password are required
DEBUG_MODE         = os.environ.get("DEBUG", "false").lower() in ("1", "true", "yes")
MONGO_URI          = os.environ.get("MONGO_URI", "")          # Set on Vercel; empty = local file mode
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "svg", "avif"}
CORE_PAGES         = {
    "intro", "people", "things", "personal-v2", "info", "archive",
    "archive-intro-v1", "archive-personal-v1", "archive-intro-loader-v1", "archive-filmstrip-v1",
    "elastic-grid-v1",
}
STANDALONE_TEMPLATES = ("archive-standalone", "filmstrip", "elastic-grid")
LAB_TEMPLATES        = STANDALONE_TEMPLATES + ("archive",)
LAB_PREFIX           = "lab/"
LAB_ALIASES          = {"filmstrip": "archive-filmstrip-v1", "grid": "archive", "grid-v2": "elastic-grid-v1"}
# Public origin used for canonical / og:url. Falls back to the request host.
SITE_URL           = os.environ.get("SITE_URL", "").rstrip("/")
# "vercel" → front-end requests images through /_vercel/image (Vercel Image Optimization).
IMAGE_OPTIMIZER    = os.environ.get("IMAGE_OPTIMIZER", "vercel" if os.environ.get("VERCEL") else "")
LOCAL_IMAGE_WIDTHS = (640, 1080, 1600)   # pre-generated variants: images/<name>-<w>.<ext>

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if DEBUG_MODE else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cms")

if not DEBUG_MODE:
    logging.getLogger("werkzeug").setLevel(logging.WARNING)

# ── App ────────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=None)

# ── Auth ───────────────────────────────────────────────────────────────────────
def _authorized():
    """
    When ADMIN_USERNAME is set, BOTH email (X-Admin-Email) and password are required.
    When ADMIN_USERNAME is empty, password alone is sufficient (backward-compatible).
    """
    pw_ok       = request.headers.get("X-Admin-Password") == ADMIN_PASSWORD
    email_given = request.headers.get("X-Admin-Email", "").strip().lower()
    if ADMIN_USERNAME:
        # strict mode: require matching email + password
        email_ok = email_given == ADMIN_USERNAME.strip().lower()
        if pw_ok and email_ok:
            return True
        # Also support HTTP Basic Auth: username=email, password=password
        auth = request.authorization
        if auth and auth.password == ADMIN_PASSWORD and auth.username.strip().lower() == ADMIN_USERNAME.strip().lower():
            return True
        return False
    else:
        # password-only mode (legacy)
        if pw_ok:
            return True
        auth = request.authorization
        if auth and auth.password == ADMIN_PASSWORD:
            return True
        return False

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _authorized():
            log.warning("Unauthorized request: %s %s from %s",
                        request.method, request.path, request.remote_addr)
            return Response(
                json.dumps({"error": "Unauthorized"}),
                401,
                {"Content-Type": "application/json",
                 "WWW-Authenticate": 'Basic realm="Portfolio Admin"'},
            )
        return f(*args, **kwargs)
    return decorated

# ── Global error handlers ──────────────────────────────────────────────────────
@app.errorhandler(400)
def handle_400(e):
    return jsonify({"error": "Bad request", "detail": str(e)}), 400

@app.errorhandler(403)
def handle_403(e):
    return jsonify({"error": "Forbidden", "detail": str(e)}), 403

@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "Not found", "path": request.path}), 404

@app.errorhandler(405)
def handle_405(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(Exception)
def handle_exception(e):
    tb = traceback.format_exc()
    log.error("Unhandled exception on %s %s — %s: %s",
              request.method, request.path, type(e).__name__, e)
    resp = {
        "error":   "Internal server error",
        "message": str(e) if DEBUG_MODE else "An unexpected error occurred.",
    }
    if DEBUG_MODE:
        resp["traceback"] = tb
        resp["type"]      = type(e).__name__
    return jsonify(resp), 500

# ══════════════════════════════════════════════════════════════════════════════
#  Data layer — MongoDB (Vercel) or local JSON files (dev)
# ══════════════════════════════════════════════════════════════════════════════
_mongo_db = None

def _get_db():
    """Return MongoDB database, creating connection on first call."""
    global _mongo_db
    if _mongo_db is None:
        import certifi
        from pymongo import MongoClient
        client  = MongoClient(
            MONGO_URI,
            serverSelectionTimeoutMS=10000,
            tlsCAFile=certifi.where(),
        )
        _mongo_db = client["portfolio"]
        log.info("MongoDB connected")
    return _mongo_db

def read_json(filename: str):
    """Read a data document. Uses MongoDB when MONGO_URI is set, local files otherwise."""
    if MONGO_URI:
        try:
            db  = _get_db()
            doc = db.data.find_one({"_id": filename})
            if doc is None:
                log.debug("read_json(%s): not found in MongoDB", filename)
                return None
            log.debug("read_json(%s): loaded from MongoDB", filename)
            return doc["data"]
        except Exception as e:
            log.error("read_json(%s) MongoDB error — %s", filename, e)
            raise
    else:
        path = DATA_DIR / filename
        if not path.exists():
            log.debug("read_json(%s): file not found", filename)
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            log.debug("read_json(%s): loaded %s items", filename,
                      len(data) if isinstance(data, list) else "object")
            return data
        except json.JSONDecodeError as e:
            log.error("read_json(%s): JSON parse error — %s", filename, e)
            raise ValueError(f"Corrupt JSON in {filename}: {e}") from e

def write_json(filename: str, data):
    """Write a data document. Uses MongoDB when MONGO_URI is set, local files otherwise."""
    if MONGO_URI:
        try:
            db = _get_db()
            db.data.replace_one(
                {"_id": filename},
                {"_id": filename, "data": data},
                upsert=True,
            )
            log.debug("write_json(%s): saved to MongoDB", filename)
        except Exception as e:
            log.error("write_json(%s) MongoDB error — %s", filename, e)
            raise
    else:
        path = DATA_DIR / filename
        tmp  = str(path) + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
            log.debug("write_json(%s): wrote %s", filename,
                      len(data) if isinstance(data, list) else "object")
        except OSError as e:
            log.error("write_json(%s): failed — %s", filename, e)
            raise

# ══════════════════════════════════════════════════════════════════════════════
#  Image dimensions — read from the file header (first 256 KB), no imaging deps
# ══════════════════════════════════════════════════════════════════════════════
def _dims_from_bytes(d: bytes):
    """Return (width, height) for JPEG/PNG/WebP header bytes, or None."""
    if d[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", d[16:24])
    if d[:4] == b"RIFF" and d[8:12] == b"WEBP":
        chunk = d[12:16]
        if chunk == b"VP8X":
            return (int.from_bytes(d[24:27], "little") + 1, int.from_bytes(d[27:30], "little") + 1)
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", d[26:30])
            return (w & 0x3FFF, h & 0x3FFF)
        if chunk == b"VP8L":
            b = int.from_bytes(d[21:25], "little")
            return ((b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1)
        return None
    i = 2
    while i < len(d) - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        m = d[i + 1]
        if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", d[i + 5:i + 9])
            return (w, h)
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack(">H", d[i + 2:i + 4])[0]
    return None

def probe_image_dims(url: str):
    """Best-effort (width, height) for a library URL. Returns None on any failure."""
    try:
        if url.startswith("/images/"):
            path = BASE_DIR / url.lstrip("/").split("?")[0]
            return _dims_from_bytes(path.read_bytes()[:262144]) if path.is_file() else None
        if not url.startswith("http"):
            return None
        import ssl
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers={"Range": "bytes=0-262143", "User-Agent": "portfolio-cms"})
        with urllib.request.urlopen(req, timeout=8, context=ctx) as r:
            return _dims_from_bytes(r.read(262144))
    except Exception as e:
        log.warning("probe_image_dims(%s) failed — %s", url, e)
        return None

def _with_dims(img: dict) -> dict:
    """Fill width/height on a library record when missing or when the URL changed."""
    if img.get("width") and img.get("height"):
        return img
    dims = probe_image_dims(img.get("url", ""))
    if dims:
        img["width"], img["height"] = int(dims[0]), int(dims[1])
    return img

# ══════════════════════════════════════════════════════════════════════════════
#  Page metadata (title, description, og, canonical) — shared by config.js
#  and the <head> injected into every HTML page
# ══════════════════════════════════════════════════════════════════════════════
def is_lab_page(page: dict) -> bool:
    return str(page.get("slug", "")).startswith(LAB_PREFIX) or page.get("template") in LAB_TEMPLATES

def page_title(page: dict, site: dict) -> str:
    name  = site.get("name") or "Juan Rozo"
    seo   = page.get("seo") or {}
    title = (seo.get("pageTitle") or "").strip()
    if page.get("isHome") and (not title or title == name):
        return f"{name} — {site.get('tagline') or 'Photographer'}, Melbourne"
    if title:
        return title
    label = page.get("menuLabel") or page.get("title") or page.get("id", "")
    return f"{label} — {name}"

def page_path(page: dict) -> str:
    return "/" if page.get("isHome") else "/" + str(page.get("slug") or page.get("id", "")).strip("/")

# ══════════════════════════════════════════════════════════════════════════════
#  config.js builder
# ══════════════════════════════════════════════════════════════════════════════
def _safe_menu_item(p):
    """Return a menu-item dict for page p, or None if the page is malformed."""
    try:
        return {
            "id":        p["id"],
            "menuLabel": p.get("menuLabel") or p.get("title", ""),
            "template":  p.get("template", ""),
            "slug":      p.get("slug", p["id"]),
        }
    except Exception as e:
        log.warning("_safe_menu_item: skipping malformed page — %s", e)
        return None

def _build_config_content() -> str:
    """Generate the full config.js JavaScript string from current data."""
    site   = read_json("site.json") or {}
    pages  = read_json("pages.json") or []
    images = read_json("images.json") or []

    img_map = {img["id"]: img for img in images}

    home_page_id = next((p["id"] for p in pages if p.get("isHome")), "intro")

    sections_map = {}
    for page in pages:
        try:
            sections_map[page["id"]] = {
                s["id"]: s.get("enabled", True)
                for s in page.get("sections", [])
            }
        except Exception as e:
            log.warning("_build_config_content: skipping sections for '%s' — %s", page.get("id", "?"), e)

    page_galleries = {}
    for page in pages:
        pid = page.get("id", "unknown")
        try:
            resolved = []
            for ref in page.get("gallery", []):
                img = img_map.get(ref.get("imageId"))
                if not img:
                    log.debug("config: imageId '%s' in page '%s' not found — skipped",
                              ref.get("imageId"), pid)
                    continue
                url     = img.get("url", "")
                alt     = ref.get("alt") or img.get("alt", "")
                caption = ref.get("caption") or img.get("caption", "")
                cats    = img.get("categories", [])
                item = {
                    "id":         img["id"],
                    "url":        url,
                    "image":      url,
                    "alt":        alt,
                    "title":      alt,
                    "caption":    caption,
                    "subtitle":   caption,
                    "categories": cats,
                }
                # Optional fields: real pixel size (layout reservation) and
                # commercial credits (brand + role), editable in the admin library.
                if img.get("width") and img.get("height"):
                    item["width"], item["height"] = int(img["width"]), int(img["height"])
                for key in ("client", "role"):
                    val = ref.get(key) or img.get(key)
                    if val:
                        item[key] = val
                resolved.append(item)
            page_galleries[pid] = resolved
        except Exception as e:
            log.warning("config: skipping gallery for '%s' — %s", pid, e)
            page_galleries[pid] = []

    about_photo = site.get("about", {}).get("photo", "")
    # Local portrait: size read from disk (cheap); remote URLs are left to the browser
    about_dims  = probe_image_dims(about_photo) if about_photo.startswith("/images/") else None
    bio = site.get("about", {}).get("bio", "").replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

    lines = [
        "// AUTO-GENERATED — Edit content via /admin/  Do not edit manually.",
        "// Generated: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "",
        "const CONFIG = {",
        "",
        f"  homePage: {json.dumps(home_page_id)},",
        f"  imageOptimizer: {json.dumps(IMAGE_OPTIMIZER)},",
        "",
        "  // ── Personal info ───────────────────────────────────────",
        f"  name:          {json.dumps(site.get('name', ''))},",
        f"  tagline:       {json.dumps(site.get('tagline', ''))},",
        f"  phone:         {json.dumps(site.get('phone', ''))},",
        f"  phoneHref:     {json.dumps(site.get('phoneHref', ''))},",
        f"  email:         {json.dumps(site.get('email', ''))},",
        f"  instagram:     {json.dumps(site.get('instagram', ''))},",
        f"  instagramUrl:  {json.dumps(site.get('instagramUrl', ''))},",
        f"  copyright:     {json.dumps(site.get('copyright', ''))},",
        "",
        "  // ── About section ───────────────────────────────────────",
        "  about: {",
        f"    photo: {json.dumps(about_photo)},",
        f"    width: {json.dumps(about_dims[0] if about_dims else None)},",
        f"    height: {json.dumps(about_dims[1] if about_dims else None)},",
        f"    bio: `{bio}`,",
        "  },",
        "",
        f"  logoUrl: {json.dumps(site.get('logoUrl', ''))},",
        "",
        "  // ── Client logos ────────────────────────────────────────",
        "  clientLogos: [",
    ]

    for logo in site.get("clientLogos", []):
        lines.append(f"    {{ name: {json.dumps(logo['name'])}, url: {json.dumps(logo['url'])} }},")

    lines += [
        "  ],",
        "",
        "  // ── Section visibility ──────────────────────────────────",
        "  sections: " + json.dumps(sections_map, ensure_ascii=False) + ",",
        "",
        "  // ── Page content (template-specific editable text) ──────",
        "  pageContent: " + json.dumps(
            {p["id"]: p["content"] for p in pages if p.get("content")},
            ensure_ascii=False
        ) + ",",
        "",
        "  // ── Page templates (template key per page id) ─────────────────",
        "  pageTemplates: " + json.dumps(
            {p["id"]: p.get("template", "") for p in pages},
            ensure_ascii=False
        ) + ",",
        "",
        "  // ── Menu pages (backend-driven nav, sorted by menuOrder) ────",
        "  menuPages: " + json.dumps(
            [item for item in (
                _safe_menu_item(p)
                for p in sorted(
                    [p for p in pages if p.get("id") and p.get("inMenu") and p.get("status") == "published"],
                    key=lambda p: p.get("menuOrder", 999)
                )
            ) if item is not None],
            ensure_ascii=False
        ) + ",",
        "",
        "  // ── All pages index (every page, regardless of status / inMenu) ────",
        "  allPages: " + json.dumps(
            [
                {
                    "id":        p["id"],
                    "title":     p.get("title", p["id"]),
                    "slug":      p.get("slug", p["id"]),
                    "template":  p.get("template", ""),
                    "status":    p.get("status", "draft"),
                    "pageTitle": page_title(p, site),
                }
                for p in pages if p.get("id")
            ],
            ensure_ascii=False
        ) + ",",
        "",
        "  // ── Page galleries (source of truth for all portfolio pages) ──",
        "  pageGalleries: {",
    ]

    for page_id, gallery in page_galleries.items():
        lines.append(f"    {json.dumps(page_id)}: [")
        for item in gallery:
            lines.append("      " + json.dumps(item, ensure_ascii=False) + ",")
        lines.append("    ],")

    lines += [
        "  },",
        "",
        "  // ── Projects (reserved for future use) ──",
        "  projects: [],",
        "",
        "};",
        "",
    ]

    return "\n".join(lines)

def regenerate_config_js():
    """
    Rebuild config.js.
    - Local mode (no MONGO_URI): writes file to disk so the static /config.js is up to date.
    - Vercel mode (MONGO_URI set): no-op — config.js is served dynamically via GET /config.js.
    """
    if MONGO_URI:
        log.debug("regenerate_config_js: Vercel mode — served dynamically, skip file write")
        return
    try:
        content     = _build_config_content()
        config_path = BASE_DIR / "config.js"
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(content)
        log.info("config.js regenerated")
    except Exception as e:
        log.error("regenerate_config_js FAILED — %s: %s", type(e).__name__, e)
        if DEBUG_MODE:
            log.debug(traceback.format_exc())
        raise

# ── HTML patchers (local dev only — Vercel serves static HTML from repo) ───────
def patch_html_seo(page_data: dict):
    """Patch <head> of index.html with SEO. Active in local mode only."""
    if MONGO_URI:
        return  # Vercel: static HTML served from repo; SEO data lives in DB
    if page_data.get("id") != "intro":
        return
    seo = page_data.get("seo", {})
    html_path = BASE_DIR / "index.html"
    if not html_path.exists():
        return
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read()
        if seo.get("pageTitle"):
            content = re.sub(r"<title>[^<]*</title>",
                             f"<title>{seo['pageTitle']}</title>", content)
        if seo.get("metaDescription"):
            content = re.sub(
                r'<meta name="description"[^>]*/?>',
                f'<meta name="description" content="{seo["metaDescription"]}" />',
                content,
            )
        og_img = seo.get("ogImage", "")
        if og_img:
            if '<meta property="og:image"' in content:
                content = re.sub(r'<meta property="og:image"[^>]*/?>',
                                 f'<meta property="og:image" content="{og_img}" />', content)
            else:
                content = content.replace("</head>",
                    f'  <meta property="og:image" content="{og_img}" />\n</head>')
        if not seo.get("indexable", True):
            if '<meta name="robots"' not in content:
                content = content.replace("</head>",
                    '  <meta name="robots" content="noindex,nofollow" />\n</head>')
        else:
            content = re.sub(r'\s*<meta name="robots"[^>]*/?>', "", content)
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(content)
        log.debug("patch_html_seo: index.html updated")
    except Exception as e:
        log.error("patch_html_seo failed — %s", e)

def patch_html_navigation(nav_data: dict):
    """Rewrite the <nav> block in index.html. Active in local mode only."""
    if MONGO_URI:
        return  # Vercel: buildMenuNav() handles nav dynamically from /config.js
    html_path = BASE_DIR / "index.html"
    if not html_path.exists():
        return
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read()
        links = sorted(
            [l for l in nav_data.get("menuLinks", []) if l.get("visible", True)],
            key=lambda x: x.get("order", 99),
        )
        nav_html = '<nav class="menu-nav" id="menu-nav">\n'
        for link in links:
            nav_html += (
                f'      <a href="#" data-page="{link["pageId"]}" class="menu-link">'
                f'<span class="menu-link-inner">{link["label"]}</span></a>\n'
            )
        nav_html += "    </nav>"
        content = re.sub(
            r'<nav class="menu-nav"[^>]*>.*?</nav>',
            nav_html, content, flags=re.DOTALL,
        )
        footer_links = [l for l in nav_data.get("footerLinks", []) if l.get("visible", True)]
        footer_html = '<div class="menu-footer">\n'
        for link in footer_links:
            footer_html += (
                f'      <a href="{link["url"]}" target="_blank" rel="noopener" '
                f'class="menu-footer-link">{link["label"]}</a>\n'
            )
        footer_html += "    </div>"
        content = re.sub(
            r'<div class="menu-footer">.*?</div>',
            footer_html, content, flags=re.DOTALL,
        )
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(content)
        log.info("Navigation patched in index.html")
    except Exception as e:
        log.error("patch_html_navigation failed — %s", e)

# ══════════════════════════════════════════════════════════════════════════════
#  API Routes
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/ping", methods=["GET"])
def api_ping():
    return jsonify({
        "ok":    True,
        "time":  datetime.now().isoformat(),
        "debug": DEBUG_MODE,
        "mode":  "mongodb" if MONGO_URI else "local",
    })

# ── Settings ───────────────────────────────────────────────────────────────────
@app.route("/api/settings", methods=["GET"])
@require_auth
def api_get_settings():
    return jsonify(read_json("site.json") or {})

@app.route("/api/settings", methods=["PUT"])
@require_auth
def api_update_settings():
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid payload — expected JSON object"}), 400
    write_json("site.json", data)
    regenerate_config_js()
    log.info("Settings updated")
    return jsonify({"ok": True})

# ── Projects ───────────────────────────────────────────────────────────────────
@app.route("/api/projects", methods=["GET"])
@require_auth
def api_list_projects():
    return jsonify(read_json("projects.json") or [])

@app.route("/api/projects", methods=["POST"])
@require_auth
def api_create_project():
    projects = read_json("projects.json") or []
    data = request.get_json(force=True)
    max_id = max((p["id"] for p in projects), default=0)
    data["id"] = max_id + 1
    data.setdefault("title", "New Project")
    data.setdefault("subtitle", "")
    data.setdefault("categories", [])
    data.setdefault("image", "")
    data.setdefault("thumbnail", "")
    projects.append(data)
    write_json("projects.json", projects)
    regenerate_config_js()
    log.info("Project created: id=%d title=%r", data["id"], data.get("title"))
    return jsonify(data), 201

@app.route("/api/projects/<int:pid>", methods=["PUT"])
@require_auth
def api_update_project(pid):
    projects = read_json("projects.json") or []
    data = request.get_json(force=True)
    for i, p in enumerate(projects):
        if p["id"] == pid:
            data["id"] = pid
            projects[i] = data
            write_json("projects.json", projects)
            regenerate_config_js()
            return jsonify(data)
    abort(404)

@app.route("/api/projects/<int:pid>", methods=["DELETE"])
@require_auth
def api_delete_project(pid):
    projects = read_json("projects.json") or []
    before = len(projects)
    projects = [p for p in projects if p["id"] != pid]
    if len(projects) == before:
        abort(404)
    write_json("projects.json", projects)
    regenerate_config_js()
    return jsonify({"ok": True})

@app.route("/api/projects/reorder", methods=["POST"])
@require_auth
def api_reorder_projects():
    ordered_ids = request.get_json(force=True)
    if not isinstance(ordered_ids, list):
        return jsonify({"error": "Expected a list of IDs"}), 400
    projects = read_json("projects.json") or []
    id_map = {p["id"]: p for p in projects}
    reordered = [id_map[i] for i in ordered_ids if i in id_map]
    seen = set(ordered_ids)
    reordered += [p for p in projects if p["id"] not in seen]
    write_json("projects.json", reordered)
    regenerate_config_js()
    return jsonify({"ok": True})

# ── Pages ──────────────────────────────────────────────────────────────────────
@app.route("/api/pages", methods=["GET"])
@require_auth
def api_list_pages():
    pages = read_json("pages.json") or []
    log.debug("GET /api/pages — %d pages", len(pages))
    return jsonify(pages)

@app.route("/api/pages/<page_id>", methods=["GET"])
@require_auth
def api_get_page(page_id):
    pages = read_json("pages.json") or []
    page  = next((p for p in pages if p["id"] == page_id), None)
    if not page:
        abort(404)
    return jsonify(page)

@app.route("/api/pages/<page_id>", methods=["PUT"])
@require_auth
def api_update_page(page_id):
    pages = read_json("pages.json") or []
    data  = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid payload — expected JSON object"}), 400
    for i, p in enumerate(pages):
        if p["id"] == page_id:
            data["id"] = page_id
            if data.get("isHome"):
                for j, other in enumerate(pages):
                    if other["id"] != page_id and other.get("isHome"):
                        pages[j] = {**other, "isHome": False}
            pages[i] = data
            write_json("pages.json", pages)
            regenerate_config_js()
            patch_html_seo(data)
            log.info("Page updated: %s", page_id)
            return jsonify(data)
    abort(404)

@app.route("/api/pages", methods=["POST"])
@require_auth
def api_create_page():
    pages = read_json("pages.json") or []
    data  = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid payload — expected JSON object"}), 400
    if not data.get("title", "").strip():
        return jsonify({"error": "title is required"}), 400
    existing_ids = {p["id"] for p in pages}
    raw_id  = re.sub(r"[^a-z0-9-]", "-", data.get("id", "new-page").lower()).strip("-")
    new_id  = raw_id
    counter = 1
    while new_id in existing_ids:
        new_id = f"{raw_id}-{counter}"
        counter += 1
    data["id"] = new_id
    data.setdefault("status", "draft")
    data.setdefault("inMenu", False)
    data.setdefault("isHome", False)
    data.setdefault("menuOrder", len(pages))
    data.setdefault("sections", [])
    data.setdefault("gallery", [])
    data.setdefault("seo", {
        "pageTitle":       data.get("title", ""),
        "metaDescription": "",
        "ogImage":         "",
        "indexable":       True,
    })
    pages.append(data)
    write_json("pages.json", pages)
    log.info("Page created: %s", new_id)
    return jsonify(data), 201

@app.route("/api/pages/<page_id>/duplicate", methods=["POST"])
@require_auth
def api_duplicate_page(page_id):
    pages    = read_json("pages.json") or []
    original = next((p for p in pages if p["id"] == page_id), None)
    if not original:
        abort(404)
    new_page            = copy.deepcopy(original)
    new_page["title"]   = original["title"] + " (Copy)"
    new_page["slug"]    = original.get("slug", page_id) + "-copy"
    new_page["status"]  = "draft"
    new_page["inMenu"]  = False
    new_page["isHome"]  = False
    new_page["seo"]     = copy.deepcopy(original.get("seo", {}))
    new_page["seo"]["pageTitle"] = new_page["title"]
    existing_ids = {p["id"] for p in pages}
    base_id = page_id + "-copy"
    new_id  = base_id
    counter = 1
    while new_id in existing_ids:
        new_id = f"{base_id}-{counter}"
        counter += 1
    new_page["id"] = new_id
    pages.append(new_page)
    write_json("pages.json", pages)
    log.info("Page duplicated: %s → %s", page_id, new_id)
    return jsonify(new_page), 201

@app.route("/api/pages/<page_id>", methods=["DELETE"])
@require_auth
def api_delete_page(page_id):
    if page_id in CORE_PAGES:
        return jsonify({"error": f"Cannot delete core page '{page_id}'"}), 403
    pages  = read_json("pages.json") or []
    before = len(pages)
    pages  = [p for p in pages if p["id"] != page_id]
    if len(pages) == before:
        abort(404)
    write_json("pages.json", pages)
    log.info("Page deleted: %s", page_id)
    return jsonify({"ok": True})

# ── Navigation ─────────────────────────────────────────────────────────────────
@app.route("/api/navigation", methods=["GET"])
@require_auth
def api_get_navigation():
    return jsonify(read_json("navigation.json") or {})

@app.route("/api/navigation", methods=["PUT"])
@require_auth
def api_update_navigation():
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid payload — expected JSON object"}), 400
    write_json("navigation.json", data)
    patch_html_navigation(data)

    # Sync visibility flags to pages.json so CONFIG.menuPages stays consistent
    menu_links = data.get("menuLinks", [])
    if menu_links:
        pages   = read_json("pages.json") or []
        nav_map = {l["pageId"]: bool(l.get("visible", True)) for l in menu_links if l.get("pageId")}
        changed = False
        for i, p in enumerate(pages):
            if p.get("id") in nav_map:
                new_in_menu = nav_map[p["id"]]
                if bool(p.get("inMenu")) != new_in_menu:
                    pages[i] = {**p, "inMenu": new_in_menu}
                    changed  = True
        if changed:
            write_json("pages.json", pages)
            try:
                regenerate_config_js()
            except Exception as e:
                log.error("api_update_navigation: regenerate_config_js failed — %s", e)

    return jsonify({"ok": True})

# ── Image Library ──────────────────────────────────────────────────────────────
def _next_image_id() -> str:
    images   = read_json("images.json") or []
    existing = {img.get("id", "") for img in images}
    for n in range(1, 10000):
        candidate = f"img{n:03d}"
        if candidate not in existing:
            return candidate
    return "img_" + uuid.uuid4().hex[:8]

@app.route("/api/library", methods=["GET"])
@require_auth
def api_library_list():
    images = read_json("images.json") or []
    log.debug("GET /api/library — %d images", len(images))
    return jsonify(images)

@app.route("/api/library", methods=["POST"])
@require_auth
def api_library_add():
    data = request.get_json(force=True)
    if not data.get("url"):
        return jsonify({"error": "url is required"}), 400
    images  = read_json("images.json") or []
    new_img = _with_dims({
        "id":         _next_image_id(),
        "url":        data["url"],
        "alt":        data.get("alt", ""),
        "caption":    data.get("caption", ""),
        "client":     data.get("client", ""),
        "role":       data.get("role", ""),
        "categories": data.get("categories", []),
        "addedAt":    datetime.now().isoformat(),
    })
    images.append(new_img)
    write_json("images.json", images)
    log.info("Library: image added — id=%s", new_img["id"])
    return jsonify(new_img), 201

@app.route("/api/library/<img_id>", methods=["PUT"])
@require_auth
def api_library_update(img_id):
    images = read_json("images.json") or []
    data   = request.get_json(force=True)
    for i, img in enumerate(images):
        if img["id"] == img_id:
            img["alt"]        = data.get("alt",        img.get("alt", ""))
            img["caption"]    = data.get("caption",    img.get("caption", ""))
            img["client"]     = data.get("client",     img.get("client", ""))
            img["role"]       = data.get("role",       img.get("role", ""))
            img["categories"] = data.get("categories", img.get("categories", []))
            if data.get("url") and data["url"] != img.get("url"):
                img["url"] = data["url"]
                img.pop("width", None)
                img.pop("height", None)
            images[i] = _with_dims(img)
            write_json("images.json", images)
            regenerate_config_js()
            return jsonify(img)
    abort(404)

@app.route("/api/library/<img_id>", methods=["DELETE"])
@require_auth
def api_library_delete(img_id):
    images   = read_json("images.json") or []
    original = len(images)
    images   = [img for img in images if img["id"] != img_id]
    if len(images) == original:
        abort(404)
    write_json("images.json", images)
    pages   = read_json("pages.json") or []
    changed = False
    removed_from = []
    for page in pages:
        before = len(page.get("gallery", []))
        page["gallery"] = [r for r in page.get("gallery", []) if r.get("imageId") != img_id]
        if len(page["gallery"]) != before:
            changed = True
            removed_from.append(page["id"])
    if changed:
        write_json("pages.json", pages)
    regenerate_config_js()
    log.info("Library: image deleted — id=%s (removed from %d pages)", img_id, len(removed_from))
    return jsonify({"ok": True, "removedFromPages": removed_from})

@app.route("/api/upload", methods=["POST"])
@require_auth
def api_upload():
    """Upload a file. Note: on Vercel uploads are ephemeral — prefer URL-based images."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": f"File type .{ext} not allowed. Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        }), 400
    try:
        from werkzeug.utils import secure_filename
        safe  = secure_filename(file.filename)
        name  = f"{uuid.uuid4().hex[:8]}_{safe}"
        path  = UPLOAD_DIR / name
        file.save(str(path))
        size  = path.stat().st_size
        url   = f"/uploads/{name}"
        images = read_json("images.json") or []
        alt = file.filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").title()
        new_img = {
            "id":         _next_image_id(),
            "url":        url,
            "alt":        alt,
            "caption":    "",
            "categories": [],
            "filename":   name,
            "addedAt":    datetime.now().isoformat(),
        }
        dims = _dims_from_bytes(path.read_bytes()[:262144])
        if dims:
            new_img["width"], new_img["height"] = int(dims[0]), int(dims[1])
        images.append(new_img)
        write_json("images.json", images)
        log.info("Upload: %s → %s (%.1f KB)", file.filename, name, size / 1024)
        return jsonify({"url": url, "filename": name, "imageId": new_img["id"], "image": new_img}), 201
    except Exception as e:
        log.error("Upload failed — %s: %s", type(e).__name__, e)
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route("/api/upload/<filename>", methods=["DELETE"])
@require_auth
def api_delete_upload(filename):
    try:
        from werkzeug.utils import secure_filename
        safe = secure_filename(filename)
        path = UPLOAD_DIR / safe
        if path.exists() and path.is_file():
            path.unlink()
            return jsonify({"ok": True})
        abort(404)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ══════════════════════════════════════════════════════════════════════════════
#  Static file serving
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/")
def serve_index():
    pages = read_json("pages.json") or []
    home  = next((p for p in pages if p.get("isHome")), None)
    if home and home.get("template") in STANDALONE_TEMPLATES:
        html_path = BASE_DIR / f"{home['id']}.html"
        if html_path.is_file():
            return serve_html(html_path, home)
    return serve_html(BASE_DIR / "index.html", home)

@app.route("/lab")
@app.route("/lab/")
def serve_lab_index():
    """Plain index of archived experiments (noindex, outside the main menu)."""
    pages = [p for p in (read_json("pages.json") or []) if is_lab_page(p) and p.get("status") == "published"]
    items = "".join(
        f'<li><a href="{html.escape(page_path(p))}">{html.escape(p.get("title") or p["id"])}</a></li>'
        for p in sorted(pages, key=lambda p: p.get("menuOrder", 999))
    )
    content = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
        "<!--core:head--><style>"
        "body{margin:0;font-family:var(--font-display);font-weight:900;background:#fff;color:#0a0a0a}"
        "main{padding:calc(var(--header-h) + 48px) var(--gutter) 64px}"
        "h1{font-size:clamp(40px,8vw,88px);letter-spacing:-.04em;line-height:.9;margin:0 0 32px}"
        "ul{list-style:none;margin:0;padding:0;font-size:clamp(22px,3vw,32px);letter-spacing:-.03em}"
        "li a{display:inline-flex;min-height:44px;align-items:center;color:inherit;text-decoration:none}"
        "@media (hover:hover){li a:hover{color:var(--color-red)}}"
        "</style></head><body><main id=\"main\"><h1>Lab</h1>"
        f"<ul>{items}</ul></main><script src=\"/config.js\"></script></body></html>"
    )
    meta = {"id": "lab", "title": "Lab", "slug": "lab", "template": "archive",
            "seo": {"pageTitle": "Lab — Juan Rozo", "indexable": False}}
    return _html_response(_inject_head(content, meta))

@app.route("/config.js")
def serve_config_js():
    """
    Serve config.js dynamically from current data.
    - Vercel mode: always fresh from MongoDB.
    - Local mode: also fresh from files (bypasses cached static file).
    """
    try:
        content = _build_config_content()
        return Response(content, mimetype="application/javascript",
                        headers={"Cache-Control": "public, max-age=60"})
    except Exception as e:
        log.error("serve_config_js failed — %s", e)
        return Response(
            "// Error generating config.js — check server logs\nconst CONFIG = {};",
            mimetype="application/javascript",
            status=500,
        )

@app.route("/admin")
def serve_admin_redirect():
    return redirect("/admin/", code=301)

@app.route("/admin/")
def serve_admin():
    return send_file(str(ADMIN_DIR / "index.html"))

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(str(UPLOAD_DIR), filename)

@app.route("/images/<path:filename>")
def serve_images(filename):
    """Local images. ?w=<n> serves the closest pre-generated variant
    (images/<name>-<w>.<ext>) when one exists, else the original."""
    images_dir = BASE_DIR / "images"
    w = request.args.get("w", type=int)
    if w:
        stem, dot, ext = filename.rpartition(".")
        for size in sorted(LOCAL_IMAGE_WIDTHS):
            if size >= w and (images_dir / f"{stem}-{size}.{ext}").is_file():
                filename = f"{stem}-{size}.{ext}"
                break
        else:
            biggest = next((s for s in sorted(LOCAL_IMAGE_WIDTHS, reverse=True)
                            if (images_dir / f"{stem}-{s}.{ext}").is_file()), None)
            if biggest and w > biggest:
                filename = f"{stem}-{biggest}.{ext}"
        # Same variant as WebP when the browser accepts it and the file exists
        webp = filename.rpartition(".")[0] + ".webp"
        if "image/webp" in request.headers.get("Accept", "") and (images_dir / webp).is_file():
            filename = webp
    r = send_from_directory(str(images_dir), filename)
    r.headers["Cache-Control"] = "public, max-age=604800"
    if w:
        r.headers["Vary"] = "Accept"
    return r

@app.route("/assets/<path:filename>")
def serve_assets(filename):
    r = send_from_directory(str(BASE_DIR / "assets"), filename,
                            mimetype="font/woff2" if filename.endswith(".woff2") else None)
    # Long cache: URLs carry ?v=<content hash> (see _asset_version)
    r.headers["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") else "no-cache"
    return r

_ASSET_VERSIONS = {}

def _asset_version(name: str) -> str:
    """Short content hash for cache-busting /assets/* URLs.
    Memoised on Vercel (files are immutable per deployment); recomputed locally."""
    if MONGO_URI and name in _ASSET_VERSIONS:
        return _ASSET_VERSIONS[name]
    path = BASE_DIR / "assets" / name
    _ASSET_VERSIONS[name] = hashlib.sha1(path.read_bytes()).hexdigest()[:10] if path.is_file() else "0"
    return _ASSET_VERSIONS[name]

def _abs_url(url: str) -> str:
    if not url or url.startswith("http"):
        return url
    base = SITE_URL or request.host_url.rstrip("/")
    return base + "/" + url.lstrip("/")

# ── LCP preload — mirrors Core.img()/Core.srcset() in assets/core.js ─────────
# The first photo of a gallery is created by JavaScript, so the browser would
# only discover it after the page script runs. Preloading it here with the
# exact same URLs lets the download start with the HTML.
IMG_WIDTHS = (128, 256, 640, 1080, 1600, 2048)   # = vercel.json images.sizes
LCP_SIZES  = {   # template → (src width, sizes) — must match the page renderers
    "carousel":            (1080, "(max-width: 600px) 90vw, 50vw"),
    "grid":                (640,  "(max-width: 600px) calc(100vw - 32px), (max-width: 768px) 46vw, 28vw"),
    "fullscreen-carousel": (1080, "(max-width: 600px) 75vw, 50vw"),
    "info":                (1080, "(max-width: 600px) 100vw, 45vw"),
}

def _snap_width(w: int) -> int:
    return next((s for s in IMG_WIDTHS if s >= w), IMG_WIDTHS[-1])

def img_url(url: str, w: int, q: int = 75) -> str:
    from urllib.parse import quote, urlparse
    w = _snap_width(w)
    if url.startswith("/images/"):
        return url.split("?")[0] + f"?w={w}"
    if IMAGE_OPTIMIZER != "vercel" or urlparse(url).hostname != "juanrozo.com":
        return url
    encoded = quote(url, safe="-_.!~*'()")   # = encodeURIComponent
    return f"/_vercel/image?url={encoded}&w={w}&q={q}"

def img_srcset(url: str, max_w=None, q: int = 75) -> str:
    if IMAGE_OPTIMIZER != "vercel" and not url.startswith("/images/"):
        return ""
    widths = [w for w in IMG_WIDTHS if w >= 256 and (not max_w or w <= _snap_width(max_w))]
    return ", ".join(f"{img_url(url, w, q)} {w}w" for w in widths)

def _lcp_preload(page: dict, site: dict) -> str:
    spec = LCP_SIZES.get(page.get("template", ""))
    if not spec:
        return ""
    if page.get("template") == "info":
        url = site.get("about", {}).get("photo", "")
        dims = probe_image_dims(url) if url.startswith("/images/") else None
        max_w = dims[0] if dims else None
    else:
        images = {img["id"]: img for img in (read_json("images.json") or [])}
        first = next((images[r["imageId"]] for r in page.get("gallery", []) if r.get("imageId") in images), None)
        if not first:
            return ""
        url, max_w = first.get("url", ""), first.get("width")
    if not url:
        return ""
    e = lambda s: html.escape(str(s), quote=True)
    srcset = img_srcset(url, max_w)
    extra = f' imagesrcset="{e(srcset)}" imagesizes="{e(spec[1])}"' if srcset else ""
    return f'<link rel="preload" as="image" href="{e(img_url(url, spec[0]))}"{extra} fetchpriority="high" />'

def _head_html(page) -> str:
    """Common <head> block: title, description, canonical, Open Graph, robots,
    icons, font + core assets. One source of truth for every HTML page."""
    site  = read_json("site.json") or {}
    page  = page or {}
    seo   = page.get("seo") or {}
    title = page_title(page, site) if page else (site.get("name") or "Juan Rozo")
    desc  = seo.get("metaDescription") or \
        f"{site.get('name', 'Juan Rozo')} — {site.get('tagline', '')}. Melbourne based.".strip()
    path  = page_path(page) if page.get("id") else request.path
    og_image = seo.get("ogImage", "")
    if not og_image and page.get("id"):
        images  = {img["id"]: img for img in (read_json("images.json") or [])}
        first   = next((images.get(r.get("imageId")) for r in page.get("gallery", []) if images.get(r.get("imageId"))), None)
        og_image = (first or {}).get("url") or (site.get("about", {}).get("photo") if page.get("template") == "info" else "")
    if not og_image:
        og_image = next((p.get("seo", {}).get("ogImage") for p in (read_json("pages.json") or [])
                         if p.get("isHome") and p.get("seo", {}).get("ogImage")), "")
    noindex = (page and is_lab_page(page)) or seo.get("indexable") is False
    e = lambda s: html.escape(str(s or ""), quote=True)
    lines = [
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc)}" />',
        f'<link rel="canonical" href="{e(_abs_url(path))}" />',
        '<meta property="og:type" content="website" />',
        f'<meta property="og:site_name" content="{e(site.get("name") or "Juan Rozo")}" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(desc)}" />',
        f'<meta property="og:url" content="{e(_abs_url(path))}" />',
        f'<meta property="og:image" content="{e(_abs_url(og_image))}" />' if og_image else "",
        '<meta name="twitter:card" content="summary_large_image" />',
        '<meta name="robots" content="noindex" />' if noindex else "",
        '<meta name="theme-color" content="#ffffff" />',
        f'<meta name="jr:page" content="{e(page.get("id"))}" />' if page.get("id") else "",
        '<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png" />',
        '<link rel="apple-touch-icon" href="/images/apple-touch-icon.png" />',
        # Self-hosted font (see @font-face in core.css) — same ?v as there
        '<link rel="preload" href="/assets/fonts/HankenGrotesk-latin.woff2?v=1" as="font" type="font/woff2" crossorigin />',
        # Photos come through /_vercel/image (same origin); preconnect only without it
        '<link rel="preconnect" href="https://juanrozo.com" />' if IMAGE_OPTIMIZER != "vercel" else "",
        _lcp_preload(page, site) if page.get("id") else "",
        f'<link rel="stylesheet" href="/assets/core.css?v={_asset_version("core.css")}" />',
        f'<script src="/assets/core.js?v={_asset_version("core.js")}"></script>',
    ]
    return "\n  ".join(l for l in lines if l)

def _inject_head(content: str, page) -> str:
    return content.replace("<!--core:head-->", _head_html(page), 1)

def _html_response(content: str):
    return Response(content, mimetype="text/html", headers={"Cache-Control": "no-cache"})

def serve_html(html_path, page=None):
    """Read an HTML file, inject the common <head> for `page` and return a
    no-cache Response. Works reliably on Vercel (no streaming issues)."""
    html_path = Path(html_path)
    if page is None and html_path.stem != "index":
        page = next((p for p in (read_json("pages.json") or []) if p.get("id") == html_path.stem), None)
    content = html_path.read_text(encoding="utf-8")
    return _html_response(_inject_head(content, page))

@app.route("/<path:filename>")
def serve_static(filename):
    try:
        path = (BASE_DIR / filename).resolve()
        if not path.is_relative_to(BASE_DIR.resolve()):
            abort(403)
    except Exception:
        abort(403)
    # Serve exact static file if it exists.
    # Root-level .html files go through serve_html() so the common <head> is injected.
    # Sub-directory files (admin/, data/, etc.) are served as-is.
    if path.is_file():
        if path.suffix == '.html' and path.parent == BASE_DIR.resolve():
            return serve_html(path)
        r = send_from_directory(str(BASE_DIR), filename)
        if request.args.get("v") and path.suffix in (".css", ".js"):
            r.headers["Cache-Control"] = "public, max-age=31536000, immutable"   # e.g. /style.css?v=N
        return r
    # ── Slug-based routing ──────────────────────────────────────
    # Allows clean URLs like /people, /personal-work, /archive-v1
    # regardless of whether the slug matches the internal page id.
    slug = filename.rstrip('/')
    pages = read_json("pages.json") or []
    # 1. Match by slug field first, then fall back to id
    page = next((p for p in pages if p.get("slug", p.get("id", "")) == slug), None)
    if page is None:
        page = next((p for p in pages if p.get("id", "") == slug), None)
    if page is None and slug.startswith(LAB_PREFIX):
        # /lab/<name> keeps working before data/migrate_ux_fix.py has moved the slugs
        name = LAB_ALIASES.get(slug[len(LAB_PREFIX):], slug[len(LAB_PREFIX):])
        page = next((p for p in pages if is_lab_page(p) and name in (p.get("id"), p.get("slug"))), None)
        if page:
            page = {**page, "slug": slug}
    if page:
        template = page.get("template", "")
        page_id  = page["id"]
        if template in STANDALONE_TEMPLATES:
            # Standalone pages have a physical .html file named after their id
            html_path = BASE_DIR / f"{page_id}.html"
            if html_path.is_file():
                return serve_html(html_path, page)
        else:
            # SPA pages — serve index.html; JS reads location.pathname to pick the right section
            return serve_html(BASE_DIR / "index.html", page)
    abort(404)

# ══════════════════════════════════════════════════════════════════════════════
#  Redirects — vercel.json is the source of truth (edge on Vercel); mirrored
#  here so local dev behaves the same.
# ══════════════════════════════════════════════════════════════════════════════
def _load_redirects():
    try:
        cfg = json.loads((BASE_DIR / "vercel.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    out = []
    for r in cfg.get("routes", []):
        if r.get("status") in (301, 302, 308) and r.get("headers", {}).get("Location"):
            out.append((re.compile("^" + r["src"] + "$"), r["headers"]["Location"], r["status"]))
    return out

_REDIRECTS = _load_redirects()

@app.before_request
def _apply_redirects():
    for rx, location, status in _REDIRECTS:
        if rx.match(request.path):
            qs = request.query_string.decode()
            return redirect(location + ("?" + qs if qs else ""), code=status)

# ══════════════════════════════════════════════════════════════════════════════
#  One-time migration: fix ephemeral /uploads/ photo URLs → permanent /images/
# ══════════════════════════════════════════════════════════════════════════════
def _migrate_about_photo():
    """
    On Vercel, /tmp/uploads/ is wiped on every deployment.
    If site.json still has an /uploads/ URL for about.photo, replace it
    with the permanent /images/ URL committed to the git repo.
    """
    try:
        site = read_json("site.json") or {}
        # Fast exit: skip DB read if photo is already permanent
        photo_check = site.get("about", {}).get("photo", "")
        if not photo_check.startswith("/uploads/"):
            return
        photo = site.get("about", {}).get("photo", "")
        if photo.startswith("/uploads/"):
            # Find a replacement in the /images/ directory
            images_dir = BASE_DIR / "images"
            candidates = sorted(images_dir.iterdir()) if images_dir.is_dir() else []
            permanent = next((f for f in candidates if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")), None)
            if permanent:
                new_url = "/images/" + permanent.name
                site.setdefault("about", {})["photo"] = new_url
                write_json("site.json", site)
                regenerate_config_js()
                log.info("Migrated about.photo: %s → %s", photo, new_url)
    except Exception as e:
        log.warning("Photo migration skipped: %s", e)

_migrate_about_photo()

# ══════════════════════════════════════════════════════════════════════════════
#  Startup (local dev only — Vercel uses the module directly)
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    mode_label = "MongoDB" if MONGO_URI else "local files"

    if not MONGO_URI:
        missing = [f for f in ("site.json", "projects.json", "pages.json", "navigation.json", "images.json")
                   if not (DATA_DIR / f).exists()]
        if missing:
            log.warning("Missing data files: %s", ", ".join(missing))
        regenerate_config_js()
        log.info("config.js regenerated on startup")
    else:
        log.info("MongoDB mode — config.js served dynamically")

    debug_label = "DEBUG" if DEBUG_MODE else "production"
    print("\n" + "─" * 56)
    print("  Portfolio Admin Server")
    print("─" * 56)
    print(f"  Portfolio : http://localhost:8080/")
    print(f"  Admin     : http://localhost:8080/admin/")
    print(f"  Password  : {ADMIN_PASSWORD}")
    print(f"  Data      : {mode_label}")
    print(f"  Mode      : {debug_label}")
    print(f"  Logging   : {'DEBUG' if DEBUG_MODE else 'INFO'}")
    print("─" * 56 + "\n")

    app.run(host="0.0.0.0", port=8080, debug=DEBUG_MODE)
