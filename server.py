#!/usr/bin/env python3
"""
Mini CMS Server — Juan Rozo Portfolio
──────────────────────────────────────
Run:      python3 server.py
Portfolio: http://localhost:8080/
Admin:     http://localhost:8080/admin/
Password:  set ADMIN_PASSWORD env var (default: portfolio2026)
Debug:     set DEBUG=1 for verbose logging and richer error responses

Requires: pip install flask
"""

import copy
import json
import logging
import os
import re
import traceback
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_file, send_from_directory, Response

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
ADMIN_DIR  = BASE_DIR / "admin"

DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

# ── Config & debug mode ────────────────────────────────────────────────────────
ADMIN_PASSWORD     = os.environ.get("ADMIN_PASSWORD", "portfolio2026")
DEBUG_MODE         = os.environ.get("DEBUG", "false").lower() in ("1", "true", "yes")
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "svg", "avif"}
CORE_PAGES         = {
    "intro", "people", "things", "personal-v2", "info", "archive",
    "archive-intro-v1", "archive-personal-v1", "archive-intro-loader-v1", "archive-filmstrip-v1",
}

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if DEBUG_MODE else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cms")

# Silence Flask/Werkzeug request logs unless in debug mode
if not DEBUG_MODE:
    logging.getLogger("werkzeug").setLevel(logging.WARNING)

# ── App ────────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=None)  # We serve static files manually via /<path:filename>

# ── Auth ───────────────────────────────────────────────────────────────────────
def _authorized():
    if request.headers.get("X-Admin-Password") == ADMIN_PASSWORD:
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
    log.warning("400 Bad Request: %s %s", request.method, request.path)
    return jsonify({"error": "Bad request", "detail": str(e)}), 400

@app.errorhandler(403)
def handle_403(e):
    log.warning("403 Forbidden: %s %s", request.method, request.path)
    return jsonify({"error": "Forbidden", "detail": str(e)}), 403

@app.errorhandler(404)
def handle_404(e):
    log.warning("404 Not Found: %s %s", request.method, request.path)
    return jsonify({"error": "Not found", "path": request.path}), 404

@app.errorhandler(405)
def handle_405(e):
    log.warning("405 Method Not Allowed: %s %s", request.method, request.path)
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(Exception)
def handle_exception(e):
    tb = traceback.format_exc()
    log.error("Unhandled exception on %s %s — %s: %s",
              request.method, request.path, type(e).__name__, e)
    if DEBUG_MODE:
        log.debug("Traceback:\n%s", tb)
    resp = {
        "error":   "Internal server error",
        "message": str(e) if DEBUG_MODE else "An unexpected error occurred.",
    }
    if DEBUG_MODE:
        resp["traceback"] = tb
        resp["type"]      = type(e).__name__
    return jsonify(resp), 500

# ── JSON helpers ───────────────────────────────────────────────────────────────
def read_json(filename: str):
    path = DATA_DIR / filename
    if not path.exists():
        log.debug("read_json(%s): file not found, returning None", filename)
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            log.debug("read_json(%s): loaded %d items", filename, len(data))
        else:
            log.debug("read_json(%s): loaded OK", filename)
        return data
    except json.JSONDecodeError as e:
        log.error("read_json(%s): JSON parse error at line %d col %d — %s",
                  filename, e.lineno, e.colno, e.msg)
        raise ValueError(f"Corrupt JSON in {filename}: {e}") from e
    except OSError as e:
        log.error("read_json(%s): OS error — %s", filename, e)
        raise

def write_json(filename: str, data):
    path = DATA_DIR / filename
    tmp  = str(path) + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        count = len(data) if isinstance(data, list) else "object"
        log.debug("write_json(%s): wrote %s", filename, count)
    except OSError as e:
        log.error("write_json(%s): failed — %s", filename, e)
        raise

# ── config.js generator ────────────────────────────────────────────────────────
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

def regenerate_config_js():
    """Rebuild config.js from data/*.json so the portfolio picks up changes."""
    try:
        site    = read_json("site.json") or {}
        pages   = read_json("pages.json") or []
        images  = read_json("images.json") or []

        img_map = {img["id"]: img for img in images}

        # Determine the home page (fallback to 'intro')
        home_page_id = next((p["id"] for p in pages if p.get("isHome")), "intro")

        sections_map = {}
        for page in pages:
            try:
                sections_map[page["id"]] = {
                    s["id"]: s.get("enabled", True)
                    for s in page.get("sections", [])
                }
            except Exception as e:
                log.warning("regenerate_config_js: skipping sections for page '%s' — %s", page.get("id", "?"), e)

        page_galleries = {}
        for page in pages:
            pid = page.get("id", "unknown")
            try:
                resolved = []
                for ref in page.get("gallery", []):
                    img = img_map.get(ref.get("imageId"))
                    if not img:
                        log.debug("regenerate_config_js: imageId '%s' in page '%s' not found in library — skipped",
                                  ref.get("imageId"), pid)
                        continue
                    url     = img.get("url", "")
                    alt     = ref.get("alt") or img.get("alt", "")
                    caption = ref.get("caption") or img.get("caption", "")
                    cats    = img.get("categories", [])
                    resolved.append({
                        "id":         img["id"],
                        "url":        url,
                        "image":      url,
                        "alt":        alt,
                        "title":      alt,
                        "caption":    caption,
                        "subtitle":   caption,
                        "categories": cats,
                    })
                page_galleries[pid] = resolved
            except Exception as e:
                log.warning("regenerate_config_js: skipping gallery for page '%s' — %s", pid, e)
                page_galleries[pid] = []

        bio = site.get("about", {}).get("bio", "").replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

        lines = [
            "// AUTO-GENERATED — Edit content via /admin/  Do not edit manually.",
            "// Generated: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "",
            "const CONFIG = {",
            "",
            f"  homePage: {json.dumps(home_page_id)},",
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
            f"    photo: {json.dumps(site.get('about', {}).get('photo', ''))},",
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
            "  // ── Page galleries (source of truth for all portfolio pages) ──",
            "  // Each entry: { id, url, image, alt, title, caption, subtitle, categories }",
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
            "  // ── Projects (reserved for future use — currently empty) ──",
            "  projects: [],",
            "",
            "};",
            "",
        ]

        config_path = BASE_DIR / "config.js"
        with open(config_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        total_imgs = sum(len(g) for g in page_galleries.values())
        log.info("config.js regenerated — %d pages, %d total gallery items", len(pages), total_imgs)

    except Exception as e:
        log.error("regenerate_config_js FAILED — %s: %s", type(e).__name__, e)
        if DEBUG_MODE:
            log.debug(traceback.format_exc())
        raise

# ── HTML patchers ──────────────────────────────────────────────────────────────
def patch_html_seo(page_data: dict):
    """Patch <head> of index.html with SEO from the intro page."""
    if page_data.get("id") != "intro":
        return
    seo = page_data.get("seo", {})
    html_path = BASE_DIR / "index.html"
    if not html_path.exists():
        log.warning("patch_html_seo: index.html not found — skipping")
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
    """Rewrite the <nav class="menu-nav"> block in index.html."""
    html_path = BASE_DIR / "index.html"
    if not html_path.exists():
        log.warning("patch_html_navigation: index.html not found — skipping")
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
        log.info("Navigation patched in index.html (%d menu links, %d footer links)",
                 len(links), len(footer_links))
    except Exception as e:
        log.error("patch_html_navigation failed — %s", e)

# ══════════════════════════════════════════════════════════════════════════════
#  API Routes
# ══════════════════════════════════════════════════════════════════════════════

# ── Ping / health check ────────────────────────────────────────────────────────
@app.route("/api/ping", methods=["GET"])
@require_auth
def api_ping():
    return jsonify({
        "ok":    True,
        "time":  datetime.now().isoformat(),
        "debug": DEBUG_MODE,
    })

# ── Settings ───────────────────────────────────────────────────────────────────
@app.route("/api/settings", methods=["GET"])
@require_auth
def api_get_settings():
    log.debug("GET /api/settings")
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
            log.info("Project updated: id=%d", pid)
            return jsonify(data)
    log.warning("Project not found: id=%d", pid)
    abort(404)

@app.route("/api/projects/<int:pid>", methods=["DELETE"])
@require_auth
def api_delete_project(pid):
    projects = read_json("projects.json") or []
    before = len(projects)
    projects = [p for p in projects if p["id"] != pid]
    if len(projects) == before:
        log.warning("Project delete: id=%d not found", pid)
        abort(404)
    write_json("projects.json", projects)
    regenerate_config_js()
    log.info("Project deleted: id=%d", pid)
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
    log.info("Projects reordered")
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
        log.warning("GET /api/pages/%s — not found", page_id)
        abort(404)
    log.debug("GET /api/pages/%s — OK", page_id)
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
            # Enforce single home page — unset isHome on all others
            if data.get("isHome"):
                for j, other in enumerate(pages):
                    if other["id"] != page_id and other.get("isHome"):
                        pages[j] = {**other, "isHome": False}
            pages[i] = data
            write_json("pages.json", pages)
            regenerate_config_js()
            patch_html_seo(data)
            log.info("Page updated: %s (%r, isHome=%s)", page_id, data.get("title"), data.get("isHome", False))
            return jsonify(data)
    log.warning("PUT /api/pages/%s — not found", page_id)
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
    log.info("Page created: %s (%r, template=%r)", new_id, data.get("title"), data.get("template"))
    return jsonify(data), 201

@app.route("/api/pages/<page_id>/duplicate", methods=["POST"])
@require_auth
def api_duplicate_page(page_id):
    pages    = read_json("pages.json") or []
    original = next((p for p in pages if p["id"] == page_id), None)
    if not original:
        log.warning("Duplicate: page %s not found", page_id)
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
    base_id  = page_id + "-copy"
    new_id   = base_id
    counter  = 1
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
        log.warning("Attempted delete of core page: %s", page_id)
        return jsonify({"error": f"Cannot delete core page '{page_id}'"}), 403
    pages = read_json("pages.json") or []
    before = len(pages)
    pages = [p for p in pages if p["id"] != page_id]
    if len(pages) == before:
        log.warning("DELETE /api/pages/%s — not found", page_id)
        abort(404)
    write_json("pages.json", pages)
    log.info("Page deleted: %s", page_id)
    return jsonify({"ok": True})

# ── Navigation ─────────────────────────────────────────────────────────────────
@app.route("/api/navigation", methods=["GET"])
@require_auth
def api_get_navigation():
    log.debug("GET /api/navigation")
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
        pages = read_json("pages.json") or []
        nav_map = {l["pageId"]: bool(l.get("visible", True)) for l in menu_links if l.get("pageId")}
        changed = False
        for i, p in enumerate(pages):
            if p.get("id") in nav_map:
                new_in_menu = nav_map[p["id"]]
                if bool(p.get("inMenu")) != new_in_menu:
                    pages[i] = {**p, "inMenu": new_in_menu}
                    changed = True
        if changed:
            write_json("pages.json", pages)
            try:
                regenerate_config_js()
            except Exception as e:
                log.error("api_update_navigation: regenerate_config_js failed — %s", e)

    return jsonify({"ok": True})

# ── Image Library ──────────────────────────────────────────────────────────────
def _next_image_id() -> str:
    images = read_json("images.json") or []
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
    images = read_json("images.json") or []
    new_img = {
        "id":         _next_image_id(),
        "url":        data["url"],
        "alt":        data.get("alt", ""),
        "caption":    data.get("caption", ""),
        "categories": data.get("categories", []),
        "addedAt":    datetime.now().isoformat(),
    }
    images.append(new_img)
    write_json("images.json", images)
    log.info("Library: image added via URL — id=%s url=%s", new_img["id"], new_img["url"])
    return jsonify(new_img), 201

@app.route("/api/library/<img_id>", methods=["PUT"])
@require_auth
def api_library_update(img_id):
    images = read_json("images.json") or []
    data = request.get_json(force=True)
    for i, img in enumerate(images):
        if img["id"] == img_id:
            img["alt"]        = data.get("alt",        img.get("alt", ""))
            img["caption"]    = data.get("caption",    img.get("caption", ""))
            img["categories"] = data.get("categories", img.get("categories", []))
            if data.get("url"):
                img["url"] = data["url"]
            images[i] = img
            write_json("images.json", images)
            regenerate_config_js()
            log.info("Library: image updated — id=%s", img_id)
            return jsonify(img)
    log.warning("Library: image not found for update — id=%s", img_id)
    abort(404)

@app.route("/api/library/<img_id>", methods=["DELETE"])
@require_auth
def api_library_delete(img_id):
    images = read_json("images.json") or []
    original = len(images)
    images = [img for img in images if img["id"] != img_id]
    if len(images) == original:
        log.warning("Library: image not found for delete — id=%s", img_id)
        abort(404)
    write_json("images.json", images)
    pages = read_json("pages.json") or []
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
        log.debug("Library delete: removed %s from galleries: %s", img_id, removed_from)
    regenerate_config_js()
    log.info("Library: image deleted — id=%s (removed from %d pages)", img_id, len(removed_from))
    return jsonify({"ok": True, "removedFromPages": removed_from})

@app.route("/api/upload", methods=["POST"])
@require_auth
def api_upload():
    """Upload a file, save to uploads/, register in the image library."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        log.warning("Upload rejected: unsupported extension .%s (file: %s)", ext, file.filename)
        return jsonify({
            "error": f"File type .{ext} is not allowed. Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
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
        images.append(new_img)
        write_json("images.json", images)

        log.info("Upload: %s → %s (id=%s, %.1f KB)", file.filename, name, new_img["id"], size / 1024)
        return jsonify({"url": url, "filename": name, "imageId": new_img["id"], "image": new_img}), 201

    except Exception as e:
        log.error("Upload failed for %s — %s: %s", file.filename, type(e).__name__, e)
        if DEBUG_MODE:
            log.debug(traceback.format_exc())
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route("/api/upload/<filename>", methods=["DELETE"])
@require_auth
def api_delete_upload(filename):
    """Delete an uploaded file from disk (does not remove from library)."""
    try:
        from werkzeug.utils import secure_filename
        safe = secure_filename(filename)
        path = UPLOAD_DIR / safe
        if path.exists() and path.is_file():
            path.unlink()
            log.info("Upload file deleted from disk: %s", safe)
            return jsonify({"ok": True})
        log.warning("Delete upload: file not found — %s", safe)
        abort(404)
    except Exception as e:
        log.error("Delete upload failed for %s — %s", filename, e)
        return jsonify({"error": str(e)}), 500

# ══════════════════════════════════════════════════════════════════════════════
#  Static file serving
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/")
def serve_index():
    return send_file(str(BASE_DIR / "index.html"))

@app.route("/admin")
def serve_admin_redirect():
    """Redirect /admin → /admin/ so relative asset paths (style.css, app.js) resolve correctly."""
    return redirect("/admin/", code=301)

@app.route("/admin/")
def serve_admin():
    """Serve the admin SPA shell — no auth required at HTML level.
    Authentication is handled entirely by JavaScript (X-Admin-Password header).
    """
    return send_file(str(ADMIN_DIR / "index.html"))

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(str(UPLOAD_DIR), filename)

@app.route("/<path:filename>")
def serve_static(filename):
    path = BASE_DIR / filename
    if not path.resolve().is_relative_to(BASE_DIR.resolve()):
        abort(403)
    if path.is_file():
        return send_from_directory(str(BASE_DIR), filename)
    abort(404)

# ══════════════════════════════════════════════════════════════════════════════
#  Startup
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    missing = [f for f in ("site.json", "projects.json", "pages.json", "navigation.json", "images.json")
               if not (DATA_DIR / f).exists()]
    if missing:
        log.warning("Missing data files: %s — check setup docs.", ", ".join(missing))

    mode_label = "DEBUG" if DEBUG_MODE else "production"
    print("\n" + "─" * 56)
    print("  Portfolio Admin Server")
    print("─" * 56)
    print(f"  Portfolio : http://localhost:8080/")
    print(f"  Admin     : http://localhost:8080/admin/")
    print(f"  Password  : {ADMIN_PASSWORD}")
    print(f"  Mode      : {mode_label}")
    if DEBUG_MODE:
        print(f"  Logging   : DEBUG (verbose — set DEBUG=0 to silence)")
    else:
        print(f"  Logging   : INFO  (set DEBUG=1 for verbose output)")
    print("─" * 56 + "\n")

    log.info("Server starting — debug=%s", DEBUG_MODE)
    try:
        regenerate_config_js()
        log.info("config.js regenerated on startup")
    except Exception as e:
        log.warning("Startup config.js regeneration failed — %s", e)
    app.run(host="0.0.0.0", port=8080, debug=False, use_reloader=False)
