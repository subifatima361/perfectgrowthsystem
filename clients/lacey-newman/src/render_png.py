"""Render every ad in board.src.html to a 1080x1080 PNG, with photo areas replaced by marked image slots."""
import pathlib, re
here = pathlib.Path(__file__).parent
SLOTS = {  # photo -> (ad id, slot size at 1080)
    "lacey-kitchen": ("1A", "410 × 1080"),
    "lacey-wall": ("1D", "1080 × 605"),
    "laptop-rattan": ("2B", "1080 × 648"),
    "lacey-chair": ("2E", "583 × 583 circle"),
    "planner": ("3A", "475 × 562"),
    "incense-desk": ("3D", "518 × 1080"),
}
src = (here / "board.src.html").read_text()
def slot(m):
    ad, size = SLOTS[m.group(1)]
    return f'data-slot="IMAGE SLOT {ad}" data-size="{size} px · see prompt {ad}"'
src = re.sub(r'style="background-image:url\(\{\{img:([a-z-]+)\}\}\)"', slot, src)
css = """<style>
.ads{grid-template-columns:1080px!important}
.ad{width:1080px!important;height:1080px!important;aspect-ratio:auto!important;max-width:none!important;box-shadow:none!important;transform:none!important}
.ad .photo[data-slot]{background:repeating-linear-gradient(135deg,#E9E4DC 0 18px,#DDD6CB 18px 36px)!important;display:grid;place-content:center;text-align:center;gap:10px;outline:4px dashed #BF5E3D;outline-offset:-14px}
.ad .photo[data-slot]::before{content:attr(data-slot);font:600 30px/1.1 Montserrat,sans-serif;letter-spacing:.12em;color:#062A2E;padding:0 24px}
.ad .photo[data-slot]::after{content:attr(data-size);font:500 20px/1.3 Montserrat,sans-serif;color:#062A2E;opacity:.75;padding:0 24px;position:static;background:none}
</style>"""
(here / "render.tmp.html").write_text(src + css)
