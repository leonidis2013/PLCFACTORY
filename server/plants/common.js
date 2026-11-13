'use strict';
let n = 0;
const uid = p => (p || 'id') + Date.now().toString(36).slice(-4) + (n++).toString(36) + Math.random().toString(36).slice(2, 5);

// Sensor factories (used for default I/O configurations)
const analog = (tag, signal, lo, hi, extra = {}) => Object.assign({ id: uid('s'), tag, type: 'analog', signal, lo, hi, scale: 'eng', noise: 0.2, fault: 'none' }, extra);
const sw = (tag, signal, op, sp, extra = {}) => Object.assign({ id: uid('s'), tag, type: 'switch', signal, op, sp, hyst: 0.5, contact: 'NO', fault: 'none' }, extra);
const disc = (tag, signal, contact = 'NO', extra = {}) => Object.assign({ id: uid('s'), tag, type: 'discrete', signal, contact, fault: 'none' }, extra);
const probe = (tag, signal, pos, extra = {}) => Object.assign({ id: uid('s'), tag, type: 'probe', signal, pos, contact: 'NO', fault: 'none' }, extra);

const panelSensors = () => [
  disc('I_Start', 'pb_start', 'NO', { desc: 'START pushbutton (NO contact: TRUE while pressed)' }),
  disc('I_Stop', 'pb_stop', 'NC', { desc: 'STOP pushbutton (NC contact: FALSE while pressed — fail-safe)' }),
  disc('I_EStop', 'estop', 'NC', { desc: 'E-stop (NC contact: FALSE when tripped — fail-safe)' }),
];

// HMI widget factory
const W = (type, x, y, w, h, props = {}) => Object.assign({ id: uid('w'), type, x, y, w, h }, props);
const A = (tag, cond, val, msg, pri = 'Medium') => ({ id: uid('a'), tag, cond, val, msg, pri });

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
const ramp = (v, target, perSec, dt) => (v < target ? Math.min(target, v + perSec * dt) : Math.max(target, v - perSec * dt));

module.exports = { uid, analog, sw, disc, probe, panelSensors, W, A, clamp, approach, ramp };
