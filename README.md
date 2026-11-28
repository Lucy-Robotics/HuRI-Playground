# HuRI-Playground

A public web page to talk with [HuRI](https://github.com/Lucy-Robotics/huri-core#huri-ecosystem),
then rate it: visitors pick the modules HuRI runs for them, have a short
conversation (typed, or spoken into the microphone), hear HuRI's voice and
watch its avatar talk and gesture, and answer the Godspeed (5-point) and RoSAS (7-point)
questionnaires. It installs as the `huri-playground` package and command.

HuRI-Playground is a **use case** of HuRI, not a part of it, like
[HuRI-CLI](https://github.com/Lucy-Robotics/HuRI-CLI) (the reference client)
or the [acceptance test site](https://github.com/Lucy-Robotics/HuRI_ATP_testsite).
It uses nothing but the public client SDK of
[huri-core](https://github.com/Lucy-Robotics/huri-core), pinned by version
range, and it has its own versions and releases.

## How it works

The playground is a gateway that runs as its own process in front of a running
HuRI server; the browser never connects to HuRI directly. HuRI builds whatever
pipeline the first message of a session describes and has no notion of a
visitor, so the gateway owns what a public page needs:

- **the pipeline**: the browser ticks module names among those HuRI reports on
  `GET /modules`, so the list follows whatever this HuRI runs. Ticking a module
  ticks what feeds it (`tts` brings `rag`, `stt` brings `vad`) and the modules
  that link it to what answers (`stt` with `rag` brings `tag` and `qag`, so a
  spoken sentence becomes a question), and the page says what the pipeline
  does before it starts. Without a question builder, the sentence you said
  becomes your message once it is transcribed. The browser sends row names
  only: labels, args and the few options a visitor may set are in
  [huri_playground/modules.yaml](huri_playground/modules.yaml), and the
  gateway refuses a pipeline in which a module's input can never arrive. A
  tickbox is a row: one module, or a bundle of modules the visitor ticks as one
  (see [modules.yaml](#modulesyaml-rows-swaps-and-interrupts));
- **the cost**: a cap on concurrent sessions and on session length;
- **abuse**: an optional shared access code, a topic allow-list, per-topic rate
  and size limits;
- **the questionnaire**: a session id handed out when the conversation starts
  is the one-time ticket to submit answers, so every response maps to a real
  conversation.

On the HuRI side the gateway is a client of the huri-core SDK (`HuRIClient`):
the SDK opens the websocket, sends the session handshake (the modules, the
topics the browser `send`s: `huri.question` and `huri.audio.in`; the topics it
`subscribe`s to: among `huri.token`, `huri.audio.out`, `huri.motion`,
`huri.voice`, `huri.transcript`, `huri.question`, `huri.emotion`, those the pipeline
produces) and frames every event. The gateway relays the events without
reading them: each subscribed topic is decoded as the raw JSON object or the
raw bytes and framed again for the browser, unchanged, so it needs no event
package. The browser-side protocol is documented at the top of
[huri_playground/gateway.py](huri_playground/gateway.py).

With `vad` the page offers a microphone (it needs `https` or `localhost`).
With `tts` it plays HuRI's voice and, if an avatar model is present, shows
him above the conversation; with `mov` (EMAGE) he gestures with the speech,
without it he only idles, nodding with the voice. With `lips`
([huri-module-lips-sync](https://github.com/Lucy-Robotics/huri-module-lips-sync),
on HuRI's side) his mouth follows the ARKit blend shapes it computes from the
voice (`huri.lips.face`), in step with it; without it, the voice's loudness. With `emo` and `eag` the
page shows the emotion HuRI reads from the voice, and the visitor chooses
whether HuRI answers in parallel with reading it (`qag`'s `mode: parallel`,
the default: an emotion read after its question left goes with the next
question, flagged `emotion_earlier`) or waits for it (`sequential`).

## Install

In a virtual environment (Python 3.10 to 3.12), from git at a ref (a release
tag, or `dev`). huri-core is not on PyPI: give it as a git URL on the same
command line, so pip never looks it up on an index:

```sh
pip install \
  "huri-core[client] @ git+https://github.com/Lucy-Robotics/huri-core.git@<core-ref>" \
  "huri-playground @ git+https://github.com/Lucy-Robotics/HuRI-Playground.git@<ref>"
```

Pick refs that match the table in
[Versions and compatibility](#versions-and-compatibility). The server side is a
HuRI set up with [huri-modules](https://github.com/Lucy-Robotics/huri-modules)
(`install.sh`, Docker or Helm) running the modules you want to offer.

### Working on huri-playground

```sh
pip install "huri-core[client] @ git+https://github.com/Lucy-Robotics/huri-core.git@dev"
pip install -e ".[dev]"
pytest -q
black --check huri_playground tests scripts && isort --check-only huri_playground tests scripts
flake8 huri_playground tests scripts && mypy huri_playground scripts --check-untyped-defs
```

A local checkout works as well: `pip install -e "../huri-core[client]"`. The
tests never reach the network: HuRI is a fake behind the SDK's websocket. With
huri-modules' packages installed next to it (`pip install -e
../huri-modules/packages/huri-module-rag` and so on), the tests also check the
args of `modules.yaml` against the modules' real signatures; without them that
check is skipped. `python scripts/check_modules_yaml.py <registry.toml>` checks
the module names of `modules.yaml` against huri-modules' registry (CI does,
at `HURI_MODULES_REF`).

The page's own logic (the picker rules, the visitor id, the answer cut, the
emotion tags, the voice activity, the audio scheduling) is plain ES modules in
`huri_playground/static/`, tested with node's built-in runner and no npm
package: `tests/test_page_logic.py` runs `node --check` on every script and
`node --test` on `tests/js/*.test.mjs`. It needs node >= 20.19; without it the
two node tests are skipped, and under `CI` they fail instead.

## Usage

Start a HuRI server first, then:

```sh
HURI_URL=ws://localhost:8000/session huri-playground   # http://127.0.0.1:8080
```

(`python -m huri_playground` is the same.) Put the page behind a reverse proxy
that terminates TLS: the microphone needs `https`, and HuRI's own port should
stay off the internet.

| Variable                     | Default                       | Meaning                                                  |
| ---------------------------- | ----------------------------- | -------------------------------------------------------- |
| `HURI_URL`                   | `ws://localhost:8000/session` | HuRI's session endpoint (keep it off the internet)       |
| `PLAYGROUND_ACCESS_CODE`     | empty (no code)               | Shared code visitors must type before starting           |
| `PLAYGROUND_MAX_SESSIONS`    | `2`                           | Concurrent conversations; others are told to wait        |
| `PLAYGROUND_SESSION_SECONDS` | `300`                         | Conversation length before it moves to the questions     |
| `PLAYGROUND_QUESTIONNAIRES`  | `godspeed,rosas`              | Which questionnaires to show, in order                   |
| `PLAYGROUND_MODULES`         | empty (all HuRI runs)         | Modules visitors may pick, e.g. `rag,tts`                |
| `PLAYGROUND_DATA_DIR`        | `playground_data`             | Where `responses.jsonl` is written                       |
| `PLAYGROUND_HOST` / `_PORT`  | `127.0.0.1` / `8080`          | Listen address                                           |

`GET /modules` is asked on the HuRI server next to `HURI_URL`
(`http://localhost:8000/modules` for the default) and again every 10 seconds
at most, so a HuRI redeployed with other modules changes the page without a
restart. Its `details` give each module's input and output topics, which is
what the gateway wires with; a HuRI older than huri-core 0.4 has no such
route and the page reports HuRI as offline.

Each line of `responses.jsonl` holds one visitor's answers, the per-dimension
scores (Godspeed: anthropomorphism, animacy, likeability, perceived
intelligence, perceived safety; RoSAS: warmth, competence, discomfort), the
conversation length, number of questions, the `modules` the visitor picked
and the `options` they set (`qag`'s mode), and the optional comment the
visitor types in the questionnaire, but not the conversation text.
Questionnaire items are in
[huri_playground/questionnaires/](huri_playground/questionnaires/).

### The browser protocol

The full list is at the top of
[huri_playground/gateway.py](huri_playground/gateway.py). What a client needs:

- `GET /api/config` lists `modules`, each one a row
  `{name, label, description, group, inputs, outputs, options}`, plus `groups`,
  `inbound`, `rendered`, `selected` (row ids), `max_seconds`,
  `access_code_required` and `huri_available`. `inputs` and `outputs` are lists
  of topics, without duplicates; `outputs` is empty for a row that produces
  nothing.
- `start`: `{"type": "start", "modules": [row ids], "options", "access_code",
  "avatar", "body", "visitor"}`. `visitor` is the visitor's id, 32 lowercase
  hexadecimal characters kept in the browser's local storage. The page sends
  it only when the visitor ticked "Let HuRI remember me"; it is also left out
  when the browser has no storage, and the gateway then uses a one-off id.
  The gateway ignores `args` and `user_id`.
- `ready` carries `modules`, the row ids in the order the browser sent them,
  and `"interrupts": true` only when the open session carries an interruption
  policy. With a 0.4 server there is no policy: the gateway opens the session
  without an `event_policy`, `interrupts` is `false`, and it logs one warning
  each time the server's huri-core version changes. When a 0.5 server refuses
  a handshake that has interruption rules, the gateway warns and retries once
  without them, both attempts under the same connection deadline.
- `error` with the reason `already_open`: a second concurrent `start` with the
  same visitor id is refused while the first conversation is open. The first
  keeps going. A start without a valid visitor id never clashes.
- In the page, a new question while HuRI is answering raises the
  `huri-interrupt` event on `window`, which stops the voice and the avatar's
  speech at once; late audio, lip and gesture chunks of the cut answer are
  dropped. With interruption, Send stays enabled while HuRI writes, so a typed
  question can cut an answer before its voice starts.

At DEBUG huri-core's `huri.client` logger logs relayed events by topic, type
and size only (`sent 'huri.question': RawJson(len:30)`), never their text. The
gateway's own log lines carry no visitor ids or question text. The
`websockets` library's own loggers print frame contents at DEBUG, so keep them
at INFO. HuRI's own server logs are outside the gateway's control.

### modules.yaml: rows, swaps and interrupts

Besides `inbound`, `selected`, `groups` and `modules` (see the header of
[huri_playground/modules.yaml](huri_playground/modules.yaml)):

- `rows` define a tickbox for several modules: `members` (the modules, in
  order), `required` (the row is offered only when HuRI runs all of these, and
  at least one member with an output), plus `group`, `label` and
  `description`. `thinking` and `huri_emotion` are rows. A module that is in no
  row is a row of its own.
- `without_visitor` maps a module to the args added when the start carries no
  valid visitor id, that is, when the visitor did not ask HuRI to remember
  them. Shipped: `rag` with `memory: "short,working"`, so nothing reaches
  long-term memory. It needs huri-modules >= 0.2.0.
- `swaps` (on a module or a row) name a module that is replaced by another when
  the row is ticked too: ticking Lip sync (`lips`) swaps `tts` for
  `tts_phonemes`. A swap target is never a row of its own.
- `interrupts` maps a topic to the topics it cuts short, for huri-core >= 0.5
  (`huri.question` cuts `huri.token`, `huri.audio.out`, `huri.motion`,
  `huri.lips.face` and `huri.emotion.out`). A session keeps only the
  topics it has, and it opens without a policy when none is left or when HuRI
  is a 0.4.

No module name appears in the Python code: a new module or row is an entry in
the yaml.

### The avatar models

The 3D models are not committed. Without one the page is text only; with
several, the page shows the first of these it finds, and `?avatar=man` or
`?avatar=mouse` picks one. They are listed in
[huri_playground/avatars.yaml](huri_playground/avatars.yaml), with how each is
framed and moves:

- **man** (the default): a man from the
  [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)
  library (MIT), with ARKit and viseme blend shapes, so his mouth opens with
  the voice and he blinks. `scripts/fetch_avatar.sh` downloads him (6 MB) to
  `huri_playground/static/avatar/man/` and converts his textures to WebP; it
  needs `curl` and ImageMagick. Another Rocketbox avatar can be given, e.g.
  `scripts/fetch_avatar.sh Male_Adult_03`.
- **mouse**: Mouse-Man, the character of the website demo. Copy
  `frontend/public/model.fbx` from
  [HuRI_website_demo](https://github.com/Lucy-Robotics/HuRI_website_demo) (Git
  LFS, 30 MB) to `huri_playground/static/avatar/model.fbx`. That model has no
  mouth rig, so his mouth does not move.

Everything about an avatar's size is computed from its model, so another
model needs no measurements:

- **its body**: the page measures it in the T-pose (shoulders, arm and hand
  lengths from the bones; chin, chest, belly and hips from the skin, scaled to
  its `height`) and sends it with the session. The gateway checks it and
  passes it to the modules listed in `body_args`: `think`
  (huri-module-think) solves its thinking poses on it, so a hand at the chin
  reaches this avatar's chin. A measurement that is off can be overridden in
  its `body`. That needs a huri-module-think that takes a `body` arg: with
  an older one, take `think` out of `body_args`;
- **the camera** (`camera`): head and shoulders, chest, waist, knees or full
  body, from the bones, without and with gestures;
- **the arms at rest** hang just clear of its belly and hips;
- **the legs** are solved (two-bone IK) so the feet stay planted while the
  hips shift and turn with EMAGE's weight shifts (`pelvis`), the knees soft;
- **the eyes** (a model with eye bones) hold yours, with small saccades, and
  follow the head when it looks away;
- **the motion** (`motion`): the idle life and HuRI's gestures each have a
  gain, and while it gestures the sustained part of the chest's lean, of the
  head's turn away from you and of the arms' spread is taken out (`upright`,
  `gaze`, `arms`): EMAGE's speakers lean forward, look down and hold their
  arms out. Measured on the man in a live session, his head was 32 degrees
  down while he spoke, and his hands went up and down 23 times as much as at
  rest; with the shipped settings, 1 degree and 4 times.

EMAGE also runs on AMD GPUs with the ROCm PyTorch build (measured on an
RX 7700S: 0.07 s per 3 s of speech), although huri-modules' installer turns
`mov` off on AMD.

### Comparing QAG's modes

[scripts/compare_qag_modes.py](scripts/compare_qag_modes.py) talks to a
running playground as a browser would, streams a spoken sentence as microphone
frames in both of `qag`'s modes and measures what a person waits for, from the
moment they stop talking to the first sound of HuRI's answer, with where the
time went. `python scripts/compare_qag_modes.py --help`; it needs `numpy`,
`websockets`, `webrtcvad` and, to read a sentence aloud instead of replaying a
recording, Piper (`piper-tts`) and a voice in `HURI_PIPER_VOICE`.

## Privacy

- **Ratings:** `playground_data/responses.jsonl` (under `PLAYGROUND_DATA_DIR`)
  keeps one line per rated conversation with ten fixed keys: no visitor id and
  no HuRI user id. The only free text is the optional comment the visitor
  leaves at the end, stored as written; the page asks visitors not to put
  personal details in it. Nothing else a visitor wrote or said is stored by
  the gateway. The ratings are stored anonymously.
- **Memory** is opt-in. The visitor ticks "Let HuRI remember me"; unticked by
  default.
  - Ticked: the page creates a random id in the browser (localStorage
    `huri-playground-visitor`) only when the conversation starts, and sends it.
    HuRI gets `playground-` plus a hash of it as the user id, and its `rag`
    module saves long-term memory on HuRI's server under that id, so the next
    conversation here can pick up where this one ended. "Forget me" removes the
    browser's id: this browser starts fresh, but nothing is deleted on HuRI's
    side. The memories stay in HuRI's store until the operator removes them.
  - Unticked, storage unavailable, or a malformed id: the gateway uses a
    one-off id, nothing links conversations, and it adds the `without_visitor`
    args of `modules.yaml`. The shipped value runs `rag` with short and working
    memory only, so nothing is saved as long-term memory.
- **Microphone:** if the visitor turns the microphone on, the voice is sent to
  HuRI to be understood. What it understands is kept as long-term memory only
  when the visitor ticked "Let HuRI remember me".
- **Logs:** see the paragraph on DEBUG logging under
  [The browser protocol](#the-browser-protocol).
- **Contact:** the operator of a deployment is responsible for it and should
  publish a contact for visitors. For this software, open an issue at the
  repository: https://github.com/Lucy-Robotics/HuRI-Playground.

## Versions and compatibility

huri-playground follows semver on its command line, its environment variables
and the keys of `modules.yaml`. Releases are git tags `X.Y.Z` (no `v`) on
`main`; `dev` carries the next version. See [RELEASING.md](RELEASING.md).

| huri-playground | huri-core | huri-modules (the server) |
|---|---|---|
| 0.1.x | 0.5.x (`>=0.5,<0.6`) | a set of huri-modules >= 0.2.0 serves the page (its `rag` has the `memory` argument the gateway sets for a start without a remembered visitor; the `rag` of 0.1.x has none and the server would refuse such a start); showing the emotion (`huri.emotion`) and the `emotion_earlier` flag of `huri.question` need its huri-events >= 0.2; showing when HuRI hears you (`huri.voice`) needs its huri-events >= 0.3.1 (huri-modules#108). A 0.5 server lets a new question cut the answer short (interruption). A 0.4 server still serves the page, but without interruption: the gateway starts the session without an `event_policy`, `ready.interrupts` is `false`, and a new question waits for the answer in progress |

CI tests against huri-core at the ref set by the `HURI_CORE_REF` variable of
[ci.yml](.github/workflows/ci.yml), the release tag inside the
`huri-core[client]` range (`0.5.0`), and checks the module names of
`modules.yaml` against huri-modules' `registry.toml` at `HURI_MODULES_REF`
(`dev`).

## License

GPL-3.0, see [LICENSE](LICENSE).
