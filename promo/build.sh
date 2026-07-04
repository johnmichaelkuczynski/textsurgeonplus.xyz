#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
SRC="promo/raw/page@411660200d6e52494f367f36baf836e6.webm"
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT="promo/out"
mkdir -p "$OUT"

cap() { echo "drawtext=fontfile=${FONT}:text='$1':fontcolor=white:fontsize=44:box=1:boxcolor=0x0b0a1f@0.74:boxborderw=26:x=(w-text_w)/2:y=h-150"; }

echo ">> title card"
ffmpeg -loglevel error -y -loop 1 -t 4.5 -i promo/assets/title.png \
  -vf "scale=1920:1080,fps=30,fade=t=in:st=0:d=0.4,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -r 30 "$OUT/c0.mp4"

echo ">> intro segment"
ffmpeg -loglevel error -y -ss 22.5 -t 9.5 -i "$SRC" \
  -vf "setpts=PTS/1.25,scale=1920:1080,fps=30,$(cap 'Paste any document. Choose your model.'),format=yuv420p" \
  -an -c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -r 30 "$OUT/c1.mp4"

echo ">> quotes segment"
ffmpeg -loglevel error -y -ss 44.0 -t 18.0 -i "$SRC" \
  -vf "setpts=PTS/1.25,scale=1920:1080,fps=30,$(cap 'Extract every quote, word-for-word, fully attributed'),format=yuv420p" \
  -an -c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -r 30 "$OUT/c2.mp4"

echo ">> tractatus segment"
ffmpeg -loglevel error -y -ss 84.0 -t 18.0 -i "$SRC" \
  -vf "setpts=PTS/1.25,scale=1920:1080,fps=30,$(cap 'Map the architecture of any argument'),format=yuv420p" \
  -an -c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -r 30 "$OUT/c3.mp4"

echo ">> outro card"
ffmpeg -loglevel error -y -loop 1 -t 8 -i promo/assets/outro.png \
  -vf "scale=1920:1080,fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=7.4:d=0.6,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -r 30 "$OUT/c4.mp4"

echo ">> xfade concat"
# durations: c0=4.5 c1=7.6 c2=14.4 c3=14.4 c4=8.0 ; xfade=0.5
ffmpeg -loglevel error -y \
  -i "$OUT/c0.mp4" -i "$OUT/c1.mp4" -i "$OUT/c2.mp4" -i "$OUT/c3.mp4" -i "$OUT/c4.mp4" \
  -filter_complex "\
[0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.0[a]; \
[a][2:v]xfade=transition=fade:duration=0.5:offset=11.1[b]; \
[b][3:v]xfade=transition=fade:duration=0.5:offset=25.0[c]; \
[c][4:v]xfade=transition=fade:duration=0.5:offset=38.9[v]" \
  -map "[v]" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -r 30 "$OUT/video_silent.mp4"

echo ">> mux audio"
ffmpeg -loglevel error -y -i "$OUT/video_silent.mp4" -i promo/audio/music.mp3 -i promo/audio/vo.mp3 \
  -filter_complex "\
[1:a]volume=0.16,afade=t=in:st=0:d=0.6,afade=t=out:st=45.2:d=1.6[m]; \
[2:a]adelay=4000|4000,volume=1.25[v]; \
[m][v]amix=inputs=2:duration=longest:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT/TextSurgeon_promo.mp4"

echo ">> DONE"
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height -of default=nw=1 "$OUT/TextSurgeon_promo.mp4"
