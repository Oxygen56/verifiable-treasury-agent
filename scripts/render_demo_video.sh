#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/output/video"
OUTPUT_FILE="$OUTPUT_DIR/verifiable-treasury-agent-v2-demo.mp4"
PDF_FILE="$ROOT_DIR/output/pdf/verifiable-treasury-agent-evidence.pdf"
PDFTOPPM="${VTA_PDFTOPPM:-$(command -v pdftoppm || true)}"
VOICE="${VTA_DEMO_VOICE:-Samantha}"
RATE="${VTA_DEMO_RATE:-220}"

for tool in ffmpeg ffprobe say; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
done

test -n "$PDFTOPPM" && test -x "$PDFTOPPM" || {
  echo "Missing required tool: pdftoppm (install Poppler or set VTA_PDFTOPPM)" >&2
  exit 1
}

required_assets=(
  "$ROOT_DIR/demo/og-image.png"
  "$ROOT_DIR/output/images/v2-control-room.png"
  "$ROOT_DIR/output/images/v2-evidence-ledger.png"
  "$PDF_FILE"
)

for asset in "${required_assets[@]}"; do
  test -s "$asset" || {
    echo "Missing required asset: $asset" >&2
    exit 1
  }
done

mkdir -p "$OUTPUT_DIR" "$ROOT_DIR/tmp/video"
WORK_DIR="$(mktemp -d "$ROOT_DIR/tmp/video/render.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

PDF_FRAME_DIR="$WORK_DIR/pdf"
mkdir -p "$PDF_FRAME_DIR"
FONTCONFIG_FILE=/dev/null "$PDFTOPPM" -png -r 150 "$PDF_FILE" "$PDF_FRAME_DIR/page" >/dev/null 2>&1

images=(
  "$ROOT_DIR/demo/og-image.png"
  "$PDF_FRAME_DIR/page-1.png"
  "$ROOT_DIR/output/images/v2-control-room.png"
  "$PDF_FRAME_DIR/page-3.png"
  "$PDF_FRAME_DIR/page-2.png"
  "$ROOT_DIR/output/images/v2-evidence-ledger.png"
  "$PDF_FRAME_DIR/page-4.png"
  "$ROOT_DIR/demo/og-image.png"
)

narrations=(
  "Verifiable Treasury Agent V two turns a treasury instruction into inspectable evidence. Its strongest proof is not a successful payment. It is a payment the contract refuses to move when risk changes."
  "On public Base Sepolia, fifteen thousand units of project m U S D enter escrow. A synthetic sanctions update changes beneficiary risk. Release is submitted, fails on chain with status zero, and transfers nothing. The payer cancels and receives the full amount back."
  "The control room replays six decisions from public receipts. A I prepared an unsigned plan with no signing key. A payer signature and two separate approval addresses authorized escrow. Current risk governed release."
  "The clean path reaches a separate beneficiary address. The blocked path ends cancelled; that beneficiary receives zero. Escrow and total escrowed return to zero, every balance reconciles, and the contract remains solvent."
  "The planner emits a deterministic E I P seven twelve payload. A real, read-only Codex trace confirms the schema without signing, broadcasting, or changing state. Only the payer signs. Chain, contract, parties, amount, quote, nonce, commitment, and clearance are bound."
  "Role epochs prevent revoked operators, approvers, or stale votes from reviving. Quote expiry, capacity, two approvals, payer and beneficiary risk, exact balance deltas, and challenge windows are contract enforced. Raw invoices stay off chain behind a salted, domain separated commitment."
  "The bundle contains twenty-six public receipts: twenty-five successes and one expected status-zero rejection. Forty checks pass; sixty-four deterministic paths were generated. The browser can freshly re-read receipt status, terminal states, balances, zero escrow, and solvency without connecting a wallet."
  "This is testnet proof, not production settlement. m U S D is valueless, not U S D C. Singapore to China and sanctions inputs are synthetic. There is no real fiat, foreign exchange, bridge, off-ramp, certified K Y C feed, or customer data. A I explains and orchestrates; it never signs. The contract alone moves value."
)

if [[ "${#images[@]}" -ne "${#narrations[@]}" ]]; then
  echo "Image and narration counts do not match" >&2
  exit 1
fi

concat_file="$WORK_DIR/segments.txt"
: > "$concat_file"

for index in "${!images[@]}"; do
  number=$(printf '%02d' "$((index + 1))")
  audio_file="$WORK_DIR/narration-$number.aiff"
  clip_file="$WORK_DIR/clip-$number.mp4"

  say -v "$VOICE" -r "$RATE" -o "$audio_file" "${narrations[$index]}"
  audio_duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$audio_file")
  clip_duration=$(awk -v duration="$audio_duration" 'BEGIN { printf "%.3f", duration + 0.85 }')
  video_fade_out=$(awk -v duration="$clip_duration" 'BEGIN { printf "%.3f", duration - 0.35 }')
  audio_fade_out=$(awk -v duration="$audio_duration" 'BEGIN { value = duration - 0.20; if (value < 0) value = 0; printf "%.3f", value }')

  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -framerate 30 -i "${images[$index]}" \
    -i "$audio_file" \
    -filter_complex "[0:v]split=2[background][foreground];[background]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=28[blurred];[foreground]scale=1800:1012:force_original_aspect_ratio=decrease[fit];[blurred][fit]overlay=(W-w)/2:(H-h)/2[composed];[composed]zoompan=z='min(zoom+0.00012,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=${video_fade_out}:d=0.35,format=yuv420p[video];[1:a]highpass=f=70,lowpass=f=15000,loudnorm=I=-16:LRA=7:TP=-1.5,afade=t=in:st=0:d=0.15,afade=t=out:st=${audio_fade_out}:d=0.20,apad=pad_dur=1[audio]" \
    -map '[video]' -map '[audio]' \
    -t "$clip_duration" \
    -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.1 \
    -c:a aac -b:a 192k -ar 48000 -ac 2 \
    -movflags +faststart \
    "$clip_file"

  printf "file '%s'\n" "$clip_file" >> "$concat_file"
done

ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$concat_file" \
  -c copy -movflags +faststart \
  "$OUTPUT_FILE"

duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE")
width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE")
height=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE")
video_codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE")
audio_codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_FILE")

awk -v duration="$duration" 'BEGIN { if (duration < 90 || duration > 120) exit 1 }' || {
  echo "Video duration is outside the required 90-120 seconds: $duration" >&2
  exit 1
}

[[ "$width" == "1920" && "$height" == "1080" && "$video_codec" == "h264" && "$audio_codec" == "aac" ]] || {
  echo "Unexpected output streams: ${width}x${height}, video=$video_codec, audio=$audio_codec" >&2
  exit 1
}

echo "Created $OUTPUT_FILE"
echo "Duration: ${duration}s"
echo "Streams: ${width}x${height} $video_codec / $audio_codec"
