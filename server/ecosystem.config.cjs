module.exports = {
  apps: [
    {
      name: "backend",
      script: "server.js",
      cwd: "/root/tgbot/server",
      interpreter: "node",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
