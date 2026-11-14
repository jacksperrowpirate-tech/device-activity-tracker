import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';

export interface PhoneCountry {
    code: string;
    name: string;
    flag: string;
}

const names = new Intl.DisplayNames(['pt-BR'], { type: 'region' });

export function phoneCountry(input: string): PhoneCountry | null {
    const digits = input.replace(/\D/g, '');
    if (digits.length < 2 || digits.length > 15) return null;
    const international = `+${digits}`;
    const parsed = parsePhoneNumberFromString(international, { extract: false });
    const typing = new AsYouType();
    typing.input(international);
    const code = parsed?.country || typing.country;
    if (!code || code.length !== 2) return null;
    const flag = [...code].map(char => String.fromCodePoint(char.charCodeAt(0) + 127397)).join('');
    return { code, name: names.of(code) || code, flag };
}
