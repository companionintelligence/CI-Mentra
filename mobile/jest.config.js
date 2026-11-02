/**
 * Unit tests for the app's pure helpers, config plugins and app config. They run in Node and
 * never load React Native or the Mentra SDK runtime (SDK imports in tested files are type-only).
 *
 * Test files are named *.spec.ts so the repository-root Jest config, which matches
 * *.test.ts and __tests__/, does not also collect them.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/ios/', '<rootDir>/android/'],
  modulePathIgnorePatterns: ['<rootDir>/ios/', '<rootDir>/android/'],
  // Untested source counts as 0%. .tsx is left out because this config has no transform for it.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', 'plugins/*.js', 'app.config.ts', '!plugins/*.spec.ts', '!app.config.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'es2022',
          esModuleInterop: true,
          resolveJsonModule: true,
          isolatedModules: true,
          strict: true,
          types: ['jest'],
        },
      },
    ],
  },
};
