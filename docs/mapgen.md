# osu!mania 7K Auto-Mapping — Project Plan

> Goal: given an mp3, produce a playable, "human-feeling" 7K osu!mania beatmap (`.osu`), using your ranked-map library both as ground truth for training/validation and as a coherence benchmark. Stack constraint: TypeScript end-to-end where feasible.

---

## 1. How the problem actually decomposes

Every prior project in this space (osu!, DDR, Beatmania, Taiko — see §5) converges on the **same two-stage decomposition**, because it maps cleanly onto what a human mapper does:

1. **Step/Onset Placement** — "at which exact timestamps does *something* happen that deserves a note?"
   This is a Music Information Retrieval (MIR) problem: onset detection + beat/BPM tracking + (ideally) per-instrument onset detection.
2. **Step/Column Selection** — "given a note must exist at time *t*, which of the 7 columns (or combination, for jumps/hands/jacks) does it go in, and is it a single note or a long note (LN)?"
   This is a sequence-modeling / pattern-generation problem, conditioned on recent history (what was just played) and difficulty target.

Treating these as one giant end-to-end black box (audio → hit objects) is what modern transformer approaches do (Mapperatorinator, osu-dreamer — §5.3-5.4), but it's much harder to debug, needs way more data/compute, and gives you less control. Given you want to move fast and reason about coherence explicitly, I'd recommend **keeping the two stages separate and swappable** — you can start with rule-based/statistical versions of each stage and upgrade individual stages to learned models later without rewriting the pipeline.

A third, often-skipped stage matters a lot for mania specifically:

3. **Difficulty & Density Conditioning** — mania patterns (jacks, trills, chordjacks, staircases, jumptrills, hands) are extremely difficulty- and genre-dependent. Without conditioning, a model trained on a mixed-difficulty dataset just regresses to the mean and produces mushy, generic patterns. Every serious prior work (DDC, GenerationMania, Mapperatorinator) explicitly conditions on a target difficulty/density signal.

---

## 2. Music theory & osu!mania fundamentals you need encoded, not just "known"

### 2.1 Timing
- **BPM & offset**: a timing point defines `beatLength = 60000/BPM` ms and an `offset`. Uninherited (red) timing points define BPM changes; inherited (green) points only scale slider velocity / mania scroll speed and don't affect BPM.
- **Snapping**: every hit object's time should land on a rational subdivision of the beat: 1/1, 1/2, 1/3, 1/4, 1/6, 1/8, 1/12, 1/16 are the standard divisors. Ranked mania maps are extremely strict about this — an onset detector that outputs raw "wall clock" timestamps **must** be re-snapped to the nearest valid tick relative to the active timing point, or the map will feel and look wrong even if audio-aligned. This resnap step is non-negotiable and should be a discrete, testable pipeline stage.
- **Variable BPM / BPM changes**: some ranked maps have multiple timing sections. Your BPM tracker needs to support piecewise-constant tempo, not just a single global BPM (see "Super timing generator" idea in Mapperatorinator, §5.3, which infers timing multiple times and averages for robustness).

### 2.2 Core mania pattern vocabulary (this is your "label space" for stage 2)
Per the official [osu!mania mapping guide](https://osu.ppy.sh/wiki/en/Guides/osu!mania_mapping_guide#timing) and standard community terminology:
- **Single note / chord**: one or multiple simultaneous columns hit together (2-note = jump, 3-note = hand, 4+ = quad).
- **Jack**: repeated same-column single notes in quick succession (tests one finger's speed).
- **Chordjack**: alternating/overlapping chords that keep re-hitting some columns rapidly (jacks embedded in chords) — a defining "hard" 7K pattern.
- **Trill**: alternating two columns rapidly (e.g. 4-5-4-5).
- **Roll / staircase**: sequential single notes moving across adjacent columns in one direction.
- **Stream**: a sustained run of evenly-spaced single notes, usually alternating hands.
- **Long note (LN / hold)**: sustained press-and-release; density of LN usage vs single notes is itself a style axis (some mappers/genres are "LN-heavy").
- **Jumptrill / anchor**: hybrid patterns mixing jumps with trills — common in high-difficulty modern maps.

A generation model (rule-based or learned) essentially needs to choose, at every onset, one of: *nothing / single / jump / hand / quad / LN-start / LN-continue / LN-release*, per column, subject to hard playability constraints (see 2.4).

### 2.3 Mapping to "instruments"
The guide's instinct (map different instruments to different columns/behaviors) is exactly what GenerationMania and TaikoNation formalize:
- Kick/bass drum → often anchors strong beats, frequently mapped as jacks or downbeat chords.
- Snare/clap → backbeat, often chords or off-column singles.
- Hi-hats/percussion → higher-frequency, shorter notes, often trills/streams.
- Bassline (harmonic bass) → sustained low content → often LNs.
- Vocals/lead melody → highest information density in "other" stem → drives the phrase-level pattern choice (e.g., matching syllables/melisma to trills or streams).
This is why **source separation** (splitting the mix into drums/bass/vocals/other stems) before onset detection is worth doing rather than just running onset detection on the full mix — it lets you assign different pattern grammars to different instrument roles instead of guessing from one blended onset function.

### 2.4 Hard playability constraints (must be enforced regardless of model)
These come from how mania is actually played (2 hands, ~3-4 fingers each on 7K) and matter more than anything ML-related for "does it feel legit":
- No physically impossible same-column double-hits within an unhittable window.
- LN releases must not collide with a new note in the same column at (near-)identical time.
- Jack length/frequency should scale with BPM — the same jack pattern is trivial at 120 BPM and brutal at 220 BPM; density must be BPM-normalized, not just onset-count-normalized.
- Column balance over a whole map should roughly match your target difficulty archetype (raw jack-spam charts have a very different column-usage histogram than jumpstream charts).

---

## 3. Recommended architecture (concrete pipeline)

```
mp3
 │
 ▼
[1] Audio decode + resample (Web Audio API / node decode) ──► PCM (44.1kHz mono+stereo)
 │
 ▼
[2] Source separation (HTDemucs ONNX) ──► stems: drums / bass / vocals / other
 │
 ▼
[3] Tempo & timing analysis
     - global + piecewise BPM estimation (autocorrelation of onset detection function
       + dynamic-programming beat tracking, Ellis 2007)
     - downbeat / offset estimation
     - "super timing": run estimator on multiple windows, reconcile/average (Mapperatorinator idea)
 │
 ▼
[4] Per-stem onset detection
     - spectral flux / complex-domain onset detection function per stem
     - peak-picking with adaptive threshold
     - snap each onset to nearest valid tick given the timing map from [3]
 │
 ▼
[5] Event stream: list of (time, instrument-role, strength/salience)
 │
 ▼
[6] Placement filter (Stage 1 refinement)
     - decide which snapped onsets actually become playable notes
       (density target from difficulty conditioning; merge onsets that are
       too close to be separately hittable)
 │
 ▼
[7] Column/pattern selection (Stage 2 — the "choreography" model)
     - rule-based baseline OR learned sequence model (see §4)
     - outputs: column(s), note type (tap/LN), LN length if applicable
 │
 ▼
[8] Playability + style post-processor
     - enforce hard constraints (§2.4)
     - resnap, resolve collisions, cap jack length by BPM, LN-collision fixes
 │
 ▼
[9] .osu file writer (osu-parsers / osu-classes, Mode: 3)
 │
 ▼
[10] Automated evaluation vs ranked-map dataset (see §6)
```

---

## 4. Stage 2 (pattern generation): three approaches, ranked by speed-to-first-result

### Option A — Rule-based / statistical Markov generator (fastest to ship, fully controllable)
Build column-transition statistics **directly from your ranked map corpus**, bucketed by:
- local BPM,
- instrument role of the onset,
- current difficulty target (star rating band),
- recent pattern history (n-gram context, e.g. last 2-4 notes per column).

Then at generation time, sample the next column choice from the empirical distribution conditioned on that context (a higher-order Markov chain / n-gram model, exactly like DDC's non-neural baseline that the neural model had to beat). This gets you a working end-to-end pipeline in days, gives you a *baseline to beat*, and is trivial to implement in pure TypeScript (no ML runtime needed at all for this stage).

### Option B — Learned sequence model (LSTM/Transformer over column history)
Train a small autoregressive model: input = recent column-history + local audio features (per-stem energy in a short window, beat-phase, delta-to-next-beat) + difficulty conditioning; output = distribution over next-column-event. This is literally the DDC "step selection" model and the GenerationMania approach, scaled down. Feasible with **TensorFlow.js (tfjs-node)**, trained on your own corpus — no need to leave the TS ecosystem.

### Option C — End-to-end tokenized transformer (Mapperatorinator-style)
Represent an entire beatmap as a token stream (time-quantized events + column/position tokens) and train a Whisper-style seq2seq model conditioned on a mel-spectrogram, generating the whole chart in one pass. State-of-the-art quality, but heavy: needs real GPU training infrastructure, large data volume, and is much harder to keep in pure TS (train in Python/PyTorch, export to ONNX, run inference via `onnxruntime-node`). Treat this as a v2/v3 target, not the starting point.

**Recommendation**: build the whole pipeline end-to-end with **Option A** first so you have a shippable, debuggable baseline and a real evaluation harness (§6). Then swap Stage 2 for **Option B**, using Option A's output/your dataset stats as a sanity check and initialization. Only reach for **Option C** once A/B's ceiling is understood and you've decided the extra infra cost is worth it.

---

## 5. Prior art (what's already been tried, and what to borrow)

### 5.1 Dance Dance Convolution (Donahue, Lipton, McAuley — 2017)
Origin of the two-stage decomposition. Step placement = CNN+RNN over spectrograms conditioned on difficulty; step selection = conditional LSTM using Δ-beat and beat-phase auxiliary features, beating n-gram baselines. The Δ-beat / beat-phase feature trick (encode "how far into the current beat subdivision are we") is directly reusable for mania timing conditioning.

### 5.2 GenerationMania (Lin, Xiao, Riedl — 2018) — closest analog to mania
Built specifically for Beatmania IIDX (7-9 key, keysounded, structurally very close to osu!mania). Four-part process: (1) train a network to identify instruments and note timing per instrument, (2) auto-label chart difficulty, (3) supervised network mapping "musical context → per-timestep column actions", (4) rule+network hybrid for control mapping. This is essentially the blueprint in §3-4 above, independently arrived at for a near-identical game. Worth reading the actual paper closely before building Stage 2.

### 5.3 TaikoNation (2021) / audio2chart (2025)
TaikoNation emphasizes *patterning* (predicting the next several notes jointly rather than one at a time) to avoid locally-plausible-but-globally-incoherent charts — relevant to mania jacks/trills, which are inherently multi-note structures, not independent per-note decisions. audio2chart explicitly discusses osu! among DDR/Beatmania and is a recent (2025) reference for current best practice in end-to-end audio→chart transcription.

### 5.4 osumapper (kotritrona, TensorFlow) — osu!-specific, includes a mania Colab
The most direct prior art for *osu!* specifically (though standard-mode-first; mania support exists but is less mature). Good source of practical lessons: their README explicitly warns against training on your *entire* map library indiscriminately — curate a subset of maps you consider well-mapped (e.g. a star-rating band from mappers whose style you like) rather than all ranked maps, since averaging over everything regresses to bland/generic patterns.

### 5.5 Mapperatorinator (OliBomby) — current SOTA-ish, all-gamemode, transformer
Tokenizes an entire beatmap (hit objects, timing points, mania scroll speed, hitsounds) into an event stream and trains a modified Whisper (219M params, RoPE + FlashAttention variable-length) conditioned on spectrograms. Notable engineering ideas worth stealing even if you don't build a transformer immediately: (a) quantize time to fixed grid (10ms) and post-process/resnap to real snap divisors, (b) "super timing" — run the timing inference many times over a song and average, to stabilize BPM/offset estimates.

### 5.6 osu-dreamer (jaswon) — diffusion-based, all-gamemode
Generates maps via a two-stage latent diffusion model. Good reference if you want a generative (rather than purely discriminative) approach later, but heavier infra (needs a training loop with checkpoints, PyTorch) — lower priority than A/B above.

### 5.7 Core MIR background (for stage 1/3/4 correctness)
- Bello et al., *A Tutorial on Onset Detection in Music Signals* (2005) — the standard onset-detection reference; covers spectral flux, phase deviation, complex-domain methods.
- Ellis, *Beat Tracking by Dynamic Programming* (2007) — the classical robust tempo/beat-tracking algorithm; also what Essentia's beat trackers are built on.
- Fitzgerald, work on Harmonic-Percussive Source Separation (HPSS) — useful cheap alternative/complement to full neural stem separation when you just need "percussive vs harmonic" onset streams quickly.

---

## 6. Using your ranked-map library as data — three distinct uses, don't conflate them

1. **Training corpus** (for Option B/C models and for Option A's n-gram statistics) — pairs of (audio, .osu). Curate rather than dump everything in (see 5.4's warning): filter by star-rating band, by mapper if you want a house style, and probably exclude maps with unusual/nonstandard timing (variable BPM spam, very short maps, marathon maps) for a first pass.
2. **Validation / regression set** — held-out maps used purely to score your pipeline's output against ground truth on matched songs (never trained on).
3. **Statistical reference distribution for coherence scoring** (§7) — used to build the "does this look like a real ranked map" metrics, independent of any specific model — this is really a dataset-profiling exercise, not training per se, and you should build it *first* since it also validates your `.osu` parser and feature extraction before any modeling starts.

Suggested TS pipeline for corpus prep:
- Parse every `.osu` with **`osu-parsers`** + **`osu-classes`** (npm, written in TypeScript, based on the osu!lazer source) → gives you timing points, hit objects, and via **`osu-mania-stable`** a lazer-accurate star-rating/difficulty calculation per map, so you don't need to hand-roll difficulty labeling.
- Decode/align the paired mp3 (from the same beatmapset folder) and run the audio-analysis stages from §3 on it, caching extracted features to disk (don't recompute audio features every run — they're expensive).
- Store per-map: timing points, per-note events (time, columns, type), computed star rating, and audio feature cache, in a simple structured format (SQLite or just newline-delimited JSON) so both the rule-based statistics builder and later ML training can consume the same corpus.

---

## 7. Evaluation: "does the generated map look/feel like a ranked map?"

Build this harness early — before Stage 2 is fancy — because it's what tells you whether Option A's baseline is even worth upgrading, and it doubles as regression testing as you iterate.

Distributional checks (compare generated map's stats to the reference distribution from same-BPM/same-star-rating ranked maps):
- **Note density curve** over time (notes/sec in sliding windows) — correlation with a plausible "energy" proxy.
- **Column usage histogram** — real maps aren't perfectly uniform across 7 columns; check yours isn't either, but isn't pathologically skewed.
- **Jack rate & jack-length distribution**, normalized by BPM.
- **LN ratio** (fraction of notes that are holds) and LN-length distribution.
- **Pattern entropy** — e.g. entropy of the column n-gram distribution; too low = repetitive/robotic, too high = incoherent noise.
- **Snap-divisor histogram** — real maps concentrate on 1/4, 1/2, 1/8, occasional 1/3/1/6/1/12; if your generator produces a flat/unusual snap distribution, that's an immediate correctness bug, not a style issue.

Hard-constraint checks (pass/fail, not distributional):
- No unhittable same-column overlaps.
- No LN/tap collisions.
- Every hit object lands on a valid snap for its active timing point.

You can implement the star-rating side of this directly with `osu-mania-stable`'s difficulty calculator — feed it your generated `.osu` and confirm the reported star rating is in the band you targeted, which is a very strong, ready-made coherence signal you don't have to build yourself.

---

## 8. TypeScript-first tech stack

| Concern | Recommended tool | Notes |
|---|---|---|
| `.osu` parsing/writing | **osu-parsers** + **osu-classes** (npm, TS, based on osu!lazer source) | Handles all format quirks (timing points, hit samples, etc.) for you |
| Mania difficulty/star rating | **osu-mania-stable** (npm) | Lazer-accurate SR calc — use as ground truth for conditioning + evaluation |
| Audio decode | Web Audio API (`OfflineAudioContext`) in browser, or a Node decode lib for CLI/batch use | Need PCM Float32 access |
| MIR features (onset/beat/tempo/spectral) | **essentia.js** (WASM, has native onset/beat-tracking algorithms + TS typings) as primary; **Meyda** (pure JS) as a lighter fallback for simple features | essentia.js benchmarked faster and more complete than Meyda for onset/beat/MFCC in the published comparison |
| Quick tempo-only estimate | **web-audio-beat-detector** (npm) | Good for a fast first-pass BPM guess before the full pipeline |
| Source separation (stems) | **onnxruntime-node** (or `onnxruntime-web` if browser-based) running an **HTDemucs ONNX export** (e.g. the `htdemucs`/`htdemucs_ft` exports published for exactly this kind of pure-inference, no-PyTorch use case) | Keeps stem separation fully in the Node/TS process — no Python subprocess needed |
| Stage-2 learned model (Option B) | **TensorFlow.js (`tfjs-node`, or `tfjs-node-gpu` if you have a CUDA box)** | Train and run inference without leaving TS; export/import as needed |
| Stage-2 heavier model (Option C, later) | Train in Python, export to **ONNX**, run via `onnxruntime-node` | Only if/when you outgrow A/B |
| Corpus storage | SQLite (e.g. `better-sqlite3`) or NDJSON files | Cache expensive audio-feature extraction once |

---

## 9. Suggested workstreams (parallelizable across agents)

These are designed so multiple agents can work mostly independently and integrate at defined boundaries.

- **W1 — Corpus & parsing pipeline**: wrap `osu-parsers`/`osu-classes`/`osu-mania-stable`, walk your ranked-map library, extract & cache (timing points, hit objects, star rating) into the structured corpus store (§6). *No audio needed yet — pure format work, can start immediately and unblocks everyone else.*
- **W2 — Audio analysis pipeline**: decode → source separation (ONNX/Demucs) → tempo/beat/onset detection → snap-to-grid. Produces the per-song event stream (§3, stages 1-5). Depends only on having sample mp3s, not on W1.
- **W3 — Reference statistics & evaluation harness**: once W1's corpus exists, compute the distributional stats in §7 across the whole (or a curated subset of the) ranked library. This *is* the spec for "what does a good map look like," and should be finished before serious Stage-2 work starts.
- **W4 — Stage 2, Option A (rule/Markov generator)**: consumes W2's event stream + W1/W3's per-context transition statistics; produces column/pattern decisions. Fastest path to an end-to-end demo.
- **W5 — Playability post-processor & `.osu` writer**: enforce hard constraints (§2.4), resnap, then serialize via `osu-parsers`. Can be built/tested against hand-crafted fake event streams before W2/W4 are done.
- **W6 (later)** — Stage 2, Option B (tfjs-node learned model), once W3/W4 give you a baseline to beat and enough corpus volume to justify training.

Suggested order: **W1 → (W2 in parallel) → W5 (against fake data) → W3 → W4 → wire W1+W2+W4+W5 into the full pipeline → iterate with W3 as your scorecard → W6.**

---

## 10. Open questions for you

I'd like your input on a few decisions that materially change the plan — answer inline or however's easiest, no need to use the buttons below if you'd rather just tell me.P