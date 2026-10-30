# UX Fix Plan — Juan Rozo Portfolio

## Fase 0 — Inventario

### Cómo se sirve cada ruta
Todo pasa por Flask (`server.py`, `@vercel/python`; `vercel.json` manda `/(.*)` → `server.py`).

| Ruta | Quién la resuelve | Archivo |
|---|---|---|
| `/` | `serve_index()`: si la página con `isHome` es standalone, sirve `<id>.html`; si no, `index.html` | prod: `archive-filmstrip-v1.html` (isHome en Mongo) |
| `/config.js` | generado en cada request por `_build_config_content()` desde `site.json`, `pages.json`, `images.json` | — |
| `/<slug>` | `serve_static()`: archivo físico → si no, busca `slug` (luego `id`) en `pages.json`. Plantillas `archive-standalone`/`filmstrip`/`elastic-grid` → `<id>.html`; resto → `index.html` (SPA) | — |
| `/admin/` | panel CMS (`admin/app.js`) escribe `pages.json`/`images.json`/`site.json`/`navigation.json` vía `/api/*` | — |

**Datos en producción = MongoDB Atlas, no los JSON del repo.** Los `data/*.json` están desfasados: en prod `homePage` es `archive-filmstrip-v1` (slug `home`) y `menuPages` tiene 11 entradas (Small Grid, Intro V1, Horizontal Scroll, Intro v2, Home×2, People, Things, Personal, Info, Grid). Home, menú, slugs y etiquetas los decide el admin.

### Páginas
- **SPA** `index.html` (106 KB, `style.css?v=16`, GSAP): secciones intro, people (carousel), things (grid), personal-v2 (fullscreen-carousel), info, archive (`/grid`). Menú, cursor, wipe y lightbox propios.
- **Standalone** (estilos inline, `@import` de fuentes, menú de `shared.js` inyectado por `serve_html()`):
  `archive-filmstrip-v1.html` (`/home`, hoy la raíz), `archive-intro-v1.html`, `archive-personal-v1.html` (Horizontal Scroll), `elastic-grid-v1.html` (`/grid-v2`, ScrollSmoother), `archive.html` (sin uso en rutas: `archive` es plantilla SPA).
- **`archive-intro-loader-v1.html`** (62 KB): copia antigua de la SPA (`style.css?v=7`), con `id="cursor"` → `serve_html()` NO inyecta `shared.js`. Tercera copia del menú/cursor/wipe.

### Las tres copias
| | SPA `index.html` | `shared.js`/`shared.css` | `archive-intro-loader-v1.html` |
|---|---|---|---|
| Menú overlay | `buildMenuNav()` + open/close, `menu-ready` | `menu-ready` tras `setTimeout(1600)` | ídem, `setTimeout(1600)` (l.1307) |
| Cursor | `#cursor` + `style.css` | inyectado por `shared.js` | `#cursor` + `style.css?v=7` |
| Wipe | `.wipe-overlay` + `replaceState` (l.696-735) | `wipeNavigate()` | l.529-551 |

### Otros hallazgos de la exploración
- `/fonts/NeueHaasGroteskDisplay-Black.woff2` se precarga en `index.html` pero **no existe en el repo** (404 en prod): la SPA cae a la fuente de reserva.
- `/_vercel/image` devuelve 404 hoy (no hay `images` en `vercel.json`). Con `builds` + `routes` legacy hay que verificar en un preview que el optimizador responde antes de depender de él.
- `?auto=format&w=…` aparece en ~25 sitios (SPA, filmstrip, intro-loader, personal-v1, elastic-grid).
- `images.json` no tiene `width`/`height`, `client` ni `role`; sí `alt` y `caption`.
- `data/navigation.json` (footerLinks de Instagram) solo se usa en modo local (`patch_html_navigation`).

## Plan por fases
1. **Core**: `/assets/core.css` + `/assets/core.js` (tokens, `reduceMotion`, menú, cursor, wipe, cabecera). SPA y standalone los cargan; `serve_html()` inyecta core en vez de `shared.*`. Se eliminan las copias.
2. **Imágenes**: `images` en `vercel.json`, helper `img()`, `srcset/sizes`, dimensiones (`width`/`height` en `images.json` + `config.js`), LCP eager, miniaturas pequeñas, revelados con `decode()`.
3. **Rutas/menú**: `pushState` + `popstate`, `/lab/<nombre>` + 301, menú accesible, transición de llegada (a) + View Transitions (b).
4. **Cursor** solo con `(hover:hover) and (pointer:fine)`, solo `transform/opacity`.
5. **Carruseles**: motor de wheel único, Pointer Events, fin de gesto, lightbox como diálogo.
6. **Móvil**: `dvh`, hover solo con `hover:hover`, safe areas, galería horizontal móvil.
7. **Páginas**: home, filmstrip, info, CTA, campos `client`/`role`.
8. **A11y**: `<main>`, un `<h1>`, `hidden`/`inert`, alt.

## Estado (rama `ux-fix`)
Fases 0–8 hechas, un commit por fase. Capturas antes/después en `ux-screens/` (local, fuera de git).

### Despliegue — en este orden
1. `git push -u origin ux-fix` → Vercel crea un preview.
2. En el preview, comprobar que `/_vercel/image?url=…&w=640&q=75` responde 200 (si no, las imágenes caen solas al original).
3. Lighthouse móvil en el preview (los números locales no usan el optimizador).
4. Fusionar a `main`.
5. **Justo después del deploy de producción**: `MONGO_URI=… python3 data/migrate_ux_fix.py --dry-run`, revisar y repetir sin `--dry-run`.
   MongoDB es compartido entre preview y producción: no migrar antes de que el código nuevo esté en producción.

### Verificación local (sin optimizador de imágenes)
| Página | Perf móvil / desktop | A11y | CLS | LCP móvil |
|---|---|---|---|---|
| `/` | 71 / 95 | 100 | 0 / 0.04 | 5.3 s |
| `/people` | 81 / 96 | 100 | 0 | 4.2 s |
| `/things` | 87 / 93 | 100 | 0 | 3.4 s |
| `/personal` | 72 / 92 | 100 | 0 | 5.1 s |
| `/info` | 69 / 86* | 100 | 0 | 13.7 s* |

\* medido con el retrato en GitHub raw (2 MB); ya corregido a `/images/about-photo.jpg` con variantes.
Performance/LCP hay que re-medirlos en el preview de Vercel.
