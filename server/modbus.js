'use strict';
/*
 * Minimal Modbus TCP server so real SCADA/HMI software (Ignition, FUXA, Node-RED,
 * Codesys, a Modbus client app...) can talk to the simulated PLC.
 *
 * Address map (0-based, rebuilt whenever tags change):
 *   Coils             (FC1, FC5, FC15)  BOOL outputs (Q_) then BOOL memory tags
 *   Discrete inputs   (FC2)             BOOL inputs (I_) then system bits
 *   Input registers   (FC4)             analog inputs, 2 registers each
 *   Holding registers (FC3, FC6, FC16)  analog outputs then numeric memory tags, 2 registers each
 * 32-bit values are big-endian (ABCD). REAL = IEEE-754 float, INT/DINT/TIME = signed 32-bit.
 */
const net = require('net');

function buildMap(rt) {
  const coils = [], di = [], ir = [], hr = [];
  const order = Object.keys(rt.tags);
  for (const K of order) {
    const t = rt.tags[K];
    if (t.kind === 'FB') continue;
    const isBool = t.base === 'BOOL';
    if (t.kind === 'DO' && isBool) coils.push(K);
    else if (t.kind === 'DI' || (t.kind === 'SYS' && isBool)) di.push(K);
    else if (t.kind === 'AI' || (t.kind === 'SYS' && !isBool)) ir.push(K);
    else if (t.kind === 'AO') hr.push(K);
  }
  for (const K of order) {
    const t = rt.tags[K];
    if (t.kind !== 'MEM') continue;
    if (t.base === 'BOOL') coils.push(K); else hr.push(K);
  }
  return { coils, di, ir, hr };
}

function describe(rt, map) {
  const out = [];
  map.coils.forEach((K, i) => out.push({ tag: rt.tags[K].name, table: 'Coil', fc: '1/5/15', addr: i, ref: `0${String(i + 1).padStart(5, '0')}`, type: 'BOOL' }));
  map.di.forEach((K, i) => out.push({ tag: rt.tags[K].name, table: 'Discrete input', fc: '2', addr: i, ref: `1${String(i + 1).padStart(5, '0')}`, type: 'BOOL' }));
  map.ir.forEach((K, i) => out.push({ tag: rt.tags[K].name, table: 'Input register', fc: '4', addr: i * 2, ref: `3${String(i * 2 + 1).padStart(5, '0')}`, type: rt.tags[K].base === 'REAL' ? 'FLOAT32' : 'INT32' }));
  map.hr.forEach((K, i) => out.push({ tag: rt.tags[K].name, table: 'Holding register', fc: '3/6/16', addr: i * 2, ref: `4${String(i * 2 + 1).padStart(5, '0')}`, type: rt.tags[K].base === 'REAL' ? 'FLOAT32' : 'INT32' }));
  return out;
}

function regsOf(t) {
  const b = Buffer.alloc(4);
  if (t.base === 'REAL') b.writeFloatBE(Number(t.v) || 0); else b.writeInt32BE(Math.trunc(Number(t.v)) | 0);
  return [b.readUInt16BE(0), b.readUInt16BE(2)];
}

function start(rt, port, log) {
  let map = null, ver = -1;
  const getMap = () => { if (ver !== rt.tagVer) { map = buildMap(rt); ver = rt.tagVer; } return map; };
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) break;
        const frame = buf.subarray(0, 6 + len);
        buf = buf.subarray(6 + len);
        try { sock.write(handle(frame)); } catch (e) { /* ignore */ }
      }
    });
    sock.on('error', () => {});
  });

  function reply(frame, pdu) {
    const h = Buffer.alloc(7);
    frame.copy(h, 0, 0, 4);
    h.writeUInt16BE(pdu.length + 1, 4);
    h[6] = frame[6];
    return Buffer.concat([h, pdu]);
  }
  const exc = (frame, fc, code) => reply(frame, Buffer.from([fc | 0x80, code]));

  function handle(frame) {
    const m = getMap();
    const fc = frame[7];
    const pdu = frame.subarray(7);
    const addr = pdu.length >= 3 ? pdu.readUInt16BE(1) : 0;
    const qty = pdu.length >= 5 ? pdu.readUInt16BE(3) : 0;
    const bits = (list, get) => {
      if (qty < 1 || qty > 2000) return exc(frame, fc, 3);
      if (addr + qty > list.length) return exc(frame, fc, 2);
      const nb = Math.ceil(qty / 8), out = Buffer.alloc(2 + nb);
      out[0] = fc; out[1] = nb;
      for (let i = 0; i < qty; i++) if (get(list[addr + i])) out[2 + (i >> 3)] |= 1 << (i & 7);
      return reply(frame, out);
    };
    const regs = list => {
      if (qty < 1 || qty > 125) return exc(frame, fc, 3);
      if (addr + qty > list.length * 2) return exc(frame, fc, 2);
      const out = Buffer.alloc(2 + qty * 2);
      out[0] = fc; out[1] = qty * 2;
      for (let i = 0; i < qty; i++) {
        const r = addr + i, t = rt.tags[list[r >> 1]];
        out.writeUInt16BE(t ? regsOf(t)[r & 1] : 0, 2 + i * 2);
      }
      return reply(frame, out);
    };
    const writeReg = (r, val, pending) => {
      const K = m.hr[r >> 1];
      if (!K) return false;
      const p = pending[K] || (pending[K] = regsOf(rt.tags[K]));
      p[r & 1] = val;
      return true;
    };
    const commit = pending => {
      for (const K in pending) {
        const b = Buffer.alloc(4); b.writeUInt16BE(pending[K][0], 0); b.writeUInt16BE(pending[K][1], 2);
        const t = rt.tags[K];
        rt.write(K, t.base === 'REAL' ? b.readFloatBE(0) : b.readInt32BE(0));
      }
    };
    switch (fc) {
      case 1: return bits(m.coils, K => rt.tags[K] && rt.tags[K].v);
      case 2: return bits(m.di, K => rt.tags[K] && rt.tags[K].v);
      case 3: return regs(m.hr);
      case 4: return regs(m.ir);
      case 5: {
        if (addr >= m.coils.length) return exc(frame, fc, 2);
        rt.write(m.coils[addr], pdu.readUInt16BE(3) === 0xFF00);
        return reply(frame, pdu.subarray(0, 5));
      }
      case 6: {
        const pending = {};
        if (!writeReg(addr, pdu.readUInt16BE(3), pending)) return exc(frame, fc, 2);
        commit(pending);
        return reply(frame, pdu.subarray(0, 5));
      }
      case 15: {
        if (addr + qty > m.coils.length) return exc(frame, fc, 2);
        for (let i = 0; i < qty; i++) rt.write(m.coils[addr + i], !!(pdu[6 + (i >> 3)] & (1 << (i & 7))));
        return reply(frame, pdu.subarray(0, 5));
      }
      case 16: {
        if (addr + qty > m.hr.length * 2) return exc(frame, fc, 2);
        const pending = {};
        for (let i = 0; i < qty; i++) writeReg(addr + i, pdu.readUInt16BE(6 + i * 2), pending);
        commit(pending);
        return reply(frame, pdu.subarray(0, 5));
      }
    }
    return exc(frame, fc, 1);
  }

  server.on('error', e => log(`Modbus TCP server error: ${e.message}`));
  server.listen(port, () => log(`Modbus TCP server listening on port ${port}`));
  return { describe: () => describe(rt, getMap()) };
}

module.exports = { start };
