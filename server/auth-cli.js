'use strict';
/*
 * Recovery tool, run inside the container:
 *   docker exec -it plcfactory node server/auth-cli.js list
 *   docker exec -it plcfactory node server/auth-cli.js reset <username> <new-password>
 *   docker exec -it plcfactory node server/auth-cli.js add <username> <password> <admin|engineer|operator|viewer>
 *   docker exec -it plcfactory node server/auth-cli.js reset-all      (delete ALL users → first-run setup on next restart)
 */
const path = require('path');
const { Auth } = require('./auth');
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const a = new Auth(DATA, () => {});
const [cmd, u, p, r] = process.argv.slice(2);
if (cmd === 'list') { for (const x of a.list()) console.log(`${x.username}\t${x.role}`); process.exit(0); }
if (cmd === 'reset' && u && p) { const e = a.resetPassword(u, p); console.log(e || `Password reset for ${u}. They will be asked to change it. (Restart the container to drop cached sessions.)`); process.exit(e ? 1 : 0); }
if (cmd === 'add' && u && p && r) { const res = a.upsert({ username: 'cli' }, { username: u, password: p, role: r }); console.log(res.ok ? `Added ${u} (${r})` : res.msg); process.exit(res.ok ? 0 : 1); }
if (cmd === 'reset-all' && u === undefined) { a.factoryReset(); console.log('All users deleted. Restart the container to run first-time setup.'); process.exit(0); }
console.log('Usage: node server/auth-cli.js list | reset <user> <password> | add <user> <password> <role> | reset-all');
process.exit(1);
