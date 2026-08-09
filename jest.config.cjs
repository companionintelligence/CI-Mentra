/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    // Jest/ts-jest run under Node's CommonJS module loader, independent of
    // the app's own "type": "module" / NodeNext ESM setup used for the
    // Deno/tsc build. tsconfig.jest.json overrides "module" back to
    // CommonJS so ts-jest emits require()-based output Jest can execute.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/*.test.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/index.ts',
  ],
};
