"""Render the original diagrams and assemble the bundled video (Windows)."""
import json
import subprocess
import tempfile
from math import atan2, cos, pi, sin, sqrt
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont

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


def tray_faces(back_angle, front_angle, front_tuck=0):
    # Folding each edge to the center puts the crease halfway in.
    # This gives a two-unit base with one-unit walls and gussets.
    faces = []

    def face(color, *points):
        faces.append((color, points))

    face(PAPER, (-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0))
    for side, outer, inner in ((-1, "#cb995d", "#d4ac71"), (1, "#b78754", "#edcd92")):
        x = side * 0.986
        face(outer, (side, -1, 0), (side, 1, 0), (side, 1, 1), (side, -1, 1))
        face(inner, (x, -1, 0), (x, 1, 0), (x, 1, 1), (x, -1, 1))
        face(LIGHT, (x, -1, 1), (x, 1, 1), (side, 1, 1), (side, -1, 1))
        face("#f3dba6" if side == 1 else "#e5c68f", (x, -1, 0.004), (x, 1, 0.004), (0, 0, 0.004))

    for sign, angle, tuck in ((-1, back_angle, pi if back_angle == pi / 2 else 0),
                              (1, front_angle, front_tuck)):
        y, z = 1 + cos(angle), sin(angle)
        bottom_left, bottom_right = (-1, sign, 0), (1, sign, 0)
        rim_left, rim_right = (-1, sign * y, z), (1, sign * y, z)
        face("#b9874e" if sign == 1 and angle == pi / 2 else FOLD,
             bottom_left, bottom_right, rim_right, rim_left)

        if angle < pi / 2:
            # Where the two corner triangles meet, their shared diagonal
            # keeps its original length as the rising end pinches inward.
            along_end = cos(angle) / (1 + sin(angle))
            inward = sqrt(max(0, 1 - along_end ** 2))
            for side in (-1, 1):
                corner = (side, sign, 0)
                side_rim = (side, sign, 1)
                end_rim = (side, sign * y, z)
                gusset_tip = (side * (1 - inward), sign * (1 + along_end), 1)
                face("#c89f66", corner, side_rim, gusset_tip)
                face("#e4be81", corner, gusset_tip, end_rim)

        if tuck == pi:
            # The liner folds over the rim, against the wall, and onto the
            # floor. A small inset shows the two layers of folded paper.
            inside = sign * (1 - 0.018)
            upper_left, upper_right = (-1, inside, 1), (1, inside, 1)
            lower_left, lower_right = (-1, inside, 0.012), (1, inside, 0.012)
            face(LIGHT, rim_left, rim_right, upper_right, upper_left)
            face("#f4dba5" if sign == -1 else "#d8b278",
                 upper_left, upper_right, lower_right, lower_left)
            face("#edd09b" if sign == 1 else "#f7e1ae",
                 lower_left, lower_right, (0, sign * 0.018, 0.012))
        else:
            panel_angle = angle + tuck
            flap_y = y + cos(panel_angle)
            flap_z = z + sin(panel_angle)
            flap_left, flap_right = (-1, sign * flap_y, flap_z), (1, sign * flap_y, flap_z)
            tip_angle = panel_angle if not tuck else pi
            tip = (0, sign * (flap_y + cos(tip_angle)), flap_z + sin(tip_angle))
            face("#f2d29b", rim_left, rim_right, flap_right, flap_left)
            face("#f7e0ad", flap_left, flap_right, tip)

    return faces


def draw_tray(canvas, faces):
    # Use a single orthographic camera and compare depth per pixel so the
    # raised walls hide whatever sits behind them, including folded layers.
    azimuth, elevation = 0.48, 0.90

    def project(point):
        x, y, z = point
        across = cos(azimuth) * x + sin(azimuth) * y
        toward = cos(azimuth) * y - sin(azimuth) * x
        return across, sin(elevation) * toward - cos(elevation) * z, cos(elevation) * toward + sin(elevation) * z

    projected = [project(point) for _, points in faces for point in points]
    left, top, _ = np.min(projected, axis=0)
    right, bottom, _ = np.max(projected, axis=0)
    scale = min(111, 440 / (right - left), 285 / (bottom - top))
    origin_x = W / 2 - (left + right) * scale / 2
    origin_y = 261 - (top + bottom) * scale / 2

    def screen(point):
        x, y, depth = project(point)
        return origin_x + x * scale, origin_y + y * scale, depth

    shadow = Image.new("L", canvas.size)
    shadow_draw = ImageDraw.Draw(shadow)
    for _, points in faces:
        shadow_draw.polygon([screen((x + 0.21 * z, y + 0.13 * z, 0))[:2]
                             for x, y, z in points], fill=135)
    canvas.paste("#13251d", mask=shadow.filter(ImageFilter.GaussianBlur(12)))

    samples = 2
    raster = np.zeros((H * samples, W * samples, 4), dtype=np.uint8)
    depth_buffer = np.full(raster.shape[:2], -np.inf, dtype=np.float32)
    for color, points in faces:
        vertices = np.array([screen(point) for point in points])
        vertices[:, :2] *= samples
        rgba = (*ImageColor.getrgb(color), 255)
        for second, third in zip(vertices[1:], vertices[2:]):
            first = vertices[0]
            a, b = second - first, third - first
            area = a[0] * b[1] - a[1] * b[0]
            if abs(area) < 1e-6:
                continue
            x0, y0 = np.floor(np.minimum(np.minimum(first, second), third)[:2]).astype(int)
            x1, y1 = np.ceil(np.maximum(np.maximum(first, second), third)[:2]).astype(int)
            dy, dx = np.ogrid[y0:y1, x0:x1]
            px, py = dx + 0.5 - first[0], dy + 0.5 - first[1]
            u = (px * b[1] - py * b[0]) / area
            v = (a[0] * py - a[1] * px) / area
            depth = first[2] + u * a[2] + v * b[2]
            stored = depth_buffer[y0:y1, x0:x1]
            visible = (u >= -1e-7) & (v >= -1e-7) & (u + v <= 1 + 1e-7) & (depth > stored)
            stored[visible] = depth[visible]
            raster[y0:y1, x0:x1][visible] = rgba
    paper = Image.fromarray(raster).resize(canvas.size, Image.Resampling.LANCZOS)
    canvas.paste(paper, mask=paper.getchannel("A"))


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
        for edge in (229, 307):
            if not phase:
                crease((402, edge), (558, edge))
            else:
                crease((edge + 212, 190), (edge + 212, 346))
        if phase:
            arrow((358, 268), (465, 268))
            arrow((602, 268), (495, 268))
        else:
            arrow((480, 145), (480, 250))
            arrow((480, 391), (480, 286))
    elif index == 4 and not phase:
        polygon([top, corners[1], corners[2], bottom, corners[3], corners[0]], FOLD)
        polygon([corners[0], center, corners[3]], LIGHT)
        polygon([corners[1], center, corners[2]], PAPER)
        for edge in (441, 519):
            crease((edge, 190), (edge, 346))
        arrow((363, 268), (408, 268))
        arrow((597, 268), (552, 268))
    else:
        if index == 4:
            faces = tray_faces(0, 0)
        elif index == 5 and not phase:
            faces = tray_faces(pi / 2, pi / 8)
        elif index == 5:
            faces = tray_faces(pi / 2, pi / 2, 5 * pi / 6)
        else:
            faces = tray_faces(pi / 2, pi / 2, pi)
        draw_tray(canvas, faces)

    font = ImageFont.truetype(str(ROOT / "public" / "fonts" / "inter.ttf"), 15)
    draw.text((841, 463), f"{index + 1:02d} / {len(STEPS):02d}", fill="#dbcda9", font=font, anchor="ra")
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
