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
