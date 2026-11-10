jest.mock('vscode', () => ({ l10n: { t: (message: string) => message, bundle: { 'Hello {0}': '你好 {0}', 'a </script> b': 'x' } } }), { virtual: true });

import { webviewL10n } from '../../../core/i18n';
import { resetTranslations, t } from '../../../webview/shared/i18n';

describe('webview translations', () => {
    afterEach(() => { document.head.innerHTML = ''; resetTranslations(); });

    test('the extension puts its bundle into the page, and the webview translates with it', () => {
        document.head.innerHTML = webviewL10n();
        expect(t('Hello {0}', 'Ada')).toBe('你好 Ada');
        expect(t('{0} errors', 3)).toBe('3 errors');
    });

    test('a key with "</script>" cannot end the data block', () => {
        expect(webviewL10n()).not.toContain('</script> b');
        document.head.innerHTML = webviewL10n();
        expect(t('a </script> b')).toBe('x');
    });

    test('without the block (English) the English text is shown', () => {
        expect(t('Hello {0}', 'Ada')).toBe('Hello Ada');
    });
});
