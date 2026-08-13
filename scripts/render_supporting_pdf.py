from pathlib import Path
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import landscape
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
import json


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "verifiable-treasury-agent-evidence.pdf"
W, H = landscape((13.333 * inch, 7.5 * inch))

INK = HexColor("#10231D")
PAPER = HexColor("#F5F2E9")
LIME = HexColor("#C8FF42")
MINT = HexColor("#DFFFE8")
GREEN = HexColor("#3F6F25")
RED = HexColor("#B73D2D")
RED_PALE = HexColor("#FFD8D1")
MUTED = HexColor("#61736C")
LINE = HexColor("#C7CEC9")
BLUE = HexColor("#245A71")

evidence = json.loads((ROOT / "evidence" / "base-sepolia-v2.json").read_text())
tx_by_label = {row["label"]: row for row in evidence["transactions"]}

REPO = "https://github.com/Oxygen56/verifiable-treasury-agent"
DEMO = "https://oxygen56.github.io/verifiable-treasury-agent/"
TREASURY = f"https://sepolia.basescan.org/address/{evidence['treasury']}"


def draw_text(c, x, y, value, size=12, font="Helvetica", color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, value)


def draw_right(c, x, y, value, size=12, font="Helvetica", color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, value)


def wrapped(c, x, y, value, width, size=12, leading=16, font="Helvetica", color=INK, max_lines=None):
    words = value.split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if c.stringWidth(trial, font, size) <= width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    if max_lines is not None:
        lines = lines[:max_lines]
    for line in lines:
        draw_text(c, x, y, line, size, font, color)
        y -= leading
    return y


def page_base(c, section, page, dark=False):
    bg = INK if dark else PAPER
    fg = white if dark else INK
    c.setFillColor(bg)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    draw_text(c, 0.55 * inch, H - 0.42 * inch, "VERIFIABLE TREASURY AGENT / V2", 9, "Helvetica-Bold", fg)
    draw_right(c, W - 0.55 * inch, H - 0.42 * inch, section.upper(), 9, "Helvetica-Bold", LIME if dark else GREEN)
    c.setStrokeColor(HexColor("#51635C") if dark else LINE)
    c.line(0.55 * inch, H - 0.52 * inch, W - 0.55 * inch, H - 0.52 * inch)
    draw_right(c, W - 0.55 * inch, 0.30 * inch, f"0{page}", 9, "Helvetica-Bold", HexColor("#9FB2AA") if dark else MUTED)


def chip(c, x, y, label, fill=LIME, color=INK):
    width = c.stringWidth(label, "Helvetica-Bold", 9) + 22
    c.setFillColor(fill)
    c.roundRect(x, y - 5, width, 22, 4, fill=1, stroke=0)
    draw_text(c, x + 11, y + 2, label, 9, "Helvetica-Bold", color)
    return width


def card(c, x, y, w, h, title, body, fill=white, title_color=INK, body_color=MUTED):
    c.setFillColor(fill)
    c.setStrokeColor(INK)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 7, fill=1, stroke=1)
    draw_text(c, x + 16, y + h - 25, title, 11, "Helvetica-Bold", title_color)
    wrapped(c, x + 16, y + h - 48, body, w - 32, 9.5, 13, "Helvetica", body_color)


def status_row(c, x, y, step, title, tx, status, status_fill, note):
    c.setFillColor(white)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, 4.82 * inch, 0.72 * inch, 6, fill=1, stroke=1)
    c.setFillColor(INK)
    c.circle(x + 0.28 * inch, y + 0.36 * inch, 0.17 * inch, fill=1, stroke=0)
    draw_text(c, x + 0.235 * inch, y + 0.315 * inch, str(step), 9, "Helvetica-Bold", white)
    draw_text(c, x + 0.55 * inch, y + 0.44 * inch, title, 10, "Helvetica-Bold", INK)
    short_hash = f"{tx['hash'][:10]}...{tx['hash'][-6:]}"
    draw_text(c, x + 0.55 * inch, y + 0.20 * inch, short_hash, 8.5, "Courier", BLUE)
    c.linkURL(tx["explorer"], (x + 0.53 * inch, y + 0.13 * inch, x + 2.36 * inch, y + 0.32 * inch), relative=0)
    badge_w = c.stringWidth(status, "Helvetica-Bold", 8.5) + 18
    c.setFillColor(status_fill)
    c.roundRect(x + 3.50 * inch, y + 0.36 * inch, badge_w, 0.22 * inch, 4, fill=1, stroke=0)
    draw_text(c, x + 3.50 * inch + 9, y + 0.405 * inch, status, 8.5, "Helvetica-Bold", INK if status_fill != RED else white)
    draw_right(c, x + 4.58 * inch, y + 0.17 * inch, note, 8.5, "Helvetica", MUTED)


def link_label(c, x, y, label, url, width):
    c.setFillColor(MINT)
    c.setStrokeColor(INK)
    c.roundRect(x, y, width, 0.42 * inch, 5, fill=1, stroke=1)
    draw_text(c, x + 0.16 * inch, y + 0.14 * inch, label, 10, "Helvetica-Bold", INK)
    c.linkURL(url, (x, y, x + width, y + 0.42 * inch), relative=0)


c = canvas.Canvas(str(OUT), pagesize=(W, H))
OUT.parent.mkdir(parents=True, exist_ok=True)
c.setTitle("Verifiable Treasury Agent V2 - Public Evidence Brief")
c.setAuthor("Oxygen56")
c.setSubject("NTU CCTF x SNZ InnovateX 2026 Track 1 - public Base Sepolia evidence")

# Page 1 - memorable outcome
page_base(c, "Public Base Sepolia proof", 1)
chip(c, 0.72 * inch, H - 1.02 * inch, "V2 BASE SEPOLIA - VERIFIED")
draw_text(c, 0.72 * inch, H - 1.72 * inch, "The payment that", 42, "Helvetica-Bold", INK)
draw_text(c, 0.72 * inch, H - 2.32 * inch, "refuses to pay.", 42, "Helvetica-Bold", GREEN)
wrapped(
    c,
    0.75 * inch,
    H - 2.82 * inch,
    "An unsigned AI-assisted treasury plan becomes a payer-signed intent. Separate role-wallet approvals and fresh risk credentials gate escrow. A late synthetic sanctions update then forces a real on-chain release failure and a full payer refund.",
    5.8 * inch,
    14,
    19,
    "Helvetica",
    INK,
)
chip(c, 0.75 * inch, H - 4.30 * inch, "26 PUBLIC RECEIPTS")
chip(c, 2.76 * inch, H - 4.30 * inch, "SEPARATE ADDRESSES", MINT)
chip(c, 4.59 * inch, H - 4.30 * inch, "ESCROW = 0", MINT)

draw_text(c, 7.15 * inch, H - 1.02 * inch, "THE CHAIN-LINKED FAILURE PATH", 10, "Helvetica-Bold", GREEN)
status_row(c, 7.15 * inch, 4.72 * inch, 1, "Fund 15,000 mUSD escrow", tx_by_label["2 payer funds revocable escrow"], "STATUS 1", MINT, "funded")
status_row(c, 7.15 * inch, 3.75 * inch, 2, "Synthetic sanctions update", tx_by_label["2 synthetic sanctions update freezes beneficiary"], "STATUS 1", MINT, "risk epoch +1")
status_row(c, 7.15 * inch, 2.78 * inch, 3, "Release is rejected on chain", tx_by_label["2 release blocked on-chain after sanctions update"], "STATUS 0", RED, "no transfer")
status_row(c, 7.15 * inch, 1.81 * inch, 4, "Payer cancels and is refunded", tx_by_label["2 payer cancels and receives full refund"], "STATUS 1", MINT, "15,000 back")

c.setFillColor(INK)
c.rect(0, 0, W, 0.78 * inch, fill=1, stroke=0)
draw_text(c, 0.72 * inch, 0.44 * inch, "BOUNDARY", 9, "Helvetica-Bold", LIME)
draw_text(c, 1.65 * inch, 0.44 * inch, "Valueless project mUSD - not USDC. SG-CN and sanctions inputs are synthetic. Public testnet evidence - not production settlement.", 9.5, "Helvetica", white)
c.showPage()

# Page 2 - deterministic trust boundary
page_base(c, "Deterministic trust boundary", 2)
draw_text(c, 0.7 * inch, H - 1.14 * inch, "AI proposes. Payer signs.", 31, "Helvetica-Bold", INK)
draw_text(c, 0.7 * inch, H - 1.66 * inch, "The contract alone moves value.", 31, "Helvetica-Bold", GREEN)

nodes = [
    (0.72, "1", "TYPED PLAN", "Deterministic planner emits an unsigned EIP-712 payload."),
    (3.25, "2", "PAYER SIGN", "Nonce, order, payer, beneficiary, amount, route, quote and clearance are bound."),
    (5.78, "3", "2 APPROVALS", "High value requires two live, distinct-role wallets."),
    (8.31, "4", "FUND ESCROW", "Quote TTL, risk freshness, capacity and exact token delta rechecked."),
    (10.84, "5", "RELEASE / REFUND", "Challenge starts at funding. Risk changes fail closed."),
]
for i, (x, n, title, body) in enumerate(nodes):
    fill = MINT if i in (0, 2, 4) else white
    card(c, x * inch, 3.92 * inch, 2.05 * inch, 1.42 * inch, f"{n}. {title}", body, fill)
    if i < len(nodes) - 1:
        c.setStrokeColor(GREEN)
        c.setLineWidth(2)
        c.line((x + 2.05) * inch + 5, 4.63 * inch, nodes[i + 1][0] * inch - 5, 4.63 * inch)

controls = [
    ("AUTHORITY", "Permissionless relayer may submit, but cannot invent payer intent or sign transactions."),
    ("SEGREGATION", "Admin is not a business role. Operator, approver and compliance roles cannot overlap."),
    ("LIVE CREDENTIALS", "Role and risk membership epochs prevent revoked actors or stale votes from reviving."),
    ("PRIVACY BOUNDARY", "A domain-separated salted invoice commitment supports selective disclosure; raw records remain off chain."),
    ("SOLVENCY", "Exact balance deltas and totalEscrowed accounting reject fee tokens and prove liabilities."),
    ("ROLLBACK", "Before release, sanctions or expiry can block movement and return all escrow to the payer."),
]
for idx, (title, body) in enumerate(controls):
    col = idx % 3
    row = idx // 3
    x = (0.72 + col * 4.18) * inch
    y = (2.22 - row * 1.12) * inch
    card(c, x, y, 3.78 * inch, 0.98 * inch, title, body, white if row else MINT)

draw_text(c, 0.72 * inch, 0.62 * inch, "REAL CODEX TRACE", 8.5, "Helvetica-Bold", GREEN)
draw_text(c, 2.02 * inch, 0.62 * inch, "Read-only / schema-valid / 27.432 s / no signing, broadcast or state change", 8.5, "Helvetica", MUTED)
draw_text(c, 0.72 * inch, 0.38 * inch, "Claim discipline: AI assists explanation and orchestration. Core state transitions are deterministic, payer-signed and contract-verifiable.", 8.8, "Helvetica-Bold", MUTED)
c.showPage()

# Page 3 - concrete public receipts and reconciliation
page_base(c, "Receipts and reconciliation", 3, dark=True)
draw_text(c, 0.7 * inch, H - 1.12 * inch, "Two outcomes. One accounting truth.", 33, "Helvetica-Bold", white)

c.setFillColor(white)
c.roundRect(0.72 * inch, 2.68 * inch, 5.74 * inch, 2.62 * inch, 8, fill=1, stroke=0)
draw_text(c, 0.98 * inch, 4.96 * inch, "CLEAN PATH", 10, "Helvetica-Bold", GREEN)
draw_text(c, 0.98 * inch, 4.56 * inch, "15,000 mUSD released", 25, "Helvetica-Bold", INK)
draw_text(c, 0.98 * inch, 4.23 * inch, "to a separate beneficiary address", 14, "Helvetica-Bold", GREEN)
clean_tx = tx_by_label["1 clean settlement releases to distinct beneficiary"]
draw_text(c, 0.98 * inch, 3.77 * inch, f"release  {clean_tx['hash'][:18]}...{clean_tx['hash'][-8:]}", 9, "Courier", BLUE)
c.linkURL(clean_tx["explorer"], (0.96 * inch, 3.68 * inch, 4.80 * inch, 3.91 * inch), relative=0)
draw_text(c, 0.98 * inch, 3.28 * inch, "Final state", 9, "Helvetica-Bold", MUTED)
draw_text(c, 2.12 * inch, 3.28 * inch, "Released (4)", 10, "Helvetica-Bold", INK)
draw_text(c, 3.62 * inch, 3.28 * inch, "Beneficiary", 9, "Helvetica-Bold", MUTED)
draw_right(c, 6.13 * inch, 3.28 * inch, "15,000 mUSD", 10, "Helvetica-Bold", GREEN)

c.setFillColor(white)
c.roundRect(6.86 * inch, 2.68 * inch, 5.74 * inch, 2.62 * inch, 8, fill=1, stroke=0)
draw_text(c, 7.12 * inch, 4.96 * inch, "BLOCKED PATH", 10, "Helvetica-Bold", RED)
draw_text(c, 7.12 * inch, 4.56 * inch, "Release status 0", 25, "Helvetica-Bold", RED)
draw_text(c, 7.12 * inch, 4.23 * inch, "then full payer refund", 14, "Helvetica-Bold", GREEN)
blocked_tx = tx_by_label["2 release blocked on-chain after sanctions update"]
refund_tx = tx_by_label["2 payer cancels and receives full refund"]
draw_text(c, 7.12 * inch, 3.83 * inch, f"blocked {blocked_tx['hash'][:16]}...{blocked_tx['hash'][-8:]}", 8.8, "Courier", BLUE)
c.linkURL(blocked_tx["explorer"], (7.10 * inch, 3.73 * inch, 10.85 * inch, 3.96 * inch), relative=0)
draw_text(c, 7.12 * inch, 3.53 * inch, f"refund  {refund_tx['hash'][:16]}...{refund_tx['hash'][-8:]}", 8.8, "Courier", BLUE)
c.linkURL(refund_tx["explorer"], (7.10 * inch, 3.43 * inch, 10.85 * inch, 3.66 * inch), relative=0)
draw_text(c, 7.12 * inch, 3.10 * inch, "Final state", 9, "Helvetica-Bold", MUTED)
draw_text(c, 8.26 * inch, 3.10 * inch, "Cancelled (5)", 10, "Helvetica-Bold", INK)
draw_text(c, 9.90 * inch, 3.10 * inch, "Blocked beneficiary", 9, "Helvetica-Bold", MUTED)
draw_right(c, 12.27 * inch, 3.10 * inch, "0 mUSD", 10, "Helvetica-Bold", RED)

draw_text(c, 0.72 * inch, 2.25 * inch, "FINAL RECONCILIATION", 10, "Helvetica-Bold", LIME)
recon = [
    ("Payer", "15,000 mUSD"),
    ("Clean beneficiary", "15,000 mUSD"),
    ("Blocked beneficiary", "0 mUSD"),
    ("Escrow", "0 mUSD"),
    ("totalEscrowed", "0"),
    ("Solvent", "TRUE"),
]
for idx, (label, value) in enumerate(recon):
    x = (0.72 + idx * 2.07) * inch
    draw_text(c, x, 1.85 * inch, label, 8.5, "Helvetica-Bold", HexColor("#9FB2AA"))
    draw_text(c, x, 1.53 * inch, value, 13, "Helvetica-Bold", LIME if idx in (4, 5) else white)

draw_text(c, 0.72 * inch, 1.03 * inch, "TREASURY", 8.5, "Helvetica-Bold", HexColor("#9FB2AA"))
draw_text(c, 1.78 * inch, 1.03 * inch, evidence["treasury"], 9.5, "Courier", white)
c.linkURL(TREASURY, (1.75 * inch, 0.92 * inch, 6.20 * inch, 1.15 * inch), relative=0)
draw_text(c, 6.86 * inch, 1.03 * inch, "READ-ONLY CHECK", 8.5, "Helvetica-Bold", HexColor("#9FB2AA"))
draw_text(c, 8.55 * inch, 1.03 * inch, "26 receipts / disclosure / solvency: PASSED", 9.5, "Helvetica-Bold", LIME)
draw_text(c, 0.72 * inch, 0.55 * inch, "All addresses and transaction links are public. The disclosed invoice is intentionally synthetic; no real customer data is present.", 9, "Helvetica", HexColor("#9FB2AA"))
c.showPage()

# Page 4 - verification depth and boundary
page_base(c, "Verification and claim ledger", 4)
draw_text(c, 0.7 * inch, H - 1.12 * inch, "Deep evidence. Narrow claims.", 34, "Helvetica-Bold", INK)

metrics = [
    ("37", "repository checks", "30 current V2 + 7 historical V1 controls"),
    ("64", "deterministic paths", "generated state-path matrix, not formal fuzzing"),
    ("99.14%", "V2 line coverage", "45.45% branch coverage"),
    ("0", "triaged high/medium", "Slither project-code findings; not an audit"),
    ("22,427 B", "runtime bytecode", "2,149 bytes below EIP-170"),
    ("26", "public receipts", "25 success + 1 expected status-0 failure"),
]
for idx, (value, label, note) in enumerate(metrics):
    col = idx % 3
    row = idx // 3
    x = (0.72 + col * 4.18) * inch
    y = (4.44 - row * 1.26) * inch
    c.setFillColor(MINT if row == 0 else white)
    c.setStrokeColor(INK)
    c.roundRect(x, y, 3.80 * inch, 0.98 * inch, 7, fill=1, stroke=1)
    value_size = 19 if len(value) > 5 else 22
    draw_text(c, x + 0.16 * inch, y + 0.52 * inch, value, value_size, "Helvetica-Bold", GREEN)
    draw_text(c, x + 1.44 * inch, y + 0.58 * inch, label, 10, "Helvetica-Bold", INK)
    wrapped(c, x + 1.44 * inch, y + 0.34 * inch, note, 2.15 * inch, 8, 10, "Helvetica", MUTED, 2)

draw_text(c, 0.72 * inch, 2.80 * inch, "WHAT IS PROVEN", 9.5, "Helvetica-Bold", GREEN)
proven = [
    "Separate role wallets, payer-signed intent, two approvals, exact escrow accounting",
    "Risk update after funding blocks release on chain, then full refund reconciles",
    "Salted, domain-bound commitment opens correctly and rejects altered disclosure",
]
for idx, item in enumerate(proven):
    c.setFillColor(GREEN)
    c.circle(0.82 * inch, (2.46 - idx * 0.36) * inch, 3.5, fill=1, stroke=0)
    draw_text(c, 1.02 * inch, (2.41 - idx * 0.36) * inch, item, 9.3, "Helvetica", INK)

draw_text(c, 6.86 * inch, 2.80 * inch, "WHAT IS NOT CLAIMED", 9.5, "Helvetica-Bold", RED)
limits = [
    "No USDC, fiat, FX, off-ramp, bridge or real cross-border settlement",
    "No certified sanctions/KYC feed; SG-CN and screening inputs are synthetic",
    "No ZK privacy, independent audit, formal verification or production key management",
]
for idx, item in enumerate(limits):
    c.setFillColor(RED)
    c.rect(6.86 * inch, (2.41 - idx * 0.36) * inch, 7, 7, fill=1, stroke=0)
    draw_text(c, 7.08 * inch, (2.41 - idx * 0.36) * inch, item, 9.3, "Helvetica", INK)

draw_text(c, 0.72 * inch, 1.25 * inch, "PUBLIC OBSERVATION", 8.5, "Helvetica-Bold", GREEN)
draw_text(c, 2.10 * inch, 1.25 * inch, "9,303,697 gas | 0.00005595 test ETH | 736 s block span | median 7.499 s (n=9 retained client timings)", 8.5, "Helvetica", MUTED)

link_label(c, 0.72 * inch, 0.62 * inch, "OPEN REPOSITORY", REPO, 2.48 * inch)
link_label(c, 3.45 * inch, 0.62 * inch, "JUDGE CONTROL ROOM", DEMO, 2.75 * inch)
link_label(c, 6.45 * inch, 0.62 * inch, "BASE SEPOLIA CONTRACT", TREASURY, 2.90 * inch)
draw_right(c, 12.60 * inch, 0.78 * inch, "NTU CCTF x SNZ InnovateX 2026 / Track 1", 9, "Helvetica-Bold", MUTED)
c.showPage()

c.save()
print(OUT)
