import type { WhatsAppProfile } from './infra/profile-store.js';

const MAX_TEXT = 500;
const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    return value.trim().slice(0, MAX_TEXT) || undefined;
};

function safePhotoUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && /(^|\.)(whatsapp\.net|fbcdn\.net)$/.test(url.hostname)) return url.href;
    } catch { /* An unavailable picture is not an error. */ }
    return undefined;
}

async function limited<T>(operation: () => Promise<T>): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            operation(),
            new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 6000); })
        ]);
    } catch { return undefined; }
    finally { if (timer) clearTimeout(timer); }
}

export async function fetchWhatsAppProfile(sock: any, jid: string, previous?: WhatsAppProfile | null): Promise<WhatsAppProfile> {
    const [picture, statuses, business] = await Promise.all([
        limited(() => sock.profilePictureUrl(jid, 'image')),
        limited(() => sock.fetchStatus(jid)),
        limited(() => sock.getBusinessProfile(jid))
    ]);
    const status = Array.isArray(statuses) ? statuses.find((item: any) => item?.id === jid)?.status : undefined;
    const businessInfo = business && typeof business === 'object' ? business as Record<string, any> : undefined;
    const businessDetails = businessInfo ? {
        description: text(businessInfo.description),
        category: text(businessInfo.category),
        website: typeof businessInfo.website?.[0] === 'string' ? text(businessInfo.website[0]) : undefined,
        email: text(businessInfo.email),
        address: text(businessInfo.address)
    } : undefined;
    const about = text(status?.status);
    const aboutSetAt = status?.setAt instanceof Date && Number.isFinite(status.setAt.getTime()) ? status.setAt.getTime() : undefined;
    return {
        photoUrl: safePhotoUrl(picture),
        sharedName: previous?.sharedName,
        nameSource: previous?.nameSource,
        about,
        aboutSetAt,
        business: businessDetails && Object.values(businessDetails).some(Boolean) ? businessDetails : undefined,
        fetchedAt: Date.now()
    };
}

export function contactSharedName(contact: { name?: unknown; notify?: unknown; verifiedName?: unknown }): Pick<WhatsAppProfile, 'sharedName' | 'nameSource'> | null {
    const verifiedName = text(contact.verifiedName);
    if (verifiedName) return { sharedName: verifiedName.slice(0, 120), nameSource: 'business' };
    const sharedName = text(contact.notify);
    return sharedName ? { sharedName: sharedName.slice(0, 120), nameSource: 'contact' } : null;
}
