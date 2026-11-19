# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Turn friendly values ("4.7k", "10uF", "1M", "2.2 kΩ") into plain numbers.

Kid rule, not SPICE rule: capital M means MEGA (1M = 1,000,000) and small m means
milli. SPICE itself treats both as milli, which trips everyone up, so we never pass
suffixes to ngspice - only plain numbers.
"""
import re

_SUFFIX = {
    "f": 1e-15, "p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6,
    "m": 1e-3, "k": 1e3, "K": 1e3, "M": 1e6, "meg": 1e6, "Meg": 1e6, "MEG": 1e6,
    "G": 1e9, "": 1.0,
}
_UNITS = ("ohms", "ohm", "Ω", "F", "H", "V", "A", "Hz", "hz", "s", "W", "%")
_RE = re.compile(r"^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|Meg|MEG|[fpnuµμmkKMG]?)\s*$")
# "4k7" style (common on resistor packets): digit, suffix letter, digits
_RE_INFIX = re.compile(r"^\s*(\d+)([pnuµμmkKMGR])(\d+)\s*$")


class BadValue(ValueError):
    pass


def parse_value(text, what="value"):
    """Return a float from a friendly string. Raises BadValue with a kid-readable message."""
    if isinstance(text, (int, float)):
        return float(text)
    s = str(text).strip().replace(",", ".")
    m = _RE_INFIX.match(s)
    if m:
        whole, suf, frac = m.groups()
        mult = 1.0 if suf == "R" else _SUFFIX[suf]
        return float(f"{whole}.{frac}") * mult
    for u in sorted(_UNITS, key=len, reverse=True):
        if s.endswith(u) and len(s) > len(u):
            s = s[: -len(u)].strip()
            break
    m = _RE.match(s)
    if not m:
        raise BadValue(f"I can't read '{text}' as a {what}. Try something like 4.7k, 100n or 9.")
    num, suf = m.groups()
    return float(num) * _SUFFIX[suf]


def pretty(x, unit=""):
    """Format a number the friendly way: 0.0047 -> '4.7 m', 12000 -> '12 k'."""
    if x == 0:
        return f"0 {unit}".strip()
    a = abs(x)
    for mult, suf in ((1e9, "G"), (1e6, "M"), (1e3, "k"), (1, ""), (1e-3, "m"), (1e-6, "µ"), (1e-9, "n"), (1e-12, "p")):
        if a >= mult * 0.9995:
            v = x / mult
            txt = f"{v:.3g}"
            return f"{txt} {suf}{unit}".strip()
    return f"{x:.3g} {unit}".strip()
