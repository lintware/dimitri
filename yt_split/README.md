# yt-split

Download any YouTube video and cleanly separate the video and audio tracks using **uv + Python + yt-dlp + ffmpeg**.

## Usage

```bash
cd yt_split

# Download and split (recommended)
uv run python -m yt_split.main download "https://youtu.be/..." --output-dir ~/Downloads --name "my_video"

# Or after building
uv run yt-split download "URL" -o ~/Downloads -n "cool_video"
```

## What you get

For a URL like `https://youtu.be/3RaKdn519H4`:

- `video_3RaKdn519H4_video_only.mp4` — Pure video stream (no audio)
- `video_3RaKdn519H4_audio_only.m4a` — Pure audio stream (best quality)
- `video_3RaKdn519H4_merged.mp4` — Combined high-quality version (optional)

## Requirements

- `uv` (Python package manager)
- `ffmpeg` installed on your system

## Install / Update

```bash
uv sync
```

## Why this is better than normal downloaders

- Downloads the **best video** and **best audio** streams *separately* (YouTube often serves them independently)
- No re-encoding — maximum quality, fast
- Clean filenames
- Also gives you a ready-to-use merged file

MIT
