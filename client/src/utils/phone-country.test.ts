import { phoneCountry } from './phone-country';

test('identifies the country from international phone numbers', () => {
    expect(phoneCountry('+55 61 99667-7010')).toMatchObject({ code: 'BR', flag: '🇧🇷' });
    expect(phoneCountry('+49 172 3411047')).toMatchObject({ code: 'DE', flag: '🇩🇪' });
    expect(phoneCountry('+33 7 87 56 72 96')).toMatchObject({ code: 'FR', flag: '🇫🇷' });
    expect(phoneCountry('123')).toBeNull();
});
