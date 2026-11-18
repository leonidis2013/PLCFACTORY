# PLCFACTORY

A self-hosted **PLC & SCADA training simulator** in Docker. You write IEC 61131-3 **Structured Text** or **Ladder**, build an **HMI**, set up the plant's **sensors**, and watch virtual equipment react in **3D** (or 2D). It has four ways to learn: graded **courses**, timed **troubleshooting** work orders, a **sandbox** where you build your own machines, and four complete **practice plants**. The interface is styled like a PLC engineering workstation (Studio 5000 / CODESYS): a controller organizer tree, Logix-style ladder instructions, and a status bar with RUN / OK / I/O / FORCE lamps, in light and dark themes (it follows your system setting). Click the logo to get back home from anywhere.

The soft PLC and the plant physics run on the server 24/7, so every browser you connect sees the same live PLC: a tablet HMI and a laptop engineering station at once. A built-in **Modbus TCP server** lets real SCADA software (Ignition, FUXA, Node-RED, Codesys…) connect to the simulated PLC.

## Modes

| Mode | What you do |
|---|---|
| **Learn** | 38 lessons in 5 courses and 7 modules, each module ending in a **capstone** project. **PLC programming**: Fundamentals (I/O and the scan, NC fail-safe wiring, logic gates, seal-in, jog vs run, interlocks, a drive-station capstone), Timers, counters & edges (TON/TOF/TP, CTU, edges, flashers, up/down counting, a traffic-light capstone), Data & motion (shift registers, UDTs, cylinder motion timeouts, VFD reference and at-speed, a sort-and-batch capstone). **Process control**: 4–20 mA scaling, hysteresis, temperature on/off with interlocks, H/L/HH/LL alarms and trips, duty/standby pumps, CASE sequencers, PID, a batch heat-and-transfer capstone. **Safety & diagnostics**: E-stop with a monitored safety relay, fail-to-start/stop, first-out, valve discrepancy, a guarded-machine capstone. **HMI**: ISA-18.2 alarms, HMI command bits and status words, setpoint validation. **SCADA & networks**: Local/Remote control and a remote pump station capstone. Every lesson works in **Structured Text or Ladder** with its own starter, hints, theory tips and solution. Three **difficulty levels**: *Easy* (hints, solution, forcing and simulator shortcuts any time), *Moderate* (each Check unlocks a hint, the solution unlocks after 3 Checks) and *Realistic* (no hints, solution, forcing or simulator shortcuts, like a commissioning job, and passing earns a *realistic ✓*). **Check my program** grades the downloaded program (A–F, out of 100) in a fast-forward copy of the simulation: correctness (the objectives, 60), robustness (25: the objectives again at 10 ms and 100 ms scan times, two minutes of random operator input without damaging the machine, and a safe power-up), and simplicity (15: program size against the reference solution, unused variables). |
| **Troubleshoot** | 10 work orders on the practice plants, each with a planted fault: a failed sensor, a stuck valve, a wrong contact type, a bad scaling setting, a mis-mounted photoeye, a program bug or a badly tuned loop. Investigate with trends, tags and the I/O view, replace parts or fix the configuration or code, then close the work order with the root cause. The plant is running when you arrive and plant-floor rules apply: logic changes go in as online edits while running; full downloads and data-type changes need the PLC in STOP (a production stop); replacing devices, rewiring, moving sensors and clearing jams need a lockout that de-energises every output; tag names, scaling and ranges can be changed online; edits that would break the running program are refused; and you must remove your lock and all forces and leave the PLC in RUN before closing. Score: 1000 minus time over par, hints, unneeded part replacements, production stops, a wrong root cause and rejected attempts. |
| **Build** | A sandbox machine builder, plus a **Network & racks** editor: add controllers, remote I/O racks, Ethernet switches, HMIs, SCADA PCs and drives, cable them together, fill the chassis slots with DI/DO/AI/AO/Ethernet modules and press **Verify** (IP and subnet errors, duplicate addresses, unreachable devices, port counts, switch loops, and I/O capacity against the machine). The network is **live**: every I/O point is wired to a module channel (local chassis first, then remote racks; shown on the I/O tab and in the organizer). **Unplug** a cable or **power off** a device while running. A rack that loses its connection (or has a bad, duplicate or wrong-subnet IP) faults its I/O: inputs read 0 and outputs drop to off, and a `NET_<device>_OK` tag lets your program react. An HMI without a path shows *Communication lost*, and a SCADA/engineering PC without a path can't download, write or force. Drag tanks, on/off and control valves, pumps (optionally VFD), heaters (optionally SCR), motors (reversing, VFD, overload relay), conveyors with part feeders, pneumatic pushers/stoppers, pushbuttons, selector switches, E-stops, dual-channel safety relays (monitored reset, cross-fault detection, hardware power cut), potentiometers, pilot lights and stack lights onto a plan. New machines start with an ST or Ladder program, following your language choice. **Apply** generates the PLC outputs and sensor signals, and can add typical sensors automatically. The 3D and 2D views are generated from your layout. |
| **Practice** | The four complete plants below, with example programs, HMIs and alarms. |

Progress is kept per user in `/data/progress.json`.

## Features

| | |
|---|---|
| **Soft PLC** | **Structured Text** and **Ladder Diagram** programs in one project (Data types → Globals → ordered programs). **UDTs** (`TYPE … STRUCT`), `ARRAY[..] OF` (including arrays of UDTs), member/index/bit access, **shift registers** (`BSL`/`BSR` on any array, `SHL`/`SHR`/`ROL`/`ROR`), bitwise logic. Compiler: `IF/ELSIF/CASE/FOR/WHILE/REPEAT`, BOOL/INT/DINT/REAL/TIME. Function blocks `TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS PID`. Warm/cold download, RUN/STOP/FAULT, watchdog, configurable cycle time, line-numbered compile errors. |
| **PID** | Ideal-form PID FB with anti-windup, derivative-on-measurement, bumpless auto/manual, reverse acting and P/I/D term outputs. Comes with an HMI **PID faceplate** for live tuning and a tuning guide (step test, lambda, Ziegler–Nichols). |
| **Flexible sensors** | The I/O tab builds the sensor list from the plant's physical measurements. Analog transmitters (engineering units, **4–20 mA** or **raw 0–27648**, range, noise), switches (SP, hysteresis, NO/NC), discrete contacts (limit switches, valve ZSO/ZSC), and position sensors placed anywhere along a line. |
| **Fault injection** | Per sensor: stuck, drift, noisy, fail low/high, wire break. Per actuator: stuck on/off. Plus process faults for each plant (lost supply, glove breach, contamination…). Hidden faults are used by troubleshooting work orders, where fault injection is locked. |
| **HMI builder** | Drag-and-drop editor on an 800×480 canvas: buttons, switches, lamps, values, setpoints, bars, motors, valves, PID faceplates, mini-trends, alarm banner. Two screen styles: **ISA-101 high-performance** (gray, colour only for abnormal states, as used in real plants) or **dark control room**. Full-screen mode for a tablet. |
| **SCADA** | Alarms (priorities, ack, return-to-normal), event log, 6-pen trend with per-pen scaling, tag browser with write and **force**. |
| **3D / 2D plant views** | Custom WebGL renderer with no external libraries, so it works offline. Orbit, pinch-zoom and pan, with live labels. |

## Plants

1. **Tank: fill, heat & drain.** 200 L tank with inlet valve (travel time), VFD pump, mixer and an SCR heater with thermowell lag (a real PID loop). Dry-fire damage, overflow, cold-water disturbance.
2. **Conveyor: box sorter.** Photoeyes, height sensor and a pneumatic pusher. Jams if your timing is wrong.
3. **Aseptic vial filler (isolator).** Indexing belt, fill-to-weight load cell, stopper press and reject kicker inside a Grade A isolator. Includes HEPA laminar flow, ΔP, particle counting and a VHP (H₂O₂) decontamination cycle. Every vial is graded on whether it was truly sterile, in spec and stoppered.
4. **Bioreactor / fermenter.** Jacketed 70 L stirred tank with 9 automated valves (media, inoculum, harvest, drain, steam, jacket hot/cold, sparge air, vent), 4 dosing pumps, agitator and air MFC. Models steam-in-place with real steam/air headspace pressure (and the vacuum-on-cooldown contamination trap), Monod growth, DO, pH and foam.

Each plant ships with a working example program, HMI, sensor list and alarm set, plus reference material and exercises in the **Reference** tab.

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
| `PUBLIC_URL`, `TRUST_PROXY`, `TRUSTED_PROXIES`, `ALLOWED_HOSTS`, `COOKIE_SECURE`, `SESSION_DAYS`, `MODBUS`, `MODBUS_WRITE`, `MODBUS_ALLOW` | — | Optional. Normally set in **Settings → External access**; if set here they override and lock the field |
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
| **engineer** | + program/download, RUN/STOP, I/O config, HMI & alarm editing, forcing, fault injection, switching lessons/challenges/machines, building machines, grading, import/export |
| **admin** | + manage users (menu → your name → Manage users) |

How it works:

- Passwords are hashed with scrypt.
- Sessions are random tokens in `HttpOnly; SameSite=Strict` cookies, and only token hashes are stored.
- Sign-in is throttled: 5 failures per username or 20 per IP gives a 15-minute lock.
- Changing a password signs out the user's other devices.
- Write requests must be same-origin JSON (CSRF protection).
- A strict Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff` are set on every response.

**Exposing it to the internet:** the admin-only **Settings** tab has everything you need, and changes apply without a restart:

- **Connection test:** shows what the server sees from your browser (client IP, proxy, HTTPS, host) and warns about misconfiguration.
- **Public URL**, **Behind a reverse proxy** (with a trusted-proxy address list), **Secure cookies**, **Allowed hostnames** (DNS-rebinding protection) and **Session lifetime**.
- **Modbus:** on/off, read-only mode and allowed client addresses.
- Copy-paste examples for Nginx Proxy Manager, Caddy, Traefik and Cloudflare Tunnel.

Steps:

1. Put it behind HTTPS: Nginx Proxy Manager, Traefik, Caddy or a Cloudflare Tunnel. Turn on **Behind a reverse proxy**, then open the Settings tab through your public address and check the connection test.
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
npm test                 # example programs, language self-test, every lesson (solution passes,
                         # starter fails) and every work order (broken fails, repaired passes)
```

```
server/
  index.js            HTTP API, Server-Sent Events, persistence, scan loop
  modbus.js           Modbus TCP server (FC 1,2,3,4,5,6,15,16)
  auth.js             users, sessions, roles, login throttling, first-run setup (auth-cli.js = recovery)
  access.js           external-access settings: proxy trust, hosts, cookies, Modbus exposure
  engine/compiler.js  Structured Text → closures; UDTs, arrays, function blocks incl. PID
  engine/ladder.js    Ladder rungs → Structured Text
  engine/runtime.js   scan cycle, sensor/actuator layers, forces, hidden faults, alarms, history
  engine/grader.js    fast-forward test harness used to grade lessons and work orders
  workspaces.js       modes: practice plants, lessons, challenges, sandbox machines; progress
  curriculum/         lessons.js + lessons2.js (38 graded lessons, courses → modules), challenges.js (10 work orders)
  plants/*.js         physics models, I/O catalogues, example projects
  plants/sandbox.js   component-based machines (layout → plant model)
public/
  js/ld.js            ladder editor + live power flow
  index.html, css/app.css
  js/app.js           engineering station (editor, I/O, alarms, trend, tags)
  js/modes.js         home screen (courses, difficulty), mission panel, build tab
  js/organizer.js     controller organizer tree + status bar
  js/net.js           network & rack builder with Verify, live status, unplug / power off
  engine/network.js   (server) reachability, addressing and I/O channel assignment
  js/sandbox.js       sandbox 3D/2D views, operator panel, machine builder
  js/theme.js         light/dark theme (follows the system by default)
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
