# Making a video for SceneFlow with AI

You do not need footage to start: a 6–10 second AI clip is enough for a shoppable or scroll-driven video. This page is for anyone who wants a quick, good-looking source video — for a real page or just to test.

## What works best in SceneFlow

| Setting | Use | Why |
| --- | --- | --- |
| Length | 6–10 s per clip (join 2–3 for a story) | Scenes are short; scroll-scrub feels best under 30 s total |
| Aspect ratio | 16:9 (1920×1080) for pages, 9:16 for mobile-first | Matches the editor canvas presets |
| Frame rate | 24 or 30 fps | What the renditions are made from |
| Camera | **one slow, continuous move** (push-in, orbit, slide), no cuts | Scroll-scrub plays forwards *and* backwards; cuts look like glitches |
| Subject | one product / one idea, centred or on the left | Leaves room on the right for the product card and text |
| Look | clean background, soft light, no on-screen text | Text, prices and buttons come from SceneFlow, and you can edit them later |
| Motion | steady, nothing fast | Fast motion stutters when scrubbed; slow motion reads as "premium" |
| Export | MP4 (H.264), highest quality available | Upload it as-is; SceneFlow makes the web versions |

## Tools (pick one)

- **Google Veo (in Gemini / Flow)** – strong realism, text-to-video and image-to-video, 8 s clips.
- **OpenAI Sora** – good for stylised scenes and camera moves; image-to-video from a product photo.
- **Runway Gen-4** – precise camera control, image-to-video, extend/loop options.
- **Kling, Luma Dream Machine, Pika** – fast and cheap; image-to-video from your own product shot works well.

**Best starting point: image-to-video.** Upload a clean product photo (white or lifestyle background) and let the model move the camera. The product stays accurate; only the camera and light change.

## Prompt templates

Replace the words in `[brackets]`. Keep the "no text, no cuts, slow" part — it matters more than the adjectives.

**Product reveal (shoppable video)**

> Cinematic product video of [a matte black wireless headphone] on [a light oak table], soft studio light from the left, shallow depth of field. Slow 8-second camera push-in from a wide shot to a close-up, the product stays centred-left with empty space on the right. Photorealistic, no text, no logos, no people, no cuts, smooth steady motion.

**Scroll story (3 chapters, same world)**

> Chapter 1: Slow aerial glide over [a misty pine forest at dawn], camera drifting forward, 8 seconds, no cuts, no text.
> Chapter 2: Same forest, camera slides sideways along [a wooden cabin], warm window light, slow and steady, 8 seconds, no text.
> Chapter 3: Slow push-in on [a coffee cup on the cabin porch], steam rising, soft morning light, 8 seconds, no text, no cuts.

(Generate each chapter separately with the same style words, then add them as three scenes.)

**Explainer / how-it-works**

> Clean 3D animation of [a smartwatch] rotating slowly on a neutral grey background, soft shadows, studio lighting, 10 seconds, one continuous 360° rotation, no text, no cuts, loopable.

**Lifestyle / fashion**

> Slow-motion video of [a woman in a linen jacket] walking along [a sunlit seaside street], camera tracking alongside at eye level, warm golden-hour light, natural colours, 8 seconds, no cuts, no text, product clearly visible.

**Loop for a hero banner**

> Seamless looping video of [waves of fabric in deep blue] moving slowly, abstract, soft light, 6 seconds, loopable, no text.

## Tips

- Write **negative instructions** explicitly: "no text, no watermark, no cuts, no people" (or "no logos" if the model invents one).
- Ask for **"empty space on the right"** or "subject on the left third" when you plan a product card.
- Generate 2–3 variations and keep the one with the smoothest motion — that one scrubs best.
- Too short? Use the tool's **extend** feature or join clips: `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4` (or just add each clip as its own scene in SceneFlow).
- Upscaling is not needed: upload 1080p, SceneFlow makes 540p/720p/1080p and the scroll-optimised file.
- Check the licence of the tool you use for commercial pages; most paid tiers allow it.

## Then in SceneFlow

1. Projects → pick a goal → the editor opens.
2. Click the canvas → *Background* → upload the clip. It is usable in seconds.
3. Drop a *Product spotlight* or *Headline + subtitle* preset, pick your product, publish.
