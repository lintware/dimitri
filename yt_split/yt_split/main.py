#!/usr/bin/env python3
"""
yt-split: Download a YouTube video and cleanly separate video and audio.

Uses yt-dlp to download the best quality video-only and audio-only streams,
then (optionally) uses ffmpeg for further processing.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich import print as rprint
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

app = typer.Typer(
    help="Download YouTube video and split into clean video-only + audio-only files",
    add_completion=False,
)
console = Console()


def run_command(cmd: list[str], description: str) -> bool:
    """Run a command with nice output."""
    rprint(f"[cyan]→[/] {description}")
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
        return True
    except subprocess.CalledProcessError as e:
        rprint(f"[red]✗ Command failed:[/] {e}")
        if e.stderr:
            rprint(f"[red]{e.stderr.strip()}[/]")
        return False


@app.command()
def download(
    url: str = typer.Argument(..., help="YouTube URL (e.g. https://youtu.be/3RaKdn519H4)"),
    output_dir: Path = typer.Option(
        Path("."),
        "--output-dir", "-o",
        help="Directory to save the files",
    ),
    name: Optional[str] = typer.Option(
        None,
        "--name", "-n",
        help="Base name for output files (default: video title)",
    ),
    merge: bool = typer.Option(
        True,
        "--merge/--no-merge",
        help="Also create a merged video+audio file",
    ),
):
    """
    Download a YouTube video and split it into:

    - video_only.mp4   (best quality video, no audio)
    - audio_only.m4a   (best quality audio, no video)

    Optionally also creates a merged high-quality file.
    """
    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rprint(f"\n[bold]YouTube Video Splitter[/]")
    rprint(f"URL: [yellow]{url}[/]")
    rprint(f"Output directory: [blue]{output_dir}[/]\n")

    # Base yt-dlp command
    base_cmd = [
        "uv", "run", "yt-dlp",
        "--no-playlist",
        "--restrict-filenames",   # safe filenames
        "-o", str(output_dir / "%(title)s.%(ext)s"),
    ]

    # 1. Download best video-only stream
    video_cmd = base_cmd + [
        "-f", "bestvideo[ext=mp4]/bestvideo",
        "--remux-video", "mp4",
        url,
    ]

    # 2. Download best audio-only stream
    audio_cmd = base_cmd + [
        "-f", "bestaudio[ext=m4a]/bestaudio",
        "--extract-audio",
        "--audio-format", "m4a",
        url,
    ]

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Downloading best video stream...", total=None)
        if not run_command(video_cmd, "Downloading best video-only stream"):
            rprint("[red]Failed to download video. Aborting.[/]")
            raise typer.Exit(1)
        progress.update(task, description="Downloading best audio stream...")

        if not run_command(audio_cmd, "Downloading best audio-only stream"):
            rprint("[red]Failed to download audio. Aborting.[/]")
            raise typer.Exit(1)
        progress.update(task, description="Processing files...")

    # Find the downloaded files
    video_files = list(output_dir.glob("*bestvideo*.mp4")) or list(output_dir.glob("*.mp4"))
    audio_files = list(output_dir.glob("*bestaudio*.m4a")) or list(output_dir.glob("*.m4a"))

    # yt-dlp with --restrict-filenames usually gives clean names.
    # Let's find the most recent video and audio files.
    video_file = max(output_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime) if list(output_dir.glob("*.mp4")) else None
    audio_file = max(output_dir.glob("*.m4a"), key=lambda p: p.stat().st_mtime) if list(output_dir.glob("*.m4a")) else None

    if not video_file or not audio_file:
        rprint("[red]Could not locate downloaded files.[/]")
        raise typer.Exit(1)

    # Rename to clean names if user provided --name
    if name:
        clean_video = output_dir / f"{name}_video_only.mp4"
        clean_audio = output_dir / f"{name}_audio_only.m4a"
        video_file.rename(clean_video)
        audio_file.rename(clean_audio)
        video_file = clean_video
        audio_file = clean_audio
    else:
        # Give them clear names
        clean_video = output_dir / "video_only.mp4"
        clean_audio = output_dir / "audio_only.m4a"
        video_file.rename(clean_video)
        audio_file.rename(clean_audio)
        video_file = clean_video
        audio_file = clean_audio

    rprint(f"\n[green]✓[/] Successfully downloaded and split!")
    rprint(f"  [bold]Video only:[/] {video_file}")
    rprint(f"  [bold]Audio only:[/] {audio_file}")

    # Optional: create merged version using ffmpeg
    if merge:
        merged_file = output_dir / (f"{name}_merged.mp4" if name else "merged_video_audio.mp4")
        rprint("\n[cyan]Creating merged high-quality file with ffmpeg...[/]")

        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-i", str(video_file),
            "-i", str(audio_file),
            "-c:v", "copy",
            "-c:a", "copy",
            "-shortest",
            str(merged_file),
        ]

        if run_command(ffmpeg_cmd, "Merging video + audio"):
            rprint(f"  [bold green]Merged file:[/] {merged_file}")
        else:
            rprint("[yellow]Warning: Could not create merged file (ffmpeg issue).[/]")

    rprint("\n[bold green]Done![/]")


@app.command()
def info(url: str):
    """Show available formats for a YouTube URL (useful for debugging)."""
    cmd = ["uv", "run", "yt-dlp", "-F", url]
    subprocess.run(cmd)


if __name__ == "__main__":
    app()
