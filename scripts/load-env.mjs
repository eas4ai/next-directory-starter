import * as nextEnv from '@next/env';

const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnv.default?.loadEnvConfig;

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
