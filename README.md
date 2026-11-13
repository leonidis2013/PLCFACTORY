# PLCFACTORY

A self-hosted **PLC & SCADA training simulator** in Docker, with an industrial engineering-station look (graphite + safety yellow, blueprint schematics). You write IEC 61131-3 **Structured Text**, build an **HMI**, set up the plant's **sensors**, and watch virtual equipment react in **3D** (or 2D).

The soft PLC and the plant physics run on the server 24/7, so every browser you connect sees the same live PLC: a tablet HMI and a laptop engineering station at once. A built-in **Modbus TCP server** lets real SCADA software (Ignition, FUXA, Node-RED, Codesys…) connect to the simulated PLC.

## Features

| | |
|---|---|
| **Soft PLC** | **Structured Text** and **Ladder Diagram** programs in one project (Data types → Globals → ordered programs). **UDTs** (`TYPE … STRUCT`), `ARRAY[..] OF` (including arrays of UDTs), member/index/bit access, **shift registers** (`BSL`/`BSR` on any array, `SHL`/`SHR`/`ROL`/`ROR`), bitwise logic. Compiler: `IF/ELSIF/CASE/FOR/WHILE/REPEAT`, BOOL/INT/DINT/REAL/TIME. Function blocks `TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS PID`. Warm/cold download, RUN/STOP/FAULT, watchdog, configurable cycle time, line-numbered compile errors. |
| **PID** | Ideal-form PID FB with anti-windup, derivative-on-measurement, bumpless auto/manual, reverse acting and P/I/D term outputs. Comes with an HMI **PID faceplate** for live tuning and a tuning guide (step test, lambda, Ziegler–Nichols). |
| **Flexible sensors** | The I/O tab builds the sensor list from the plant's physical measurements. Analog transmitters (engineering units, **4–20 mA** or **raw 0–27648**, range, noise), switches (SP, hysteresis, NO/NC), discrete contacts (limit switches, valve ZSO/ZSC), and position sensors placed anywhere along a line. |
| **Fault injection** | Per sensor: stuck, drift, noisy, fail low/high, wire break. Per actuator: stuck on/off. Plus process faults for each plant (lost supply, glove breach, contamination…). |
| **HMI builder** | Drag-and-drop editor on an 800×480 canvas: buttons, switches, lamps, values, setpoints, bars, motors, valves, PID faceplates, mini-trends, alarm banner. Two screen styles: **ISA-101 high-performance** (gray, colour only for abnormal states, as used in real plants) or **dark control room**. Full-screen mode for a tablet. |
| **SCADA** | Alarms (priorities, ack, return-to-normal), event log, 6-pen trend with per-pen scaling, tag browser with write and **force**. |
| **3D / 2D plant views** | Custom WebGL renderer with no external libraries, so it works offline. Orbit, pinch-zoom and pan, with live labels. |

## Plants

1. **Tank: fill, heat & drain.** 200 L tank with inlet valve (travel time), VFD pump, mixer and an SCR heater with thermowell lag (a real PID loop). Dry-fire damage, overflow, cold-water disturbance.
2. **Conveyor: box sorter.** Photoeyes, height sensor and a pneumatic pusher. Jams if your timing is wrong.
3. **Aseptic vial filler (isolator).** Indexing belt, fill-to-weight load cell, stopper press and reject kicker inside a Grade A isolator. Includes HEPA laminar flow, ΔP, particle counting and a VHP (H₂O₂) decontamination cycle. Every vial is graded on whether it was truly sterile, in spec and stoppered.
4. **Bioreactor / fermenter.** Jacketed 70 L stirred tank with 9 automated valves (media, inoculum, harvest, drain, steam, jacket hot/cold, sparge air, vent), 4 dosing pumps, agitator and air MFC. Models steam-in-place with real steam/air headspace pressure (and the vacuum-on-cooldown contamination trap), Monod growth, DO, pH and foam.

Each plant ships with a working example program, HMI, sensor list and alarm set, plus exercises in the **Learn** tab.

## Install

### TrueNAS SCALE (custom app → Install via YAML)

Paste [`docker-compose.yml`](docker-compose.yml). It uses the image `ghcr.io/leonidis2013/plcfactory:latest` and stores data in the named volume `plcfactory-data`.

- Web UI: `http://<server>:8085`
- Modbus TCP: port `502`

> The image is built by GitHub Actions on every push to `main`. If the repository is private, the GHCR package is private too. Either make the package public (GitHub → Packages → plcfactory → Package settings → Change visibility) or add GHCR credentials to TrueNAS.

### Docker Compose (any host)

```bash
docker compose up -d                 # pulls the image
# or build locally:
docker build -t ghcr.io/leonidis2013/plcfactory:latest . && docker compose up -d
```

### Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `8080` | Web UI port inside the container |
| `MODBUS_PORT` | `5020` | Modbus TCP port inside the container (published as 502) |
| `MODBUS` | on | Set to `off` to disable Modbus |
| `DATA_DIR` | `/data` | Projects (`projects/<plant>.json`) and settings |

| `ADMIN_USER` / `ADMIN_PASSWORD` | — | Optional: create the first admin without the setup page (only when no users exist) |
| `TRUST_PROXY` | off | Set `true` behind a reverse proxy so client IPs and HTTPS are detected |
| `COOKIE_SECURE` | auto | Force the `Secure` cookie flag |
| `SESSION_DAYS` | `7` | Sign-in lifetime (sliding) |
| `AUTH` | on | `off` disables sign-in. Only for an isolated LAN |

## Security & users

Sign-in is **on by default**.

**First-time setup:** on first start, every page redirects to **Create the administrator**. Pick a username and a password of 10+ characters, and you're signed in.

- If you connect from your **local network**, that's all.
- If you connect from **outside, or through a reverse proxy**, the page also asks for a **one-time setup code**. It's printed in the container log (TrueNAS: Apps → plcfactory → Logs), so nobody else can claim the server before you.
- Finish setup **before** you port-forward or publish it.
- For unattended installs, set `ADMIN_USER`/`ADMIN_PASSWORD` instead.
- To start over: `node server/auth-cli.js reset-all`, then restart.

| Role | Can |
|---|---|
| **viewer** | Watch everything (HMI, plant, trends, alarms, program), change nothing |
| **operator** | + operate the HMI and local control station, plant controls, acknowledge alarms |
| **engineer** | + program/download, RUN/STOP, I/O config, HMI & alarm editing, forcing, fault injection, scenarios, import/export |
| **admin** | + manage users (menu → your name → Manage users) |

How it works:

- Passwords are hashed with scrypt.
- Sessions are random tokens in `HttpOnly; SameSite=Strict` cookies, and only token hashes are stored.
- Sign-in is throttled: 5 failures per username or 20 per IP gives a 15-minute lock.
- Changing a password signs out the user's other devices.
- Write requests must be same-origin JSON (CSRF protection).
- A strict Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff` are set on every response.

**Exposing it to the internet:**
1. Put it behind HTTPS: Nginx Proxy Manager, Traefik, Caddy or a Cloudflare Tunnel. Set `TRUST_PROXY=true`.
2. Forward **only the web port**. Never forward Modbus (502). Modbus/TCP has no authentication, so anyone who reaches it can read and write the PLC. Keep it on your LAN, or set `MODBUS=off`.
3. Give people the lowest role they need.

Locked out? Run this inside the container:

```bash
docker exec -it plcfactory node server/auth-cli.js list
docker exec -it plcfactory node server/auth-cli.js reset admin 'a-new-long-password'
docker exec -it plcfactory node server/auth-cli.js reset-all     # delete all users → setup page after restart
```

## Development

There are no dependencies: Node 18+ is all you need.

```bash
node server/index.js     # http://localhost:8080  (data in ./data)
node test/sim.js         # headless check: runs every example program against its plant
```

```
server/
  index.js            HTTP API, Server-Sent Events, persistence, scan loop
  modbus.js           Modbus TCP server (FC 1,2,3,4,5,6,15,16)
  auth.js             users, sessions, roles, login throttling (auth-cli.js = recovery)
  engine/compiler.js  Structured Text → closures; UDTs, arrays, function blocks incl. PID
  engine/ladder.js    Ladder rungs → Structured Text
  engine/runtime.js   scan cycle, sensor/actuator layers, forces, alarms, history
  plants/*.js         physics models, I/O catalogues, example projects
public/
  js/ld.js            ladder editor + live power flow
  index.html, css/app.css
  js/app.js           engineering station (editor, I/O, alarms, trend, tags)
  js/hmi.js           HMI runtime + builder
  js/gl.js            WebGL renderer
  js/scenes3d.js      3D plant scenes
  js/scenes2d.js      2D schematics
  js/learn.js         tutorial content
```

## Modbus address map

The map is generated from your tags and shown in the I/O tab. In short:

- **Coils:** BOOL outputs, then BOOL memory variables.
- **Discrete inputs:** BOOL inputs and system bits.
- **Input registers:** analog inputs.
- **Holding registers:** analog outputs, then numeric memory variables.

32-bit values (REAL as IEEE-754 float, integers as INT32) take 2 registers, big-endian.

---
© Jerod Ulicki
