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
archive-*.html    — Páginas standalone de archivo (no usan style.css, tienen <style> inline)
shared.css        — Estilos compartidos
shared.js         — JS compartido
vercel.json       — Configuración de routing Vercel
```

---

## Arquitectura CSS Importante

### Elementos fixed (siempre encima del contenido)
- `.site-logo` → `position: fixed; top: 21px; left: 24px; z-index: 200`
  - La imagen del logo: `height: 40px; width: auto`
- `.menu-btn` → `position: fixed; top: 14px; right: 24px; z-index: 200; font-size: 48px`
- Altura combinada desde arriba: ~62px — cualquier contenido debe tener al menos 80px de padding-top para no quedar tapado

### Cache busting de CSS
El link de style.css en `index.html` usa versión: `<link rel="stylesheet" href="style.css?v=N" />`
**Incrementar `v=N` cada vez que se modifique style.css** para forzar recarga en browsers.
Versión actual: **v=8**

### Páginas de archivo (archive-*.html)
Estas páginas NO importan `style.css`. Tienen su propio bloque `<style>` inline.
Por eso, reglas como `.site-logo img { height: 40px }` deben estar explícitamente en el `<style>` de cada archivo.
Archivos: `archive-filmstrip-v1.html`, `archive-intro-v1.html`, `archive-personal-v1.html`, `archive-intro-loader-v1.html`

### Things page (masonry grid)
- Sección: `id="page-things"`, clase `page-grid-section`
- Grid: `.portfolio-grid` con columnas `.portfolio-column` (flex)
- 3 cols desktop / 2 cols tablet / 1 col mobile
- `padding-top: 80px` en todas las breakpoints para clearance del header fixed

---

## Diseño y UX

### Logo
- Archivo: `/images/logo.svg`
- Tamaño fijo: `height: 40px; width: auto`
- En la SPA (`index.html`) el estilo viene de `style.css`
- En páginas standalone el estilo debe estar inline

### Cursor personalizado
- El sitio tiene cursor custom (`.cursor` element)
- `.site-logo` usa `cursor: none` (no el cursor del sistema)

### Menu overlay
- Clase `body.menu-open` oculta el logo: `.site-logo { opacity: 0; pointer-events: none }`
- El `.menu-name` dentro del overlay también usa el logo SVG

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
