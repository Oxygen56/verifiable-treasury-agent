from pathlib import Path
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import landscape
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch
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
MUTED = HexColor("#61736C")

metrics = json.loads((ROOT / "evidence" / "benchmark.json").read_text())

def text(c, x, y, value, size=12, font="Helvetica", color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, value)

def wrapped(c, x, y, value, width, size=12, leading=16, font="Helvetica", color=INK):
    words = value.split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if c.stringWidth(trial, font, size) <= width:
            current = trial
        else:
            if current: lines.append(current)
            current = word
    if current: lines.append(current)
    for line in lines:
        text(c, x, y, line, size, font, color)
        y -= leading
    return y

def header(c, section, page):
    text(c, 0.55*inch, H-0.42*inch, "VERIFIABLE TREASURY AGENT", 9, "Helvetica-Bold", INK)
    c.setFont("Helvetica-Bold", 9); c.setFillColor(GREEN); c.drawRightString(W-0.55*inch, H-0.42*inch, section.upper())
    c.setStrokeColor(HexColor("#BCC5BF")); c.line(0.55*inch, H-0.52*inch, W-0.55*inch, H-0.52*inch)
    text(c, W-0.75*inch, 0.32*inch, f"0{page}", 9, "Helvetica-Bold", MUTED)

def chip(c, x, y, label, fill=LIME, color=INK):
    width = c.stringWidth(label, "Helvetica-Bold", 9) + 22
    c.setFillColor(fill); c.roundRect(x, y-5, width, 22, 4, fill=1, stroke=0)
    text(c, x+11, y+2, label, 9, "Helvetica-Bold", color)
    return width

def box(c, x, y, w, h, title, body, fill=white):
    c.setFillColor(fill); c.setStrokeColor(INK); c.setLineWidth(1); c.roundRect(x, y, w, h, 7, fill=1, stroke=1)
    text(c, x+16, y+h-25, title, 11, "Helvetica-Bold")
    wrapped(c, x+16, y+h-48, body, w-32, 10, 14, "Helvetica", MUTED)

c = canvas.Canvas(str(OUT), pagesize=(W, H))
OUT.parent.mkdir(parents=True, exist_ok=True)
c.setTitle("Verifiable Treasury Agent - Evidence Brief")
c.setAuthor("Oxygen56")
c.setSubject("NTU CCTF x SNZ InnovateX 2026 Track 1 supporting material")

# Page 1
c.setFillColor(PAPER); c.rect(0, 0, W, H, fill=1, stroke=0); header(c, "Track 1 - Payments and Financial Infrastructure", 1)
text(c, 0.7*inch, H-1.22*inch, "Move stablecoins.", 47, "Helvetica-Bold", INK)
text(c, 0.7*inch, H-1.87*inch, "Prove every control.", 47, "Helvetica-Bold", GREEN)
wrapped(c, 0.72*inch, H-2.45*inch, "An AI-orchestrated, contract-enforced cross-border treasury rail for approvals, policy binding, private commitments, revocable escrow, rollback, and reconciliation.", 6.3*inch, 16, 22, "Helvetica", INK)
chip(c, 0.72*inch, H-3.45*inch, "AI HAS NO PRIVILEGED ROLE")
chip(c, 3.05*inch, H-3.45*inch, "TESTNET ASSETS HAVE NO VALUE", MINT)
box(c, 7.7*inch, H-2.1*inch, 4.8*inch, 1.35*inch, "THE GAP", "A model's explanation is not proof that treasury limits, independent approvals, compliance status, privacy rules, or recovery paths actually ran.", white)
box(c, 7.7*inch, H-3.75*inch, 4.8*inch, 1.35*inch, "OUR ANSWER", "Only the smart contract can move state or escrowed tokens. Every critical path is independently inspectable through source, tests, events, balances, and receipts.", MINT)
text(c, 0.72*inch, 1.1*inch, "NTU CCTF x SNZ InnovateX 2026", 10, "Helvetica-Bold", MUTED)
text(c, 7.72*inch, 1.1*inch, "Public Group - Stage 1 evidence brief", 10, "Helvetica-Bold", MUTED)
c.showPage()

# Page 2
c.setFillColor(PAPER); c.rect(0, 0, W, H, fill=1, stroke=0); header(c, "Deterministic trust boundary", 2)
text(c, 0.7*inch, H-1.15*inch, "AI explains. Contracts enforce.", 32, "Helvetica-Bold")
nodes = [
    (0.8, 4.35, 2.0, 1.18, "1. PROPOSE", "Salted invoice commitment + exact policy digest"),
    (3.15, 4.35, 2.0, 1.18, "2. APPROVE", "One or two distinct signers based on value"),
    (5.5, 4.35, 2.0, 1.18, "3. FUND", "Daily limit + allowance + atomic escrow"),
    (7.85, 4.35, 2.0, 1.18, "4. CHALLENGE", "Cancelable before release; expiry rollback"),
    (10.2, 4.35, 2.0, 1.18, "5. RELEASE", "Policy rechecked; transfer + reconciliation"),
]
for i, (x, y, w, h, title, body) in enumerate(nodes):
    box(c, x*inch, y*inch, w*inch, h*inch, title, body, MINT if i in (1,3) else white)
    if i < len(nodes)-1:
        c.setStrokeColor(GREEN); c.setLineWidth(2); c.line((x+w)*inch+4, (y+h/2)*inch, (nodes[i+1][0])*inch-4, (y+h/2)*inch)
controls = [
    ("Excess spend", "Per-payer daily funding limit", "Failing tx leaves state and balances unchanged"),
    ("Single-person high value", "Two distinct approvers", "Duplicate approval rejected"),
    ("Sanctions / stale policy", "Expiring digest + status recheck", "Approval and release both gated"),
    ("Sensitive records", "Salted commitment only", "Raw invoice and KYC remain off-chain"),
    ("Dispute / stuck funds", "Pre-release cancel + expiry rollback", "Escrow returns to payer"),
]
text(c, 0.8*inch, 3.9*inch, "RISK", 9, "Helvetica-Bold", MUTED)
text(c, 3.5*inch, 3.9*inch, "ENFORCED CONTROL", 9, "Helvetica-Bold", MUTED)
text(c, 8.0*inch, 3.9*inch, "VERIFIABLE RESULT", 9, "Helvetica-Bold", MUTED)
y = 3.5*inch
for risk, control, result in controls:
    c.setStrokeColor(HexColor("#CBD1CC")); c.line(0.8*inch, y-8, 12.2*inch, y-8)
    text(c, 0.8*inch, y, risk, 11, "Helvetica-Bold")
    text(c, 3.5*inch, y, control, 11)
    text(c, 8.0*inch, y, result, 11, "Helvetica", GREEN)
    y -= 0.48*inch
chip(c, 0.8*inch, 0.72*inch, "REVOCABLE BEFORE RELEASE")
chip(c, 3.05*inch, 0.72*inch, "FINAL AFTER RELEASE", HexColor("#FFD8D1"), RED)
c.showPage()

# Page 3
c.setFillColor(INK); c.rect(0, 0, W, H, fill=1, stroke=0); header(c, "Measured evidence", 3)
text(c, 0.7*inch, H-1.15*inch, "Evidence, not promises.", 34, "Helvetica-Bold", white)
values = [
    (str(metrics["totals"]["transactionCount"]), "state-changing transactions"),
    (f'{int(metrics["totals"]["gasUsed"]):,}', "gas units - full high-value path"),
    ("PASSED" if metrics["reconciliation"]["passed"] else "FAILED", "escrow reconciliation invariant"),
]
for i, (value, label) in enumerate(values):
    x = (0.8 + i*4.15)*inch
    text(c, x, 4.85*inch, value, 34, "Helvetica-Bold", LIME)
    wrapped(c, x, 4.48*inch, label, 3.2*inch, 11, 15, "Helvetica", white)
text(c, 0.8*inch, 3.7*inch, "SEVEN PASSING CONTROLS", 10, "Helvetica-Bold", LIME)
tests = [
    "Low-value approval, escrow, delayed release, and selective disclosure",
    "Two distinct approvals required above the high-value threshold",
    "Sanction-status change blocks action without state mutation",
    "Funded settlement cancellation refunds the payer before release",
    "Permissionless expiry rollback reconciles escrow to zero",
    "Daily-limit failure is atomic across state and token balances",
    "Policy-digest change invalidates a previously approved release",
]
for i, line in enumerate(tests):
    col = 0 if i < 4 else 1
    row = i if i < 4 else i-4
    x = (0.8 + col*6.15)*inch; y = (3.3 - row*0.62)*inch
    c.setFillColor(LIME); c.circle(x+5, y+4, 4, fill=1, stroke=0)
    wrapped(c, x+20, y+9, line, 5.4*inch, 11, 15, "Helvetica", white)
text(c, 0.8*inch, 0.55*inch, "Local EVM measurements are reproducible. They do not claim public-RPC latency, fiat cost, production security, or regulatory approval.", 9, "Helvetica", HexColor("#9FB2AA"))
c.showPage()

# Page 4
c.setFillColor(PAPER); c.rect(0, 0, W, H, fill=1, stroke=0); header(c, "Open evidence and claim boundary", 4)
text(c, 0.7*inch, H-1.15*inch, "Built to be challenged.", 34, "Helvetica-Bold")
box(c, 0.8*inch, 3.7*inch, 3.65*inch, 1.65*inch, "OPEN SOURCE", "Apache-2.0 repository with contract source, tests, benchmark output, architecture, disclosure, and CI.", white)
box(c, 4.85*inch, 3.7*inch, 3.65*inch, 1.65*inch, "PUBLIC DEMO", "A judge-facing control room shows both the successful path and the failure paths that protect treasury funds.", MINT)
box(c, 8.9*inch, 3.7*inch, 3.65*inch, 1.65*inch, "BASE SEPOLIA", "Deployment evidence uses public testnet receipts and Circle test USDC. Test assets have no financial value.", white)
text(c, 0.8*inch, 3.1*inch, "HONEST CLAIM BOUNDARY", 10, "Helvetica-Bold", GREEN)
limits = [
    "Compliance digest demonstrates policy binding, not a certified sanctions-screening service.",
    "Salted commitments support selective disclosure; this is not a zero-knowledge privacy claim.",
    "Settlement is revocable before release; finalized transfers are not presented as reversible.",
    "Public testnet execution is evidence of functionality, not proof of production readiness.",
    "OpenAI Codex assisted research, implementation, testing, and documentation; core runtime authority remains deterministic and human-signed.",
]
y = 2.78*inch
for item in limits:
    c.setFillColor(GREEN); c.rect(0.82*inch, y+2, 6, 6, fill=1, stroke=0)
    wrapped(c, 1.02*inch, y+10, item, 11.2*inch, 10.5, 14, "Helvetica", INK)
    y -= 0.38*inch
text(c, 0.8*inch, 0.62*inch, "github.com/Oxygen56/verifiable-treasury-agent", 12, "Helvetica-Bold", INK)
text(c, 7.0*inch, 0.62*inch, "oxygen56.github.io/verifiable-treasury-agent", 12, "Helvetica-Bold", GREEN)
c.save()
print(OUT)
