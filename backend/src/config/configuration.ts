export default () => ({
  port: parseInt(process.env.PORT || '4000', 10),
  database: {
    type: process.env.DB_TYPE || 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3307', 10),
    username: process.env.DB_USERNAME || 'codeassess',
    password: process.env.DB_PASSWORD || 'codeassess_secret',
    name: process.env.DB_NAME || 'codeassess',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380', 10),
    password: process.env.REDIS_PASSWORD || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret',
    expiration: process.env.JWT_EXPIRATION || '24h',
  },
  judge0: {
    apiUrl: process.env.JUDGE0_API_URL || 'http://localhost:2358',
    apiKey: process.env.JUDGE0_API_KEY || '',
  },
});
