import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileContactRepository } from '../dist/infra/contact-repository.js';

test('file repository persists concurrent changes and removes contacts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-contacts-'));
    const filename = path.join(directory, 'contacts.json');
    try {
        const repository = new FileContactRepository(filename);
        assert.deepEqual(await repository.list(), []);
        await Promise.all([
            repository.save({ id: '491701234567@s.whatsapp.net', platform: 'whatsapp' }),
            repository.save({ id: 'signal:491701234568', platform: 'signal' })
        ]);
        assert.equal((await repository.list()).length, 2);
        await repository.remove('signal:491701234568');
        assert.deepEqual(await repository.list(), [{ id: '491701234567@s.whatsapp.net', platform: 'whatsapp' }]);
        assert.equal(JSON.parse(await readFile(filename, 'utf8')).length, 1);
        await repository.close();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
