import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../public/js/lang.js');

const ar = {
  'New sale': 'بيع جديد',
  'Hello, {name}': 'مرحباً، {name}',
  '{n} items': {
    zero: 'لا توجد عناصر', one: 'عنصر واحد', two: 'عنصران',
    few: '{n} عناصر', many: '{n} عنصراً', other: '{n} عنصر',
  },
};

describe('lang.js', () => {
  beforeEach(() => { L.__setCatalogue('en', {}); });

  it('returns the English text when the language is English', () => {
    assert.equal(L.t('New sale'), 'New sale');
  });

  it('fills placeholders', () => {
    assert.equal(L.t('Hello, {name}', { name: 'Amara' }), 'Hello, Amara');
  });

  it('translates from the active catalogue', () => {
    L.__setCatalogue('ar', ar);
    assert.equal(L.t('New sale'), 'بيع جديد');
    assert.equal(L.t('Hello, {name}', { name: 'Amara' }), 'مرحباً، Amara');
  });

  it('falls back to English for a key the catalogue lacks, rather than showing nothing', () => {
    L.__setCatalogue('ar', ar);
    assert.equal(L.t('Something new'), 'Something new');
  });

  it('picks English plurals by count', () => {
    assert.equal(L.tn('{n} item', '{n} items', 1), '1 item');
    assert.equal(L.tn('{n} item', '{n} items', 3), '3 items');
    assert.equal(L.tn('{n} item', '{n} items', 0), '0 items');
  });

  it('picks all six Arabic plural forms, which a one/other scheme gets wrong', () => {
    L.__setCatalogue('ar', ar);
    assert.equal(L.tn('{n} item', '{n} items', 0), 'لا توجد عناصر');
    assert.equal(L.tn('{n} item', '{n} items', 1), 'عنصر واحد');
    assert.equal(L.tn('{n} item', '{n} items', 2), 'عنصران');
    assert.equal(L.tn('{n} item', '{n} items', 5), '5 عناصر');
    assert.equal(L.tn('{n} item', '{n} items', 11), '11 عنصراً');
    assert.equal(L.tn('{n} item', '{n} items', 100), '100 عنصر');
  });

  it('knows which languages run right-to-left', () => {
    assert.equal(L.dirOf('ar'), 'rtl');
    assert.equal(L.dirOf('ur'), 'rtl');
    assert.equal(L.dirOf('en'), 'ltr');
    assert.equal(L.dirOf('nonsense'), 'ltr');
  });

  it('offers exactly the languages with a complete catalogue, each named in itself', () => {
    assert.deepEqual(L.LANGUAGES.map((l) => l.code), ['en', 'ar', 'ur']);
    assert.equal(L.LANGUAGES.find((l) => l.code === 'ar').name, 'العربية');
    assert.equal(L.LANGUAGES.find((l) => l.code === 'ur').name, 'اردو');
  });

  it('marks a string for translation without translating it yet', () => {
    assert.equal(L.N_('Booked in'), 'Booked in');
  });

  it('resolves the terminal language: an explicit choice wins, then the store, then English', () => {
    assert.equal(L.resolveLanguage('ur', 'ar-AE'), 'ur');
    assert.equal(L.resolveLanguage('store', 'ar-AE'), 'ar');
    assert.equal(L.resolveLanguage('', 'ur-PK'), 'ur');
    assert.equal(L.resolveLanguage('store', 'fr-FR'), 'en', 'no French catalogue, so English');
    assert.equal(L.resolveLanguage('klingon', ''), 'en');
  });

  it('translates into a language other than the screen, for receipts', () => {
    L.__setCatalogue('en', {});
    L.__setCatalogue('ar', ar, { activate: false });
    assert.equal(L.t('New sale'), 'New sale', 'the screen stays English');
    assert.equal(L.tIn('ar', 'New sale'), 'بيع جديد', 'the receipt is Arabic');
  });

  it('points from-to arrows in the reading direction of the screen', () => {
    L.__setCatalogue('en', {});
    assert.equal(L.arrow(), '→');
    L.__setCatalogue('ur', {});
    assert.equal(L.arrow(), '←');
  });
});
