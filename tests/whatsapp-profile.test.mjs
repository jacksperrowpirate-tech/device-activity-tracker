import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileProfileStore } from '../dist/infra/profile-store.js';
import { contactSharedName, fetchWhatsAppProfile } from '../dist/whatsapp-profile.js';

test('collects visible WhatsApp fields and keeps unavailable fields explicit', async () => {
    const jid = '491701234567@s.whatsapp.net';
    const profile = await fetchWhatsAppProfile({
        profilePictureUrl: async () => 'https://pps.whatsapp.net/photo.jpg',
        fetchStatus: async () => [{ id: jid, status: { status: 'Atendimento', setAt: new Date('2026-01-02') } }],
        getBusinessProfile: async () => ({ category: 'Serviços', description: 'Aberto', website: ['https://example.com'] })
    }, jid);
    assert.equal(profile.photoUrl, 'https://pps.whatsapp.net/photo.jpg');
    assert.equal(profile.about, 'Atendimento');
    assert.equal(profile.business.category, 'Serviços');
    assert.equal(profile.sharedName, undefined);
    assert.deepEqual(contactSharedName({ id: jid, notify: 'Ana', verifiedName: 'Loja Ana' }), { sharedName: 'Loja Ana', nameSource: 'business' });

    const hidden = await fetchWhatsAppProfile({
        profilePictureUrl: async () => 'javascript:alert(1)',
        fetchStatus: async () => [{ id: jid, status: { status: null } }],
        getBusinessProfile: async () => undefined
    }, jid);
    assert.equal(hidden.photoUrl, undefined);
    assert.equal(hidden.about, undefined);
    assert.equal(hidden.business, undefined);
});

test('profile cache survives restart and is deleted with its contact', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-profile-'));
    const filename = path.join(directory, 'profiles.json');
    try {
        await new FileProfileStore(filename).save('contact-a', { sharedName: 'Ana', nameSource: 'contact', fetchedAt: 42 });
        assert.equal((await new FileProfileStore(filename).get('contact-a')).sharedName, 'Ana');
        await new FileProfileStore(filename).remove('contact-a');
        assert.equal(await new FileProfileStore(filename).get('contact-a'), null);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
