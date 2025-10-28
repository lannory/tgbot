export default {
  apps: [
    {
      name: 'backend',
      script: './server.js',
      cwd: '/root/tgbot/server',
      watch: false,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
