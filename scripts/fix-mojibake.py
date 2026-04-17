"""
One-shot mojibake sweep.

Reads UTF-8 source files and replaces known mojibake sequences produced by
UTF-8 bytes being misread as Windows-1252 (or similar) and re-saved as UTF-8.

Run from repo root: `python scripts/fix-mojibake.py`
"""

import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.join(os.path.dirname(__file__), "..", "src")
ROOT = os.path.abspath(ROOT)

# Longer patterns first so they win against shorter prefixes.
MAP = [
    ("\u00e2\u20ac\u2122", "\u2019"),  # right single quote
    ("\u00e2\u20ac\u02dc", "\u2018"),  # left single quote
    ("\u00e2\u20ac\u0153", "\u201c"),  # left double quote
    ("\u00e2\u20ac\u009d", "\u201d"),  # right double quote (bare)
    ("\u00e2\u20ac\u201d", "\u2014"),  # em dash
    ("\u00e2\u20ac\u201c", "\u2013"),  # en dash
    ("\u00c3\u2014",       "\u00d7"),  # multiplication sign
    ("\u00c3\u00a9",       "\u00e9"),  # e-acute
    ("\u00c3\u00a8",       "\u00e8"),  # e-grave
    ("\u00c3\u00a1",       "\u00e1"),  # a-acute
    ("\u00c3\u00a0",       "\u00e0"),  # a-grave
    ("\u00c3\u00a2",       "\u00e2"),  # a-circumflex
    ("\u00c3\u00bc",       "\u00fc"),  # u-umlaut
    ("\u00c3\u00b6",       "\u00f6"),  # o-umlaut
    ("\u00c3\u00a4",       "\u00e4"),  # a-umlaut
]

EXTS = (".ts", ".tsx", ".js", ".jsx", ".md", ".css", ".html", ".json")
SKIP_DIRS = {"node_modules", "dist", ".git", "build"}

hits = {}
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if not fn.endswith(EXTS):
            continue
        p = os.path.join(dirpath, fn)
        try:
            with open(p, "r", encoding="utf-8") as f:
                orig = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        txt = orig
        for bad, good in MAP:
            txt = txt.replace(bad, good)
        if txt != orig:
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(txt)
            counts = {bad: orig.count(bad) for bad, _ in MAP if bad in orig}
            hits[p] = counts

print(f"Files changed: {len(hits)}")
total = 0
for p, counts in sorted(hits.items()):
    rel = os.path.relpath(p, os.path.abspath(os.path.join(ROOT, ".."))).replace("\\", "/")
    parts = ", ".join(f"{v} of {repr(k)}" for k, v in counts.items())
    total += sum(counts.values())
    print(f"  {rel}: {parts}")
print(f"Total replacements: {total}")
