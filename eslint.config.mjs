// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    { ignores: ['out/**', 'coverage/**', 'node_modules/**', 'src/__fixtures__/**', 'scripts/screenshots/sample/**', '*.js', '*.mjs'] },
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            // A promise nobody waits for loses its error: write `void` when it is meant
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off', // the compiler's noUnusedLocals and noUnusedParameters decide
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-unsafe-function-type': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
);
