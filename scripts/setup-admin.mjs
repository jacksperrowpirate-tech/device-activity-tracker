import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashPassword } from '../dist/auth.js';

const filename = resolve('.env');
let content = await readFile(filename, 'utf8').catch(() => '');
const lines = content.split(/\r?\n/).filter(Boolean);
const currentHash = lines.find(line => line.startsWith('ADMIN_PASSWORD_HASH='))?.slice('ADMIN_PASSWORD_HASH='.length);
if (currentHash && !process.argv.includes('--rotate')) {
    throw new Error('Admin password is already configured. Run with --rotate to replace it.');
}
function setValue(key, value) {
    const index = lines.findIndex(line => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
}
const oldToken = lines.find(line => line.startsWith('ADMIN_TOKEN='))?.slice('ADMIN_TOKEN='.length);
if (oldToken) {
    lines.splice(lines.findIndex(line => line.startsWith('ADMIN_TOKEN=')), 1);
    if (!lines.some(line => line.startsWith('MONITOR_TOKEN='))) setValue('MONITOR_TOKEN', oldToken);
}
const password = randomBytes(18).toString('base64url');
setValue('ADMIN_USERNAME', 'admin');
setValue('ADMIN_PASSWORD_HASH', await hashPassword(password));
await writeFile(filename, `${lines.join('\n')}\n`, { mode: 0o600 });
await chmod(filename, 0o600);
await mkdir(resolve('data'), { recursive: true, mode: 0o700 });
const credentialFile = resolve('data/admin-login.txt');
await writeFile(credentialFile, `Usuário: admin\nSenha: ${password}\n`, { mode: 0o600 });
await chmod(credentialFile, 0o600);
console.log(`Login criado. Credenciais locais: ${credentialFile}`);
