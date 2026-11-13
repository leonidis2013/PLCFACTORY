# PLCFACTORY

A self-hosted **PLC & SCADA training simulator** in Docker, with an industrial engineering-station look (graphite + safety yellow, blueprint schematics). You write IEC 61131-3 **Structured Text**, build an **HMI**, set up the plant's **sensors**, and watch virtual equipment react in **3D** (or 2D).

The soft PLC and the plant physics run on the server 24/7, so every browser you connect sees the same live PLC: a tablet HMI and a laptop engineering station at once. A built-in **Modbus TCP server** lets real SCADA software (Ignition, FUXA, Node-RED, Codesys…) connect to the simulated PLC.

## Features

| | |
|---|---|
| **Soft PLC** | Structured Text compiler: `IF/ELSIF/CASE/FOR/WHILE/REPEAT`, BOOL/INT/DINT/REAL/TIME. Function blocks `TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS PID`. Warm/cold download, RUN/STOP/FAULT, watchdog, configurable cycle time, line-numbered compile errors. |
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

There is no login. Run it on a trusted LAN.

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
  engine/compiler.js  Structured Text → closures; function blocks incl. PID
  engine/runtime.js   scan cycle, sensor/actuator layers, forces, alarms, history
  plants/*.js         physics models, I/O catalogues, example projects
public/
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
