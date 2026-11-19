"""Render the original diagrams and assemble the bundled video (Windows)."""
import json
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "lesson"
STEPS = json.loads((ROOT / "src" / "lesson.json").read_text(encoding="utf-8"))
END = 62
W, H = 960, 540
BACK = "#263d32"
INK = "#816141"
PAPER = "#f0d49c"
FOLD = "#d2ae71"
LIGHT = "#f8e6b7"


def render(index, phase=0):
    canvas = Image.new("RGB", (W, H), BACK)
    draw = ImageDraw.Draw(canvas)
    for x in range(0, W, 27):
        for y in range(0, H, 27):
            draw.ellipse((x, y, x + 1, y + 1), fill="#466153")
    draw.rounded_rectangle((103, 87, 857, 450), 20, fill="#2e473a", outline="#547060", width=1)

    def polygon(points, fill=PAPER):
        draw.polygon(points, fill=fill, outline=INK, width=2)

    def crease(start, end):
        points = tuple(zip(start, end))
        for i in range(0, 16, 2):
            a = tuple(x + (y - x) * i / 16 for x, y in points)
            b = tuple(x + (y - x) * (i + 1) / 16 for x, y in points)
            draw.line((a, b), fill=INK, width=2)

    def arrow(start, end):
        from math import atan2, cos, sin
        angle = atan2(end[1] - start[1], end[0] - start[0])
        draw.line((start, end), fill="#faf0d3", width=4)
        tip = [end]
        for offset in (-0.52, 0.52):
            tip.append((end[0] - 17 * cos(angle + offset), end[1] - 17 * sin(angle + offset)))
        draw.polygon(tip, fill="#faf0d3")

    top, right, bottom, left, center = (480, 112), (636, 268), (480, 424), (324, 268), (480, 268)
    corners = [(402, 190), (558, 190), (558, 346), (402, 346)]
    if index <= 2:
        draw.polygon([(x + 5, y + 8) for x, y in (top, right, bottom, left)], fill="#20352a")
        polygon([top, right, bottom, left])
        if index >= 1:
            crease(top, bottom)
            if index == 2 or phase == 1:
                crease(left, right)
            if index == 1:
                arrow((697, 268), (645, 268)) if not phase else arrow((480, 440), (480, 397))
        if index == 2:
            for i, tip in enumerate((top, right, bottom, left)):
                polygon([corners[i], tip, corners[(i + 1) % 4]], FOLD if i % 2 else LIGHT)
                if not phase:
                    arrow(tuple(t + (c - t) * 0.08 for t, c in zip(tip, center)),
                          tuple(t + (c - t) * 0.47 for t, c in zip(tip, center)))
            if phase:
                polygon(corners, PAPER)
                for corner in corners:
                    crease(corner, center)
    elif index == 3:
        polygon(corners)
        for edge in (216, 320):
            crease((402, edge), (558, edge))
            crease((edge + 212, 190), (edge + 212, 346))
        if phase:
            arrow((358, 268), (465, 268))
            arrow((602, 268), (495, 268))
        else:
            arrow((480, 145), (480, 250))
            arrow((480, 391), (480, 286))
    elif index == 4 and not phase:
        polygon([top, corners[1], corners[2], bottom, corners[3], corners[0]], FOLD)
        polygon([(402, 190), (558, 190), (558, 346), (402, 346)])
        for edge in (428, 532):
            crease((edge, 190), (edge, 346))
        arrow((480, 217), (480, 142))
        arrow((480, 319), (480, 394))
    else:
        a, b, c, d = (385, 239), (513, 186), (595, 282), (467, 339)
        a2, b2, c2, d2 = (358, 177), (515, 113), (623, 226), (466, 300)
        if index < 6:
            polygon([a, b, (466, 129)], LIGHT)
            polygon([d, c, (537, 421)], FOLD)
        polygon([a, b, c, d])
        polygon([a, d, d2, a2], "#dfb273")
        polygon([b, c, c2, b2], "#d3ab6e")
        if index == 6 or (index == 5 and phase):
            polygon([a, b, b2, a2], LIGHT)
            polygon([d, c, c2, d2], "#b9854d")
            crease((396, 244), (507, 198))
        elif index == 5:
            arrow((537, 411), (531, 329))
            arrow((465, 128), (460, 205))
        else:
            arrow((364, 249), (352, 187))
            arrow((627, 293), (636, 233))

    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 15)
    draw.text((119, 463), "PAPER WORKSHOP", fill="#dbcda9", font=font)
    draw.text((841, 463), f"{index + 1:02d} / 07", fill="#dbcda9", font=font, anchor="ra")
    return canvas


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    render(0).save(OUTPUT / "poster.png")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as name:
        scratch = Path(name)
        (scratch / "steps.json").write_text(json.dumps(STEPS), encoding="utf-8")
        subprocess.run([
            "powershell", "-NoProfile", "-Command",
            "Add-Type -AssemblyName System.Speech; "
            "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$voice.Rate = 1; $rows = Get-Content -Raw steps.json | ConvertFrom-Json; "
            "for ($i = 0; $i -lt $rows.Count; $i++) { "
            "$voice.SetOutputToWaveFile((Join-Path (Get-Location) \"$i.wav\")); "
            "$voice.Speak($rows[$i].caption); $voice.SetOutputToNull() }",
        ], cwd=scratch, check=True)
        segments = []
        for index, step in enumerate(STEPS):
            duration = (STEPS[index + 1]["start"] if index + 1 < len(STEPS) else END) - step["start"]
            for phase in range(2):
                render(index, phase).save(scratch / f"{index}-{phase}.png")
            clip = scratch / f"{index}.mp4"
            subprocess.run([
                ffmpeg, "-v", "error", "-loop", "1", "-framerate", "24", "-t", str(duration / 2),
                "-i", str(scratch / f"{index}-0.png"), "-loop", "1", "-framerate", "24", "-t",
                str(duration / 2), "-i", str(scratch / f"{index}-1.png"), "-i", str(scratch / f"{index}.wav"),
                "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]adelay=450,apad[a]",
                "-map", "[v]", "-map", "[a]", "-t", str(duration), "-pix_fmt", "yuv420p",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", str(clip),
            ], check=True)
            segments.append(f"file '{index}.mp4'\n")
        (scratch / "segments.txt").write_text("".join(segments), encoding="utf-8")
        subprocess.run([
            ffmpeg, "-v", "error", "-y", "-f", "concat", "-safe", "0",
            "-i", str(scratch / "segments.txt"), "-c", "copy", "-movflags", "+faststart",
            str(OUTPUT / "paper-box.mp4"),
        ], check=True)


if __name__ == "__main__":
    main()
