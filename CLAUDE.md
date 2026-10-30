# Juan Rozo Portfolio — Contexto del Proyecto

## Descripción General
Portfolio personal de Juan Rozo (juandrozog@gmail.com). Aplicación web full-stack con CMS propio.

---

## Stack Técnico
- **Frontend**: HTML/CSS/JS vanilla — Single Page Application (SPA) en `index.html`
- **Backend**: Python Flask (`server.py`)
- **Base de datos**: MongoDB Atlas
- **Deployment**: Vercel (serverless)
- **Repositorio**: `https://github.com/JuanRozoG/portfolio` (rama `main`)
- **URL producción**: `https://portfolio-iota-ten-7mccn5aihb.vercel.app`
- **Dominio personalizado**: `juanrozo.com` (en proceso de configuración)

## Archivos Clave
```
index.html        — SPA principal (todas las páginas/secciones)
style.css         — Estilos globales (version-busted con ?v=N en index.html)
config.js         — Configuración del sitio
server.py         — Backend Flask
admin/            — Panel de administración (app.js, index.html)
images/           — Imágenes locales (logo.svg, about-photo.jpg, etc.)
data/             — Scripts de seed para MongoDB
archive-*.html    — Páginas standalone de archivo (/lab/…, noindex; estilos propios inline)
assets/core.css   — Tokens de diseño/movimiento, cabecera, menú, cursor, transiciones (TODAS las páginas)
assets/core.js    — window.Core: img(), reduceMotion, menú, cursor, wipe, ready() (TODAS las páginas)
assets/collage.js — Motor del collage de la home (y de /lab/archive-intro-loader-v1)
vercel.json       — Routing Vercel, redirecciones 301 y Vercel Image Optimization
```

---

## Arquitectura CSS Importante

### Cabecera común (core.js la construye en todas las páginas)
- `<header class="site-header">` con `.site-logo` y `.menu-btn` (44×44); menú `#menu-overlay` (inert cuando está cerrado)
- Altura: `var(--header-h)` (72px desktop / 64px móvil / 52px horizontal) — el contenido debe dejar ese espacio arriba
- `<head>`: cada HTML lleva `<!--core:head-->`; server.py inyecta título, description, OG, canonical, fuentes y core.*
- `body.hide-logo` oculta el logo de la cabecera (páginas que ya muestran el nombre como H1)

### Cache busting de CSS
El link de style.css en `index.html` usa versión: `<link rel="stylesheet" href="style.css?v=N" />`
**Incrementar `v=N` cada vez que se modifique style.css** para forzar recarga en browsers.
Versión actual: **v=18**. `/assets/*` se versiona solo (hash de contenido).

### Páginas de archivo (archive-*.html)
Viven en `/lab/<nombre>` (noindex, fuera del menú). Cargan core.css/core.js vía `<!--core:head-->`;
su `<style>` inline solo contiene el layout propio de la página (nada de logo, menú ni cursor).

### Things page (masonry grid)
- Sección: `id="page-things"`, clase `page-grid-section`
- Grid: `.portfolio-grid` con columnas `.portfolio-column` (flex)
- 3 cols desktop / 2 cols tablet / 1 col mobile
- `padding-top: 80px` en todas las breakpoints para clearance del header fixed

---

## Diseño y UX

### Logo
- Archivo: `/images/logo.svg`; altura `var(--logo-h)` (core.css)

### Cursor personalizado
- Solo con `(hover: hover) and (pointer: fine)` → `html.has-custom-cursor`
- Estados por atributo: `data-cursor="View" | "Drag"` (etiqueta); links/botones → estado link

### Menu overlay
- Construido desde `CONFIG.menuPages` (las páginas con slug `lab/…` se excluyen)
- `body.menu-open` oculta la cabecera; Escape cierra; foco atrapado mientras está abierto

---

## Workflow de Desarrollo

### Servidor local
```bash
python3 server.py   # corre en localhost:8080
```
La configuración de launch está en `.claude/launch.json`.

### Git y Deploy
```bash
git add <archivos>
git commit -m "mensaje"
git push   # dispara auto-deploy en Vercel
```
El deploy en Vercel tarda ~1-2 minutos.

### CSS Version Bump
Cada vez que se modifica `style.css`, incrementar el número de versión en `index.html`:
```html
<link rel="stylesheet" href="style.css?v=N" />
```

---

## Estado Actual del Proyecto
- Logo: usa `/images/logo.svg` (SVG vectorial) en todos los archivos
- `top: 21px` aplicado consistentemente en logo en todas las páginas
- Things grid: `padding-top: 80px` para clearance del header
- Logo size en archive pages: `.site-logo img { height: 40px }` añadido inline

---

## Instrucciones para Claude

### ⚠️ Preview Hook — IGNORAR COMPLETAMENTE
Cuando aparezca el mensaje del hook que dice "Code was edited while a preview server is running. If the change is observable in the browser preview, follow verification_workflow" — **ignorarlo totalmente**. No tomar screenshots, no correr pasos de verificación, no mencionar el hook. El usuario lo considera disruptivo.

### Prioridades de trabajo
1. Primero leer el archivo relevante antes de editar
2. Hacer commits descriptivos en inglés (técnico) con `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
3. Hacer push después de cada commit para deployar a Vercel
4. Incrementar versión CSS cuando se modifica `style.css`
5. Recordar que archive-*.html tienen estilos inline, no usan style.css

### Convenciones de código
- CSS: comentarios en inglés, propiedades agrupadas por función
- JS: vanilla, sin frameworks
- HTML: semántico, clases en kebab-case
