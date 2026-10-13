"""Inline the brand photos into board.src.html -> ../ad-direction.html."""
import base64, pathlib, re
here = pathlib.Path(__file__).parent
src = (here / "board.src.html").read_text()
def sub(m):
    data = base64.b64encode((here / "photos" / f"{m.group(1)}.jpg").read_bytes()).decode()
    return f"data:image/jpeg;base64,{data}"
out = re.sub(r"\{\{img:([a-z-]+)\}\}", sub, src)
(here.parent / "ad-direction.html").write_text(out)
print(len(out))
